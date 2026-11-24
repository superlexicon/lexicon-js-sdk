/**
 * @superlexicon/sdk/rpc
 *
 * Multiplexed WebSocket JSON-RPC transport (`slxNodeRpc`), Deployment Manifest Cache (`SlxHfsCache`),
 * Collision-Free Nonce & Same-Block Ordering Queue (`SlxNonceQueue`), and High-Level `SlxClient`.
 */

import {
  bytesToHex,
  keccak256Hex,
  computeAddress,
  signOrderedLexiconTx,
} from './crypto.js';
import { encodeAbi } from './abi.js';
import { slxWaitForReceipt, slxWatchChainApp } from './events.js';

export const PUBLIC_SUBNET1_WSS_RPC_NODES = [
  'wss://node1.superlexicon.com/rpc',
  'wss://node3.superlexicon.com/rpc',
  'wss://node4.superlexicon.com/rpc',
  'wss://node2.superlexicon.com/rpc',
  'wss://node5.superlexicon.com/rpc',
];
export const PUBLIC_SUBNET1_WSS_RPC = PUBLIC_SUBNET1_WSS_RPC_NODES[0];
let _preferredPublicWssRpc = PUBLIC_SUBNET1_WSS_RPC;
export const BYTECODE_STORE_ADDRESS = '0x0000000000000000000000000000000000000100';
const STORAGE_KEY_HFS_CACHE = 'slx_hfs_address_cache_v1';
const STORAGE_KEY_ACTIVE_SUBNET = 'slx_active_subnet_v1';
const STORAGE_KEY_CUSTOM_SUBNETS = 'slx_custom_subnets_v1';
const STORAGE_KEY_DISCOVERED_SUBNETS = 'slx_discovered_subnets_meta_v1';

function _httpToWs(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length);
  if (s.startsWith('http://')) return 'ws://' + s.slice('http://'.length);
  return 'ws://' + s;
}

function _getLanPrefix() {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const h = window.location.hostname.toLowerCase();
    if (h.startsWith('192.168.1.')) return '192.168.1';
  }
  return '192.168.50';
}

