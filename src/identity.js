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
  concatBytes,
  selectorBytes,
  computeAddress,
  computeCreateAddress,
  generatePrivateKeyHex,
  deriveKeypairInfo,
  signOrderedLexiconTx,
} from './crypto.js';
import {
  ZERO_ADDR,
  ZERO_BYTES32,
  shortHex,
  shortAddr,
  truncAddr4,
  u16BEBytes,
  readU16BE,
  readU32BE,
  readU64BE,
  encodeAbi,
  decodeUintWord,
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

async function waitReceiptsChecked(rpcUrl, hashes, { timeoutMs = 56_000, fallbackPollMs = 240 } = {}) {
  const rcpts = await Promise.all(
    hashes.map((h) =>
      slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, {
        timeoutMs,
        fallbackPollMs,
      })
    )
  );
  rcpts.forEach((r, idx) => {
    const h = hashes[idx];
    if (!r) throw new Error(`Timed out waiting for Subnet 1 confirmation (${h.slice(0, 10)}…)`);
    if (r.status !== '0x1') {
      throw new Error(`On-chain transaction reverted (${h.slice(0, 10)}…)`);
    }
  });
  return rcpts;
}

export class SlxWalletManager {
  constructor({ privateKey = null } = {}) {
    this.nonces = new Map();
    this.txHistory = [];
    this.listeners = new Set();
    this._pendingRegistrySeals = new Map();
    this.keypair = privateKey
      ? { ...deriveKeypairInfo(privateKey), source: 'imported' }
      : this._loadOrCreate();
  }

