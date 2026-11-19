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

export const PUBLIC_SUBNET1_WSS_RPC = 'wss://node1.superlexicon.com/rpc';
export const BYTECODE_STORE_ADDRESS = '0x0000000000000000000000000000000000000100';
const STORAGE_KEY_HFS_CACHE = 'slx_hfs_address_cache_v1';

export function getDefaultNodeWsUrl() {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname.toLowerCase();
    if (window.location.protocol === 'https:' || host.endsWith('superlexicon.com')) {
      return PUBLIC_SUBNET1_WSS_RPC;
    }
    return `ws://${window.location.hostname}:8545`;
  }
  return PUBLIC_SUBNET1_WSS_RPC;
}

export const SlxHfsCache = {
  load() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HFS_CACHE);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  },
  save(patch) {
    const next = { ...this.load(), ...patch };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_HFS_CACHE, JSON.stringify(next));
      } catch (_) {}
    }
    return next;
  },
  async hydrateWithManifest(manifestUrl = '/contracts/subnet1-deployments.json') {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('slx_inst_wasm_snapshot_v1');
      } catch (_) {}
    }
    const cached = this.load();
    let manifest = null;
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch(manifestUrl, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
      } catch (_) {}
    }
    const defaultWs = getDefaultNodeWsUrl();
    const isHttpsPage =
      typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const cachedRpc = String(cached.rpcUrl || '');
    const isStaleCachedRpc =
      !cachedRpc.startsWith('ws') ||
      cachedRpc.includes('superlexicon.com:8545') ||
      (isHttpsPage && cachedRpc.startsWith('ws://'));
    const useRpc = isStaleCachedRpc ? defaultWs : cachedRpc;
    const merged = {
      rpcUrl: useRpc,
      battleshipAddr: manifest?.battleship?.contractAddr || cached.battleshipAddr || '',
      battleId: manifest?.battleship?.battleId || cached.battleId || '',
      deadDropAddr: manifest?.deadDrop?.contractAddr || cached.deadDropAddr || '',
      matchId: manifest?.deadDrop?.matchId || cached.matchId || '',
      socialCharterAddr: manifest?.commonsRf?.charter || cached.socialCharterAddr || '',
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
    return { cache: merged, manifest };
  },
};

const _wsConnections = new Map();

export function toWsEndpoint(urlStr) {
  const s = String(urlStr || '').trim() || getDefaultNodeWsUrl();
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length);
  if (s.startsWith('http://')) return 'ws://' + s.slice('http://'.length);
  return 'ws://' + s;
}

function getOrOpenWsEntry(wsUrl, connectTimeoutMs = 12000) {
  const existing = _wsConnections.get(wsUrl);
  if (existing && existing.ws && (existing.ws.readyState === 0 || existing.ws.readyState === 1)) {
    return existing;
  }
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
    pending,
    openPromise: null,
  };

  entry.openPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch (_) {}
      _wsConnections.delete(wsUrl);
      reject(new Error(`WebSocket connect timeout (${wsUrl})`));
    }, connectTimeoutMs);

    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      _wsConnections.delete(wsUrl);
      reject(new Error(`WebSocket unreachable (${wsUrl})`));
    };
    ws.onclose = () => {
      _wsConnections.delete(wsUrl);
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
          p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
      }
    };
  });

  _wsConnections.set(wsUrl, entry);
  return entry;
}

export async function slxNodeRpc(endpointUrl, method, params = [], timeoutMs = 15000) {
  const wsUrl = toWsEndpoint(endpointUrl);
  const entry = getOrOpenWsEntry(wsUrl, Math.min(timeoutMs, 12000));
  if (entry) {
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
    } catch (wsErr) {
      if (wsUrl !== PUBLIC_SUBNET1_WSS_RPC) {
        const pubEntry = getOrOpenWsEntry(PUBLIC_SUBNET1_WSS_RPC, Math.min(timeoutMs, 12000));
        if (pubEntry) {
          const pubWs = await pubEntry.openPromise;
          const id = pubEntry.reqSeq++;
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pubEntry.pending.delete(id);
              reject(new Error(`RPC timeout on ${method}`));
            }, timeoutMs);
            pubEntry.pending.set(id, { resolve, reject, timer });
            pubWs.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
          });
        }
      }
      if (!String(endpointUrl || '').startsWith('http')) {
        throw wsErr;
      }
    }
  }

  const r = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
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