export const SlxSubnetManager = {
  _hydratedDiscovery: false,

  getBuiltInSubnets() {
    const isHttps =
      typeof window !== 'undefined' &&
      (window.location?.protocol === 'https:' ||
        String(window.location?.hostname || '').toLowerCase().endsWith('superlexicon.com'));
    const lanPrefix = _getLanPrefix();
    const host =
      typeof window !== 'undefined' && window.location?.hostname
        ? window.location.hostname
        : `${lanPrefix}.91`;
    const localHostRpc =
      host === 'localhost' || host === '127.0.0.1'
        ? `ws://${lanPrefix}.91:8545`
        : `ws://${host}:8545`;

    let meta = {};
    if (typeof localStorage !== 'undefined') {
      try {
        meta = JSON.parse(localStorage.getItem(STORAGE_KEY_DISCOVERED_SUBNETS) || '{}') || {};
      } catch (_) {}
    }

    const s1 = {
      key: 'subnet1',
      name: 'Subnet 1 — 915 MHz LR2021 RF',
      shortLabel: 'SUBNET 1 • RF',
      icon: '📡',
      transport: 'flrc',
      subnetId: meta.subnet1?.subnetId || '00000001',
      manifestUrl: '/contracts/subnet1-deployments.json',
      rpcUrl: isHttps ? _preferredPublicWssRpc : localHostRpc,
      pubsubWsUrls: isHttps
        ? [
            'wss://node1.superlexicon.com',
            'wss://node3.superlexicon.com',
            'wss://node4.superlexicon.com',
            'wss://node2.superlexicon.com',
          ]
        : [
            `ws://${lanPrefix}.91:8566`,
            `ws://${lanPrefix}.93:8566`,
            `ws://${lanPrefix}.94:8566`,
            `ws://${lanPrefix}.92:8566`,
            `ws://${host}:8566`,
            `ws://${host}:8546`,
          ],
      validatorNodes: isHttps
        ? [
            { name: 'Validator node1', url: 'wss://node1.superlexicon.com/rpc', pubkeyPrefix: 'c8692b6e' },
            { name: 'Validator node2', url: 'wss://node2.superlexicon.com/rpc', pubkeyPrefix: '75c9f6e5' },
            { name: 'Validator node3', url: 'wss://node3.superlexicon.com/rpc', pubkeyPrefix: '33b12ce4' },
            { name: 'Validator node4', url: 'wss://node4.superlexicon.com/rpc', pubkeyPrefix: 'fbfc4fee' },
          ]
        : [
            { name: `RF Validator 1 (.91)`, url: `ws://${lanPrefix}.91:8545`, pubkeyPrefix: 'c8692b6e' },
            { name: `RF Validator 2 (.92)`, url: `ws://${lanPrefix}.92:8555`, pubkeyPrefix: '75c9f6e5' },
            { name: `RF Validator 3 (.93)`, url: `ws://${lanPrefix}.93:8545`, pubkeyPrefix: '33b12ce4' },
            { name: `RF Validator 4 (.94)`, url: `ws://${lanPrefix}.94:8545`, pubkeyPrefix: 'fbfc4fee' },
          ],
      builtin: true,
    };

    const s2RpcUrls = Array.isArray(meta.subnet2?.rpcUrls) && meta.subnet2.rpcUrls.length
      ? meta.subnet2.rpcUrls.map(_httpToWs)
      : [`ws://${lanPrefix}.91:18545`, `ws://${lanPrefix}.92:18545`, `ws://${lanPrefix}.94:18545`];
    const s2PubsubUrls = Array.isArray(meta.subnet2?.wsUrls) && meta.subnet2.wsUrls.length
      ? meta.subnet2.wsUrls
      : [`ws://${lanPrefix}.91:18566`, `ws://${lanPrefix}.92:18566`, `ws://${lanPrefix}.94:18566`];

    const s2 = {
      key: 'subnet2',
      name: meta.subnet2?.name || 'Subnet 2 — Encrypted TCP/IP Mesh',
      shortLabel: 'SUBNET 2 • TCP',
      icon: '🔌',
      transport: meta.subnet2?.transport || 'tcp',
      subnetId: meta.subnet2?.subnetId || '6eaa3da4',
      manifestUrl: '/contracts/subnet2-deployments.json',
      rpcUrl: s2RpcUrls[0],
      pubsubWsUrls: s2PubsubUrls,
      validatorNodes: s2RpcUrls.map((u, idx) => ({
        name: `TCP Validator #${idx + 1} (${u.replace(/^wss?:\/\//, '')})`,
        url: u,
        pubkeyPrefix: null,
      })),
      builtin: true,
    };

    const extraFromConfig = Array.isArray(meta.configuredSubnets) ? meta.configuredSubnets : [];
    return isHttps ? [s1, ...extraFromConfig] : [s1, s2, ...extraFromConfig];
  },

  getCustomSubnets() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_SUBNETS) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  },

  listSubnets() {
    const builtins = this.getBuiltInSubnets();
    const customs = this.getCustomSubnets().map((c) => {
      const wsRpc = _httpToWs(c.rpcUrl);
      let pubsub = c.pubsubWsUrl ? [_httpToWs(c.pubsubWsUrl)] : [];
      if (!pubsub.length && wsRpc) {
        try {
          const u = new URL(wsRpc);
          const p = Number(u.port || 8545);
          const u1 = new URL(wsRpc);
          u1.port = String(p + 21); // 8545 -> 8566, 18545 -> 18566
          const u2 = new URL(wsRpc);
          u2.port = String(p + 1); // 8545 -> 8546
          pubsub = [u1.toString().replace(/\/$/, ''), u2.toString().replace(/\/$/, '')];
        } catch (_) {}
      }
      return {
        key: c.key,
        name: c.name || `Custom Subnet (${wsRpc})`,
        shortLabel: c.shortLabel || (c.name ? c.name.slice(0, 16).toUpperCase() : 'CUSTOM SUBNET'),
        icon: c.transport === 'flrc' ? '📡' : '🌐',
        transport: c.transport || 'tcp',
        subnetId: c.subnetId || 'custom',
        manifestUrl: c.manifestUrl || '',
        rpcUrl: wsRpc,
        pubsubWsUrls: pubsub,
        validatorNodes: [{ name: c.name || 'Subnet Validator', url: wsRpc, pubkeyPrefix: null }],
        builtin: false,
      };
    });
    return [...builtins, ...customs];
  },

  getActiveSubnetKey() {
    if (typeof window !== 'undefined' && window.location?.search) {
      try {
        const q = new URLSearchParams(window.location.search).get('subnet');
        if (q && this.listSubnets().some((s) => s.key === q || s.subnetId === q)) {
          const matched = this.listSubnets().find((s) => s.key === q || s.subnetId === q);
          if (matched && typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY_ACTIVE_SUBNET, matched.key);
          }
          return matched ? matched.key : 'subnet1';
        }
      } catch (_) {}
    }
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_SUBNET);
      if (saved && this.listSubnets().some((s) => s.key === saved)) {
        return saved;
      }
    }
    return 'subnet1';
  },

  getActiveSubnetProfile() {
    const key = this.getActiveSubnetKey();
    const list = this.listSubnets();
    const prof = list.find((s) => s.key === key) || list[0];
    if (typeof window !== 'undefined' && prof) {
      window.__SLX_ACTIVE_SUBNET__ = prof;
      window.__SLX_ACTIVE_PUBSUB_WS_URLS__ = prof.pubsubWsUrls || [];
    }
    return prof;
  },

  setActiveSubnetKey(key, { reload = true } = {}) {
    const list = this.listSubnets();
    const target = list.find((s) => s.key === key) || list[0];
    if (!target) return null;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_SUBNET, target.key);
      } catch (_) {}
    }
    if (typeof window !== 'undefined') {
      window.__SLX_ACTIVE_SUBNET__ = target;
      window.__SLX_ACTIVE_PUBSUB_WS_URLS__ = target.pubsubWsUrls || [];
      try {
        const u = new URL(window.location.href);
        if (target.key === 'subnet1') u.searchParams.delete('subnet');
        else u.searchParams.set('subnet', target.key);
        window.history.replaceState({}, '', u.toString());
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('slx:subnet-changed', { detail: target }));
      if (reload) {
        window.location.reload();
      }
    }
    return target;
  },

  addCustomSubnet({ name, rpcUrl, pubsubWsUrl = '', manifestUrl = '', transport = 'tcp', subnetId = '' }) {
    const cleanRpc = _httpToWs(rpcUrl);
    if (!cleanRpc) throw new Error('RPC URL is required');
    const key = `custom_${Date.now().toString(36)}`;
    const list = this.getCustomSubnets();
    list.push({
      key,
      name: String(name || cleanRpc).trim(),
      shortLabel: String(name || 'CUSTOM').trim().slice(0, 16).toUpperCase(),
      rpcUrl: cleanRpc,
      pubsubWsUrl: pubsubWsUrl ? _httpToWs(pubsubWsUrl) : '',
      manifestUrl: String(manifestUrl || '').trim(),
      transport,
      subnetId: String(subnetId || '').trim(),
    });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CUSTOM_SUBNETS, JSON.stringify(list));
    }
    return key;
  },

  removeCustomSubnet(key) {
    const next = this.getCustomSubnets().filter((c) => c.key !== key);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CUSTOM_SUBNETS, JSON.stringify(next));
    }
    if (this.getActiveSubnetKey() === key) {
      this.setActiveSubnetKey('subnet1', { reload: true });
    }
  },

  async refreshDiscoveryMetadata() {
    if (typeof fetch === 'undefined') return;
    const meta = {};
    try {
      const r2 = await fetch('/contracts/subnet2-deployments.json', { cache: 'no-store' });
      if (r2.ok) {
        const j2 = await r2.json();
        meta.subnet2 = {
          subnetId: j2.subnetId || '6eaa3da4',
          transport: j2.transport || 'tcp',
          rpcUrls: j2.rpcUrls || [],
          wsUrls: j2.wsUrls || [],
        };
        if (j2.subnet1Id) {
          meta.subnet1 = { subnetId: j2.subnet1Id };
        }
      }
    } catch (_) {}
    try {
      const rs = await fetch('/contracts/subnets.json', { cache: 'no-store' });
      if (rs.ok) {
        const js = await rs.json();
        if (Array.isArray(js?.subnets)) {
          meta.configuredSubnets = js.subnets
            .filter((x) => x && x.key && x.key !== 'subnet1' && x.key !== 'subnet2' && x.rpcUrl)
            .map((x) => ({
              key: String(x.key),
              name: x.name || String(x.key),
              shortLabel: x.shortLabel || String(x.name || x.key).slice(0, 16).toUpperCase(),
              icon: x.transport === 'flrc' ? '📡' : '🔌',
              transport: x.transport || 'tcp',
              subnetId: x.subnetId || '',
              manifestUrl: x.manifestUrl || '',
              rpcUrl: _httpToWs(x.rpcUrl),
              pubsubWsUrls: Array.isArray(x.pubsubWsUrls) ? x.pubsubWsUrls.map(_httpToWs) : [],
              validatorNodes: Array.isArray(x.validatorNodes)
                ? x.validatorNodes
                : [{ name: x.name || 'Validator', url: _httpToWs(x.rpcUrl), pubkeyPrefix: null }],
              builtin: true,
            }));
        }
      }
    } catch (_) {}
    if (typeof localStorage !== 'undefined' && Object.keys(meta).length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY_DISCOVERED_SUBNETS, JSON.stringify(meta));
      } catch (_) {}
    }
    this._hydratedDiscovery = true;
    return this.getActiveSubnetProfile();
  },
};