  async awaitRegistrySeal(identityAddr) {
    if (!identityAddr) return;
    const p = this._pendingRegistrySeals.get(String(identityAddr).toLowerCase());
    if (p) {
      await p;
    }
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
    if (record.identityAddr && record.nickname) {
      _writeSharedIdentityLabel(record.identityAddr, `${record.nickname} · ${truncAddr4(k)}`);
    }
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
    {
      rpcUrl = getDefaultNodeWsUrl(),
      manifest = null,
      onStatus = null,
      waitForRegistrySeal = false,
    } = {}
  ) {
    const nickname = String(rawNickname || '').trim().slice(0, 24);
    if (!nickname) throw new Error('Please enter a nickname (1–24 characters).');

    const emitStatus = (msg, meta = {}) => {
      if (typeof onStatus === 'function') {
        try {
          onStatus(msg, meta);
        } catch (_) {}
      }
    };

    emitStatus(`Preparing "${nickname}" Identity deployment…`, {
      pct: 14,
      sub: 'Loading Subnet 1 WASM code hashes & account nonce',
    });

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

    const canRegisterInst = Boolean(
      inst?.registry && inst?.keeperPriv && inst?.keeperIdentity && authCodeHash
    );
    const keeperEoa = canRegisterInst ? computeAddress(inst.keeperPriv) : '';

    // 1. Fetch user's uncontended nonce and precompute deterministic CREATE addresses!
    const myNonce0 = BigInt(
      await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest'])
    );
    const newIdAddr = computeCreateAddress(myEoa, myNonce0);
    const regAuthAddr = canRegisterInst ? computeCreateAddress(myEoa, myNonce0 + 2n) : '';

    emitStatus(`Signing 1-block Identity pipeline (${shortHex(newIdAddr)})…`, {
      pct: 38,
      identityAddr: newIdAddr,
      sub: `Pre-computed Identity HFS ${shortHex(newIdAddr)} • Zero-gas RLP signing`,
    });

    const ZERO_LB = '0x' + '00'.repeat(32);

    // 2. User EOA (0% background contention!) deploys Identity + initializes Nickname (+ Auth HFS) in ONE block!
    const idInstSigned = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: myNonce0,
      to: null,
      data: idCodeHash,
      gasLimit: 4_000_000n,
      extraTargets: [newIdAddr],
      lowerBoundHashHex: ZERO_LB,
    });

    const initCd = encodeAbi('initializeWithNickname(address,string,string)', [
      ['address', myEoa],
      ['string', handle],
      ['string', nickname],
    ]);
    const initSigned = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce: myNonce0 + 1n,
      to: newIdAddr,
      data: initCd,
      gasLimit: 4_500_000n,
      extraTargets: [newIdAddr],
      lowerBoundHashHex: idInstSigned.txHash,
    });

    const userRawTxs = [idInstSigned.raw, initSigned.raw];
    if (canRegisterInst) {
      const authInstSigned = signOrderedLexiconTx({
        privateKey: myPriv,
        nonce: myNonce0 + 2n,
        to: null,
        data: authCodeHash,
        gasLimit: 4_000_000n,
      });
      userRawTxs.push(authInstSigned.raw);
    }

    emitStatus(`Broadcasting "${nickname}" (${shortHex(newIdAddr)}) to Subnet 1…`, {
      pct: 60,
      identityAddr: newIdAddr,
      sub: `Submitting ${userRawTxs.length} atomic zero-gas HFS transactions in 1 block round`,
    });

    const userHashes = [];
    for (const raw of userRawTxs) {
      userHashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [raw]));
    }

    this.recordExternalRpcTx({
      txHash: userHashes[0],
      rawTx: idInstSigned.raw,
      from: myEoa,
      to: '(instantiate Identity)',
      contractLabel: 'Identity',
      fnLabel: 'instantiate',
      dataHex: idCodeHash,
    });
    this.recordExternalRpcTx({
      txHash: userHashes[1],
      rawTx: initSigned.raw,
      from: myEoa,
      to: newIdAddr,
      contractLabel: 'Identity',
      fnLabel: `initializeWithNickname("${nickname}")`,
      dataHex: initCd,
    });

    emitStatus(`Confirming "${nickname}" (${shortHex(newIdAddr)}) in next Subnet 1 block…`, {
      pct: 76,
      awaitingBlock: true,
      identityAddr: newIdAddr,
      sub: 'Awaiting single-block validator finality',
    });

    // 3. Confirm user's single-block Identity creation + nickname initialization!
    const userRcpts = await waitReceiptsChecked(rpcUrl, userHashes);
    const confirmedAddr = (userRcpts[0]?.contractAddress || newIdAddr).toLowerCase();
    const confirmedRegAuth = canRegisterInst
      ? (userRcpts[2]?.contractAddress || regAuthAddr).toLowerCase()
      : '';

    // 4. Launch non-blocking post-commit IdentityRegistry oracle seal (tracked via `awaitRegistrySeal`
    //    with automatic retry if backend `tx-load-sim` bumps `keeperEoa` nonce concurrently).
    if (canRegisterInst && confirmedRegAuth) {
      const sealPromise = (async () => {
        const regActionHash = await slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: inst.registry,
            data: encodeAbi('hashRegisterIdentity(address)', [['address', confirmedAddr]]),
          },
          'latest',
        ]);
        const targets = [inst.keeperIdentity, inst.registry, confirmedRegAuth, confirmedAddr];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const knBase = BigInt(
              await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [keeperEoa, 'latest'])
            );
            const k1 = signOrderedLexiconTx({
              privateKey: inst.keeperPriv,
              nonce: knBase,
              to: inst.keeperIdentity,
              data: encodeAbi('initOracleAuth(address,address,address,address,bytes32,uint64)', [
                ['address', confirmedRegAuth],
                ['address', inst.registry],
                ['address', inst.keeperIdentity],
                ['address', inst.registry],
                ['bytes32', regActionHash],
                ['uint64', 100],
              ]),
              gasLimit: 4_800_000n,
              extraTargets: targets,
              lowerBoundHashHex: ZERO_LB,
            });
            const k2 = signOrderedLexiconTx({
              privateKey: inst.keeperPriv,
              nonce: knBase + 1n,
              to: inst.keeperIdentity,
              data: encodeAbi('approveAndFinalizeAuth(address)', [['address', confirmedRegAuth]]),
              gasLimit: 4_800_000n,
              extraTargets: targets,
              lowerBoundHashHex: k1.txHash,
            });
            const regInner = encodeAbi('registerIdentity(address,address)', [
              ['address', confirmedAddr],
              ['address', confirmedRegAuth],
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
            const kh = [];
            for (const txObj of [k1, k2, k3]) {
              kh.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txObj.raw]));
            }
            await waitReceiptsChecked(rpcUrl, kh, { timeoutMs: 14_000, fallbackPollMs: 240 });
            break;
          } catch (_) {
            if (attempt === 2) break;
          }
        }
      })().finally(() => {
        this._pendingRegistrySeals.delete(confirmedAddr);
      });

      this._pendingRegistrySeals.set(confirmedAddr, sealPromise);
      if (waitForRegistrySeal) {
        emitStatus(`Sealing IdentityRegistry for ${shortHex(confirmedAddr)}…`, {
          pct: 91,
          awaitingBlock: true,
          identityAddr: confirmedAddr,
        });
        await sealPromise;
      }
    }

    emitStatus(`✓ Identity "${nickname}" (${shortHex(confirmedAddr)}) Live on Subnet 1!`, {
      pct: 100,
      done: true,
      identityAddr: confirmedAddr,
      sub: `Unified HFS Identity ready across all SuperLexicon apps`,
    });

    return this.saveIdentityRecord(
      {
        identityAddr: confirmedAddr,
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

  async fetchHfsAssociations({ rpcUrl = getDefaultNodeWsUrl(), identityAddr = null } = {}) {
    const idAddr = (identityAddr || this.getIdentityRecord()?.identityAddr || '').toLowerCase();
    if (!idAddr) {
      return { version: 2, items: [], byAddr: new Map() };
    }
    return fetchIdentityHfsAssociations(rpcUrl, idAddr);
  }

  async setHfsAssociation({
    hfsAddr,
    typeName = '',
    status = 2,
    label = '',
    rpcUrl = getDefaultNodeWsUrl(),
  }) {
    const cleanAddr = String(hfsAddr || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(cleanAddr) || cleanAddr === ZERO_ADDR) {
      throw new Error('Enter a valid 20-byte HFS contract address (0x…).');
    }
    const stNum = Number(status);
    if (![1, 2, 3].includes(stNum)) {
      throw new Error('Association status must be 1 (Pending), 2 (Whitelisted), or 3 (Spam).');
    }
    const idRec = await this.ensureIdentityWithPrompt({ rpcUrl, appName: 'Identity HFS Whitelist' });
    const myId = idRec.identityAddr.toLowerCase();
    const myEoa = this.keypair.address;
    const myPriv = this.keypair.privateKey;
    const typeIdHex = typeName ? encodeHfsTypeId(typeName) : ZERO_BYTES32;
    const safeLabel = String(label || '').slice(0, 64);

    const { version, extAddr } = await resolveIdentityWhitelistTarget(rpcUrl, myId);
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));

    let dataHex;
    let extraTargets;
    if (version >= 2) {
      dataHex = IdentityHfsWhitelistAbi.setHfsAssociation(cleanAddr, typeIdHex, stNum, safeLabel);
      extraTargets = [myId, cleanAddr];
    } else {
      if (!extAddr) {
        throw new Error('Missing identityHfsExtension in subnet1-deployments.json for v1 Identity');
      }
      const inner = IdentityHfsWhitelistAbi.setDelegatedHfsAssociation(
        cleanAddr,
        typeIdHex,
        stNum,
        safeLabel
      );
      dataHex = encodeAbi('execute(address,bytes)', [
        ['address', extAddr],
        ['bytes', hexToBytes(inner)],
      ]);
      extraTargets = [myId, extAddr, cleanAddr];
    }

    const signed = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: myId,
      data: dataHex,
      gasLimit: 4_800_000n,
      extraTargets,
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    const [rcpt] = await waitReceiptsChecked(rpcUrl, [txHash]);
    _invalidateIdentityAssocCache(myId);
    this.recordExternalRpcTx({
      txHash,
      rawTx: signed.raw,
      from: myEoa,
      to: myId,
      contractLabel: 'Identity',
      fnLabel: `setHfsAssociation(${shortHex(cleanAddr)}, state=${stNum})`,
      dataHex,
      blockNumber: Number(BigInt(rcpt.blockNumber || 0)),
      nonce: Number(nonce),
    });
    return rcpt;
  }

  async setHfsAssociationBatch(entries = [], { rpcUrl = getDefaultNodeWsUrl() } = {}) {
    const valid = (entries || []).filter(
      (e) => e && /^0x[0-9a-f]{40}$/i.test(String(e.hfsAddr || '')) && String(e.hfsAddr).toLowerCase() !== ZERO_ADDR
    );
    if (!valid.length) return null;
    const idRec = await this.resolveVerifiedIdentity(rpcUrl);
    if (!idRec?.identityAddr) return null;
    const myId = idRec.identityAddr.toLowerCase();
    const myEoa = this.keypair.address;
    const myPriv = this.keypair.privateKey;

    const { version, extAddr } = await resolveIdentityWhitelistTarget(rpcUrl, myId);
    const packed = packHfsAssociationBatch(valid);
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const hfsTargets = valid.map((e) => e.hfsAddr.toLowerCase());

    let dataHex;
    let extraTargets;
    if (version >= 2) {
      dataHex = IdentityHfsWhitelistAbi.setHfsAssociationBatch(packed);
      extraTargets = Array.from(new Set([myId, ...hfsTargets]));
    } else {
      if (!extAddr) return null;
      const inner = IdentityHfsWhitelistAbi.setDelegatedHfsAssociationBatch(packed);
      dataHex = encodeAbi('execute(address,bytes)', [
        ['address', extAddr],
        ['bytes', hexToBytes(inner)],
      ]);
      extraTargets = Array.from(new Set([myId, extAddr, ...hfsTargets]));
    }

    const signed = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: myId,
      data: dataHex,
      gasLimit: 5_200_000n,
      extraTargets,
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    const [rcpt] = await waitReceiptsChecked(rpcUrl, [txHash]);
    _invalidateIdentityAssocCache(myId);
    this.recordExternalRpcTx({
      txHash,
      rawTx: signed.raw,
      from: myEoa,
      to: myId,
      contractLabel: 'Identity',
      fnLabel: `setHfsAssociationBatch(${valid.length})`,
      dataHex,
      blockNumber: Number(BigInt(rcpt.blockNumber || 0)),
      nonce: Number(nonce),
    });
    return rcpt;
  }

  async notifyExternalHfsAssociation({
    targetIdentityAddr,
    hfsAddr,
    typeName = '',
    label = '',
    rpcUrl = getDefaultNodeWsUrl(),
  }) {
    const targetId = String(targetIdentityAddr || '').trim().toLowerCase();
    const cleanHfs = String(hfsAddr || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(targetId) || !/^0x[0-9a-f]{40}$/.test(cleanHfs)) return null;

    const myEoa = this.keypair.address;
    const myPriv = this.keypair.privateKey;
    const typeIdHex = typeName ? encodeHfsTypeId(typeName) : ZERO_BYTES32;
    const safeLabel = String(label || '').slice(0, 64);

    const { version, extAddr } = await resolveIdentityWhitelistTarget(rpcUrl, targetId);
    const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));

    let toAddr;
    let dataHex;
    let extraTargets;
    if (version >= 2) {
      toAddr = targetId;
      dataHex = IdentityHfsWhitelistAbi.notifyHfsAssociation(cleanHfs, typeIdHex, safeLabel);
      extraTargets = [targetId, cleanHfs];
    } else if (extAddr) {
      toAddr = extAddr;
      dataHex = IdentityHfsWhitelistAbi.notifyDelegatedHfsAssociation(
        targetId,
        cleanHfs,
        typeIdHex,
        safeLabel
      );
      extraTargets = [extAddr, targetId, cleanHfs];
    } else {
      return null;
    }

    const signed = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: toAddr,
      data: dataHex,
      gasLimit: 4_200_000n,
      extraTargets,
    });
    const txHash = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    const [rcpt] = await waitReceiptsChecked(rpcUrl, [txHash]);
    _invalidateIdentityAssocCache(targetId);
    return rcpt;
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
  SECRET_BALLOT: {
    typeName: 'SECRET_BALLOT',
    icon: '🗳️',
    shortLabel: 'CipherVote',
    deployBtnText: '+ New Ballot Hub',
    modalTitle: 'Deploy & Register New CipherVote Homomorphic Ballot Hub',
    placeholder: 'e.g. Subnet 1 Institutional & Civic Ballot Hub',
  },
  IFRS_LEDGER: {
    typeName: 'IFRS_LEDGER',
    icon: '📒',
    shortLabel: 'IFRS Ledger',
    deployBtnText: '+ Incorporate IFRS Suite',
    modalTitle: 'Deploy Self-Contained IFRS AccountingLedger + Virgin Treasury Custody',
    placeholder: 'e.g. Meridian Robotics Pte. Ltd.',
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
  await wallet
    .setHfsAssociation({
      hfsAddr: primaryAddr,
      typeName,
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});
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

// ---------------------------------------------------------------------------
// Cross-App Cached & Debounced Identity Label Directory + Standard HFS Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY_IDENTITY_DIRECTORY = 'slx_identity_directory_v1';
const _sharedMemIdentityLabels = new Map();
let _sharedLabelsHydrated = false;

function _hydrateSharedIdentityLabels() {
  if (_sharedLabelsHydrated) return;
  _sharedLabelsHydrated = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_IDENTITY_DIRECTORY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj || {})) {
      if (k && typeof v === 'string' && v) {
        _sharedMemIdentityLabels.set(k.toLowerCase(), v);
      }
    }
  } catch (_) {}
}

