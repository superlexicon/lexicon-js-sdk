/**
 * @superlexicon/sdk/app-store
 *
 * Headless On-Chain HFS App Store (`app_store.wasm`, HPS #27), Content-Addressed UI Bundle
 * Compressor/Verifier (`keccak256` + `CompressionStream('gzip')`), `IndexedDB` Immutable Bundle
 * Cache (`SlxUiBundleCache`), and Zero-Trust Sandboxed Iframe `window.slx` Host Bridge.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Hex,
  selectorBytes,
  computeCreateAddress,
  signOrderedLexiconTx,
} from './crypto.js';
import {
  ZERO_ADDR,
  ZERO_BYTES32,
  shortHex,
  truncAddr4,
  readU16BE,
  readU64BE,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
} from './abi.js';
import { getDefaultNodeWsUrl, SlxHfsCache, slxNodeRpc } from './rpc.js';
import { slxWaitForReceipt } from './events.js';
import {
  encodeHfsTypeId,
  HfsRegistryAbi,
  readOnChainIdentityNickname,
  HFS_ASSOC_STATUS,
} from './identity.js';
import {
  SUBGROUP_ALL_MEMBERS_SLUG,
  SUBGROUP_DEVELOPERS_SLUG,
  SOVEREIGN_SUPERLEXICON_CHARTER_SPEC,
  isConfusableSuperlexiconName,
  companyGroupChannelHash,
  isPublicWebsiteRpcUrl,
  CharterSocialAbi,
  decodeEntityProfileHex,
  decodeCompanySocialOverviewHex,
  resolveSovereignSuperlexiconCharter,
  checkSuperlexiconDeveloperStanding,
} from './charter-social.js';

export {
  SUBGROUP_ALL_MEMBERS_SLUG,
  SUBGROUP_DEVELOPERS_SLUG,
  SOVEREIGN_SUPERLEXICON_CHARTER_SPEC,
  isConfusableSuperlexiconName,
  companyGroupChannelHash,
  isPublicWebsiteRpcUrl,
  CharterSocialAbi,
  decodeEntityProfileHex,
  decodeCompanySocialOverviewHex,
  resolveSovereignSuperlexiconCharter,
  checkSuperlexiconDeveloperStanding,
};

export const APP_STORE_CODE_HASH =
  '0xee9d0de546e867f3a564e67cca86ea8988b965246b240eb93c9c2fc83ee90646';
export const BYTECODE_STORE_ADDRESS = '0x0000000000000000000000000000000000000100';

export const APP_STORE_CHUNK_BYTES = 32_768; // 32 KiB per chunk (up to 8 chunks = 256 KiB compressed)
export const APP_STORE_MAX_CHUNKS = 8;

export const APP_STORE_ENCODING = {
  RAW_UTF8: 0,
  GZIP: 1,
};

export const APP_EXEC_MODE = {
  SANDBOX_IFRAME: 0,
  VERIFIED_HOST: 1,
};

export const APP_STATUS = {
  ACTIVE: 1,
  ARCHIVED: 2,
};

export const APP_CATEGORIES = {
  1: {
    id: 1,
    key: 'defi',
    label: 'Markets & DeFi',
    shortLabel: 'DeFi & CLOB',
    icon: '📈',
    description: 'Central limit order books, batch auctions, liquidity & asset settlement',
  },
  2: {
    id: 2,
    key: 'governance',
    label: 'Corporate, Governance & IFRS',
    shortLabel: 'Gov & IFRS',
    icon: '🏛️',
    description: 'Statutory charters, quorums, secret ballots & double-entry ZK accounting',
  },
  3: {
    id: 3,
    key: 'commerce',
    label: 'Commerce, Hardware & Rewards',
    shortLabel: 'Commerce',
    icon: '🚀',
    description: 'Retail/B2B storefronts, milestone hardware pre-orders & validator vouchers',
  },
  4: {
    id: 4,
    key: 'social',
    label: 'Social, Comms & Guilds',
    shortLabel: 'Social & RF',
    icon: '📡',
    description: 'Radio-bounded communities, ECIES messaging, guilds & repeater walls',
  },
  5: {
    id: 5,
    key: 'games',
    label: 'Multiplayer Games & VRF',
    shortLabel: 'Games & VRF',
    icon: '🎮',
    description: 'Real-time naval arenas, grand strategy, ZK deduction & quorum-VRF jackpots',
  },
  6: {
    id: 6,
    key: 'rf',
    label: 'RF, Civic & Dev Utilities',
    shortLabel: 'Utilities',
    icon: '⚡',
    description: 'Mesh diagnostics, civic micro-polls, bounty splits & developer tools',
  },
};

export function resolveAppCategory(catOrKey) {
  if (catOrKey === null || catOrKey === undefined || catOrKey === '' || catOrKey === 0 || catOrKey === '0' || catOrKey === 'all') {
    return null;
  }
  const asNum = Number(catOrKey);
  if (Number.isInteger(asNum) && APP_CATEGORIES[asNum]) {
    return APP_CATEGORIES[asNum];
  }
  const cleanKey = String(catOrKey).trim().toLowerCase();
  return (
    Object.values(APP_CATEGORIES).find(
      (c) => c.key === cleanKey || c.label.toLowerCase() === cleanKey
    ) || null
  );
}

const STORAGE_APP_STORE_ADDR_KEY = 'slx_app_store_hfs_addr_v1';
const STORAGE_LOCAL_PUBLISHED_APPS_KEY = 'slx_local_published_apps_v1';
const STORAGE_CACHED_UI_INDEX_KEY = 'slx_cached_ui_index_v1';
const STORAGE_MANIFEST_CACHE_KEY = 'slx_manifest_cache_v1';
const STORAGE_PERSONAL_CONTAINER_KEY = 'slx_personal_app_container_v1';
const CACHE_STORAGE_BUNDLES_NAME = 'slx-hfs-app-bundles-v1';
const IDB_NAME = 'slx_app_bundle_cas_v1';
const IDB_STORE_HTML = 'verified_html';
const IDB_STORE_RAW = 'raw_bundles';

// ---------------------------------------------------------------------------
// 1. Gzip Compression / Decompression & `keccak256` Bundle Verification
// ---------------------------------------------------------------------------

async function _streamTransform(inputBytes, streamInstance) {
  const writer = streamInstance.writable.getWriter();
  writer.write(inputBytes);
  writer.close();
  const reader = streamInstance.readable.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBytes(...chunks);
}

export async function compressAppUiBundle(htmlString) {
  const rawBytes = utf8ToBytes(String(htmlString || ''));
  let compressedBytes = rawBytes;
  let encoding = APP_STORE_ENCODING.RAW_UTF8;

  if (typeof globalThis.CompressionStream === 'function') {
    try {
      compressedBytes = await _streamTransform(rawBytes, new globalThis.CompressionStream('gzip'));
      encoding = APP_STORE_ENCODING.GZIP;
    } catch (_) {
      compressedBytes = rawBytes;
      encoding = APP_STORE_ENCODING.RAW_UTF8;
    }
  }

  const uiHash = keccak256Hex(compressedBytes);
  const chunkCount = Math.max(1, Math.ceil(compressedBytes.length / APP_STORE_CHUNK_BYTES));
  return {
    bytes: compressedBytes,
    encoding,
    uncompressedLen: rawBytes.length,
    compressedLen: compressedBytes.length,
    uiHash,
    chunkCount,
  };
}

export async function decompressAppUiBundle(payloadBytes, encoding = APP_STORE_ENCODING.GZIP) {
  const u8 = payloadBytes instanceof Uint8Array ? payloadBytes : hexToBytes(payloadBytes);
  if (!u8.length) return '';
  const isGzipMagic = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  if ((encoding === APP_STORE_ENCODING.GZIP || isGzipMagic) && typeof globalThis.DecompressionStream === 'function') {
    const out = await _streamTransform(u8, new globalThis.DecompressionStream('gzip'));
    return bytesToUtf8(out);
  }
  return bytesToUtf8(u8);
}

export async function verifyAndUnpackAppUiBundle(
  payloadBytes,
  expectedUiHash,
  encoding = APP_STORE_ENCODING.GZIP
) {
  const u8 = payloadBytes instanceof Uint8Array ? payloadBytes : hexToBytes(payloadBytes);
  const cleanExpected = String(expectedUiHash || '').trim().toLowerCase();
  const actualHash = keccak256Hex(u8).toLowerCase();
  if (cleanExpected && cleanExpected !== ZERO_BYTES32 && actualHash !== cleanExpected) {
    throw new Error(
      `UI bundle integrity check failed: expected ${shortHex(cleanExpected)}, computed ${shortHex(actualHash)}`
    );
  }
  const html = await decompressAppUiBundle(u8, encoding);
  return {
    uiHash: actualHash,
    compressedLen: u8.length,
    uncompressedLen: utf8ToBytes(html).length,
    html,
  };
}

export function splitBundleIntoChunks(compressedBytes) {
  const chunks = [];
  for (let off = 0; off < compressedBytes.length; off += APP_STORE_CHUNK_BYTES) {
    chunks.push(compressedBytes.subarray(off, Math.min(compressedBytes.length, off + APP_STORE_CHUNK_BYTES)));
  }
  return chunks;
}

export function slugToBytes32(slug) {
  const clean = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return keccak256Hex(utf8ToBytes(clean));
}

// ---------------------------------------------------------------------------
// 2. Persistent Content-Addressed Local UI Bundle Cache (`IndexedDB` + `CacheStorage` + Sync Index)
// ---------------------------------------------------------------------------

const _memHtmlCache = new Map();
const _memRawBundleCache = new Map();
let _idbPromise = null;

function _loadUiCacheIndexMap() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_CACHED_UI_INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function _saveUiCacheIndexMap(mapObj) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_CACHED_UI_INDEX_KEY, JSON.stringify(mapObj || {}));
  } catch (_) {}
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('slx:ui-cache-changed'));
    } catch (_) {}
  }
}

function _syntheticBundleCacheUrl(cleanHash) {
  return `/__slx_app_bundle_cas__/${cleanHash}.bin`;
}

function _openIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_HTML)) {
          db.createObjectStore(IDB_STORE_HTML);
        }
        if (!db.objectStoreNames.contains(IDB_STORE_RAW)) {
          db.createObjectStore(IDB_STORE_RAW);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return _idbPromise;
}

export function cacheCatalogManifestLocal(manifestObj) {
  if (typeof localStorage === 'undefined' || !manifestObj || !Array.isArray(manifestObj.apps)) {
    return;
  }
  try {
    localStorage.setItem(
      STORAGE_MANIFEST_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        apps: manifestObj.apps,
      })
    );
  } catch (_) {}
}

export function getCachedCatalogManifestLocal() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.apps) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export const SlxUiBundleCache = {
  isCachedSync(uiHash) {
    if (!uiHash) return false;
    const key = String(uiHash).trim().toLowerCase();
    if (!key || key === ZERO_BYTES32) return false;
    if (_memHtmlCache.has(key) || _memRawBundleCache.has(key)) return true;
    const idx = _loadUiCacheIndexMap();
    return Boolean(idx[key]);
  },

  getCacheEntryMetaSync(uiHash) {
    if (!uiHash) return null;
    const key = String(uiHash).trim().toLowerCase();
    const idx = _loadUiCacheIndexMap();
    return idx[key] || null;
  },

  getCacheStats() {
    const idx = _loadUiCacheIndexMap();
    const entries = Object.values(idx);
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    for (const e of entries) {
      totalCompressedBytes += Number(e?.compressedLen || 0);
      totalUncompressedBytes += Number(e?.uncompressedLen || 0);
    }
    return {
      count: entries.length,
      totalCompressedBytes,
      totalUncompressedBytes,
      entries,
    };
  },

  async getVerifiedHtml(uiHash) {
    if (!uiHash) return null;
    const key = String(uiHash).trim().toLowerCase();
    if (_memHtmlCache.has(key)) return _memHtmlCache.get(key);
    const db = await _openIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_HTML, 'readonly');
        const req = tx.objectStore(IDB_STORE_HTML).get(key);
        req.onsuccess = () => {
          if (req.result) _memHtmlCache.set(key, req.result);
          resolve(req.result || null);
        };
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  },

  async putVerifiedHtml(uiHash, entry, metaHint = {}) {
    if (!uiHash || !entry?.html) return;
    const key = String(uiHash).trim().toLowerCase();
    const record = {
      ...entry,
      uiHash: key,
      cachedAt: entry.cachedAt || Date.now(),
    };
    _memHtmlCache.set(key, record);

    const idx = _loadUiCacheIndexMap();
    const prev = idx[key] || {};
    idx[key] = {
      uiHash: key,
      slug: metaHint.slug || entry.slug || prev.slug || '',
      title: metaHint.title || entry.title || prev.title || '',
      compressedLen: Number(entry.compressedLen || metaHint.compressedLen || prev.compressedLen || 0),
      uncompressedLen: Number(
        entry.uncompressedLen || metaHint.uncompressedLen || utf8ToBytes(entry.html).length
      ),
      cachedAt: record.cachedAt,
    };
    _saveUiCacheIndexMap(idx);

    const db = await _openIdb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_HTML, 'readwrite');
        tx.objectStore(IDB_STORE_HTML).put(record, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  },

  async putRawBundle(uiHash, bytes, encoding = APP_STORE_ENCODING.GZIP) {
    if (!uiHash || !bytes) return;
    const key = String(uiHash).trim().toLowerCase();
    const u8 = bytes instanceof Uint8Array ? bytes : hexToBytes(bytes);
    const payload = { bytes: u8, encoding };
    _memRawBundleCache.set(key, payload);

    // Mirror raw compressed bundle into browser CacheStorage when available
    if (typeof globalThis.caches !== 'undefined' && typeof Response === 'function') {
      try {
        const cache = await globalThis.caches.open(CACHE_STORAGE_BUNDLES_NAME);
        await cache.put(
          _syntheticBundleCacheUrl(key),
          new Response(u8, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Slx-Encoding': String(encoding),
            },
          })
        );
      } catch (_) {}
    }

    const db = await _openIdb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_RAW, 'readwrite');
        tx.objectStore(IDB_STORE_RAW).put(payload, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  },

  async getRawBundle(uiHash) {
    if (!uiHash) return null;
    const key = String(uiHash).trim().toLowerCase();
    if (_memRawBundleCache.has(key)) return _memRawBundleCache.get(key);
    const db = await _openIdb();
    if (db) {
      const idbHit = await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_RAW, 'readonly');
          const req = tx.objectStore(IDB_STORE_RAW).get(key);
          req.onsuccess = () => {
            if (req.result) _memRawBundleCache.set(key, req.result);
            resolve(req.result || null);
          };
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
      if (idbHit) return idbHit;
    }

    // Fallback check in browser CacheStorage
    if (typeof globalThis.caches !== 'undefined') {
      try {
        const cache = await globalThis.caches.open(CACHE_STORAGE_BUNDLES_NAME);
        const match = await cache.match(_syntheticBundleCacheUrl(key));
        if (match) {
          const bytes = new Uint8Array(await match.arrayBuffer());
          const encoding = Number(match.headers.get('X-Slx-Encoding') ?? APP_STORE_ENCODING.GZIP);
          const payload = { bytes, encoding };
          _memRawBundleCache.set(key, payload);
          return payload;
        }
      } catch (_) {}
    }
    return null;
  },

  async evictBundle(uiHash) {
    if (!uiHash) return;
    const key = String(uiHash).trim().toLowerCase();
    _memHtmlCache.delete(key);
    _memRawBundleCache.delete(key);

    const idx = _loadUiCacheIndexMap();
    if (idx[key]) {
      delete idx[key];
      _saveUiCacheIndexMap(idx);
    }

    if (typeof globalThis.caches !== 'undefined') {
      try {
        const cache = await globalThis.caches.open(CACHE_STORAGE_BUNDLES_NAME);
        await cache.delete(_syntheticBundleCacheUrl(key));
      } catch (_) {}
    }

    const db = await _openIdb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction([IDB_STORE_HTML, IDB_STORE_RAW], 'readwrite');
        tx.objectStore(IDB_STORE_HTML).delete(key);
        tx.objectStore(IDB_STORE_RAW).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  },

  async clearUnusedCache(keepUiHashes = []) {
    const keepSet = new Set(
      (keepUiHashes || []).map((h) => String(h || '').trim().toLowerCase()).filter(Boolean)
    );
    const idx = _loadUiCacheIndexMap();
    const toEvict = Object.keys(idx).filter((k) => !keepSet.has(k));
    for (const k of toEvict) {
      await this.evictBundle(k);
    }
    return toEvict.length;
  },
};

// ---------------------------------------------------------------------------
// 3. `AppStore` HFS ABI Encoders & Binary Slice Decoders
// ---------------------------------------------------------------------------

export const AppStoreAbi = {
  initialize: (adminAddr) => encodeAbi('initialize(address)', [['address', adminAddr]]),
  initializeWithDeveloperGate: (
    adminAddr,
    superlexiconCharterAddr,
    subgroupSlug = SUBGROUP_DEVELOPERS_SLUG
  ) =>
    encodeAbi('initializeWithDeveloperGate(address,address,bytes32)', [
      ['address', adminAddr],
      ['address', superlexiconCharterAddr],
      ['bytes32', subgroupSlug || SUBGROUP_DEVELOPERS_SLUG],
    ]),
  setAuthorizedPublisherGroup: (superlexiconCharterAddr, subgroupSlug = SUBGROUP_DEVELOPERS_SLUG) =>
    encodeAbi('setAuthorizedPublisherGroup(address,bytes32)', [
      ['address', superlexiconCharterAddr],
      ['bytes32', subgroupSlug || SUBGROUP_DEVELOPERS_SLUG],
    ]),
  authorizedPublisherGroup: () => bytesToHex(selectorBytes('authorizedPublisherGroup()')),
  canPublish: (actorAddr) => encodeAbi('canPublish(address)', [['address', actorAddr]]),
  abiVersion: () => bytesToHex(selectorBytes('abiVersion()')),
  admin: () => bytesToHex(selectorBytes('admin()')),
  uploadBundleChunk: ({ uiHash, chunkIndex, totalChunks, encoding, uncompressedLen, chunkBytes }) =>
    encodeAbi('uploadBundleChunk(bytes32,uint64,uint64,uint64,uint64,bytes)', [
      ['bytes32', uiHash],
      ['uint64', chunkIndex],
      ['uint64', totalChunks],
      ['uint64', encoding],
      ['uint64', uncompressedLen],
      ['bytes', chunkBytes instanceof Uint8Array ? chunkBytes : hexToBytes(chunkBytes)],
    ]),
  hasBundle: (uiHash) => encodeAbi('hasBundle(bytes32)', [['bytes32', uiHash]]),
  getBundleInfo: (uiHash) => encodeAbi('getBundleInfo(bytes32)', [['bytes32', uiHash]]),
  getBundleChunk: (uiHash, chunkIndex) =>
    encodeAbi('getBundleChunk(bytes32,uint64)', [
      ['bytes32', uiHash],
      ['uint64', chunkIndex],
    ]),
  getBundle: (uiHash) => encodeAbi('getBundle(bytes32)', [['bytes32', uiHash]]),
  publishApp: ({
    slugId,
    publisherIdentity = ZERO_ADDR,
    wasmCodeHash = ZERO_BYTES32,
    defaultHfsAddr = ZERO_ADDR,
    uiHash,
    category = 6,
    execMode = APP_EXEC_MODE.SANDBOX_IFRAME,
    title,
    summary = '',
    icon = '🧩',
    version = '1.0.0',
  }) =>
    encodeAbi(
      'publishApp(bytes32,address,bytes32,address,bytes32,uint64,uint64,string,string,string,string)',
      [
        ['bytes32', slugId],
        ['address', publisherIdentity || ZERO_ADDR],
        ['bytes32', wasmCodeHash || ZERO_BYTES32],
        ['address', defaultHfsAddr || ZERO_ADDR],
        ['bytes32', uiHash],
        ['uint64', category],
        ['uint64', execMode],
        ['string', String(title || '').slice(0, 64)],
        ['string', String(summary || '').slice(0, 240)],
        ['string', String(icon || '🧩').slice(0, 16)],
        ['string', String(version || '1.0.0').slice(0, 24)],
      ]
    ),
  setAppStatus: (appId, status, execMode) =>
    encodeAbi('setAppStatus(uint64,uint64,uint64)', [
      ['uint64', appId],
      ['uint64', status],
      ['uint64', execMode],
    ]),
  registerAppInstance: ({ appId, instanceAddr, creatorIdentity = ZERO_ADDR, label = '' }) =>
    encodeAbi('registerAppInstance(uint64,address,address,string)', [
      ['uint64', appId],
      ['address', instanceAddr],
      ['address', creatorIdentity || ZERO_ADDR],
      ['string', String(label || '').slice(0, 64)],
    ]),
  bindInstanceUi: (instanceAddr, appId, uiHash) =>
    encodeAbi('bindInstanceUi(address,uint64,bytes32)', [
      ['address', instanceAddr],
      ['uint64', appId],
      ['bytes32', uiHash],
    ]),
  totalApps: () => bytesToHex(selectorBytes('totalApps()')),
  totalBundles: () => bytesToHex(selectorBytes('totalBundles()')),
  getApp: (appId) => encodeAbi('getApp(uint64)', [['uint64', appId]]),
  getAppBySlug: (slugId) => encodeAbi('getAppBySlug(bytes32)', [['bytes32', slugId]]),
  getAppsSlice: (offset = 0, limit = 24) =>
    encodeAbi('getAppsSlice(uint64,uint64)', [
      ['uint64', offset],
      ['uint64', limit],
    ]),
  getAppInstances: (appId, offset = 0, limit = 32) =>
    encodeAbi('getAppInstances(uint64,uint64,uint64)', [
      ['uint64', appId],
      ['uint64', offset],
      ['uint64', limit],
    ]),
  resolveInstance: (instanceAddr) =>
    encodeAbi('resolveInstance(address)', [['address', instanceAddr]]),
};

export function decodeAppRecordAt(buf, offset = 0) {
  if (!buf || offset + 180 > buf.length) return null;
  const appId = Number(readU64BE(buf, offset));
  const status = buf[offset + 8];
  const execMode = buf[offset + 9];
  const category = readU16BE(buf, offset + 10);
  const slugId = bytesToHex(buf.subarray(offset + 12, offset + 44));
  const publisher = bytesToHex(buf.subarray(offset + 44, offset + 64)).toLowerCase();
  const wasmCodeHash = bytesToHex(buf.subarray(offset + 64, offset + 96)).toLowerCase();
  const defaultHfsAddr = bytesToHex(buf.subarray(offset + 96, offset + 116)).toLowerCase();
  const uiHash = bytesToHex(buf.subarray(offset + 116, offset + 148)).toLowerCase();
  const releaseCount = Number(readU64BE(buf, offset + 148));
  const installCount = Number(readU64BE(buf, offset + 156));
  const updatedBlock = Number(readU64BE(buf, offset + 164));
  const tLen = readU16BE(buf, offset + 172);
  const sLen = readU16BE(buf, offset + 174);
  const iLen = readU16BE(buf, offset + 176);
  const vLen = readU16BE(buf, offset + 178);

  let p = offset + 180;
  if (p + tLen + sLen + iLen + vLen > buf.length) return null;
  const title = bytesToUtf8(buf.subarray(p, p + tLen));
  p += tLen;
  const summary = bytesToUtf8(buf.subarray(p, p + sLen));
  p += sLen;
  const icon = bytesToUtf8(buf.subarray(p, p + iLen)) || '🧩';
  p += iLen;
  const version = bytesToUtf8(buf.subarray(p, p + vLen)) || '1.0.0';
  p += vLen;

  return {
    nextOffset: p,
    record: {
      appId,
      status,
      execMode,
      category,
      slugId,
      publisher,
      wasmCodeHash,
      defaultHfsAddr,
      uiHash,
      releaseCount,
      installCount,
      updatedBlock,
      title,
      summary,
      icon,
      version,
      source: 'onchain',
    },
  };
}

export function decodeSingleAppHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 180) return null;
  const parsed = decodeAppRecordAt(b, 0);
  return parsed ? parsed.record : null;
}

export function decodeAppsSliceHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 16) return { total: 0, items: [] };
  const total = Number(readU64BE(b, 0));
  const returned = Number(readU64BE(b, 8));
  const items = [];
  let pos = 16;
  for (let i = 0; i < returned; i++) {
    const parsed = decodeAppRecordAt(b, pos);
    if (!parsed) break;
    items.push(parsed.record);
    pos = parsed.nextOffset;
  }
  return { total, items };
}

export function decodeAppInstancesSliceHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 16) return { total: 0, items: [] };
  const total = Number(readU64BE(b, 0));
  const returned = Number(readU64BE(b, 8));
  const items = [];
  let pos = 16;
  for (let i = 0; i < returned; i++) {
    if (pos + 50 > b.length) break;
    const instanceAddr = bytesToHex(b.subarray(pos, pos + 20)).toLowerCase();
    const creator = bytesToHex(b.subarray(pos + 20, pos + 40)).toLowerCase();
    const createdBlock = Number(readU64BE(b, pos + 40));
    const lLen = readU16BE(b, pos + 48);
    pos += 50;
    if (pos + lLen > b.length) break;
    const label = bytesToUtf8(b.subarray(pos, pos + lLen));
    pos += lLen;
    items.push({ instanceAddr, creator, createdBlock, label });
  }
  return { total, items };
}

export function decodeBundleInfoHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 192) {
    return { sealed: false, totalChunks: 0, compressedLen: 0, uncompressedLen: 0, encoding: 0, uploader: ZERO_ADDR };
  }
  return {
    sealed: Number(readU64BE(b, 24)) === 1,
    totalChunks: Number(readU64BE(b, 56)),
    compressedLen: Number(readU64BE(b, 88)),
    uncompressedLen: Number(readU64BE(b, 120)),
    encoding: Number(readU64BE(b, 152)),
    uploader: bytesToHex(b.subarray(172, 192)).toLowerCase(),
  };
}

export function decodeResolvedInstanceHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 128) return null;
  const appId = Number(readU64BE(b, 24));
  if (!appId) return null;
  return {
    appId,
    uiHash: bytesToHex(b.subarray(32, 64)).toLowerCase(),
    wasmCodeHash: bytesToHex(b.subarray(64, 96)).toLowerCase(),
    execMode: b[127],
  };
}

// ---------------------------------------------------------------------------
// 4. Local Published App Mirror & On-Chain `AppStoreClient`
// ---------------------------------------------------------------------------

export function loadLocalPublishedApps() {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_LOCAL_PUBLISHED_APPS_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

export function saveLocalPublishedApp(appMeta) {
  if (typeof localStorage === 'undefined') return;
  try {
    const list = loadLocalPublishedApps();
    const idx = list.findIndex(
      (x) => x.slug === appMeta.slug || (x.slugId && x.slugId === appMeta.slugId)
    );
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...appMeta, releaseCount: (list[idx].releaseCount || 1) + 1 };
    } else {
      list.unshift({ ...appMeta, releaseCount: appMeta.releaseCount || 1 });
    }
    localStorage.setItem(STORAGE_LOCAL_PUBLISHED_APPS_KEY, JSON.stringify(list));
  } catch (_) {}
}

async function _waitReceipts(rpcUrl, hashes) {
  const rcpts = await Promise.all(
    hashes.map((h) => slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, { timeoutMs: 56_000, fallbackPollMs: 220 }))
  );
  rcpts.forEach((r, idx) => {
    if (!r) throw new Error(`Timed out waiting for Subnet 1 receipt (${hashes[idx].slice(0, 10)}…)`);
    if (r.status !== '0x1') throw new Error(`Subnet 1 transaction reverted (${hashes[idx].slice(0, 10)}…)`);
  });
  return rcpts;
}

export class AppStoreClient {
  constructor({ rpcUrl = getDefaultNodeWsUrl(), storeAddr = '' } = {}) {
    this.rpcUrl = rpcUrl;
    this.storeAddr = storeAddr ? storeAddr.toLowerCase() : '';
  }

  async resolveStoreAddress() {
    if (this.storeAddr && this.storeAddr !== ZERO_ADDR) {
      const ok = await this._probeAppStore(this.storeAddr);
      if (ok) return this.storeAddr;
    }

    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_APP_STORE_ADDR_KEY);
      if (saved && /^0x[0-9a-f]{40}$/i.test(saved)) {
        if (await this._probeAppStore(saved)) {
          this.storeAddr = saved.toLowerCase();
          return this.storeAddr;
        }
      }
    }

    try {
      const { manifest } = await SlxHfsCache.hydrateWithManifest();
      const fromManifest = manifest?.contracts?.appStore || manifest?.appStore;
      if (fromManifest && (await this._probeAppStore(fromManifest))) {
        this.setStoreAddress(fromManifest);
        return this.storeAddr;
      }
      const regAddr = manifest?.institutional?.hfsRegistry || manifest?.hfsRegistry;
      if (regAddr) {
        const typeId = encodeHfsTypeId('APP_STORE');
        const sliceHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
          { to: regAddr, data: HfsRegistryAbi.getInstancesByType(typeId, 0, 4) },
          'latest',
        ]);
        const sb = hexToBytes(sliceHex);
        if (sb.length >= 16 + 109) {
          const retCnt = Number(readU64BE(sb, 8));
          if (retCnt > 0) {
            const cand = bytesToHex(sb.subarray(16 + 5, 16 + 25)).toLowerCase();
            if (await this._probeAppStore(cand)) {
              this.setStoreAddress(cand);
              return this.storeAddr;
            }
          }
        }
      }
    } catch (_) {}

    return '';
  }

  setStoreAddress(addr) {
    this.storeAddr = String(addr || '').trim().toLowerCase();
    if (typeof localStorage !== 'undefined' && /^0x[0-9a-f]{40}$/.test(this.storeAddr)) {
      try {
        localStorage.setItem(STORAGE_APP_STORE_ADDR_KEY, this.storeAddr);
      } catch (_) {}
    }
  }

  async _probeAppStore(addr) {
    if (!addr || addr === ZERO_ADDR) return false;
    try {
      const verHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: addr, data: AppStoreAbi.abiVersion() },
        'latest',
      ]);
      return decodeUintWord(verHex) >= 1;
    } catch (_) {
      return false;
    }
  }

  async deployAppStoreOnChain({ wallet, wasmUrl = '/contracts/app_store.wasm', onStatus = null }) {
    const emit = (m) => {
      if (typeof onStatus === 'function') onStatus(m);
    };
    emit('Fetching app_store.wasm (23.7 KB)…');
    let resp = await fetch(wasmUrl, { cache: 'no-store' });
    if (!resp.ok) resp = await fetch('/public/contracts/app_store.wasm', { cache: 'no-store' });
    if (!resp.ok) throw new Error('Could not fetch /contracts/app_store.wasm');
    const wasmBytes = new Uint8Array(await resp.arrayBuffer());
    const codeHash = keccak256Hex(wasmBytes);

    const idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl: this.rpcUrl,
      appName: 'SuperLexicon HFS App Store',
    });
    const myEoa = wallet.keypair.address;
    const myPriv = wallet.keypair.privateKey;
    const ZERO_LB = '0x' + '00'.repeat(32);

    const n0 = BigInt(await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const predictedStoreAddr = computeCreateAddress(myEoa, n0 + 1n).toLowerCase();

    emit(`Uploading app_store.wasm & instantiating AppStore HFS (${shortHex(predictedStoreAddr)})…`);
    const txStore = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: n0,
      to: BYTECODE_STORE_ADDRESS,
      data: codeHash + bytesToHex(wasmBytes, false),
      gasLimit: 7_500_000n,
      lowerBoundHashHex: ZERO_LB,
    });
    const txInst = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: n0 + 1n,
      to: null,
      data: codeHash,
      gasLimit: 4_800_000n,
      extraTargets: [predictedStoreAddr],
      lowerBoundHashHex: txStore.txHash,
    });
    const initSov = await resolveSovereignSuperlexiconCharter(this.rpcUrl);
    const initCd = initSov
      ? AppStoreAbi.initializeWithDeveloperGate(idRec.identityAddr, initSov, SUBGROUP_DEVELOPERS_SLUG)
      : AppStoreAbi.initialize(idRec.identityAddr);
    const txInit = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: n0 + 2n,
      to: predictedStoreAddr,
      data: initCd,
      gasLimit: 4_500_000n,
      extraTargets: [predictedStoreAddr],
      lowerBoundHashHex: txInst.txHash,
    });

    const hashes = [];
    for (const t of [txStore, txInst, txInit]) {
      hashes.push(await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [t.raw]));
    }
    const rcpts = await _waitReceipts(this.rpcUrl, hashes);
    const confirmedAddr = (rcpts[1]?.contractAddress || predictedStoreAddr).toLowerCase();
    this.setStoreAddress(confirmedAddr);

    // Best-effort HfsRegistry global registration so all browsers auto-discover it
    try {
      const { manifest } = await SlxHfsCache.hydrateWithManifest();
      const regAddr = manifest?.institutional?.hfsRegistry || manifest?.hfsRegistry;
      if (regAddr) {
        const nReg = BigInt(await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
        const regCd = HfsRegistryAbi.registerInstance({
          typeId: encodeHfsTypeId('APP_STORE'),
          primaryAddr: confirmedAddr,
          creatorIdentity: idRec.identityAddr,
          label: 'SuperLexicon Subnet App Store',
          metaBytes: new Uint8Array(0),
        });
        const sReg = signOrderedLexiconTx({
          privateKey: myPriv,
          nonce: nReg,
          to: regAddr,
          data: regCd,
          gasLimit: 4_800_000n,
          extraTargets: [regAddr, confirmedAddr],
        });
        await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [sReg.raw]);
      }
    } catch (_) {}

    emit(`✓ AppStore HFS live at ${shortHex(confirmedAddr)}!`);
    return confirmedAddr;
  }

  async checkPublisherStanding(wallet) {
    const storeAddr = await this.resolveStoreAddress();
    const idRec = wallet?.getIdentityRecord?.() || null;
    const identityAddr = idRec?.identityAddr || '';
    const eoaAddr = wallet?.keypair?.address || '';
    return checkSuperlexiconDeveloperStanding({
      rpcUrl: this.rpcUrl,
      identityAddr,
      eoaAddr,
      storeAddr,
    });
  }

  async uploadUiBundleOnChain({ wallet, htmlSource, slug = '', title = '', onStatus = null }) {
    const emit = (m) => {
      if (typeof onStatus === 'function') onStatus(m);
    };
    // Enforce Superlexicon · Developers social group membership before Web RPC publish / HFS deploy
    const standing = await this.checkPublisherStanding(wallet);
    if (!standing.authorized) {
      throw new Error(
        standing.reason ||
          'Only members of the Superlexicon · Developers social subgroup (linked to Superlexicon Pte. Ltd. CorporateCharter) are authorized to publish apps or deploy HFS over Web RPC.'
      );
    }

    const packed = await compressAppUiBundle(htmlSource);
    await SlxUiBundleCache.putRawBundle(packed.uiHash, packed.bytes, packed.encoding);
    await SlxUiBundleCache.putVerifiedHtml(
      packed.uiHash,
      {
        uiHash: packed.uiHash,
        compressedLen: packed.compressedLen,
        uncompressedLen: packed.uncompressedLen,
        html: htmlSource,
      },
      { slug, title }
    );

    if (!this.storeAddr) throw new Error('AppStore HFS address not connected.');

    const hasHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: this.storeAddr, data: AppStoreAbi.hasBundle(packed.uiHash) },
      'latest',
    ]);
    if (decodeUintWord(hasHex) === 1) {
      emit(`✓ UI bundle ${shortHex(packed.uiHash)} already verified on-chain (deduplicated)!`);
      return packed;
    }

    const chunks = splitBundleIntoChunks(packed.bytes);
    if (chunks.length > APP_STORE_MAX_CHUNKS) {
      throw new Error(
        `Compressed UI bundle (${(packed.compressedLen / 1024).toFixed(1)} KiB) exceeds ${
          (APP_STORE_MAX_CHUNKS * APP_STORE_CHUNK_BYTES) / 1024
        } KiB on-chain cap.`
      );
    }

    const myEoa = wallet.keypair.address;
    const myPriv = wallet.keypair.privateKey;
    let curNonce = BigInt(await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    let prevHash = '0x' + '00'.repeat(32);

    emit(
      `Uploading & keccak256-sealing UI bundle (${(packed.compressedLen / 1024).toFixed(1)} KiB gzip in ${
        chunks.length
      } chunk${chunks.length === 1 ? '' : 's'})…`
    );
    const txs = chunks.map((chunkBytes, idx) => {
      const cd = AppStoreAbi.uploadBundleChunk({
        uiHash: packed.uiHash,
        chunkIndex: idx,
        totalChunks: chunks.length,
        encoding: packed.encoding,
        uncompressedLen: packed.uncompressedLen,
        chunkBytes,
      });
      const signed = signOrderedLexiconTx({
        privateKey: myPriv,
        nonce: curNonce,
        to: this.storeAddr,
        data: cd,
        gasLimit: 8_500_000n,
        extraTargets: [this.storeAddr],
        lowerBoundHashHex: prevHash,
      });
      curNonce += 1n;
      prevHash = signed.txHash;
      return { signed, cd, idx };
    });

    const hashes = [];
    for (const item of txs) {
      const h = await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [item.signed.raw]);
      hashes.push(h);
      wallet.recordExternalRpcTx({
        txHash: h,
        rawTx: item.signed.raw,
        from: myEoa,
        to: this.storeAddr,
        contractLabel: 'AppStore',
        fnLabel: `uploadBundleChunk(${item.idx + 1}/${chunks.length})`,
        dataHex: item.cd,
      });
    }
    await _waitReceipts(this.rpcUrl, hashes);
    return packed;
  }

  async publishApp({
    wallet,
    slug,
    title,
    summary = '',
    icon = '🧩',
    version = '1.0.0',
    category = 6,
    execMode = APP_EXEC_MODE.SANDBOX_IFRAME,
    htmlSource,
    wasmBytes = null,
    wasmCodeHash = ZERO_BYTES32,
    defaultHfsAddr = ZERO_ADDR,
    deployInstance = false,
    onStatus = null,
  }) {
    const emit = (m) => {
      if (typeof onStatus === 'function') onStatus(m);
    };
    const cleanSlug = String(slug || title || 'app')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
    const slugId = slugToBytes32(cleanSlug);

    // Enforce Superlexicon · Developers social group membership before Web RPC publish / HFS deploy
    const standing = await this.checkPublisherStanding(wallet);
    if (!standing.authorized) {
      throw new Error(
        standing.reason ||
          'Only members of the Superlexicon · Developers social subgroup (linked to Superlexicon Pte. Ltd. CorporateCharter) are authorized to publish apps or deploy HFS over Web RPC.'
      );
    }

    const packed = await compressAppUiBundle(htmlSource);
    await SlxUiBundleCache.putRawBundle(packed.uiHash, packed.bytes, packed.encoding);
    await SlxUiBundleCache.putVerifiedHtml(
      packed.uiHash,
      {
        uiHash: packed.uiHash,
        compressedLen: packed.compressedLen,
        uncompressedLen: packed.uncompressedLen,
        html: htmlSource,
      },
      { slug: cleanSlug, title }
    );

    let resolvedWasmHash = wasmCodeHash || ZERO_BYTES32;
    let resolvedDefaultHfs = defaultHfsAddr || ZERO_ADDR;

    // If AppStore HFS is live on Subnet 1, publish on-chain!
    const storeAddr = await this.resolveStoreAddress();
    if (storeAddr) {
      const idRec = await wallet.ensureIdentityWithPrompt({
        rpcUrl: this.rpcUrl,
        appName: 'SuperLexicon HFS App Publisher',
      });
      const myEoa = wallet.keypair.address;
      const myPriv = wallet.keypair.privateKey;

      if (wasmBytes && wasmBytes.length > 0) {
        resolvedWasmHash = keccak256Hex(wasmBytes);
        emit(`Uploading HFS WASM (${(wasmBytes.length / 1024).toFixed(1)} KiB) to BYTECODE_STORE…`);
        const nW = BigInt(await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
        const sW = signOrderedLexiconTx({
          privateKey: myPriv,
          nonce: nW,
          to: BYTECODE_STORE_ADDRESS,
          data: resolvedWasmHash + bytesToHex(wasmBytes, false),
          gasLimit: 9_000_000n,
        });
        const hW = await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [sW.raw]);
        await _waitReceipts(this.rpcUrl, [hW]);
      }

      if (deployInstance && resolvedWasmHash !== ZERO_BYTES32 && resolvedDefaultHfs === ZERO_ADDR) {
        emit('Instantiating default HFS subroutine instance…');
        const nI = BigInt(await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
        const pred = computeCreateAddress(myEoa, nI).toLowerCase();
        const sI = signOrderedLexiconTx({
          privateKey: myPriv,
          nonce: nI,
          to: null,
          data: resolvedWasmHash,
          gasLimit: 4_800_000n,
          extraTargets: [pred],
        });
        const hI = await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [sI.raw]);
        const [rI] = await _waitReceipts(this.rpcUrl, [hI]);
        resolvedDefaultHfs = (rI.contractAddress || pred).toLowerCase();
      }

      await this.uploadUiBundleOnChain({ wallet, htmlSource, onStatus });

      emit(`Registering "${title}" (${version}) in AppStore HFS…`);
      const pubCd = AppStoreAbi.publishApp({
        slugId,
        publisherIdentity: idRec.identityAddr,
        wasmCodeHash: resolvedWasmHash,
        defaultHfsAddr: resolvedDefaultHfs,
        uiHash: packed.uiHash,
        category,
        execMode,
        title,
        summary,
        icon,
        version,
      });
      const nP = BigInt(await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
      const sP = signOrderedLexiconTx({
        privateKey: myPriv,
        nonce: nP,
        to: storeAddr,
        data: pubCd,
        gasLimit: 5_500_000n,
        extraTargets: [storeAddr, idRec.identityAddr, ...(resolvedDefaultHfs !== ZERO_ADDR ? [resolvedDefaultHfs] : [])],
      });
      const hP = await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [sP.raw]);
      wallet.recordExternalRpcTx({
        txHash: hP,
        rawTx: sP.raw,
        from: myEoa,
        to: storeAddr,
        contractLabel: 'AppStore',
        fnLabel: `publishApp("${title}", "${version}")`,
        dataHex: pubCd,
      });
      await _waitReceipts(this.rpcUrl, [hP]);

      const onChainRec = await this.fetchAppBySlug(cleanSlug);
      const savedMeta = {
        ...(onChainRec || {}),
        slug: cleanSlug,
        slugId,
        title,
        summary,
        icon,
        version,
        category,
        execMode: onChainRec ? onChainRec.execMode : execMode,
        uiHash: packed.uiHash,
        compressedLen: packed.compressedLen,
        uncompressedLen: packed.uncompressedLen,
        chunkCount: packed.chunkCount,
        wasmCodeHash: resolvedWasmHash,
        defaultHfsAddr: resolvedDefaultHfs,
        publisher: idRec.identityAddr,
        publisherLabel: `${idRec.nickname} · ${truncAddr4(myEoa)}`,
        source: 'onchain',
      };
      saveLocalPublishedApp(savedMeta);
      return savedMeta;
    }

    // Offline / Local Sandbox publish (still 100% content-addressed by keccak256 in IndexedDB!)
    const idRec = wallet.getIdentityRecord();
    const savedLocal = {
      appId: 1000 + loadLocalPublishedApps().length + 1,
      slug: cleanSlug,
      slugId,
      status: APP_STATUS.ACTIVE,
      execMode: APP_EXEC_MODE.SANDBOX_IFRAME,
      category,
      title,
      summary,
      icon,
      version,
      uiHash: packed.uiHash,
      compressedLen: packed.compressedLen,
      uncompressedLen: packed.uncompressedLen,
      chunkCount: packed.chunkCount,
      wasmCodeHash: resolvedWasmHash,
      defaultHfsAddr: resolvedDefaultHfs,
      publisher: idRec?.identityAddr || wallet.keypair.address,
      publisherLabel: idRec?.nickname
        ? `${idRec.nickname} · ${truncAddr4(wallet.keypair.address)}`
        : `Dev_${truncAddr4(wallet.keypair.address)}`,
      updatedBlock: 0,
      source: 'local-cas',
    };
    saveLocalPublishedApp(savedLocal);
    return savedLocal;
  }

  async fetchOnChainApps() {
    const storeAddr = await this.resolveStoreAddress();
    if (!storeAddr) return [];
    try {
      const sliceHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: storeAddr, data: AppStoreAbi.getAppsSlice(0, 24) },
        'latest',
      ]);
      const { items } = decodeAppsSliceHex(sliceHex);
      return items.filter((a) => a.status === APP_STATUS.ACTIVE);
    } catch (_) {
      return [];
    }
  }

  async fetchAppBySlug(slug) {
    const storeAddr = await this.resolveStoreAddress();
    if (!storeAddr) return null;
    try {
      const slugId = slugToBytes32(slug);
      const hex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: storeAddr, data: AppStoreAbi.getAppBySlug(slugId) },
        'latest',
      ]);
      return decodeSingleAppHex(hex);
    } catch (_) {
      return null;
    }
  }

  async resolveInstanceApp(instanceAddr) {
    const storeAddr = await this.resolveStoreAddress();
    if (!storeAddr || !instanceAddr || instanceAddr === ZERO_ADDR) return null;
    try {
      const hex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: storeAddr, data: AppStoreAbi.resolveInstance(instanceAddr) },
        'latest',
      ]);
      return decodeResolvedInstanceHex(hex);
    } catch (_) {
      return null;
    }
  }

  /**
   * Fetches, cryptographically verifies (`keccak256(compressedBytes) === uiHash`), decompresses,
   * and caches an App UI bundle from:
   *   1. `IndexedDB` Immutable CAS Cache (`0–4 ms`, pre-verified HTML)
   *   2. Local raw bundle store (`IndexedDB` / `CacheStorage`)
   *   3. Live Subnet 1 `AppStore.getBundle(uiHash)` (`1` single `eth_call`)
   *   4. Genesis static fallback URL (`/app-bundles/<slug>.html.gz`)
   */
  async fetchVerifiedBundleHtml({
    uiHash,
    fallbackBundleUrl = '',
    slug = '',
    title = '',
    forceRevalidate = false,
  }) {
    const cleanHash = String(uiHash || '').trim().toLowerCase();
    const metaHint = { slug, title };

    if (cleanHash && cleanHash !== ZERO_BYTES32 && !forceRevalidate) {
      const cached = await SlxUiBundleCache.getVerifiedHtml(cleanHash);
      if (cached?.html) {
        if (!SlxUiBundleCache.isCachedSync(cleanHash)) {
          await SlxUiBundleCache.putVerifiedHtml(cleanHash, cached, metaHint);
        }
        return { ...cached, cacheHit: true, loadedFrom: 'local-cache' };
      }

      const rawLocal = await SlxUiBundleCache.getRawBundle(cleanHash);
      if (rawLocal?.bytes) {
        const verified = await verifyAndUnpackAppUiBundle(
          rawLocal.bytes,
          cleanHash,
          rawLocal.encoding
        );
        await SlxUiBundleCache.putVerifiedHtml(cleanHash, verified, metaHint);
        return { ...verified, cacheHit: true, loadedFrom: 'indexeddb-cas' };
      }
    }

    if (cleanHash && cleanHash !== ZERO_BYTES32) {
      const storeAddr = await this.resolveStoreAddress();
      if (storeAddr) {
        try {
          const [infoHex, bundleHex] = await Promise.all([
            slxNodeRpc(this.rpcUrl, 'eth_call', [
              { to: storeAddr, data: AppStoreAbi.getBundleInfo(cleanHash) },
              'latest',
            ]),
            slxNodeRpc(this.rpcUrl, 'eth_call', [
              { to: storeAddr, data: AppStoreAbi.getBundle(cleanHash) },
              'latest',
            ]),
          ]);
          const info = decodeBundleInfoHex(infoHex);
          const rawBytes = hexToBytes(bundleHex);
          if (info.sealed && rawBytes.length > 0) {
            const verified = await verifyAndUnpackAppUiBundle(rawBytes, cleanHash, info.encoding);
            await SlxUiBundleCache.putRawBundle(cleanHash, rawBytes, info.encoding);
            await SlxUiBundleCache.putVerifiedHtml(cleanHash, verified, metaHint);
            return { ...verified, cacheHit: false, loadedFrom: 'onchain-appstore' };
          }
        } catch (_) {}
      }
    }

    if (fallbackBundleUrl) {
      const bustUrl =
        cleanHash && cleanHash !== ZERO_BYTES32
          ? `${fallbackBundleUrl}${fallbackBundleUrl.includes('?') ? '&' : '?'}h=${cleanHash.slice(2, 14)}`
          : fallbackBundleUrl;
      const resp = await fetch(bustUrl, { cache: 'no-cache' });
      if (!resp.ok) {
        throw new Error(`Failed to fetch UI bundle ${fallbackBundleUrl} (HTTP ${resp.status})`);
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const verified = await verifyAndUnpackAppUiBundle(
        bytes,
        cleanHash,
        APP_STORE_ENCODING.GZIP
      );
      const effectiveHash = verified.uiHash || cleanHash;
      if (effectiveHash) {
        await SlxUiBundleCache.putRawBundle(effectiveHash, bytes, APP_STORE_ENCODING.GZIP);
        await SlxUiBundleCache.putVerifiedHtml(effectiveHash, verified, metaHint);
      }
      return { ...verified, cacheHit: false, loadedFrom: 'genesis-cas' };
    }

    throw new Error(`UI bundle ${shortHex(cleanHash)} not found in cache or on-chain AppStore.`);
  }
}

