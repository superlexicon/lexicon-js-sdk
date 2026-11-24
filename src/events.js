/**
 * @superlexicon/sdk/events
 *
 * Multiplexed WebSocket `eth_subscribe` real-time pub/sub client for SuperLexicon Subnet 1:
 *  - Automatically maps JSON-RPC URLs (`wss://nodeX.superlexicon.com/rpc`, `ws://<lan>:8545`)
 *    to the validator's pub/sub `WebSocketServer` (`wss://nodeX.superlexicon.com`, `ws://<lan>:8546`).
 *  - Multiplexes `newHeads`, `logs`, and `stats` over ONE persistent socket per endpoint family.
 *  - Expands multi-topic & multi-address filters into exact validator-side `LogsFilter`s with
 *    hot-swappable `refreshFilter()` and bounded `4,096`-key LRU deduplication.
 *  - Uses a FIFO subscribe barrier so the validator's 30-block `send_log_backfill` arrives in
 *    strictly chronological `(oldest -> newest)` order while live pushes stream in `0ms`.
 */

export const PUBLIC_PUBSUB_WS_NODES = [
  'wss://node1.superlexicon.com',
  'wss://node3.superlexicon.com',
  'wss://node4.superlexicon.com',
  'wss://node2.superlexicon.com',
  'wss://node5.superlexicon.com',
];

let _preferredPublicPubSubNode = PUBLIC_PUBSUB_WS_NODES[0];

const HEADS_WATCHDOG_SILENCE_MS = 28_000;
const MAX_DEDUP_KEYS = 4096;
const MAX_SERVER_FILTER_FANOUT = 16;

let _hubSeq = 1;
let _clientSubSeq = 1;
const _hubsByKey = new Map();
const _globalHeadWaiters = new Set();

function parseHexOrNum(val, fallback = 0) {
  if (val == null) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  const s = String(val).trim();
  if (!s) return fallback;
  try {
    return Number(BigInt(s));
  } catch (_) {
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }
}

export function toPubSubWsUrl(inputUrl) {
  let raw = String(inputUrl || '').trim();
  if (!raw) {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const host = window.location.hostname.toLowerCase();
      if (window.location.protocol === 'https:' || host.endsWith('superlexicon.com')) {
        return PUBLIC_PUBSUB_WS_NODES[0];
      }
      return `ws://${window.location.hostname}:8546`;
    }
    return PUBLIC_PUBSUB_WS_NODES[0];
  }

  if (raw.startsWith('https://')) raw = 'wss://' + raw.slice('https://'.length);
  else if (raw.startsWith('http://')) raw = 'ws://' + raw.slice('http://'.length);
  else if (!raw.startsWith('ws://') && !raw.startsWith('wss://')) raw = 'ws://' + raw;

  try {
    const u = new URL(raw);
    if (u.pathname === '/rpc' || u.pathname === '/rpc/') {
      u.pathname = '/';
    }
    if (u.port) {
      const p = Number(u.port);
      if (Number.isFinite(p) && p >= 8500 && p < 65500 && p % 10 === 5) {
        u.port = String(p + 1);
      }
    }
    return u.toString().replace(/\/$/, '');
  } catch (_) {
    return raw.replace(/\/rpc\/?$/, '').replace(/\/$/, '');
  }
}