function _writeSharedIdentityLabel(addrHex, labelStr, persist = true) {
  if (!addrHex || !labelStr) return;
  _hydrateSharedIdentityLabels();
  const low = String(addrHex).toLowerCase();
  _sharedMemIdentityLabels.set(low, labelStr);
  while (_sharedMemIdentityLabels.size > 300) {
    const oldest = _sharedMemIdentityLabels.keys().next().value;
    if (oldest === undefined) break;
    _sharedMemIdentityLabels.delete(oldest);
  }
  if (persist && typeof localStorage !== 'undefined') {
    try {
      const out = {};
      for (const [k, v] of _sharedMemIdentityLabels.entries()) {
        out[k] = v;
      }
      localStorage.setItem(STORAGE_KEY_IDENTITY_DIRECTORY, JSON.stringify(out));
    } catch (_) {}
  }
}

/**
 * Shared cross-app Identity handle directory (`SlxIdentityDirectory`).
 * - Shares resolved `identityAddr -> "Handle · eoa4"` labels across all SuperLexicon apps via `localStorage` + memory.
 * - Deduplicates concurrent on-chain `nickname()` + `owner()` lookups per address.
 * - Batches resolved label notifications with a `debounceMs` timer (default `150ms`) so UIs repaint cleanly
 *   with zero RPC refresh storms.
 */