// ---------------------------------------------------------------------------
// 4B. Personal App Container ("My Installed Apps" + Eager Local HTML Pinning)
// ---------------------------------------------------------------------------

function _normalizePersonalAppRecord(appMeta = {}, prev = null) {
  const cleanSlug = String(appMeta.slug || prev?.slug || '')
    .trim()
    .toLowerCase();
  const isSystemCore = Boolean(
    appMeta.isSystemCore ?? prev?.isSystemCore ?? appMeta.execMode === APP_EXEC_MODE.VERIFIED_HOST
  );
  const route =
    appMeta.route ||
    prev?.route ||
    (isSystemCore && cleanSlug ? `/${cleanSlug}.html` : `/apps.html?run=${encodeURIComponent(cleanSlug)}`);
  const bundleUrl =
    appMeta.bundleUrl !== undefined
      ? appMeta.bundleUrl
      : prev?.bundleUrl || (cleanSlug ? `/app-bundles/${cleanSlug}.html.gz` : '');
  return {
    slug: cleanSlug,
    slugId: appMeta.slugId || prev?.slugId || (cleanSlug ? slugToBytes32(cleanSlug) : ZERO_BYTES32),
    appId: Number(appMeta.appId || prev?.appId || 0),
    title: appMeta.title || prev?.title || cleanSlug || 'HFS App',
    summary: appMeta.summary ?? prev?.summary ?? '',
    icon: appMeta.icon || prev?.icon || '🧩',
    version: appMeta.version || prev?.version || '1.0.0',
    category: Number(appMeta.category || prev?.category || 6),
    execMode:
      appMeta.execMode !== undefined
        ? Number(appMeta.execMode)
        : prev?.execMode !== undefined
        ? Number(prev.execMode)
        : isSystemCore
        ? APP_EXEC_MODE.VERIFIED_HOST
        : APP_EXEC_MODE.SANDBOX_IFRAME,
    isSystemCore,
    route,
    bundleUrl,
    uiHash: String(appMeta.uiHash || prev?.uiHash || ZERO_BYTES32).toLowerCase(),
    compressedLen: Number(appMeta.compressedLen || prev?.compressedLen || 0),
    uncompressedLen: Number(appMeta.uncompressedLen || prev?.uncompressedLen || 0),
    wasmCodeHash: String(appMeta.wasmCodeHash || prev?.wasmCodeHash || ZERO_BYTES32).toLowerCase(),
    defaultHfsAddr: String(appMeta.defaultHfsAddr || prev?.defaultHfsAddr || ZERO_ADDR).toLowerCase(),
    installedAt: prev?.installedAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function _readPersonalContainerRaw() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_PERSONAL_CONTAINER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => x && x.slug) : [];
  } catch (_) {
    return [];
  }
}