export function derivePubSubWsCandidates(rpcUrl) {
  const isHttpsPage =
    typeof window !== 'undefined' && window.location?.protocol === 'https:';
  const out = [];
  const pushUnique = (u) => {
    if (!u) return;
    if (isHttpsPage && u.startsWith('ws://')) return;
    if (!out.includes(u)) out.push(u);
  };

  const activeSubnet =
    typeof window !== 'undefined' ? window.__SLX_ACTIVE_SUBNET__ : null;
  if (activeSubnet && Array.isArray(activeSubnet.pubsubWsUrls)) {
    for (const u of activeSubnet.pubsubWsUrls) pushUnique(u);
  }

  // Also include `+21` pub/sub port convention (`8545 -> 8566`, `18545 -> 18566`)
  try {
    const rawWs = String(rpcUrl || '').replace(/^http/, 'ws');
    const u = new URL(rawWs);
    const p = Number(u.port);
    if (Number.isFinite(p) && p % 100 === 45) {
      u.port = String(p + 21);
      pushUnique(u.toString().replace(/\/$/, ''));
    }
  } catch (_) {}

  const primary = toPubSubWsUrl(rpcUrl);
  // If `primary` is a public validator subdomain (`wss://nodeX.superlexicon.com`), prefer the last
  // verified-healthy TLS validator first so an expired/restarting node never stalls initial subscribe.
  if (primary && PUBLIC_PUBSUB_WS_NODES.includes(primary) && _preferredPublicPubSubNode) {
    pushUnique(_preferredPublicPubSubNode);
  }
  pushUnique(primary);

  if (!activeSubnet || activeSubnet.key === 'subnet1') {
    for (const pub of PUBLIC_PUBSUB_WS_NODES) {
      pushUnique(pub);
    }
  }
  return out.length ? out : [...PUBLIC_PUBSUB_WS_NODES];
}

export function getCanonicalLogKey(log) {
  if (!log) return '';
  const txh = String(log.transactionHash ?? log.transaction_hash ?? '').toLowerCase();
  const lgi = parseHexOrNum(log.logIndex ?? log.log_index, -1);
  const addr = String(log.address || '').toLowerCase();
  const blk = parseHexOrNum(log.blockNumber ?? log.block_number, 0);
  if (txh && lgi >= 0) {
    return `${txh}:${lgi}`;
  }
  const t0 = String(log.topics?.[0] || '').toLowerCase();
  const data = String(log.data || '').slice(0, 66).toLowerCase();
  return `${blk}:${addr}:${t0}:${lgi}:${data}`;
}

export function compileLogsFilter(rawFilter) {
  if (!rawFilter || typeof rawFilter !== 'object') {
    return {
      empty: false,
      addresses: null,
      topicSlots: [],
      serverFilters: [{}],
      signature: '[{}]',
    };
  }

  let addresses = null;
  if (Array.isArray(rawFilter.address)) {
    const cleaned = Array.from(
      new Set(
        rawFilter.address
          .map((a) => String(a || '').trim().toLowerCase())
          .filter((a) => a.startsWith('0x') && a.length === 42)
      )
    );
    if (cleaned.length === 0) {
      return { empty: true, addresses: [], topicSlots: [], serverFilters: [], signature: 'EMPTY' };
    }
    addresses = cleaned;
  } else if (typeof rawFilter.address === 'string' && rawFilter.address.trim()) {
    const a = rawFilter.address.trim().toLowerCase();
    if (!a.startsWith('0x') || a.length !== 42) {
      return { empty: true, addresses: [], topicSlots: [], serverFilters: [], signature: 'EMPTY' };
    }
    addresses = [a];
  }

  const topicSlots = [];
  if (Array.isArray(rawFilter.topics)) {
    for (const slot of rawFilter.topics) {
      if (slot == null) {
        topicSlots.push(null);
      } else if (Array.isArray(slot)) {
        const opts = Array.from(
          new Set(
            slot
              .map((t) => String(t || '').trim().toLowerCase())
              .filter((t) => t.startsWith('0x') && t.length === 66)
          )
        );
        if (opts.length === 0) {
          return { empty: true, addresses: addresses || [], topicSlots: [], serverFilters: [], signature: 'EMPTY' };
        }
        topicSlots.push(opts);
      } else {
        const t = String(slot).trim().toLowerCase();
        if (!t) {
          topicSlots.push(null);
        } else {
          topicSlots.push([t]);
        }
      }
    }
    while (topicSlots.length > 0 && topicSlots[topicSlots.length - 1] === null) {
      topicSlots.pop();
    }
  }

  const addrChoices = addresses ? addresses : [null];
  let topicCombinations = [[]];
  for (const slot of topicSlots) {
    if (slot === null) {
      topicCombinations = topicCombinations.map((prefix) => [...prefix, null]);
    } else {
      const next = [];
      for (const prefix of topicCombinations) {
        for (const opt of slot) {
          next.push([...prefix, opt]);
        }
      }
      topicCombinations = next;
    }
    if (topicCombinations.length > MAX_SERVER_FILTER_FANOUT) break;
  }

  let serverFilters = [];
  if (addrChoices.length * topicCombinations.length <= MAX_SERVER_FILTER_FANOUT) {
    for (const a of addrChoices) {
      for (const tc of topicCombinations) {
        const f = {};
        if (a) f.address = a;
        if (tc.length > 0) f.topics = tc;
        serverFilters.push(f);
      }
    }
  } else if (topicCombinations.length <= MAX_SERVER_FILTER_FANOUT) {
    for (const tc of topicCombinations) {
      const f = {};
      if (tc.length > 0) f.topics = tc;
      serverFilters.push(f);
    }
  } else if (addrChoices.length <= MAX_SERVER_FILTER_FANOUT && addrChoices[0] !== null) {
    for (const a of addrChoices) {
      serverFilters.push({ address: a });
    }
  } else {
    serverFilters = [{}];
  }

  const signature = JSON.stringify({
    a: addresses,
    t: topicSlots,
  });

  return {
    empty: false,
    addresses,
    topicSlots,
    serverFilters,
    signature,
  };
}