export class SlxIdentityDirectory {
  constructor({
    rpcUrlFn = () => getDefaultNodeWsUrl(),
    wallet = null,
    debounceMs = 150,
    onLabelsUpdated = null,
    persistToStorage = true,
    onlineFn = () => true,
    resolverFn = null,
  } = {}) {
    _hydrateSharedIdentityLabels();
    this.rpcUrlFn = typeof rpcUrlFn === 'function' ? rpcUrlFn : () => String(rpcUrlFn || getDefaultNodeWsUrl());
    this.wallet = wallet || null;
    this.debounceMs = Math.max(0, Number(debounceMs ?? 150));
    this.onLabelsUpdated = onLabelsUpdated || null;
    this.persistToStorage = persistToStorage !== false;
    this.onlineFn = typeof onlineFn === 'function' ? onlineFn : () => true;
    this.resolverFn = resolverFn || null;

    this.labels = new Map(_sharedMemIdentityLabels);
    this.myIdentityAddr = '';
    this.myIdentityHandle = '';
    this._resolving = new Set();
    this._listeners = new Set();
    this._notifyTimer = null;
  }

  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  setMyIdentity(identityAddr, handle = '') {
    this.myIdentityAddr = String(identityAddr || '').toLowerCase();
    this.myIdentityHandle = String(handle || '');
    if (this.myIdentityAddr && this.myIdentityHandle) {
      const eoa = this.wallet?.keypair?.address;
      const tag = eoa ? `${this.myIdentityHandle} · ${truncAddr4(eoa)}` : this.myIdentityHandle;
      this.seed(this.myIdentityAddr, tag, { persist: this.persistToStorage });
    }
  }

  seed(addrHex, labelStr, { persist = false } = {}) {
    if (!addrHex || !labelStr) return;
    const low = String(addrHex).toLowerCase();
    this.labels.set(low, labelStr);
    _writeSharedIdentityLabel(low, labelStr, persist && this.persistToStorage);
  }

  seedMany(entries = [], opts = {}) {
    for (const item of entries) {
      if (Array.isArray(item)) {
        this.seed(item[0], item[1], opts);
      } else if (item && item.addr && item.label) {
        this.seed(item.addr, item.label, opts);
      }
    }
  }

  invalidate(addrHex) {
    if (!addrHex) return;
    const low = String(addrHex).toLowerCase();
    this.labels.delete(low);
    _sharedMemIdentityLabels.delete(low);
    this._resolving.delete(low);
  }

  _scheduleNotify() {
    if (this._notifyTimer) return;
    const fire = () => {
      this._notifyTimer = null;
      if (typeof this.onLabelsUpdated === 'function') {
        try {
          this.onLabelsUpdated(this.labels);
        } catch (_) {}
      }
      for (const fn of this._listeners) {
        try {
          fn(this.labels);
        } catch (_) {}
      }
    };
    if (this.debounceMs === 0) {
      fire();
    } else {
      this._notifyTimer = setTimeout(fire, this.debounceMs);
    }
  }

  labelFor(addrHex, { resolveIfMissing = true } = {}) {
    if (!addrHex) return '—';
    const low = String(addrHex).toLowerCase();
    if (this.myIdentityAddr && low === this.myIdentityAddr) {
      const eoa = this.wallet?.keypair?.address;
      const base = this.myIdentityHandle || shortAddr(low);
      return eoa ? `${base} · ${truncAddr4(eoa)} (You)` : `${base} (You)`;
    }
    if (this.labels.has(low)) {
      return this.labels.get(low);
    }
    if (_sharedMemIdentityLabels.has(low)) {
      const shared = _sharedMemIdentityLabels.get(low);
      this.labels.set(low, shared);
      return shared;
    }

    if (resolveIfMissing && this.onlineFn() && !this._resolving.has(low) && low !== ZERO_ADDR) {
      this._resolving.add(low);
      const rpcUrl = this.rpcUrlFn();
      const lookupPromise =
        typeof this.resolverFn === 'function'
          ? Promise.resolve(this.resolverFn(low, rpcUrl))
          : Promise.all([
              readOnChainIdentityNickname(rpcUrl, low),
              readOnChainIdentityOwner(rpcUrl, low),
            ]).then(([nick, owner]) => ({ nick, owner }));

      lookupPromise
        .then((res) => {
          const nick = res?.nick || '';
          const owner = res?.owner || '';
          if (nick) {
            const tag = owner && owner !== ZERO_ADDR ? `${nick} · ${truncAddr4(owner)}` : nick;
            this.labels.set(low, tag);
            _writeSharedIdentityLabel(low, tag, this.persistToStorage);
            this._scheduleNotify();
          }
        })
        .catch(() => {
          this._resolving.delete(low);
        });
    }
    return shortAddr(low);
  }
}

/**
 * Enumerate non-zero holder addresses from any HFS `AssetLedger` / `ShareLedger`
 * implementing `registeredHolderCount()` + `registeredHolderAt(uint64)`.
 */