export function getDefaultNodeWsUrl() {
  const active = SlxSubnetManager.getActiveSubnetProfile();
  if (active && active.key !== 'subnet1' && active.rpcUrl) {
    return active.rpcUrl;
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname.toLowerCase();
    if (window.location.protocol === 'https:' || host.endsWith('superlexicon.com')) {
      return _preferredPublicWssRpc;
    }
    return `ws://${window.location.hostname}:8545`;
  }
  return _preferredPublicWssRpc;
}

function _scopedCacheStorageKey() {
  const key = SlxSubnetManager.getActiveSubnetKey();
  return key === 'subnet1' ? STORAGE_KEY_HFS_CACHE : `${STORAGE_KEY_HFS_CACHE}:${key}`;
}

export const SlxHfsCache = {
  load() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(_scopedCacheStorageKey());
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  },
  save(patch) {
    const next = { ...this.load(), ...patch };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(_scopedCacheStorageKey(), JSON.stringify(next));
      } catch (_) {}
    }
    return next;
  },
  async hydrateWithManifest(manifestUrl = undefined) {
    await SlxSubnetManager.refreshDiscoveryMetadata().catch(() => null);
    const activeProf = SlxSubnetManager.getActiveSubnetProfile();
    const effectiveManifestUrl =
      manifestUrl !== undefined
        ? manifestUrl
        : activeProf?.manifestUrl || '/contracts/subnet1-deployments.json';

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('slx_inst_wasm_snapshot_v1');
      } catch (_) {}
    }
    let cached = this.load();
    let manifest = null;
    if (typeof fetch !== 'undefined' && effectiveManifestUrl) {
      try {
        const res = await fetch(effectiveManifestUrl, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
      } catch (_) {}
    }
    const manifestReg = String(manifest?.hfsRegistry || '').toLowerCase();
    const cachedReg = String(cached.hfsRegistry || '').toLowerCase();
    if (activeProf?.key === 'subnet1' && manifestReg && cachedReg !== manifestReg) {
      if (typeof localStorage !== 'undefined') {
        try {
          // Preserve returning users' chosen nicknames before purging stale pre-reset chain caches
          const prevIdsRaw = localStorage.getItem('slx_unified_identities_v1');
          if (prevIdsRaw) {
            const prevIds = JSON.parse(prevIdsRaw);
            const prefRaw = localStorage.getItem('slx_preferred_nicknames_v1');
            const prefMap = prefRaw ? JSON.parse(prefRaw) : {};
            for (const [eoaKey, rec] of Object.entries(prevIds || {})) {
              if (rec?.nickname && !prefMap[eoaKey.toLowerCase()]) {
                prefMap[eoaKey.toLowerCase()] = String(rec.nickname).trim().slice(0, 24);
              }
            }
            localStorage.setItem('slx_preferred_nicknames_v1', JSON.stringify(prefMap));
          }
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (
              k &&
              k.startsWith('slx_') &&
              k !== 'slx_wallet_keypair_v1' &&
              k !== 'slx_preferred_nicknames_v1' &&
              k !== 'slx_legal_consent_v1' &&
              !k.startsWith('slx_game_guide_seen_')
            ) {
              keysToRemove.push(k);
            }
          }
          for (const k of keysToRemove) localStorage.removeItem(k);
        } catch (_) {}
      }
      cached = {};
    }
    const defaultWs = getDefaultNodeWsUrl();
    const isHttpsPage =
      typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const cachedRpc = String(cached.rpcUrl || '');
    const isStaleCachedRpc =
      (activeProf && activeProf.key !== 'subnet1') ||
      !cachedRpc.startsWith('ws') ||
      cachedRpc.includes('superlexicon.com:8545') ||
      (isHttpsPage && cachedRpc.startsWith('ws://')) ||
      (PUBLIC_SUBNET1_WSS_RPC_NODES.includes(cachedRpc) && cachedRpc !== _preferredPublicWssRpc);
    const useRpc = isStaleCachedRpc ? defaultWs : cachedRpc;
    const LEGACY_COMMONS_CHARTER = '0x24707a2b8115992bc864c014b2f5e71e831ab8d5';
    const cachedSocialCharter =
      cached.socialCharterAddr &&
      String(cached.socialCharterAddr).toLowerCase() !== LEGACY_COMMONS_CHARTER
        ? cached.socialCharterAddr
        : '';
    const merged = {
      subnetKey: activeProf?.key || 'subnet1',
      subnetId: manifest?.subnetId || activeProf?.subnetId || '00000001',
      rpcUrl: useRpc,
      hfsRegistry: manifest?.hfsRegistry || cached.hfsRegistry || '',
      messagingAddr:
        manifest?.messaging || manifest?.commonsRf?.messaging || cached.messagingAddr || '',
      deployedAt: manifest?.deployedAt || cached.deployedAt || '',
      battleshipAddr: manifest?.battleship?.contractAddr || cached.battleshipAddr || '',
      battleId: manifest?.battleship?.battleId || cached.battleId || '',
      socialCharterAddr:
        manifest?.fleetSocial?.charter ||
        cachedSocialCharter ||
        manifest?.commonsRf?.charter ||
        '',
      fleetSocial: manifest?.fleetSocial || cached.fleetSocial || null,
      personaIdentities: manifest?.commonsRf?.personaIdentities || [],
      personaPrivs: manifest?.commonsRf?.personaPrivs || [],
      citizenOnboardingPool: manifest?.commonsRf?.citizenOnboardingPool || [],
      poolSlotPrivs: manifest?.commonsRf?.poolSlotPrivs || [],
      faucetPriv: manifest?.commonsRf?.faucetPriv || '',
      dexClobAddr: manifest?.institutional?.dexClob || cached.dexClobAddr || '',
      corporateCharterAddr: manifest?.institutional?.corporateCharter || cached.corporateCharterAddr || '',
      corpProductLedgerAddr: manifest?.institutional?.productLedger || cached.corpProductLedgerAddr || '',
      fiatLedgerAddr: manifest?.institutional?.fiatLedger || cached.fiatLedgerAddr || '',
      shareLedgerAddr: manifest?.institutional?.shareLedger || cached.shareLedgerAddr || '',
      accountingLedgerAddr: manifest?.institutional?.accountingLedger || cached.accountingLedgerAddr || '',
      institutional: manifest?.institutional || null,
      codeHashes: manifest?.codeHashes || {},
    };
    this.save(merged);
    return { cache: merged, manifest, subnet: activeProf };
  },
};