export function matchesCompiledFilter(log, compiled) {
  if (!log || !compiled || compiled.empty) return false;
  if (compiled.addresses) {
    const logAddr = String(log.address || '').toLowerCase();
    if (!compiled.addresses.includes(logAddr)) return false;
  }
  if (compiled.topicSlots.length > 0) {
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (topics.length < compiled.topicSlots.length) return false;
    for (let i = 0; i < compiled.topicSlots.length; i++) {
      const want = compiled.topicSlots[i];
      if (want !== null) {
        const got = String(topics[i] || '').toLowerCase();
        if (!want.includes(got)) return false;
      }
    }
  }
  return true;
}

export function normalizeHeadPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const blockNumberNum = parseHexOrNum(raw.number, 0);
  return {
    ...raw,
    blockNumberNum,
    timestampNum: parseHexOrNum(raw.timestamp, 0),
    txCountNum:
      typeof raw.transactionCount === 'number'
        ? raw.transactionCount
        : Array.isArray(raw.transactions)
          ? raw.transactions.length
          : 0,
  };
}

export function normalizeLogPayload(raw, isBackfill = false) {
  if (!raw || typeof raw !== 'object') return null;
  const blockNumberNum = parseHexOrNum(raw.blockNumber, 0);
  const txIndexNum = parseHexOrNum(raw.transactionIndex, 0);
  const logIndexNum = parseHexOrNum(raw.logIndex, 0);
  const txHash = String(raw.transactionHash || '').toLowerCase();
  return {
    ...raw,
    address: String(raw.address || '').toLowerCase(),
    topics: Array.isArray(raw.topics) ? raw.topics.map((t) => String(t || '').toLowerCase()) : [],
    transactionHash: txHash,
    blockNumberNum,
    txIndexNum,
    logIndexNum,
    isBackfill: Boolean(isBackfill),
    dedupKey: getCanonicalLogKey(raw),
  };
}

class BoundedKeySet {
  constructor(limit = MAX_DEDUP_KEYS) {
    this.limit = limit;
    this.set = new Set();
  }

  has(key) {
    return key ? this.set.has(key) : false;
  }

  add(key) {
    if (!key) return false;
    if (this.set.has(key)) return false;
    this.set.add(key);
    if (this.set.size > this.limit) {
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) this.set.delete(oldest);
    }
    return true;
  }
}

class SlxEventHub {
  constructor(candidates) {
    this.id = _hubSeq++;
    this.candidates = candidates;
    this.candIdx = -1;
    this.ws = null;
    this.connected = false;
    this.reqSeq = 1;
    this.pendingRpc = new Map();
    this.serverSubToClient = new Map();
    this.clientSubs = new Map();
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.watchdogTimer = null;
    this.lastActivityAt = 0;
    this.latestBlockNumber = 0;
  }