export async function fetchRegisteredHolders(
  rpcUrl,
  ledgerAddr,
  { limit = 64, callFn = null } = {}
) {
  if (!ledgerAddr || ledgerAddr.toLowerCase() === ZERO_ADDR) return [];
  const execCall =
    typeof callFn === 'function'
      ? (to, data) => callFn(to, data)
      : (to, data) => slxNodeRpc(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
  try {
    const cnt = decodeUintWord(
      await execCall(ledgerAddr, encodeAbi('registeredHolderCount()')).catch(() => '0x0')
    );
    if (cnt === 0) return [];
    const addrs = await Promise.all(
      Array.from({ length: Math.min(cnt, limit) }, (_, idx) =>
        execCall(ledgerAddr, encodeAbi('registeredHolderAt(uint64)', [['uint64', idx]]))
          .then(decodeAddrWord)
          .catch(() => ZERO_ADDR)
      )
    );
    return addrs.filter((a) => a && a !== ZERO_ADDR);
  } catch (_) {
    return [];
  }
}

/**
 * Standard predicate indicating whether an HFS `Authorization` contract has reached an
 * immutable terminal state (`3` = Expired, `4` = Consumed with 0 pending claims, or failed Step-1 bids)
 * and can be permanently cached via `SlxCallCache.getOrComputeImmutable`.
 */
export function isTerminalAuthStatus(
  statusNum,
  { failedBidsStage = false, pendingClaims = 0 } = {}
) {
  const s = Number(statusNum || 0);
  if (failedBidsStage) return true;
  if (s === 3) return true;
  if (s === 4 && Number(pendingClaims || 0) === 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Identity Smart-Contract HFS Subroutine Whitelist & Spam Register (v2 + v1 Extension)
// ---------------------------------------------------------------------------

export const HFS_ASSOC_STATUS = {
  UNLISTED: 0,
  PENDING: 1,
  WHITELISTED: 2,
  SPAM: 3,
};

export const HFS_ASSOC_STATUS_LABELS = {
  0: 'Unlisted',
  1: 'Pending / Unverified',
  2: 'Whitelisted (Valid)',
  3: 'Spam / Blocked',
};

export function decodeHfsTypeIdHex(hex32) {
  if (!hex32 || hex32 === '0x') return '';
  const b = hexToBytes(hex32);
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return bytesToUtf8(b.slice(0, end));
}

export function packHfsAssociationBatch(entries = []) {
  const safe = entries.slice(0, 32);
  const chunks = [u16BEBytes(safe.length)];
  for (const e of safe) {
    const addrB = hexToBytes(e.hfsAddr).slice(-20);
    const typeHex = e.typeIdHex || (e.typeName ? encodeHfsTypeId(e.typeName) : ZERO_BYTES32);
    const typeB = hexToBytes(typeHex).slice(0, 32);
    const statusB = new Uint8Array([Number(e.status ?? HFS_ASSOC_STATUS.WHITELISTED) & 0xff]);
    const lblB = utf8ToBytes(String(e.label || '')).slice(0, 64);
    const lblLenB = new Uint8Array([lblB.length & 0xff]);
    chunks.push(addrB, typeB, statusB, lblLenB, lblB);
  }
  return concatBytes(...chunks);
}

export const IdentityHfsWhitelistAbi = {
  identityVersion() {
    return encodeAbi('identityVersion()');
  },
  setHfsAssociation(hfsAddr, typeIdHex, status, label = '') {
    return encodeAbi('setHfsAssociation(address,bytes32,uint64,string)', [
      ['address', hfsAddr],
      ['bytes32', typeIdHex || ZERO_BYTES32],
      ['uint64', status],
      ['string', String(label || '').slice(0, 64)],
    ]);
  },
  setHfsAssociationBatch(packedBytes) {
    return encodeAbi('setHfsAssociationBatch(bytes)', [['bytes', packedBytes]]);
  },
  notifyHfsAssociation(hfsAddr, typeIdHex, label = '') {
    return encodeAbi('notifyHfsAssociation(address,bytes32,string)', [
      ['address', hfsAddr],
      ['bytes32', typeIdHex || ZERO_BYTES32],
      ['string', String(label || '').slice(0, 64)],
    ]);
  },
  getHfsAssociationStatus(hfsAddr) {
    return encodeAbi('getHfsAssociationStatus(address)', [['address', hfsAddr]]);
  },
  isHfsWhitelisted(hfsAddr) {
    return encodeAbi('isHfsWhitelisted(address)', [['address', hfsAddr]]);
  },
  getHfsAssociationsSlice(offset = 0, limit = 64) {
    return encodeAbi('getHfsAssociationsSlice(uint64,uint64)', [
      ['uint64', offset],
      ['uint64', limit],
    ]);
  },
  setDelegatedHfsAssociation(hfsAddr, typeIdHex, status, label = '') {
    return encodeAbi('setDelegatedHfsAssociation(address,bytes32,uint64,string)', [
      ['address', hfsAddr],
      ['bytes32', typeIdHex || ZERO_BYTES32],
      ['uint64', status],
      ['string', String(label || '').slice(0, 64)],
    ]);
  },
  setDelegatedHfsAssociationBatch(packedBytes) {
    return encodeAbi('setDelegatedHfsAssociationBatch(bytes)', [['bytes', packedBytes]]);
  },
  notifyDelegatedHfsAssociation(subjectIdentity, hfsAddr, typeIdHex, label = '') {
    return encodeAbi('notifyDelegatedHfsAssociation(address,address,bytes32,string)', [
      ['address', subjectIdentity],
      ['address', hfsAddr],
      ['bytes32', typeIdHex || ZERO_BYTES32],
      ['string', String(label || '').slice(0, 64)],
    ]);
  },
  getDelegatedHfsAssociationsSlice(subjectIdentity, offset = 0, limit = 64) {
    return encodeAbi('getDelegatedHfsAssociationsSlice(address,uint64,uint64)', [
      ['address', subjectIdentity],
      ['uint64', offset],
      ['uint64', limit],
    ]);
  },
};

export function decodeIdentityHfsSliceHex(hex) {
  if (!hex || hex === '0x') return { totalCount: 0, items: [] };
  const b = hexToBytes(hex);
  if (b.length < 16) return { totalCount: 0, items: [] };

  const totalCount = readU64BE(b, 0);
  const returnedCount = readU64BE(b, 8);
  let pos = 16;
  const items = [];

  for (let i = 0; i < returnedCount && pos + 8 + 83 <= b.length; i++) {
    const entryIdx = readU64BE(b, pos);
    pos += 8;
    const status = b[pos];
    const hfsAddr = bytesToHex(b.slice(pos + 1, pos + 21)).toLowerCase();
    const typeIdHex = bytesToHex(b.slice(pos + 21, pos + 53)).toLowerCase();
    const typeName = decodeHfsTypeIdHex(typeIdHex);
    const updatedBlock = readU64BE(b, pos + 53);
    const actor = bytesToHex(b.slice(pos + 61, pos + 81)).toLowerCase();
    const labelLen = readU16BE(b, pos + 81);
    const recTotal = 83 + labelLen;
    if (pos + recTotal > b.length) break;
    const label = bytesToUtf8(b.slice(pos + 83, pos + recTotal));
    pos += recTotal;

    items.push({
      entryIdx,
      status,
      statusLabel: HFS_ASSOC_STATUS_LABELS[status] || 'Unlisted',
      hfsAddr,
      typeIdHex,
      typeName,
      updatedBlock,
      actor,
      label,
    });
  }

  return { totalCount, items };
}

const _identityAbiVerCache = new Map();
const _identityAssocMemCache = new Map();
const _identityAssocListeners = new Set();

export function onIdentityHfsAssociationsChanged(fn) {
  if (typeof fn !== 'function') return () => {};
  _identityAssocListeners.add(fn);
  return () => _identityAssocListeners.delete(fn);
}

function _invalidateIdentityAssocCache(identityAddr) {
  if (identityAddr) {
    _identityAssocMemCache.delete(String(identityAddr).toLowerCase());
  } else {
    _identityAssocMemCache.clear();
  }
  for (const fn of _identityAssocListeners) {
    try {
      fn(identityAddr ? String(identityAddr).toLowerCase() : '');
    } catch (_) {}
  }
}

export const SUBNET1_IDENTITY_HFS_EXTENSION_ADDRESS =
  '0x8295c9fbf3ae208ecf54cc21ced52ecaee81f235';

export async function resolveIdentityWhitelistTarget(rpcUrl, identityAddr, { manifest = null } = {}) {
  const low = String(identityAddr || '').toLowerCase();
  const resolvedManifest = manifest || (await SlxHfsCache.hydrateWithManifest()).manifest;
  const extAddr = String(
    resolvedManifest?.identityHfsExtension || SUBNET1_IDENTITY_HFS_EXTENSION_ADDRESS
  ).toLowerCase();
  if (!low || low === ZERO_ADDR) {
    return { version: 2, extAddr };
  }
  if (_identityAbiVerCache.has(low)) {
    return { version: _identityAbiVerCache.get(low), extAddr };
  }
  let ver = 1;
  try {
    const raw = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: low, data: IdentityHfsWhitelistAbi.identityVersion() },
      'latest',
    ]);
    const parsed = decodeUintWord(raw);
    if (parsed >= 2) ver = parsed;
  } catch (_) {
    ver = 1;
  }
  _identityAbiVerCache.set(low, ver);
  return { version: ver, extAddr };
}