const _wsPools = new Map();
const MAX_WS_POOL_SIZE = 4;

export function toWsEndpoint(urlStr) {
  const s = String(urlStr || '').trim() || getDefaultNodeWsUrl();
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length);
  if (s.startsWith('http://')) return 'ws://' + s.slice('http://'.length);
  return 'ws://' + s;
}

function createWsPoolEntry(wsUrl, pool, connectTimeoutMs = 12000) {
  if (typeof WebSocket === 'undefined') return null;

  const pending = new Map();
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (_) {
    return null;
  }

  const entry = {
    ws,
    reqSeq: 1,
    inflight: 0,
    pending,
    openPromise: null,
  };

  const removeSelf = () => {
    const idx = pool.indexOf(entry);
    if (idx !== -1) pool.splice(idx, 1);
  };

  entry.openPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch (_) {}
      removeSelf();
      reject(new Error(`WebSocket connect timeout (${wsUrl})`));
    }, connectTimeoutMs);

    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      removeSelf();
      reject(new Error(`WebSocket unreachable (${wsUrl})`));
    };
    ws.onclose = () => {
      removeSelf();
      for (const [, p] of pending.entries()) {
        p.reject(new Error('WebSocket closed'));
      }
      pending.clear();
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (msg && msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          const detail = msg.error.data ? ` (${msg.error.data})` : '';
          const rpcErr = new Error(
            msg.error.message ? `${msg.error.message}${detail}` : JSON.stringify(msg.error)
          );
          rpcErr.isJsonRpcError = true;
          rpcErr.code = msg.error.code;
          rpcErr.data = msg.error.data;
          p.reject(rpcErr);
        } else {
          p.resolve(msg.result);
        }
      }
    };
  });

  pool.push(entry);
  return entry;
}