function _writePersonalContainerRaw(list) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PERSONAL_CONTAINER_KEY, JSON.stringify(list || []));
  } catch (_) {}
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(
        new CustomEvent('slx:personal-apps-changed', {
          detail: { apps: list || [] },
        })
      );
    } catch (_) {}
  }
}

export const SlxPersonalAppContainer = {
  listInstalled() {
    return _readPersonalContainerRaw();
  },

  countInstalled() {
    return _readPersonalContainerRaw().length;
  },

  isInstalled(slug) {
    const clean = String(slug || '').trim().toLowerCase();
    if (!clean) return false;
    return _readPersonalContainerRaw().some((a) => String(a.slug || '').toLowerCase() === clean);
  },

  getInstalled(slug) {
    const clean = String(slug || '').trim().toLowerCase();
    if (!clean) return null;
    return (
      _readPersonalContainerRaw().find((a) => String(a.slug || '').toLowerCase() === clean) || null
    );
  },

  /**
   * Installs an app into the user's Personal App Container AND eagerly fetches, `keccak256`-verifies,
   * decompresses, and caches its HTML bundle in persistent local storage (`IndexedDB` + `CacheStorage`)
   * so all future loads open instantaneously with zero blocking network fetch.
   */
  async installApp(appMeta, { storeClient = null, onStatus = null, cacheHtml = true } = {}) {
    const cleanSlug = String(appMeta?.slug || '').trim().toLowerCase();
    if (!cleanSlug) {
      throw new Error('Cannot install app without a valid slug.');
    }
    const emit = (msg) => {
      if (typeof onStatus === 'function') onStatus(msg);
    };

    const list = _readPersonalContainerRaw();
    const idx = list.findIndex((a) => String(a.slug || '').toLowerCase() === cleanSlug);
    const prev = idx >= 0 ? list[idx] : null;
    const normalized = _normalizePersonalAppRecord(appMeta, prev);

    let cachedBundle = null;
    if (
      cacheHtml &&
      ((normalized.uiHash && normalized.uiHash !== ZERO_BYTES32) || normalized.bundleUrl)
    ) {
      const client = storeClient || new AppStoreClient();
      emit(`Verifying & caching "${normalized.title}" HTML locally…`);
      try {
        cachedBundle = await client.fetchVerifiedBundleHtml({
          uiHash: normalized.uiHash,
          fallbackBundleUrl: normalized.bundleUrl || '',
          slug: normalized.slug,
          title: normalized.title,
        });
        if (cachedBundle?.uiHash) {
          normalized.uiHash = cachedBundle.uiHash;
        }
        if (cachedBundle?.compressedLen) {
          normalized.compressedLen = cachedBundle.compressedLen;
        }
        if (cachedBundle?.uncompressedLen) {
          normalized.uncompressedLen = cachedBundle.uncompressedLen;
        }
      } catch (cacheErr) {
        // Still allow installing metadata if offline and bundle already cached or pending sync
        if (!SlxUiBundleCache.isCachedSync(normalized.uiHash)) {
          throw cacheErr;
        }
      }
    }

    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      list.push(normalized);
    }
    _writePersonalContainerRaw(list);
    emit(`✓ Installed "${normalized.title}" in My Apps (HTML cached locally)`);
    return { app: normalized, cachedBundle };
  },

  async uninstallApp(slug, { evictCache = false } = {}) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    if (!cleanSlug) return false;
    const list = _readPersonalContainerRaw();
    const target = list.find((a) => String(a.slug || '').toLowerCase() === cleanSlug);
    if (!target) return false;
    const next = list.filter((a) => String(a.slug || '').toLowerCase() !== cleanSlug);
    _writePersonalContainerRaw(next);

    if (evictCache && target.uiHash && target.uiHash !== ZERO_BYTES32) {
      const stillReferenced = next.some(
        (a) => String(a.uiHash || '').toLowerCase() === String(target.uiHash).toLowerCase()
      );
      if (!stillReferenced) {
        await SlxUiBundleCache.evictBundle(target.uiHash);
      }
    }
    return true;
  },

  moveInstalledApp(slug, delta) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const list = _readPersonalContainerRaw();
    const idx = list.findIndex((a) => String(a.slug || '').toLowerCase() === cleanSlug);
    if (idx < 0) return list;
    const nextIdx = Math.max(0, Math.min(list.length - 1, idx + Number(delta || 0)));
    if (nextIdx === idx) return list;
    const [item] = list.splice(idx, 1);
    list.splice(nextIdx, 0, item);
    _writePersonalContainerRaw(list);
    return list;
  },

  syncCatalogMetadata(catalogApps = []) {
    if (!Array.isArray(catalogApps) || !catalogApps.length) return;
    const list = _readPersonalContainerRaw();
    if (!list.length) return;
    const bySlug = new Map(
      catalogApps.map((a) => [String(a.slug || '').toLowerCase(), a])
    );
    let mutated = false;
    for (let i = 0; i < list.length; i += 1) {
      const cur = list[i];
      const latest = bySlug.get(String(cur.slug || '').toLowerCase());
      if (!latest) continue;
      const next = _normalizePersonalAppRecord(latest, cur);
      if (
        next.uiHash !== cur.uiHash ||
        next.version !== cur.version ||
        next.title !== cur.title ||
        next.category !== cur.category ||
        next.route !== cur.route
      ) {
        list[i] = next;
        mutated = true;
      }
    }
    if (mutated) {
      _writePersonalContainerRaw(list);
    }
  },

  async preCacheAllInstalled({ storeClient = null, onStatus = null } = {}) {
    const list = _readPersonalContainerRaw();
    const client = storeClient || new AppStoreClient();
    let cachedCount = 0;
    for (const app of list) {
      if ((app.uiHash && app.uiHash !== ZERO_BYTES32) || app.bundleUrl) {
        if (typeof onStatus === 'function') {
          onStatus(`Caching [${cachedCount + 1}/${list.length}] "${app.title}"…`);
        }
        await client.fetchVerifiedBundleHtml({
          uiHash: app.uiHash,
          fallbackBundleUrl: app.bundleUrl || '',
          slug: app.slug,
          title: app.title,
        });
        cachedCount += 1;
      }
    }
    return cachedCount;
  },

  onChange(listener) {
    if (typeof window === 'undefined' || typeof listener !== 'function') {
      return () => {};
    }
    const handler = () => {
      try {
        listener(_readPersonalContainerRaw());
      } catch (_) {}
    };
    const onStorage = (ev) => {
      if (
        !ev ||
        !ev.key ||
        ev.key === STORAGE_PERSONAL_CONTAINER_KEY ||
        ev.key === STORAGE_CACHED_UI_INDEX_KEY
      ) {
        handler();
      }
    };
    window.addEventListener('slx:personal-apps-changed', handler);
    window.addEventListener('slx:ui-cache-changed', handler);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('slx:personal-apps-changed', handler);
      window.removeEventListener('slx:ui-cache-changed', handler);
      window.removeEventListener('storage', onStorage);
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Zero-Trust Sandboxed Iframe Guest Shim (`window.slx`) & Host Bridge
// ---------------------------------------------------------------------------

const GUEST_BRIDGE_SCRIPT = `<script>
(function () {
  let _reqSeq = 1;
  const _pending = new Map();
  const _blockListeners = new Set();

  window.addEventListener('message', function (ev) {
    const msg = ev.data;
    if (!msg || msg.__slxBridge !== 'host->guest') return;
    if (msg.type === 'response' && _pending.has(msg.id)) {
      const p = _pending.get(msg.id);
      _pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    } else if (msg.type === 'event' && msg.event === 'newBlock') {
      _blockListeners.forEach(function (fn) {
        try { fn(msg.payload); } catch (_) {}
      });
    }
  });

  function requestHost(method, params) {
    return new Promise(function (resolve, reject) {
      const id = _reqSeq++;
      _pending.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({ __slxBridge: 'guest->host', id: id, method: method, params: params || {} }, '*');
    });
  }

  window.slx = {
    version: '1.0.0',
    getContext: function () { return requestHost('getContext', {}); },
    ethCall: function (to, dataHex) { return requestHost('ethCall', { to: to, data: dataHex }); },
    callContract: function (fnSig, args, to) { return requestHost('callContract', { fnSig: fnSig, args: args || [], to: to }); },
    encodeAbi: function (fnSig, args) { return requestHost('encodeAbi', { fnSig: fnSig, args: args || [] }); },
    sendTransaction: function (opts) { return requestHost('sendTransaction', opts || {}); },
    deployInstance: function (opts) { return requestHost('deployInstance', opts || {}); },
    resolveIdentity: function (addr) { return requestHost('resolveIdentity', { address: addr }); },
    getAppStorage: function (key) { return requestHost('getAppStorage', { key: String(key || '') }); },
    setAppStorage: function (key, value) { return requestHost('setAppStorage', { key: String(key || ''), value: value }); },
    onNewBlock: function (fn) {
      if (typeof fn === 'function') _blockListeners.add(fn);
      return function () { _blockListeners.delete(fn); };
    }
  };
})();
<\/script>`;

export function buildSandboxedIframeSrcdoc(rawHtml) {
  const html = String(rawHtml || '');
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${GUEST_BRIDGE_SCRIPT}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${GUEST_BRIDGE_SCRIPT}</head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${GUEST_BRIDGE_SCRIPT}</head><body>${html}</body></html>`;
}

export function attachSandboxedAppBridge({
  iframeEl,
  appMeta,
  wallet,
  rpcUrl = getDefaultNodeWsUrl(),
  onConfirmTx = null,
}) {
  const sessionApprovedTargets = new Set();
  const appStorageKey = `slx_sandbox_kv_${appMeta.slug || appMeta.uiHash || 'app'}`;

  const loadSandboxKv = () => {
    try {
      return JSON.parse(localStorage.getItem(appStorageKey) || '{}');
    } catch (_) {
      return {};
    }
  };
  const saveSandboxKv = (obj) => {
    try {
      localStorage.setItem(appStorageKey, JSON.stringify(obj));
    } catch (_) {}
  };

  const reply = (id, result, error = null) => {
    try {
      iframeEl.contentWindow?.postMessage(
        { __slxBridge: 'host->guest', type: 'response', id, result, error },
        '*'
      );
    } catch (_) {}
  };

  const onMessage = async (ev) => {
    if (!iframeEl || ev.source !== iframeEl.contentWindow) return;
    const msg = ev.data;
    if (!msg || msg.__slxBridge !== 'guest->host') return;
    const { id, method, params = {} } = msg;

    try {
      if (method === 'getContext') {
        const idRec = wallet.getIdentityRecord();
        let blk = 0;
        try {
          const bHex = await slxNodeRpc(rpcUrl, 'eth_blockNumber', []);
          blk = Number(BigInt(bHex || '0x0'));
        } catch (_) {}
        reply(id, {
          appId: appMeta.appId || 0,
          slug: appMeta.slug || '',
          title: appMeta.title || 'HFS App',
          version: appMeta.version || '1.0.0',
          uiHash: appMeta.uiHash || ZERO_BYTES32,
          wasmCodeHash: appMeta.wasmCodeHash || ZERO_BYTES32,
          instanceAddr: appMeta.activeInstanceAddr || appMeta.defaultHfsAddr || ZERO_ADDR,
          rpcUrl,
          blockNumber: blk,
          user: {
            eoa: wallet.keypair.address,
            tag4: truncAddr4(wallet.keypair.address),
            identityAddr: idRec?.identityAddr || '',
            nickname: idRec?.nickname || `Guest_${truncAddr4(wallet.keypair.address)}`,
          },
        });
        return;
      }

      if (method === 'encodeAbi') {
        reply(id, encodeAbi(params.fnSig, params.args || []));
        return;
      }

      if (method === 'ethCall') {
        const to = params.to || appMeta.activeInstanceAddr || appMeta.defaultHfsAddr;
        const out = await slxNodeRpc(rpcUrl, 'eth_call', [{ to, data: params.data || '0x' }, 'latest']);
        reply(id, out);
        return;
      }

      if (method === 'callContract') {
        const to = params.to || appMeta.activeInstanceAddr || appMeta.defaultHfsAddr;
        const data = encodeAbi(params.fnSig, params.args || []);
        const out = await slxNodeRpc(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
        reply(id, out);
        return;
      }

      if (method === 'resolveIdentity') {
        const addr = String(params.address || '').toLowerCase();
        const nick = await readOnChainIdentityNickname(rpcUrl, addr);
        reply(id, { address: addr, nickname: nick || shortHex(addr) });
        return;
      }

      if (method === 'getAppStorage') {
        const kv = loadSandboxKv();
        reply(id, kv[params.key] ?? null);
        return;
      }

      if (method === 'setAppStorage') {
        const kv = loadSandboxKv();
        kv[params.key] = params.value;
        saveSandboxKv(kv);
        reply(id, true);
        return;
      }

      if (method === 'sendTransaction') {
        const target = String(
          params.to || appMeta.activeInstanceAddr || appMeta.defaultHfsAddr || ZERO_ADDR
        ).toLowerCase();
        const innerData = params.data || (params.fnSig ? encodeAbi(params.fnSig, params.args || []) : '0x');

        // Enforce Identity HFS Subroutine Firewall (`State = 3 SPAM` auto-blocks!)
        if (target !== ZERO_ADDR) {
          try {
            const assocs = await wallet.fetchHfsAssociations({ rpcUrl });
            const hit = assocs.byAddr?.get(target);
            if (hit && hit.status === HFS_ASSOC_STATUS.SPAM) {
              throw new Error(
                `Blocked by your Identity HFS Firewall: target subroutine ${shortHex(target)} is marked State = 3 (Spam).`
              );
            }
          } catch (fwErr) {
            if (String(fwErr.message || '').includes('Firewall')) throw fwErr;
          }
        }

        if (typeof onConfirmTx === 'function' && !sessionApprovedTargets.has(target)) {
          const decision = await onConfirmTx({
            appMeta,
            target,
            fnSig: params.fnSig || innerData.slice(0, 10),
            summary: params.summary || '',
            dataHex: innerData,
          });
          if (!decision?.approved) {
            throw new Error('Transaction rejected by user in Host Wallet.');
          }
          if (decision.trustSession && target !== ZERO_ADDR) {
            sessionApprovedTargets.add(target);
          }
        }

        // Offline / Sandbox simulation fallback if target is 0x0 or chain offline
        if (target === ZERO_ADDR) {
          const simHash = keccak256Hex(utf8ToBytes(`simtx:${Date.now()}:${innerData}`));
          reply(id, { txHash: simHash, simulated: true, status: '0x1' });
          return;
        }

        const idRec = await wallet.ensureIdentityWithPrompt({
          rpcUrl,
          appName: appMeta.title || 'Sandboxed HFS App',
        });
        const myEoa = wallet.keypair.address;
        const myPriv = wallet.keypair.privateKey;
        const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
        const useIdentityExec = params.viaIdentity !== false && idRec?.identityAddr;
        const txTo = useIdentityExec ? idRec.identityAddr : target;
        const txData = useIdentityExec
          ? encodeAbi('execute(address,bytes)', [
              ['address', target],
              ['bytes', hexToBytes(innerData)],
            ])
          : innerData;
        const signed = signOrderedLexiconTx({
          privateKey: myPriv,
          nonce,
          to: txTo,
          data: txData,
          gasLimit: 6_000_000n,
          extraTargets: useIdentityExec ? [idRec.identityAddr, target] : [target],
        });
        const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
        wallet.recordExternalRpcTx({
          txHash,
          rawTx: signed.raw,
          from: myEoa,
          to: target,
          contractLabel: appMeta.title || 'AppHFS',
          fnLabel: params.fnSig || 'call',
          dataHex: innerData,
        });
        const [rcpt] = await _waitReceipts(rpcUrl, [txHash]);
        reply(id, { txHash, status: rcpt.status, blockNumber: Number(BigInt(rcpt.blockNumber || 0)) });
        return;
      }

      throw new Error(`Unsupported window.slx bridge method: ${method}`);
    } catch (err) {
      reply(id, null, err.message || String(err));
    }
  };

  window.addEventListener('message', onMessage);
  return {
    notifyNewBlock(blockPayload) {
      try {
        iframeEl.contentWindow?.postMessage(
          { __slxBridge: 'host->guest', type: 'event', event: 'newBlock', payload: blockPayload },
          '*'
        );
      } catch (_) {}
    },
    destroy() {
      window.removeEventListener('message', onMessage);
    },
  };
}