export async function fetchIdentityHfsAssociations(
  rpcUrl,
  identityAddr,
  { manifest = null, forceRefresh = false } = {}
) {
  const low = String(identityAddr || '').toLowerCase();
  if (!low || low === ZERO_ADDR) {
    return { version: 2, items: [], byAddr: new Map() };
  }
  if (!forceRefresh && _identityAssocMemCache.has(low)) {
    const cached = _identityAssocMemCache.get(low);
    if (Date.now() - cached.at < 4500) {
      return cached.value;
    }
  }

  const { version, extAddr } = await resolveIdentityWhitelistTarget(rpcUrl, low, { manifest });
  const items = [];
  let offset = 0;
  let totalCount = Infinity;

  while (offset < totalCount && offset < 256) {
    let rawHex = '0x';
    try {
      if (version >= 2) {
        rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
          { to: low, data: IdentityHfsWhitelistAbi.getHfsAssociationsSlice(offset, 64) },
          'latest',
        ]);
      } else if (extAddr) {
        rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: extAddr,
            data: IdentityHfsWhitelistAbi.getDelegatedHfsAssociationsSlice(low, offset, 64),
          },
          'latest',
        ]);
      } else {
        break;
      }
    } catch (_) {
      break;
    }
    const page = decodeIdentityHfsSliceHex(rawHex);
    totalCount = page.totalCount || 0;
    if (!page.items.length) break;
    items.push(...page.items);
    offset += 64;
  }

  const byAddr = new Map();
  for (const it of items) {
    byAddr.set(it.hfsAddr, it);
  }
  const value = { version, items, byAddr };
  _identityAssocMemCache.set(low, { at: Date.now(), value });
  return value;
}