function acquireWsEntry(wsUrl, connectTimeoutMs = 12000) {
  let pool = _wsPools.get(wsUrl);
  if (!pool) {
    pool = [];
    _wsPools.set(wsUrl, pool);
  }
  for (let i = pool.length - 1; i >= 0; i--) {
    const st = pool[i].ws?.readyState;
    if (st !== 0 && st !== 1) pool.splice(i, 1);
  }
  const idle = pool.find((e) => e.ws.readyState === 1 && e.inflight === 0 && e.pending.size === 0);
  if (idle) return idle;
  if (pool.length < MAX_WS_POOL_SIZE) {
    const created = createWsPoolEntry(wsUrl, pool, connectTimeoutMs);
    if (created) return created;
  }
  if (pool.length === 0) return null;
  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].inflight < best.inflight) best = pool[i];
  }
  return best;
}

async function sendSingleWsRpc(wsUrl, method, params, timeoutMs) {
  const entry = acquireWsEntry(wsUrl, Math.min(timeoutMs, 6500));
  if (!entry) throw new Error(`WebSocket unavailable (${wsUrl})`);
  entry.inflight++;
  try {
    const ws = await entry.openPromise;
    const id = entry.reqSeq++;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error(`RPC timeout on ${method}`));
      }, timeoutMs);
      entry.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  } finally {
    entry.inflight = Math.max(0, entry.inflight - 1);
  }
}

const _deadWsCooldownUntil = new Map();
const DEAD_WS_COOLDOWN_MS = 45_000;