  updateCandidates(nextCandidates) {
    if (Array.isArray(nextCandidates) && nextCandidates.length > 0) {
      this.candidates = nextCandidates;
    }
  }

  ensureConnected() {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.clientSubs.size === 0) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.candIdx = (this.candIdx + 1) % this.candidates.length;
    const url = this.candidates[this.candIdx];
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      this._scheduleReconnect();
      return;
    }

    this.ws = ws;
    const connectDeadline = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch (_) {}
      }
    }, 6500);

    ws.onopen = () => {
      clearTimeout(connectDeadline);
      if (this.ws !== ws) return;
      if (PUBLIC_PUBSUB_WS_NODES.includes(url)) {
        _preferredPublicPubSubNode = url;
      }
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastActivityAt = Date.now();
      this.serverSubToClient.clear();
      this._startWatchdog();

      for (const sub of this.clientSubs.values()) {
        sub.serverSubIds.clear();
        this._registerClientSubOnOpenSocket(sub);
      }
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastActivityAt = Date.now();
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch (_) {
        return;
      }

      if (frame && frame.id != null && this.pendingRpc.has(frame.id)) {
        const p = this.pendingRpc.get(frame.id);
        this.pendingRpc.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.error) {
          p.reject(new Error(frame.error.message || JSON.stringify(frame.error)));
        } else {
          p.resolve(frame.result);
        }
        return;
      }

      if (frame && (frame.method === 'eth_subscription' || frame.method === 'subscription')) {
        const serverSubId = frame.params?.subscription;
        const result = frame.params?.result;
        if (!serverSubId || result == null) return;
        const sub = this.serverSubToClient.get(serverSubId);
        if (!sub || sub.disposed) return;
        this._dispatchNotification(sub, result);
      }
    };

    ws.onclose = () => {
      clearTimeout(connectDeadline);
      if (this.ws === ws) {
        this.ws = null;
        this.connected = false;
      }
      this._stopWatchdog();
      for (const [, p] of this.pendingRpc.entries()) {
        clearTimeout(p.timer);
        p.reject(new Error('Pub/sub WebSocket closed'));
      }
      this.pendingRpc.clear();
      this.serverSubToClient.clear();
      if (this.clientSubs.size > 0) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch (_) {}
    };
  }

  _startWatchdog() {
    this._stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastActivityAt > HEADS_WATCHDOG_SILENCE_MS) {
        try {
          this.ws.close();
        } catch (_) {}
      }
    }, 6000);
  }

  _stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.clientSubs.size === 0) return;
    const baseDelay = Math.min(5000, 350 * Math.pow(1.6, Math.min(6, this.reconnectAttempts++)));
    const jitter = Math.floor(Math.random() * 180);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, baseDelay + jitter);
  }

  _sendRpc(method, params, timeoutMs = 8000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Socket not open'));
    }
    const id = `slx-sub-${this.reqSeq++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`Timeout on ${method}`));
      }, timeoutMs);
      this.pendingRpc.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRpc.delete(id);
        reject(err);
      }
    });
  }

  async _registerClientSubOnOpenSocket(sub) {
    if (sub.disposed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (sub.kind === 'newHeads' || sub.kind === 'stats') {
      try {
        const sid = await this._sendRpc('eth_subscribe', [sub.kind]);
        if (sub.disposed) {
          this._sendRpc('eth_unsubscribe', [sid]).catch(() => {});
          return;
        }
        if (typeof sid === 'string' && sid) {
          sub.serverSubIds.add(sid);
          this.serverSubToClient.set(sid, sub);
        }
      } catch (_) {}
      return;
    }

    if (sub.kind === 'logs') {
      const rawFilter = typeof sub.filterOrFn === 'function' ? sub.filterOrFn() : sub.filterOrFn;
      const compiled = compileLogsFilter(rawFilter);
      sub.compiledFilter = compiled;
      if (compiled.empty) {
        sub.backfillComplete = true;
        return;
      }

      sub.backfillComplete = false;
      sub.initialBackfillTip = 0;

      const subPromises = compiled.serverFilters.map((sf) =>
        this._sendRpc('eth_subscribe', ['logs', sf])
          .then((sid) => {
            if (sub.disposed) {
              this._sendRpc('eth_unsubscribe', [sid]).catch(() => {});
              return;
            }
            if (typeof sid === 'string' && sid) {
              sub.serverSubIds.add(sid);
              this.serverSubToClient.set(sid, sub);
            }
          })
          .catch(() => {})
      );
      const barrierPromise = this._sendRpc('eth_unsubscribe', ['__backfill_barrier__']).catch(() => {});

      await Promise.all([...subPromises, barrierPromise]);
      if (!sub.disposed) {
        sub.backfillComplete = true;
        this._flushBackfillBuffer(sub);
      }
    }
  }

  async refreshLogsSubFilter(sub) {
    if (!sub || sub.disposed || sub.kind !== 'logs') return;
    const rawFilter = typeof sub.filterOrFn === 'function' ? sub.filterOrFn() : sub.filterOrFn;
    const nextCompiled = compileLogsFilter(rawFilter);
    if (sub.compiledFilter && sub.compiledFilter.signature === nextCompiled.signature) {
      return;
    }

    const oldIds = Array.from(sub.serverSubIds);
    sub.serverSubIds.clear();
    for (const sid of oldIds) {
      this.serverSubToClient.delete(sid);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._sendRpc('eth_unsubscribe', [sid]).catch(() => {});
      }
    }
    sub.compiledFilter = nextCompiled;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !nextCompiled.empty) {
      await this._registerClientSubOnOpenSocket(sub);
    }
  }

  _dispatchNotification(sub, result) {
    if (sub.kind === 'newHeads') {
      const head = normalizeHeadPayload(result);
      if (!head) return;
      if (head.blockNumberNum > this.latestBlockNumber) {
        this.latestBlockNumber = head.blockNumberNum;
      }
      for (const waiter of Array.from(_globalHeadWaiters)) {
        try {
          waiter(head);
        } catch (_) {}
      }
      try {
        sub.callback(head);
      } catch (err) {
        console.warn('[@superlexicon/sdk] newHeads listener error:', err);
      }
      return;
    }

    if (sub.kind === 'stats') {
      try {
        sub.callback(result);
      } catch (err) {
        console.warn('[@superlexicon/sdk] stats listener error:', err);
      }
      return;
    }

    if (sub.kind === 'logs') {
      const items = Array.isArray(result) ? result : [result];
      for (const raw of items) {
        const blkNum = parseHexOrNum(raw?.blockNumber, 0);
        if (!sub.backfillComplete && sub.initialBackfillTip === 0 && blkNum > 0) {
          sub.initialBackfillTip = blkNum;
        }
        const isBackfill =
          !sub.backfillComplete &&
          (sub.initialBackfillTip === 0 || blkNum <= sub.initialBackfillTip);

        const log = normalizeLogPayload(raw, isBackfill);
        if (!log) continue;
        if (sub.compiledFilter && !matchesCompiledFilter(log, sub.compiledFilter)) {
          continue;
        }
        if (!sub.seenKeys.add(log.dedupKey)) {
          continue;
        }
        if (isBackfill && sub.sortBackfill !== false) {
          sub.backfillBuffer.push(log);
        } else {
          if (sub.backfillBuffer.length > 0) {
            this._flushBackfillBuffer(sub);
          }
          try {
            sub.callback(log);
          } catch (err) {
            console.warn('[@superlexicon/sdk] logs listener error:', err);
          }
        }
      }
    }
  }

  _flushBackfillBuffer(sub) {
    if (!sub.backfillBuffer.length || sub.disposed) {
      sub.backfillBuffer.length = 0;
      return;
    }
    const batch = sub.backfillBuffer.splice(0, sub.backfillBuffer.length);
    batch.sort((a, b) => {
      if (a.blockNumberNum !== b.blockNumberNum) return a.blockNumberNum - b.blockNumberNum;
      if (a.txIndexNum !== b.txIndexNum) return a.txIndexNum - b.txIndexNum;
      return a.logIndexNum - b.logIndexNum;
    });
    for (const lg of batch) {
      if (sub.disposed) break;
      try {
        sub.callback(lg);
      } catch (err) {
        console.warn('[@superlexicon/sdk] backfill listener error:', err);
      }
    }
  }

  addSubscription(kind, filterOrFn, callback, options = {}) {
    const id = _clientSubSeq++;
    const sub = {
      id,
      kind,
      filterOrFn,
      compiledFilter:
        kind === 'logs'
          ? compileLogsFilter(typeof filterOrFn === 'function' ? filterOrFn() : filterOrFn)
          : null,
      callback,
      sortBackfill: options.sortBackfill !== false,
      seenKeys: options.seenKeys || new BoundedKeySet(MAX_DEDUP_KEYS),
      serverSubIds: new Set(),
      backfillBuffer: [],
      backfillComplete: kind !== 'logs',
      initialBackfillTip: 0,
      disposed: false,
    };

    this.clientSubs.set(id, sub);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._registerClientSubOnOpenSocket(sub);
    } else {
      this.ensureConnected();
    }

    return {
      id,
      isConnected: () => this.connected,
      markReceiptSeen: (receipt) => {
        if (!receipt || !Array.isArray(receipt.logs)) return;
        for (const lg of receipt.logs) {
          sub.seenKeys.add(getCanonicalLogKey(lg));
        }
      },
      refreshFilter: () => this.refreshLogsSubFilter(sub),
      unsubscribe: () => {
        if (sub.disposed) return;
        sub.disposed = true;
        sub.backfillBuffer.length = 0;
        this.clientSubs.delete(id);
        for (const sid of sub.serverSubIds) {
          this.serverSubToClient.delete(sid);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this._sendRpc('eth_unsubscribe', [sid]).catch(() => {});
          }
        }
        sub.serverSubIds.clear();
        if (this.clientSubs.size === 0) {
          this._stopWatchdog();
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          if (this.ws) {
            try {
              this.ws.close();
            } catch (_) {}
            this.ws = null;
            this.connected = false;
          }
        }
      },
    };
  }
}

function getOrCreateHub(rpcUrlOrFn) {
  const rpcUrl = typeof rpcUrlOrFn === 'function' ? rpcUrlOrFn() : rpcUrlOrFn;
  const candidates = derivePubSubWsCandidates(rpcUrl);
  const key = candidates[0] || PUBLIC_PUBSUB_WS_NODES[0];
  let hub = _hubsByKey.get(key);
  if (!hub) {
    hub = new SlxEventHub(candidates);
    _hubsByKey.set(key, hub);
  } else {
    hub.updateCandidates(candidates);
  }
  return hub;
}

export function slxSubscribeNewHeads(rpcUrlOrFn, onHead, options = {}) {
  return getOrCreateHub(rpcUrlOrFn).addSubscription('newHeads', null, onHead, options);
}

export function slxSubscribeLogs(rpcUrlOrFn, filterOrFn, onLog, options = {}) {
  return getOrCreateHub(rpcUrlOrFn).addSubscription('logs', filterOrFn, onLog, options);
}

export function slxSubscribeStats(rpcUrlOrFn, onStats, options = {}) {
  return getOrCreateHub(rpcUrlOrFn).addSubscription('stats', null, onStats, options);
}

export function slxOnAnyNewHead(listener) {
  _globalHeadWaiters.add(listener);
  return () => _globalHeadWaiters.delete(listener);
}

export async function slxWaitForReceipt(
  rpcCallFn,
  txHash,
  { timeoutMs = 55_000, fallbackPollMs = 280 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rcpt = await rpcCallFn('eth_getTransactionReceipt', [txHash]).catch(() => null);
    if (rcpt) return rcpt;

    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offHead();
        resolve();
      };
      const offHead = slxOnAnyNewHead(() => done());
      const timer = setTimeout(done, fallbackPollMs);
    });
  }
  return null;
}

/**
 * Wrap any async refresh function so overlapping invocations coalesce into at most
 * one active execution + at most one queued follow-up pass (keeping the highest `blockNumber`).
 * All callers awaiting a coalesced cycle share the active cycle's Promise.
 */
export function createSingleFlightRefresh(fn, { onError = null } = {}) {
  if (typeof fn !== 'function') {
    const noop = async () => {};
    noop._isSlxSingleFlight = true;
    noop.isRunning = () => false;
    noop.cancelQueued = () => {};
    return noop;
  }
  if (fn._isSlxSingleFlight) return fn;

  let inFlightPromise = null;
  let queuedMeta = undefined;
  let disposed = false;

  const wrapped = (meta = null) => {
    if (disposed) return Promise.resolve();
    if (inFlightPromise) {
      if (
        queuedMeta === undefined ||
        (meta?.blockNumber || 0) >= (queuedMeta?.blockNumber || 0)
      ) {
        queuedMeta = meta;
      }
      return inFlightPromise;
    }

    inFlightPromise = (async () => {
      let curMeta = meta;
      try {
        while (!disposed) {
          queuedMeta = undefined;
          await fn(curMeta);
          if (queuedMeta === undefined) break;
          curMeta = queuedMeta;
        }
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err);
        } else {
          console.warn('[@superlexicon/sdk] refresh warning:', err);
        }
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  };

  wrapped._isSlxSingleFlight = true;
  wrapped.isRunning = () => Boolean(inFlightPromise);
  wrapped.cancelQueued = () => {
    queuedMeta = undefined;
  };
  wrapped._dispose = () => {
    disposed = true;
    queuedMeta = undefined;
  };
  return wrapped;
}

export function slxWatchChainApp({
  rpcUrl,
  filter = null,
  onHead = null,
  onLog = null,
  onRefresh = null,
  offlineFallbackMs = 8000,
  sortBackfill = true,
} = {}) {
  let disposed = false;
  let lastHeadAt = 0;

  const coalescedRefresh =
    typeof onRefresh === 'function' ? createSingleFlightRefresh(onRefresh) : null;

  const triggerRefresh = async (meta = { source: 'manual', blockNumber: 0 }) => {
    if (disposed || !coalescedRefresh) return;
    await coalescedRefresh(meta);
  };

  const headsSub = slxSubscribeNewHeads(rpcUrl, (head) => {
    if (disposed) return;
    lastHeadAt = Date.now();
    if (typeof onHead === 'function') {
      try {
        onHead(head);
      } catch (_) {}
    }
    if (coalescedRefresh) {
      triggerRefresh({
        source: 'newHeads',
        blockNumber: head.blockNumberNum,
        head,
      });
    }
  });

  const logsSub =
    filter && typeof onLog === 'function'
      ? slxSubscribeLogs(
          rpcUrl,
          filter,
          (log) => {
            if (disposed) return;
            onLog(log);
          },
          { sortBackfill }
        )
      : null;

  const fallbackTimer =
    offlineFallbackMs > 0 && coalescedRefresh
      ? setInterval(() => {
          if (disposed) return;
          const wsHealthy =
            headsSub.isConnected() &&
            (lastHeadAt === 0 || Date.now() - lastHeadAt < HEADS_WATCHDOG_SILENCE_MS);
          if (!wsHealthy) {
            triggerRefresh({ source: 'offlineFallback', blockNumber: 0 });
          }
        }, offlineFallbackMs)
      : null;

  return {
    refresh: triggerRefresh,
    triggerRefresh,
    isConnected: () => headsSub.isConnected(),
    refreshFilter: () => logsSub?.refreshFilter?.(),
    markReceiptSeen: (rcpt) => logsSub?.markReceiptSeen?.(rcpt),
    unsubscribe: () => {
      if (disposed) return;
      disposed = true;
      if (fallbackTimer) clearInterval(fallbackTimer);
      headsSub.unsubscribe();
      logsSub?.unsubscribe?.();
    },
  };
}