function buildManifestShowcaseAddrSet(manifest) {
  const set = new Set();
  if (!manifest) return set;
  const inst = manifest.institutional || {};
  const sec = manifest.secondaryDeployments || {};
  const ifrs = manifest.ifrsAccounting || {};
  const ifrsSec = ifrs.secondaryCompany || {};
  const add = (v) => {
    if (typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v)) {
      set.add(v.toLowerCase());
    }
  };
  [
    manifest.battleship?.contractAddr,
    sec.battleship2?.contractAddr,
    inst.corporateCharter,
    inst.dexClob,
    inst.productLedger,
    inst.accountingLedger,
    inst.fiatLedger,
    inst.shareLedger,
    sec.techDex?.dexClob,
    ifrs.primaryLedger,
    ifrs.primaryProductLedger,
    ifrsSec.corporateCharter,
    ifrsSec.accountingLedger,
    manifest.fleetSocial?.charter,
    manifest.commonsRf?.charter,
    manifest.commonsRf?.meiProductLedger,
    manifest.hegemony?.contractAddr,
    sec.hegemony2?.contractAddr,
    manifest.cipherNoir?.contractAddr,
    sec.cipherNoir2?.contractAddr,
    manifest.quantumLottery?.contractAddr,
    manifest.quantumLottery?.secondaryPool?.contractAddr,
    manifest.secretBallot?.contractAddr,
    manifest.secretBallot?.secondaryHub,
  ].forEach(add);
  return set;
}

const _probeCache = new Map();

async function probeUnwhitelistedHfsAssociation(rpcUrl, typeName, it, identityAddr, baseShareLedger = '') {
  const key = `${typeName}:${it.primaryAddr}:${identityAddr}`;
  const hit = _probeCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) {
    return hit.reason;
  }

  let reason = '';
  const m = it.meta || {};
  const metaJsonLow = JSON.stringify(m).toLowerCase();

  try {
    if (typeName === 'CORPORATE_CHARTER') {
      const shLed = String(m.sh || m.shareLedger || '').toLowerCase();
      const [isDirHex, isPendHex, shBalHex] = await Promise.all([
        slxNodeRpc(rpcUrl, 'eth_call', [
          { to: it.primaryAddr, data: encodeAbi('isDirector(address)', [['address', identityAddr]]) },
          'latest',
        ]).catch(() => '0x0'),
        slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: it.primaryAddr,
            data: encodeAbi('isPendingDirector(address)', [['address', identityAddr]]),
          },
          'latest',
        ]).catch(() => '0x0'),
        shLed && /^0x[0-9a-f]{40}$/.test(shLed)
          ? slxNodeRpc(rpcUrl, 'eth_call', [
              { to: shLed, data: encodeAbi('balanceOf(address)', [['address', identityAddr]]) },
              'latest',
            ]).catch(() => '0x0')
          : Promise.resolve('0x0'),
      ]);
      if (decodeUintWord(isPendHex) === 1) {
        reason = 'Named your Identity as Pending Director without whitelist';
      } else if (decodeUintWord(isDirHex) === 1) {
        reason = 'Named your Identity on Board of Directors without whitelist';
      } else if (decodeUintWord(shBalHex) > 0) {
        reason = `Allocated ${decodeUintWord(shBalHex).toLocaleString('en-US')} unsolicited shares without whitelist`;
      }
    } else if (typeName === 'IFRS_LEDGER') {
      const chr = String(m.corporateCharter || '').toLowerCase();
      if (String(m.treasuryIdentity || '').toLowerCase() === identityAddr) {
        reason = 'Bound your Identity as Treasury Vault without whitelist';
      } else if (chr && /^0x[0-9a-f]{40}$/.test(chr)) {
        const [dHex, pHex] = await Promise.all([
          slxNodeRpc(rpcUrl, 'eth_call', [
            { to: chr, data: encodeAbi('isDirector(address)', [['address', identityAddr]]) },
            'latest',
          ]).catch(() => '0x0'),
          slxNodeRpc(rpcUrl, 'eth_call', [
            { to: chr, data: encodeAbi('isPendingDirector(address)', [['address', identityAddr]]) },
            'latest',
          ]).catch(() => '0x0'),
        ]);
        if (decodeUintWord(dHex) === 1 || decodeUintWord(pHex) === 1) {
          reason = 'Associated IFRS Ledger with your Identity without whitelist';
        }
      }
    } else if (typeName === 'DEX_CLOB') {
      const shLed = String(m.shareLedger || '').toLowerCase();
      if (shLed && /^0x[0-9a-f]{40}$/.test(shLed) && shLed !== baseShareLedger) {
        const bal = decodeUintWord(
          await slxNodeRpc(rpcUrl, 'eth_call', [
            { to: shLed, data: encodeAbi('balanceOf(address)', [['address', identityAddr]]) },
            'latest',
          ]).catch(() => '0x0')
        );
        if (bal > 0) {
          reason = `Allocated ${bal.toLocaleString('en-US')} unsolicited tokens on unwhitelisted DEX`;
        }
      }
    }
    if (!reason && metaJsonLow.includes(identityAddr)) {
      reason = 'Referenced your Identity in HFS metadata without whitelist';
    }
  } catch (_) {}

  _probeCache.set(key, { at: Date.now(), reason });
  return reason;
}

/**
 * Partition HFS instances of `typeName` into:
 *  - `whitelistedItems`: Subroutines validly whitelisted in `Identity` (`State = 2`) or deployed by `myEoa`.
 *  - `spamItems`: Subroutines that attempted to associate with `identityAddr` without being whitelisted
 *                 (`State = 1` Pending, unsolicited on-chain Board/Cap-Table/Token association, or `State = 3` Blocked Spam).
 *  - `publicItems`: Public network instances that have not attempted to associate with `identityAddr`.
 */