export async function slxNodeRpc(endpointUrl, method, params = [], timeoutMs = 15000, opts = {}) {
  const allowFailover = opts?.allowFailover !== false;
  let wsUrl = toWsEndpoint(endpointUrl);

  // Automatically route public validator calls to the currently healthy TLS validator first
  if (
    allowFailover &&
    PUBLIC_SUBNET1_WSS_RPC_NODES.includes(wsUrl) &&
    _preferredPublicWssRpc &&
    wsUrl !== _preferredPublicWssRpc
  ) {
    wsUrl = _preferredPublicWssRpc;
  }

  try {
    const res = await sendSingleWsRpc(wsUrl, method, params, timeoutMs);
    _deadWsCooldownUntil.delete(wsUrl);
    if (PUBLIC_SUBNET1_WSS_RPC_NODES.includes(wsUrl)) {
      _preferredPublicWssRpc = wsUrl;
    }
    return res;
  } catch (primaryErr) {
    // IMPORTANT: A JSON-RPC application error (e.g. VM revert `Call failed` on an optional HFS view probe)
    // proves the validator WebSocket IS healthy and answered — NEVER fail over across other validators!
    if (primaryErr?.isJsonRpcError) {
      throw primaryErr;
    }
    _deadWsCooldownUntil.set(wsUrl, Date.now() + DEAD_WS_COOLDOWN_MS);

    if (allowFailover) {
      const isHttpsPage =
        typeof window !== 'undefined' && window.location?.protocol === 'https:';
      const now = Date.now();
      const fallbackNodes = PUBLIC_SUBNET1_WSS_RPC_NODES.filter(
        (u) => u !== wsUrl && (_deadWsCooldownUntil.get(u) || 0) <= now
      );
      // Only fall back to public WSS nodes if we're on HTTPS or already targeting a public WSS node
      if (isHttpsPage || wsUrl.startsWith('wss://')) {
        for (const cand of fallbackNodes) {
          try {
            const res = await sendSingleWsRpc(cand, method, params, Math.min(timeoutMs, 4500));
            _deadWsCooldownUntil.delete(cand);
            _preferredPublicWssRpc = cand;
            SlxHfsCache.save({ rpcUrl: cand });
            return res;
          } catch (candErr) {
            if (candErr?.isJsonRpcError) {
              _preferredPublicWssRpc = cand;
              throw candErr;
            }
            _deadWsCooldownUntil.set(cand, Date.now() + DEAD_WS_COOLDOWN_MS);
          }
        }
      }
    }
    if (!String(endpointUrl || '').startsWith('http')) {
      throw primaryErr;
    }
  }

  const r = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) {
    const detail = j.error.data ? ` (${j.error.data})` : '';
    const rpcErr = new Error(
      j.error.message ? `${j.error.message}${detail}` : JSON.stringify(j.error)
    );
    rpcErr.isJsonRpcError = true;
    rpcErr.code = j.error.code;
    rpcErr.data = j.error.data;
    throw rpcErr;
  }
  return j.result;
}

/**
 * Per-EOA serialized nonce & intra-block `lowerBoundHashHex` pipelining manager.
 * Prevents nonce collisions when an app dispatches multiple concurrent transactions in the same round!
 */
export class SlxNonceQueue {
  constructor({ rpcUrlFn = () => getDefaultNodeWsUrl(), inFlightTtlMs = 22_000 } = {}) {
    this.rpcUrlFn = rpcUrlFn;
    this.inFlightTtlMs = inFlightTtlMs;
    this.nextNonceByAddr = new Map();
    this.inFlightByAddr = new Map();
    this.mutexByAddr = new Map();
  }

  reset(addrHex) {
    if (!addrHex) {
      this.nextNonceByAddr.clear();
      this.inFlightByAddr.clear();
      return;
    }
    const low = String(addrHex).toLowerCase();
    this.nextNonceByAddr.delete(low);
    this.inFlightByAddr.delete(low);
  }

  release(addrHex, nonceBig) {
    if (!addrHex) return;
    const low = String(addrHex).toLowerCase();
    this.inFlightByAddr.get(low)?.delete(BigInt(nonceBig));
  }

