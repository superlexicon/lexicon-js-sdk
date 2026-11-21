/**
 * @superlexicon/sdk/identity
 *
 * Headless Unified Cross-App Identity (`identity.wasm` + `IdentityRegistry`), Keypair Wallet Manager
 * (`SlxWalletManager`), and Global On-Chain `HfsRegistry` Discovery Client.
 *
 * 100% DOM-free so Node bots, CLI tools, and custom frontends can manage identities and query/register
 * HFS instances without browser dependencies. Importing `@superlexicon/sdk/ui` upgrades
 * `wallet.ensureIdentityWithPrompt()` to display the interactive nickname modal automatically.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  selectorBytes,
  computeAddress,
  generatePrivateKeyHex,
  deriveKeypairInfo,
  signOrderedLexiconTx,
} from './crypto.js';
import {
  ZERO_ADDR,
  shortHex,
  truncAddr4,
  readU16BE,
  readU32BE,
  readU64BE,
  encodeAbi,
  decodeAddrWord,
  decodeAbiStringHex,
} from './abi.js';
import {
  getDefaultNodeWsUrl,
  SlxHfsCache,
  slxNodeRpc,
} from './rpc.js';
import { slxWaitForReceipt } from './events.js';

const STORAGE_KEY_WALLET = 'slx_wallet_keypair_v1';
const STORAGE_KEY_UNIFIED_IDENTITIES = 'slx_unified_identities_v1';

let _uiIdentityPromptHandler = null;

export function registerIdentityPromptHandler(handlerFn) {
  _uiIdentityPromptHandler = handlerFn;
}

export async function readOnChainIdentityNickname(rpcUrl, identityAddr) {
  if (!identityAddr || /^0x0{40}$/i.test(identityAddr)) return '';
  try {
    const nickHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: identityAddr, data: bytesToHex(selectorBytes('nickname()')) },
      'latest',
    ]);
    const nick = decodeAbiStringHex(nickHex);
    if (nick) return nick;
  } catch (_) {}
  try {
    const hdlHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: identityAddr, data: bytesToHex(selectorBytes('handle()')) },
      'latest',
    ]);
    return decodeAbiStringHex(hdlHex);
  } catch (_) {
    return '';
  }
}

export async function readOnChainIdentityOwner(rpcUrl, identityAddr) {
  if (!identityAddr || /^0x0{40}$/i.test(identityAddr)) return '';
  try {
    const hex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: identityAddr, data: bytesToHex(selectorBytes('owner()')) },
      'latest',
    ]);
    const owner = decodeAddrWord(hex);
    return owner === ZERO_ADDR ? '' : owner;
  } catch (_) {
    return '';
  }
}

async function waitReceiptsChecked(rpcUrl, hashes) {
  const out = [];
  for (const h of hashes) {
    const r = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, {
      timeoutMs: 56_000,
      fallbackPollMs: 850,
    });
    if (!r) throw new Error(`Timed out waiting for Subnet 1 confirmation (${h.slice(0, 10)}…)`);
    if (r.status !== '0x1') {
      throw new Error(`On-chain transaction reverted (${h.slice(0, 10)}…)`);
    }
    out.push(r);
  }
  return out;
}

export class SlxWalletManager {
  constructor({ privateKey = null } = {}) {
    this.nonces = new Map();
    this.txHistory = [];
    this.listeners = new Set();
    this.keypair = privateKey
      ? { ...deriveKeypairInfo(privateKey), source: 'imported' }
      : this._loadOrCreate();
  }

  _loadOrCreate() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_WALLET);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.privateKey) {
            return {
              ...deriveKeypairInfo(parsed.privateKey),
              source: parsed.source || 'persisted',
            };
          }
        }
      } catch (_) {}
    }
    const freshPriv = generatePrivateKeyHex();
    const info = { ...deriveKeypairInfo(freshPriv), source: 'generated' };
    this._save(info);
    return info;
  }

  _save(info) {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          STORAGE_KEY_WALLET,
          JSON.stringify({ privateKey: info.privateKey, source: info.source })
        );
      } catch (_) {}
    }
  }

  _loadIdentityMap() {
    if (typeof localStorage === 'undefined') {
      return this._memIdentityMap || {};
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_UNIFIED_IDENTITIES);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  _saveIdentityMap(map) {
    this._memIdentityMap = map;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_UNIFIED_IDENTITIES, JSON.stringify(map));
      } catch (_) {}
    }
  }

  getIdentityRecord(eoaAddr = this.keypair.address) {
    const map = this._loadIdentityMap();
    return map[String(eoaAddr || '').toLowerCase()] || null;
  }

  saveIdentityRecord(record, eoaAddr = this.keypair.address) {
    const map = this._loadIdentityMap();
    const k = String(eoaAddr || '').toLowerCase();
    map[k] = {
      identityAddr: record.identityAddr,
      nickname: record.nickname,
      handle: record.handle || record.nickname,
      registryAddr: record.registryAddr || '',
    };
    this._saveIdentityMap(map);
    this._emit();
    return map[k];
  }

  clearIdentityRecord(eoaAddr = this.keypair.address) {
    const map = this._loadIdentityMap();
    delete map[String(eoaAddr || '').toLowerCase()];
    this._saveIdentityMap(map);
    this._emit();
  }

  async resolveVerifiedIdentity(rpcUrl = getDefaultNodeWsUrl()) {
    const eoa = this.keypair.address.toLowerCase();
    const rec = this.getIdentityRecord(eoa);
    if (!rec || !rec.identityAddr) return null;

    const ownerOnChain = await readOnChainIdentityOwner(rpcUrl, rec.identityAddr);
    if (!ownerOnChain || ownerOnChain.toLowerCase() !== eoa) {
      this.clearIdentityRecord(eoa);
      return null;
    }

    const liveNick = await readOnChainIdentityNickname(rpcUrl, rec.identityAddr);
    if (liveNick && liveNick !== rec.nickname) {
      return this.saveIdentityRecord({ ...rec, nickname: liveNick }, eoa);
    }
    return rec;
  }

  async deployUnifiedIdentityWithNickname(
    rawNickname,
    { rpcUrl = getDefaultNodeWsUrl(), manifest = null, onStatus = null } = {}
  ) {
    const nickname = String(rawNickname || '').trim().slice(0, 24);
    if (!nickname) throw new Error('Please enter a nickname (1–24 characters).');

    const resolvedManifest = manifest || (await SlxHfsCache.hydrateWithManifest()).manifest;
    const idCodeHash = resolvedManifest?.codeHashes?.identity;
    const authCodeHash = resolvedManifest?.codeHashes?.authorization;
    const inst = resolvedManifest?.institutional;
    if (!idCodeHash) {
      throw new Error('Missing identity.wasm codeHash in subnet1-deployments.json');
    }

    const myEoa = this.keypair.address;
    const myPriv = this.keypair.privateKey;
    const slug =
      nickname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 20) || 'user';
    const handle = `${slug}.${truncAddr4(myEoa)}`;

    if (onStatus) {
      onStatus(`Step 1/2: Instantiating Identity HFS for "${nickname}" (${truncAddr4(myEoa)})…`);
    }
    const myNonce0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const idInstSigned = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: myNonce0,
      to: null,
      data: idCodeHash,
      gasLimit: 4_000_000n,
    });
    const batch1Hashes = [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [idInstSigned.raw])];
    this.recordExternalRpcTx({
      txHash: batch1Hashes[0],
      rawTx: idInstSigned.raw,
      from: myEoa,
      to: '(instantiate Identity)',
      contractLabel: 'Identity',
      fnLabel: 'instantiate',
      dataHex: idCodeHash,
    });

    const canRegisterInst = Boolean(
      inst?.registry && inst?.keeperPriv && inst?.keeperIdentity && authCodeHash
    );
    if (canRegisterInst) {
      const keeperEoa = computeAddress(inst.keeperPriv);
      const keeperNonce0 = BigInt(
        await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [keeperEoa, 'latest'])
      );
      const authInstSigned = signOrderedLexiconTx({
        privateKey: inst.keeperPriv,
        nonce: keeperNonce0,
        to: null,
        data: authCodeHash,
        gasLimit: 4_000_000n,
      });
      batch1Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [authInstSigned.raw]));
    }

    const batch1Rcpts = await waitReceiptsChecked(rpcUrl, batch1Hashes);
    const newIdAddr = batch1Rcpts[0].contractAddress;
    const regAuthAddr = canRegisterInst ? batch1Rcpts[1].contractAddress : null;

    if (onStatus) {
      onStatus(
        `Step 2/2: Saving nickname "${nickname}" & registering ${shortHex(newIdAddr)} on IdentityRegistry…`
      );
    }
    const myNonce1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const initCd = encodeAbi('initializeWithNickname(address,string,string)', [
      ['address', myEoa],
      ['string', handle],
      ['string', nickname],
    ]);
    const initSigned = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: myNonce1,
      to: newIdAddr,
      data: initCd,
      gasLimit: 4_500_000n,
      extraTargets: [newIdAddr],
    });
    const batch2Hashes = [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [initSigned.raw])];
    this.recordExternalRpcTx({
      txHash: batch2Hashes[0],
      rawTx: initSigned.raw,
      from: myEoa,
      to: newIdAddr,
      contractLabel: 'Identity',
      fnLabel: `initializeWithNickname("${nickname}")`,
      dataHex: initCd,
    });

    if (canRegisterInst && regAuthAddr) {
      const regActionHash = await slxNodeRpc(rpcUrl, 'eth_call', [
        {
          to: inst.registry,
          data: encodeAbi('hashRegisterIdentity(address)', [['address', newIdAddr]]),
        },
        'latest',
      ]);
      const keeperEoa = computeAddress(inst.keeperPriv);
      const knBase = BigInt(
        await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [keeperEoa, 'latest'])
      );
      const targets = [inst.keeperIdentity, inst.registry, regAuthAddr, newIdAddr];

      const k1 = signOrderedLexiconTx({
        privateKey: inst.keeperPriv,
        nonce: knBase,
        to: inst.keeperIdentity,
        data: encodeAbi('initOracleAuth(address,address,address,address,bytes32,uint64)', [
          ['address', regAuthAddr],
          ['address', inst.registry],
          ['address', inst.keeperIdentity],
          ['address', inst.registry],
          ['bytes32', regActionHash],
          ['uint64', 100],
        ]),
        gasLimit: 4_800_000n,
        extraTargets: targets,
      });
      const k2 = signOrderedLexiconTx({
        privateKey: inst.keeperPriv,
        nonce: knBase + 1n,
        to: inst.keeperIdentity,
        data: encodeAbi('approveAndFinalizeAuth(address)', [['address', regAuthAddr]]),
        gasLimit: 4_800_000n,
        extraTargets: targets,
        lowerBoundHashHex: k1.txHash,
      });
      const regInner = encodeAbi('registerIdentity(address,address)', [
        ['address', newIdAddr],
        ['address', regAuthAddr],
      ]);
      const k3 = signOrderedLexiconTx({
        privateKey: inst.keeperPriv,
        nonce: knBase + 2n,
        to: inst.keeperIdentity,
        data: encodeAbi('execute(address,bytes)', [
          ['address', inst.registry],
          ['bytes', hexToBytes(regInner)],
        ]),
        gasLimit: 5_200_000n,
        extraTargets: targets,
        lowerBoundHashHex: k2.txHash,
      });

      batch2Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k1.raw]));
      batch2Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k2.raw]));
      batch2Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k3.raw]));
    }

    await waitReceiptsChecked(rpcUrl, batch2Hashes);
    return this.saveIdentityRecord(
      {
        identityAddr: newIdAddr,
        nickname,
        handle,
        registryAddr: inst?.registry || '',
      },
      myEoa
    );
  }

  async updateIdentityNickname(rawNickname, { rpcUrl = getDefaultNodeWsUrl() } = {}) {
    const nickname = String(rawNickname || '').trim().slice(0, 24);
    if (!nickname) throw new Error('Nickname must be 1–24 characters.');
    const rec = await this.resolveVerifiedIdentity(rpcUrl);
    if (!rec) return this.deployUnifiedIdentityWithNickname(nickname, { rpcUrl });

    const myEoa = this.keypair.address;
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const cd = encodeAbi('setNickname(string)', [['string', nickname]]);
    const signed = signOrderedLexiconTx({
      privateKey: this.keypair.privateKey,
      nonce,
      to: rec.identityAddr,
      data: cd,
      gasLimit: 4_000_000n,
      extraTargets: [rec.identityAddr],
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    this.recordExternalRpcTx({
      txHash,
      rawTx: signed.raw,
      from: myEoa,
      to: rec.identityAddr,
      contractLabel: 'Identity',
      fnLabel: `setNickname("${nickname}")`,
      dataHex: cd,
    });
    await waitReceiptsChecked(rpcUrl, [txHash]);
    return this.saveIdentityRecord({ ...rec, nickname }, myEoa);
  }

  async ensureIdentityWithPrompt({
    rpcUrl = getDefaultNodeWsUrl(),
    appName = 'SuperLexicon',
    forcePrompt = false,
    defaultNickname = '',
  } = {}) {
    if (!forcePrompt) {
      const existing = await this.resolveVerifiedIdentity(rpcUrl);
      if (existing) return existing;
    }
    if (typeof document !== 'undefined' && typeof _uiIdentityPromptHandler === 'function') {
      return _uiIdentityPromptHandler(this, { rpcUrl, appName });
    }
    const fallbackNick = defaultNickname || `Capt_${truncAddr4(this.keypair.address)}`;
    return this.deployUnifiedIdentityWithNickname(fallbackNick, { rpcUrl });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      try {
        fn(this.keypair, this.txHistory);
      } catch (_) {}
    }
  }

  generateNewKeypair() {
    const freshPriv = generatePrivateKeyHex();
    this.keypair = { ...deriveKeypairInfo(freshPriv), source: 'generated' };
    this._save(this.keypair);
    this._emit();
    return this.keypair;
  }

  importPrivateKey(inputStr) {
    let rawPriv = String(inputStr || '').trim();
    if (rawPriv.startsWith('{')) {
      const parsed = JSON.parse(rawPriv);
      rawPriv = parsed.privateKey || parsed.privKey || parsed.secretKey || '';
    }
    const derived = deriveKeypairInfo(rawPriv);
    this.keypair = { ...derived, source: 'imported' };
    this._save(this.keypair);
    this._emit();
    return this.keypair;
  }

  nextNonce(addrHex) {
    const k = String(addrHex || this.keypair.address).toLowerCase();
    const cur = this.nonces.get(k) || 0;
    this.nonces.set(k, cur + 1);
    return cur;
  }

  recordExternalRpcTx({
    txHash,
    rawTx = '',
    from,
    to,
    contractLabel,
    fnLabel,
    dataHex = '0x',
    blockNumber = 0,
    nonce = null,
  }) {
    const entry = {
      txHash,
      rawTx,
      nonce: nonce !== null ? nonce : this.nextNonce(from || this.keypair.address),
      from: from || this.keypair.address,
      to: to || '(deploy)',
      contractLabel,
      fnLabel,
      selector: String(dataHex || '0x').slice(0, 10),
      rc: 0,
      ok: true,
      returnHex: '0x',
      blockNumber,
      timestamp: new Date().toLocaleTimeString(),
    };
    this.txHistory.unshift(entry);
    if (this.txHistory.length > 35) this.txHistory.length = 35;
    saveCachedSignedTx(entry);
    this._emit();
    return entry;
  }
}

const STORAGE_KEY_SIGNED_TX_PROOFS = 'slx_signed_tx_proof_cache_v1';
const _memSignedTxProofs = new Map();

export function lookupCachedSignedTx(txHash) {
  if (!txHash) return null;
  const key = String(txHash).toLowerCase();
  if (_memSignedTxProofs.has(key)) return _memSignedTxProofs.get(key);
  try {
    if (typeof localStorage === 'undefined') return null;
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY_SIGNED_TX_PROOFS) || '{}');
    return map[key] || null;
  } catch (_) {
    return null;
  }
}

function saveCachedSignedTx(entry) {
  if (!entry?.txHash) return;
  const key = String(entry.txHash).toLowerCase();
  _memSignedTxProofs.set(key, entry);
  if (_memSignedTxProofs.size > 60) {
    const oldest = _memSignedTxProofs.keys().next().value;
    if (oldest) _memSignedTxProofs.delete(oldest);
  }
  try {
    if (typeof localStorage === 'undefined') return;
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY_SIGNED_TX_PROOFS) || '{}');
    map[key] = entry;
    const keys = Object.keys(map);
    if (keys.length > 60) {
      for (const oldKey of keys.slice(0, keys.length - 60)) {
        delete map[oldKey];
      }
    }
    localStorage.setItem(STORAGE_KEY_SIGNED_TX_PROOFS, JSON.stringify(map));
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Headless Global On-Chain `HfsRegistry` Client
// ---------------------------------------------------------------------------

export const HFS_TYPES = {
  DEX_CLOB: {
    typeName: 'DEX_CLOB',
    icon: '📈',
    shortLabel: 'DEX Market',
    deployBtnText: '+ New Market',
    modalTitle: 'Deploy & Register New DEX CLOB Market',
    placeholder: 'e.g. SLX-AI / SGD-FIAT Spot CLOB',
  },
  PHANTOM_FLEET: {
    typeName: 'PHANTOM_FLEET',
    icon: '⚓',
    shortLabel: 'Fleet Arena',
    deployBtnText: '+ New Arena',
    modalTitle: 'Deploy & Register New Phantom Fleet HFS Arena',
    placeholder: 'e.g. South China Sea Fleet Arena',
  },
  CORPORATE_CHARTER: {
    typeName: 'CORPORATE_CHARTER',
    icon: '🏛️',
    shortLabel: 'Charter HFS',
    deployBtnText: '+ Incorporate',
    modalTitle: 'Incorporate New CorporateCharter HFS',
    placeholder: 'e.g. Aegis Naval Robotics Pte. Ltd.',
  },
  PRODUCT_LEDGER: {
    typeName: 'PRODUCT_LEDGER',
    icon: '🛒',
    shortLabel: 'Storefront HFS',
    deployBtnText: null,
    modalTitle: 'Select ProductLedger HFS',
    placeholder: '',
  },
  SOCIAL_CHARTER: {
    typeName: 'SOCIAL_CHARTER',
    icon: '📡',
    shortLabel: 'Guild HFS',
    deployBtnText: null,
    modalTitle: 'Select SocialCharter HFS',
    placeholder: '',
  },
  FRACTURED_HEGEMONY: {
    typeName: 'FRACTURED_HEGEMONY',
    icon: '⬢',
    shortLabel: 'Hegemony Realm',
    deployBtnText: '+ New Realm',
    modalTitle: 'Deploy & Register New Fractured Hegemony Command Realm',
    placeholder: 'e.g. Boreal Rift Command Realm',
  },
  CIPHER_NOIR: {
    typeName: 'CIPHER_NOIR',
    icon: '🔐',
    shortLabel: 'Noir Tribunal',
    deployBtnText: '+ New Tribunal',
    modalTitle: 'Deploy & Register New Cipher Noir Sabotage Tribunal',
    placeholder: 'e.g. Geneva Clearinghouse Audit',
  },
  QUANTUM_LOTTERY: {
    typeName: 'QUANTUM_LOTTERY',
    icon: '🎰',
    shortLabel: '4D Lottery',
    deployBtnText: '+ New 4D Pool',
    modalTitle: 'Deploy & Register New Quantum 4D Threshold-VRF Jackpot Pool',
    placeholder: 'e.g. Subnet 1 Evening 4D Sweeps',
  },
};

export function encodeHfsTypeId(typeName) {
  const b = new Uint8Array(32);
  b.set(utf8ToBytes(String(typeName || '')).slice(0, 32), 0);
  return bytesToHex(b, true);
}

export const HfsRegistryAbi = {
  getInstancesByType(typeName, offset = 0, limit = 32) {
    return encodeAbi('getInstancesByType(bytes32,uint64,uint64)', [
      ['bytes32', encodeHfsTypeId(typeName)],
      ['uint64', offset],
      ['uint64', limit],
    ]);
  },
  registerInstance(typeName, primaryAddr, creatorIdentity, label, metaObj = {}) {
    const metaBytes =
      metaObj instanceof Uint8Array
        ? metaObj
        : utf8ToBytes(typeof metaObj === 'string' ? metaObj : JSON.stringify(metaObj || {}));
    return encodeAbi('registerInstance(bytes32,address,address,string,bytes)', [
      ['bytes32', encodeHfsTypeId(typeName)],
      ['address', primaryAddr],
      ['address', creatorIdentity || ZERO_ADDR],
      ['string', String(label || '').slice(0, 64)],
      ['bytes', metaBytes],
    ]);
  },
};

export function makeHfsSelectionKey(primaryAddr, meta = {}) {
  const addrLow = String(primaryAddr || '').toLowerCase();
  const sub = String(meta?.battleId || meta?.matchId || '').toLowerCase();
  return sub ? `${addrLow}:${sub}` : addrLow;
}

export function decodeHfsInstancesSliceHex(hex) {
  if (!hex || hex === '0x') return { totalCount: 0, items: [] };
  const b = hexToBytes(hex);
  if (b.length < 16) return { totalCount: 0, items: [] };

  const totalCount = readU64BE(b, 0);
  const returnedCount = readU64BE(b, 8);
  let pos = 16;
  const items = [];

  for (let i = 0; i < returnedCount && pos + 8 + 109 <= b.length; i++) {
    const entryIdx = readU64BE(b, pos);
    pos += 8;
    const abiVersion = readU32BE(b, pos);
    const status = b[pos + 4];
    const primaryAddr = bytesToHex(b.slice(pos + 5, pos + 25)).toLowerCase();
    const codeHash = bytesToHex(b.slice(pos + 25, pos + 57)).toLowerCase();
    const creatorEoa = bytesToHex(b.slice(pos + 57, pos + 77)).toLowerCase();
    const rawId = bytesToHex(b.slice(pos + 77, pos + 97)).toLowerCase();
    const creatorIdentity = /^0x0{40}$/.test(rawId) ? '' : rawId;
    const createdBlock = readU64BE(b, pos + 97);
    const labelLen = readU16BE(b, pos + 105);
    const metaLen = readU16BE(b, pos + 107);
    const recTotal = 109 + labelLen + metaLen;
    if (pos + recTotal > b.length) break;

    const label = bytesToUtf8(b.slice(pos + 109, pos + 109 + labelLen));
    const metaRaw = bytesToUtf8(b.slice(pos + 109 + labelLen, pos + recTotal));
    let meta = {};
    if (metaRaw) {
      try {
        meta = JSON.parse(metaRaw);
      } catch (_) {
        meta = { raw: metaRaw };
      }
    }
    pos += recTotal;

    items.push({
      entryIdx,
      abiVersion,
      status,
      primaryAddr,
      codeHash,
      creatorEoa,
      creatorIdentity,
      createdBlock,
      label,
      meta,
      selectionKey: makeHfsSelectionKey(primaryAddr, meta),
    });
  }

  return { totalCount, items };
}

const _creatorNickCache = new Map();

export const SUBNET1_HFS_REGISTRY_ADDRESS = '0xc9ab95e06851805a34d07c7bc1a9937dcde9328b';

export async function fetchRegisteredHfsByType(
  typeName,
  { rpcUrl = getDefaultNodeWsUrl(), registryAddr = null } = {}
) {
  let reg = registryAddr;
  if (!reg) {
    const { manifest } = await SlxHfsCache.hydrateWithManifest();
    reg = manifest?.hfsRegistry || SUBNET1_HFS_REGISTRY_ADDRESS;
  }
  if (!reg) return [];

  const items = [];
  let offset = 0;
  let totalCount = Infinity;
  while (offset < totalCount && offset < 256) {
    const rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: reg, data: HfsRegistryAbi.getInstancesByType(typeName, offset, 32) },
      'latest',
    ]);
    const page = decodeHfsInstancesSliceHex(rawHex);
    totalCount = page.totalCount || 0;
    if (!page.items.length) break;
    items.push(...page.items);
    offset += 32;
  }
  const active = items.filter((it) => it.status === 1);

  await Promise.all(
    active.map(async (it) => {
      if (!it.creatorIdentity) {
        it.creatorTag = truncAddr4(it.creatorEoa);
        return;
      }
      if (_creatorNickCache.has(it.creatorIdentity)) {
        it.creatorNick = _creatorNickCache.get(it.creatorIdentity);
      } else {
        const nick = await readOnChainIdentityNickname(rpcUrl, it.creatorIdentity).catch(() => '');
        if (nick) _creatorNickCache.set(it.creatorIdentity, nick);
        it.creatorNick = nick || '';
      }
      it.creatorTag = it.creatorNick
        ? `${it.creatorNick} · ${truncAddr4(it.creatorEoa)}`
        : truncAddr4(it.creatorEoa);
    })
  );

  return active;
}

export async function registerHfsInstanceOnChain({
  wallet,
  rpcUrl = getDefaultNodeWsUrl(),
  registryAddr = null,
  typeName,
  primaryAddr,
  label,
  meta = {},
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const reg = registryAddr || manifest?.hfsRegistry;
  if (!reg) throw new Error('Missing hfsRegistry address in subnet1-deployments.json');

  const idRec = await wallet.ensureIdentityWithPrompt({
    rpcUrl,
    appName: HFS_TYPES[typeName]?.shortLabel || typeName,
  });
  const creatorIdentity = idRec?.identityAddr || ZERO_ADDR;
  const myEoa = wallet.keypair.address;
  const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const cd = HfsRegistryAbi.registerInstance(typeName, primaryAddr, creatorIdentity, label, meta);

  const signed = signOrderedLexiconTx({
    privateKey: wallet.keypair.privateKey,
    nonce,
    to: reg,
    data: cd,
    gasLimit: 5_000_000n,
    extraTargets: [reg, primaryAddr, ...(creatorIdentity ? [creatorIdentity] : [])],
  });

  const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
  const [rcpt] = await waitReceiptsChecked(rpcUrl, [txHash]);
  wallet.recordExternalRpcTx({
    txHash,
    rawTx: signed.raw,
    from: myEoa,
    to: reg,
    contractLabel: 'HfsRegistry',
    fnLabel: `registerInstance(${typeName}, "${label}")`,
    dataHex: cd,
    blockNumber: Number(BigInt(rcpt.blockNumber || 0)),
    nonce: Number(nonce),
  });
  return rcpt;
}

export function getUrlHfsParam() {
  if (typeof window === 'undefined') return '';
  try {
    const u = new URL(window.location.href);
    return (u.searchParams.get('hfs') || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

export function setUrlHfsParam(primaryAddr, push = false) {
  if (typeof window === 'undefined' || !primaryAddr) return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('hfs', primaryAddr.toLowerCase());
    if (push) {
      window.history.pushState({}, '', u.toString());
    } else {
      window.history.replaceState({}, '', u.toString());
    }
  } catch (_) {}
}

export function clearUrlHfsParam(push = false) {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('hfs');
    if (push) {
      window.history.pushState({}, '', u.toString());
    } else {
      window.history.replaceState({}, '', u.toString());
    }
  } catch (_) {}
}