export async function classifyHfsInstancesForIdentity(
  instances = [],
  {
    typeName = '',
    identityAddr = '',
    myEoa = '',
    assocByAddr = null,
    rpcUrl = getDefaultNodeWsUrl(),
    manifest = null,
    callFn = null,
  } = {}
) {
  const idLow = String(identityAddr || '').toLowerCase();
  const eoaLow = String(myEoa || '').toLowerCase();
  if (!idLow || idLow === ZERO_ADDR) {
    return {
      whitelistedItems: [],
      publicItems: instances.map((it) => ({ ...it, assocStatus: 0, assocCategory: 'public' })),
      spamItems: [],
      validItems: instances.map((it) => ({ ...it, assocStatus: 0, assocCategory: 'public' })),
    };
  }

  const resolvedManifest =
    manifest || (callFn ? null : (await SlxHfsCache.hydrateWithManifest()).manifest);
  const byAddr =
    assocByAddr || (await fetchIdentityHfsAssociations(rpcUrl, idLow, { manifest: resolvedManifest })).byAddr;
  const showcaseSet = buildManifestShowcaseAddrSet(resolvedManifest);
  const dexDeskSet = new Set(
    (resolvedManifest?.institutional?.dexDeskIdentities || [])
      .map((d) => String(d.identityAddr || '').toLowerCase())
      .filter(Boolean)
  );
  const baseShareLedger = String(resolvedManifest?.institutional?.shareLedger || '').toLowerCase();

  const whitelistedItems = [];
  const publicItems = [];
  const spamItems = [];
  const seenPrimary = new Set();

  const classified = await Promise.all(
    instances.map(async (it) => {
      const addrLow = String(it.primaryAddr || '').toLowerCase();
      seenPrimary.add(addrLow);
      const rec = byAddr.get(addrLow);

      if (rec?.status === HFS_ASSOC_STATUS.WHITELISTED) {
        return {
          bucket: 'whitelisted',
          item: {
            ...it,
            assocStatus: HFS_ASSOC_STATUS.WHITELISTED,
            assocCategory: 'whitelisted',
            assocBadge: 'Whitelisted (State 2)',
            assocRecord: rec,
          },
        };
      }

      if (rec?.status === HFS_ASSOC_STATUS.SPAM) {
        return {
          bucket: 'spam',
          item: {
            ...it,
            assocStatus: HFS_ASSOC_STATUS.SPAM,
            assocCategory: 'spam',
            spamReason: 'Blocked as Spam in your Identity HFS Register (State = 3)',
            assocRecord: rec,
          },
        };
      }

      if (rec?.status === HFS_ASSOC_STATUS.PENDING) {
        return {
          bucket: 'spam',
          item: {
            ...it,
            assocStatus: HFS_ASSOC_STATUS.PENDING,
            assocCategory: 'spam',
            spamReason: rec.label
              ? `Unverified association "${rec.label}" awaiting whitelist (State = 1)`
              : 'Unverified inbound association awaiting whitelist (State = 1)',
            assocRecord: rec,
          },
        };
      }

      // Implicitly valid if deployed directly from this wallet's EOA (unless explicitly marked SPAM = 3 above)
      if (eoaLow && String(it.creatorEoa || '').toLowerCase() === eoaLow) {
        return {
          bucket: 'whitelisted',
          item: {
            ...it,
            assocStatus: HFS_ASSOC_STATUS.WHITELISTED,
            assocCategory: 'whitelisted',
            isImplicitOwnEoa: true,
            assocBadge: 'Deployed by Your Keypair',
          },
        };
      }

      // Spoofed creatorIdentity!
      if (String(it.creatorIdentity || '').toLowerCase() === idLow) {
        return {
          bucket: 'spam',
          item: {
            ...it,
            assocStatus: HFS_ASSOC_STATUS.UNLISTED,
            assocCategory: 'spam',
            spamReason: 'Claimed your Identity as creator without authorization',
          },
        };
      }

      const isSimShowcase =
        showcaseSet.has(addrLow) ||
        (typeName === 'DEX_CLOB' &&
          it.creatorIdentity &&
          dexDeskSet.has(String(it.creatorIdentity).toLowerCase()));

      if (!isSimShowcase && !callFn) {
        const probeReason = await probeUnwhitelistedHfsAssociation(
          rpcUrl,
          typeName,
          it,
          idLow,
          baseShareLedger
        );
        if (probeReason) {
          return {
            bucket: 'spam',
            item: {
              ...it,
              assocStatus: HFS_ASSOC_STATUS.UNLISTED,
              assocCategory: 'spam',
              spamReason: probeReason,
            },
          };
        }
      }

      return {
        bucket: 'public',
        item: {
          ...it,
          assocStatus: HFS_ASSOC_STATUS.UNLISTED,
          assocCategory: 'public',
        },
      };
    })
  );

  for (const entry of classified) {
    if (entry.bucket === 'whitelisted') whitelistedItems.push(entry.item);
    else if (entry.bucket === 'spam') spamItems.push(entry.item);
    else publicItems.push(entry.item);
  }

  // Also surface off-registry entries recorded directly in Identity's HFS Register for `typeName`!
  for (const rec of byAddr.values()) {
    if (seenPrimary.has(rec.hfsAddr)) continue;
    if (typeName && rec.typeName && rec.typeName !== typeName) continue;
    const synth = {
      entryIdx: rec.entryIdx,
      abiVersion: 2,
      status: 1,
      primaryAddr: rec.hfsAddr,
      codeHash: ZERO_BYTES32,
      creatorEoa: rec.actor,
      creatorIdentity: '',
      createdBlock: rec.updatedBlock,
      label: rec.label || `${rec.typeName || typeName || 'HFS'} · ${shortHex(rec.hfsAddr)}`,
      meta: {},
      selectionKey: makeHfsSelectionKey(rec.hfsAddr, {}),
      assocStatus: rec.status,
      assocRecord: rec,
      isOffRegistry: true,
    };
    if (rec.status === HFS_ASSOC_STATUS.WHITELISTED) {
      whitelistedItems.push({
        ...synth,
        assocCategory: 'whitelisted',
        assocBadge: 'Whitelisted (Off-Registry)',
      });
    } else if (rec.status === HFS_ASSOC_STATUS.PENDING || rec.status === HFS_ASSOC_STATUS.SPAM) {
      spamItems.push({
        ...synth,
        assocCategory: 'spam',
        spamReason:
          rec.status === HFS_ASSOC_STATUS.SPAM
            ? 'Blocked as Spam in your Identity HFS Register (State = 3)'
            : `Unverified inbound notification "${rec.label || shortHex(rec.hfsAddr)}" (State = 1)`,
      });
    }
  }

  return {
    whitelistedItems,
    publicItems,
    spamItems,
    validItems: [...whitelistedItems, ...publicItems],
  };
}