  async sendSigned({
    privateKey,
    to = null,
    data = '0x',
    gasLimit = 5_000_000n,
    gasPrice = 50_000_000_000n,
    chainId = 1337n,
    extraTargets = [],
    label = 'tx',
  }) {
    const senderAddr = computeAddress(privateKey);
    const key = senderAddr.toLowerCase();
    const prevLock = this.mutexByAddr.get(key) || Promise.resolve();

    let releaseLock;
    const nextLock = new Promise((r) => {
      releaseLock = r;
    });
    this.mutexByAddr.set(
      key,
      prevLock.catch(() => {}).then(() => nextLock)
    );

    await prevLock.catch(() => {});
    try {
      const rpcUrl = this.rpcUrlFn();
      const chainNonce = BigInt(
        await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [senderAddr, 'latest'])
      );
      let inFlight = this.inFlightByAddr.get(key);
      if (!inFlight) {
        inFlight = new Map();
        this.inFlightByAddr.set(key, inFlight);
      }
      const now = Date.now();
      for (const [n, entry] of inFlight.entries()) {
        if (n < chainNonce || now - entry.sentAt > this.inFlightTtlMs) {
          inFlight.delete(n);
        }
      }

      let localNext = this.nextNonceByAddr.get(key) ?? chainNonce;
      if (localNext < chainNonce) localNext = chainNonce;
      if (inFlight.size === 0 && localNext > chainNonce) localNext = chainNonce;

      const nonce = localNext;
      this.nextNonceByAddr.set(key, nonce + 1n);

      let lowerBoundHashHex = null;
      for (const [, entry] of inFlight.entries()) {
        if (!lowerBoundHashHex || entry.txHash > lowerBoundHashHex) {
          lowerBoundHashHex = entry.txHash;
        }
      }

      const signed = signOrderedLexiconTx({
        privateKey,
        nonce,
        to,
        data,
        gasLimit,
        gasPrice,
        chainId,
        extraTargets,
        lowerBoundHashHex,
      });

      const txHash = String(
        await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw])
      ).toLowerCase();
      inFlight.set(nonce, { txHash, label, sentAt: Date.now() });

      return { txHash, rawTx: signed.raw, nonce, senderAddr };
    } finally {
      releaseLock();
    }
  }
}

/**
 * Deduplicating & Immutable HFS Read Memoizer (`SlxCallCache`).
 * - Coalesces identical concurrent `(to, dataHex)` `eth_call`s in flight.
 * - Optionally caches ephemeral reads by `blockNumber` or short `ttlMs`.
 * - Permanently memoizes immutable contract metadata (`symbol()`, `decimals()`, etc.)
 *   and terminal state objects (e.g. enacted/expired `Authorization` contracts) via `getOrComputeImmutable`.
 */
export class SlxCallCache {
  constructor({
    rpcUrlFn = () => getDefaultNodeWsUrl(),
    callFn = null,
    maxEntries = 512,
  } = {}) {
    this.rpcUrlFn = typeof rpcUrlFn === 'function' ? rpcUrlFn : () => String(rpcUrlFn || getDefaultNodeWsUrl());
    this.callFn = callFn;
    this.maxEntries = maxEntries;
    this._immutable = new Map();
    this._ephemeral = new Map();
    this._inFlight = new Map();
    this._frozenObjects = new Map();
  }

  _trimMap(map) {
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  _rawCall(to, dataHex) {
    if (typeof this.callFn === 'function') {
      return this.callFn(to, dataHex);
    }
    return slxNodeRpc(this.rpcUrlFn(), 'eth_call', [{ to, data: dataHex }, 'latest']);
  }

  async call(to, dataHex, { blockNumber = 0, ttlMs = 900, immutable = false } = {}) {
    const addr = String(to || '').toLowerCase();
    const data = String(dataHex || '0x').toLowerCase();
    const key = `${addr}:${data}`;

    if (this._immutable.has(key)) {
      return this._immutable.get(key);
    }

    if (!immutable) {
      const hit = this._ephemeral.get(key);
      if (hit) {
        const blockMatch = blockNumber > 0 && hit.blockNumber === blockNumber;
        const ttlMatch = blockNumber === 0 && ttlMs > 0 && Date.now() < hit.expiresAt;
        if (blockMatch || ttlMatch) return hit.value;
      }
    }

    if (this._inFlight.has(key)) {
      return this._inFlight.get(key);
    }

    const p = Promise.resolve()
      .then(() => this._rawCall(addr, dataHex))
      .then((res) => {
        if (immutable && res && res !== '0x') {
          this._immutable.set(key, res);
          this._trimMap(this._immutable);
        } else if (blockNumber > 0 || ttlMs > 0) {
          this._ephemeral.set(key, {
            value: res,
            blockNumber,
            expiresAt: Date.now() + Math.max(0, ttlMs),
          });
          this._trimMap(this._ephemeral);
        }
        return res;
      })
      .finally(() => {
        this._inFlight.delete(key);
      });

    this._inFlight.set(key, p);
    return p;
  }

  callImmutable(to, dataHex) {
    return this.call(to, dataHex, { immutable: true });
  }

  callAbiImmutable(to, sig, typedArgs = []) {
    return this.callImmutable(to, encodeAbi(sig, typedArgs));
  }

  async getOrComputeImmutable(cacheKey, computeFn, shouldFreezeFn = (v) => Boolean(v)) {
    const key = String(cacheKey || '');
    if (this._frozenObjects.has(key)) {
      return this._frozenObjects.get(key);
    }
    const val = await computeFn();
    if (shouldFreezeFn(val)) {
      this._frozenObjects.set(key, val);
      this._trimMap(this._frozenObjects);
    }
    return val;
  }

  hasFrozen(cacheKey) {
    return this._frozenObjects.has(String(cacheKey || ''));
  }

  getFrozen(cacheKey) {
    return this._frozenObjects.get(String(cacheKey || ''));
  }

  invalidateContract(addrHex) {
    const prefix = `${String(addrHex || '').toLowerCase()}:`;
    for (const k of this._ephemeral.keys()) {
      if (k.startsWith(prefix)) this._ephemeral.delete(k);
    }
  }

  clearEphemeral() {
    this._ephemeral.clear();
  }

  clearAll() {
    this._immutable.clear();
    this._ephemeral.clear();
    this._frozenObjects.clear();
  }
}

/**
 * High-level ergonomic SuperLexicon Client for building web apps, bots, and scripts in a few lines!
 *
 * Example:
 * ```js
 * const client = new SlxClient({ rpcUrl: 'wss://node1.superlexicon.com/rpc' });
 * const supplyHex = await client.callAbi(ledgerAddr, 'totalSupply()');
 * const watcher = client.watch({ filter: { address: dexAddr }, onLog: console.log });
 * ```
 */
export class SlxClient {
  constructor({ rpcUrl = getDefaultNodeWsUrl(), chainId = 1337n } = {}) {
    this.rpcUrl = rpcUrl;
    this.chainId = BigInt(chainId);
    this.nonceQueue = new SlxNonceQueue({ rpcUrlFn: () => this.rpcUrl });
    this.cache = new SlxCallCache({ rpcUrlFn: () => this.rpcUrl });
  }

  rpc(method, params = [], timeoutMs = 15000) {
    return slxNodeRpc(this.rpcUrl, method, params, timeoutMs);
  }

  async getBlockNumber() {
    const hex = await this.rpc('eth_blockNumber');
    return Number(BigInt(hex));
  }

  async getNonce(address) {
    const hex = await this.rpc('eth_getTransactionCount', [address, 'latest']);
    return BigInt(hex);
  }

  callRaw(to, dataHex, blockTag = 'latest') {
    return this.rpc('eth_call', [{ to, data: dataHex }, blockTag]);
  }

  callAbi(to, sig, typedArgs = [], blockTag = 'latest') {
    return this.callRaw(to, encodeAbi(sig, typedArgs), blockTag);
  }

  callCached(to, sig, typedArgs = [], opts = {}) {
    return this.cache.call(to, encodeAbi(sig, typedArgs), opts);
  }

  callImmutable(to, sig, typedArgs = []) {
    return this.cache.callAbiImmutable(to, sig, typedArgs);
  }

  waitForReceipt(txHash, opts = {}) {
    return slxWaitForReceipt((m, p) => this.rpc(m, p), txHash, opts);
  }

  async sendAndConfirm({
    privateKey,
    to = null,
    data = '0x',
    gasLimit = 5_000_000n,
    extraTargets = [],
    label = 'tx',
  }) {
    const sent = await this.nonceQueue.sendSigned({
      privateKey,
      to,
      data,
      gasLimit,
      chainId: this.chainId,
      extraTargets,
      label,
    });
    try {
      const receipt = await this.waitForReceipt(sent.txHash);
      if (!receipt) {
        throw new Error(`Timeout waiting for confirmation of ${label} (${sent.txHash})`);
      }
      if (receipt.status !== '0x1') {
        throw new Error(`Transaction reverted on-chain during ${label} (${sent.txHash})`);
      }
      return { ...sent, receipt };
    } finally {
      this.nonceQueue.release(sent.senderAddr, sent.nonce);
    }
  }

  /**
   * Store WASM HFS bytecode at `0x...0100` (if needed) and instantiate a fresh contract instance!
   */
  async deployHfsWasm({ privateKey, wasmBytes, skipStoreIfUploaded = false }) {
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    const codeHash = keccak256Hex(bytes);
    if (!skipStoreIfUploaded) {
      await this.sendAndConfirm({
        privateKey,
        to: BYTECODE_STORE_ADDRESS,
        data: codeHash + bytesToHex(bytes, false),
        gasLimit: 9_500_000n,
        label: 'storeBytecode',
      });
    }
    const inst = await this.sendAndConfirm({
      privateKey,
      to: null,
      data: codeHash,
      gasLimit: 4_500_000n,
      label: 'instantiateHfs',
    });
    return {
      codeHash,
      contractAddress: String(inst.receipt.contractAddress || '').toLowerCase(),
      receipt: inst.receipt,
    };
  }

  watch(opts = {}) {
    return slxWatchChainApp({
      rpcUrl: () => this.rpcUrl,
      ...opts,
    });
  }
}
