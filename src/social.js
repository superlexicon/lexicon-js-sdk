/**
 * @superlexicon/sdk/social
 *
 * Unified Subnet 1 Social Graph & Messaging Client (`SocialCharter`, `SocialRelationships`,
 * `SocialFeed`, and `Messaging` Haltproof Subroutines).
 *
 * Enables any SuperLexicon App UI or external SDK app to share the same cross-app social connections,
 * mutual RF handshakes (`SLX_FLEET_ENC_NONCE_V1`), 1-on-1 Direct Messages, per-app live lounges,
 * and global Subnet 1 Wall posts under the user's Unified `Identity` HFS.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Hex,
  selectorBytes,
} from './crypto.js';
import {
  wordU64,
  wordAddress,
  wordBytes32,
  truncAddr4,
  ZERO_ADDR,
} from './abi.js';
import {
  SlxNonceQueue,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
} from './rpc.js';
import {
  slxWaitForReceipt,
  slxWatchChainApp,
} from './events.js';
import {
  readOnChainIdentityNickname,
  readOnChainIdentityOwner,
} from './identity.js';

export const SUBNET1_FLEET_SOCIAL_DEFAULT = {
  identityRegistry: '0x114322a44284eb92bc8ab3f175504c0482901a62',
  messaging: '0xce1d210b5c7c2ab165fcc2e5a60556e90496d0fe',
  charter: '0xdc68f6666864931d83a85f14189489679d5ef0ee',
  relationships: '0xbdc5778b1959352cbbb660091051bdc028eaef0f',
  feed: '0x11f6255cd9b1213820cd0e5c1731b6156d21ac5a',
  events: '0xd11c4dc4dab4f0e20066c6e387292de5ec9fa5ec',
};

function tailBytes(input) {
  const raw = input instanceof Uint8Array ? input : utf8ToBytes(String(input || ''));
  const pad = (32 - (raw.length % 32)) % 32;
  return concatBytes(wordU64(raw.length), raw, new Uint8Array(pad));
}

function readU16LE(b, o) {
  return b[o] | (b[o + 1] << 8);
}

function readU32LE(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function readU64LEBig(b, o) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]);
  return v;
}

export function deterministicEncounterNonce(charterAddr, initiatorIdAddr, targetIdAddr) {
  return keccak256Hex(
    concatBytes(
      utf8ToBytes('SLX_FLEET_ENC_NONCE_V1'),
      hexToBytes(charterAddr).slice(-20),
      hexToBytes(initiatorIdAddr).slice(-20),
      hexToBytes(targetIdAddr).slice(-20)
    )
  );
}

export function computeEncounterCommit(charterAddr, initiatorIdAddr, targetIdAddr, secretNonceHex) {
  return keccak256Hex(
    concatBytes(
      utf8ToBytes('SLX_RF_ENC_V1'),
      hexToBytes(charterAddr).slice(-20),
      hexToBytes(initiatorIdAddr).slice(-20),
      hexToBytes(targetIdAddr).slice(-20),
      hexToBytes(secretNonceHex).slice(0, 32)
    )
  );
}

export function appChannelHash(appId = 'global') {
  return keccak256Hex(utf8ToBytes(`SLX_APP_LOUNGE:${String(appId || 'global').toLowerCase()}`));
}

export const SlxSocialAbi = {
  execViaIdentity(targetAddr, innerCalldataHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('execute(address,bytes)'),
        wordAddress(targetAddr),
        wordU64(0x40),
        tailBytes(hexToBytes(innerCalldataHex))
      )
    );
  },
  registerProfile(xM, yM, metaStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('registerProfile(uint64,uint64,bytes)'),
        wordU64(xM),
        wordU64(yM),
        wordU64(0x60),
        tailBytes(metaStr)
      )
    );
  },
  pingPresence(xM, yM) {
    return bytesToHex(
      concatBytes(selectorBytes('pingPresence(uint64,uint64)'), wordU64(xM), wordU64(yM))
    );
  },
  syncVerifiedIdentity(identityAddr) {
    return bytesToHex(
      concatBytes(selectorBytes('syncVerifiedIdentity(address)'), wordAddress(identityAddr))
    );
  },
  getCharterSnapshot() {
    return bytesToHex(selectorBytes('getCharterSnapshot()'));
  },
  openEncounterHandshake(targetIdAddr, tier, commitHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('openEncounterHandshake(address,uint64,bytes32)'),
        wordAddress(targetIdAddr),
        wordU64(tier),
        wordBytes32(commitHex)
      )
    );
  },
  acceptEncounterHandshake(initiatorIdAddr, secretNonceHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('acceptEncounterHandshake(address,bytes32)'),
        wordAddress(initiatorIdAddr),
        wordBytes32(secretNonceHex)
      )
    );
  },
  getRelationshipsSnapshot() {
    return bytesToHex(selectorBytes('getRelationshipsSnapshot()'));
  },
  postMessage(channelB32, textStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('postMessage(bytes32,bytes)'),
        wordBytes32(channelB32),
        wordU64(0x40),
        tailBytes(textStr)
      )
    );
  },
  getRecentMessages(channelB32, maxCount = 28) {
    return bytesToHex(
      concatBytes(
        selectorBytes('getRecentMessages(bytes32,uint64)'),
        wordBytes32(channelB32),
        wordU64(maxCount)
      )
    );
  },
  sendDirectMessage(recipientIdAddr, textStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('sendDirectMessage(address,bytes)'),
        wordAddress(recipientIdAddr),
        wordU64(0x40),
        tailBytes(textStr)
      )
    );
  },
  getDirectMessages(idA, idB, maxCount = 32) {
    return bytesToHex(
      concatBytes(
        selectorBytes('getDirectMessages(address,address,uint64)'),
        wordAddress(idA),
        wordAddress(idB),
        wordU64(maxCount)
      )
    );
  },
  createPost(visibility, contentStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('createPost(uint64,bytes)'),
        wordU64(visibility),
        wordU64(0x40),
        tailBytes(contentStr)
      )
    );
  },
  reactPost(postId, kind = 1) {
    return bytesToHex(
      concatBytes(selectorBytes('reactPost(uint64,uint64)'), wordU64(postId), wordU64(kind))
    );
  },
  getFeedSnapshot() {
    return bytesToHex(selectorBytes('getFeedSnapshot()'));
  },
};

function parseMsgEntries(b, startPos, count) {
  let pos = startPos;
  const list = [];
  for (let i = 0; i < count; i++) {
    if (pos + 30 > b.length) break;
    const block = Number(readU64LEBig(b, pos));
    const authorAddr = bytesToHex(b.slice(pos + 8, pos + 28)).toLowerCase();
    const len = readU16LE(b, pos + 28);
    pos += 30;
    const text = bytesToUtf8(b.slice(pos, pos + len));
    pos += len;
    list.push({ block, authorAddr, text });
  }
  return { list, nextPos: pos };
}

export function decodeSocialMessagesHex(hex) {
  if (!hex || hex === '0x') return [];
  const b = hexToBytes(hex);
  if (b.length < 4) return [];
  return parseMsgEntries(b, 4, readU32LE(b, 0)).list.reverse();
}

export function decodeSocialCharterSnapshotHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 136 || b[0] !== 1) return null;

  const memberCount = b[1];
  const rfRangeM = readU32LE(b, 8);
  const centerX = readU32LE(b, 16) || 1500;
  const centerY = readU32LE(b, 20) || 1500;
  const currentBlock = Number(readU64LEBig(b, 24));
  let pos = 136;
  const members = [];

  for (let i = 0; i < memberCount; i++) {
    if (pos + 72 > b.length) break;
    const identityAddr = bytesToHex(b.slice(pos, pos + 20)).toLowerCase();
    const uid = b[pos + 40];
    const trustScore = b[pos + 41];
    const isActive = b[pos + 43] !== 0;
    const xM = readU16LE(b, pos + 44);
    const yM = readU16LE(b, pos + 46);
    const lastHeartbeatBlock = Number(readU64LEBig(b, pos + 48));
    const metaLen = b[pos + 71];
    pos += 72;
    const metaStr = bytesToUtf8(b.slice(pos, pos + metaLen));
    pos += metaLen;
    const [name = 'Citizen', handle = '@citizen', role = 'Subnet Member'] = metaStr.split('|');
    members.push({
      identityAddr,
      uid,
      trustScore,
      isActive,
      xM,
      yM,
      lastHeartbeatBlock,
      name,
      handle,
      role,
    });
  }

  return { currentBlock, rfRangeM, centerX, centerY, members };
}

export function decodeSocialRelSnapshotHex(hex) {
  if (!hex || hex === '0x') return { edges: [], handshakes: [] };
  const b = hexToBytes(hex);
  if (b.length < 68) return { edges: [], handshakes: [] };
  const edgeCount = readU16LE(b, 0);
  const pendingCount = readU16LE(b, 2);
  let pos = 68;
  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    if (pos + 4 > b.length) break;
    edges.push({ u1: b[pos], u2: b[pos + 1], tier: b[pos + 2] });
    pos += 4;
  }
  const handshakes = [];
  for (let i = 0; i < pendingCount; i++) {
    if (pos + 44 > b.length) break;
    handshakes.push({
      initiatorUid: b[pos],
      targetUid: b[pos + 1],
      tier: b[pos + 2],
      expiresBlock: Number(readU64LEBig(b, pos + 4)),
      commitHex: bytesToHex(b.slice(pos + 12, pos + 44)).toLowerCase(),
    });
    pos += 44;
  }
  return { edges, handshakes };
}

export function decodeSocialFeedSnapshotHex(hex) {
  if (!hex || hex === '0x') return { totalPosts: 0, posts: [] };
  const b = hexToBytes(hex);
  if (b.length < 8) return { totalPosts: 0, posts: [] };
  const count = readU32LE(b, 0);
  const totalPosts = readU32LE(b, 4);
  let pos = 8;
  const posts = [];
  for (let i = 0; i < count; i++) {
    if (pos + 34 > b.length) break;
    const postId = readU32LE(b, pos);
    const authorUid = b[pos + 4];
    const visibility = b[pos + 5];
    const cmtCnt = b[pos + 6];
    const createdBlock = Number(readU64LEBig(b, pos + 8));
    const likedByMask = readU64LEBig(b, pos + 16);
    const clen = readU16LE(b, pos + 32);
    pos += 34;
    const content = bytesToUtf8(b.slice(pos, pos + clen));
    pos += clen;
    const parsedCmts = parseMsgEntries(b, pos, cmtCnt);
    pos = parsedCmts.nextPos;

    let likeCount = 0;
    let m = likedByMask;
    while (m > 0n) {
      if (m & 1n) likeCount++;
      m >>= 1n;
    }

    posts.push({
      postId,
      authorUid,
      visibility,
      createdBlock,
      likeCount,
      content,
    });
  }
  return { totalPosts, posts };
}

export class SlxSocialClient {
  constructor({
    rpcUrlFn = () => getDefaultNodeWsUrl(),
    appId = 'subnet1',
    suiteOverride = null,
  } = {}) {
    this.rpcUrlFn = rpcUrlFn;
    this.appId = appId;
    this.suite = suiteOverride || null;
    this.nonceQueue = new SlxNonceQueue({ rpcUrlFn });

    this.myIdentityAddr = '';
    this.charterSnap = null;
    this.relSnap = { edges: [], handshakes: [] };
    this.feedSnap = { totalPosts: 0, posts: [] };
    this.appChannelMsgs = [];
    this.dmMsgs = [];
    this.activeDmPeerId = '';

    this.connectedIds = new Set();
    this.incomingHandshakes = [];
    this.outgoingIds = new Set();
    this.tagCache = new Map();
    this._resolvingTags = new Set();
    this._listeners = new Set();
    this._watcher = null;
  }

  onChange(fn) {
    if (typeof fn === 'function') this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) {
      try {
        fn(this);
      } catch (_) {}
    }
  }

  async ensureSuite() {
    if (this.suite?.charter && this.suite?.relationships && this.suite?.feed) {
      return this.suite;
    }
    const { manifest } = await SlxHfsCache.hydrateWithManifest().catch(() => ({ manifest: null }));
    this.suite = manifest?.fleetSocial || SUBNET1_FLEET_SOCIAL_DEFAULT;
    return this.suite;
  }

  suiteTargets(extra = []) {
    const s = this.suite || SUBNET1_FLEET_SOCIAL_DEFAULT;
    return Array.from(
      new Set(
        [
          s.identityRegistry,
          s.messaging,
          s.charter,
          s.relationships,
          s.feed,
          s.events,
          ...extra,
        ].filter((a) => a && a !== ZERO_ADDR)
      )
    );
  }

  resolveDisplayTag(identityAddr, onResolved = null) {
    const low = String(identityAddr || '').toLowerCase();
    if (!low || low === ZERO_ADDR) return 'Citizen';
    if (this.tagCache.has(low)) return this.tagCache.get(low);

    const chMem = this.charterSnap?.members?.find((m) => m.identityAddr === low);
    if (!this._resolvingTags.has(low)) {
      this._resolvingTags.add(low);
      const rpcUrl = this.rpcUrlFn();
      Promise.all([
        readOnChainIdentityNickname(rpcUrl, low).catch(() => ''),
        readOnChainIdentityOwner(rpcUrl, low).catch(() => ''),
      ])
        .then(([nick, owner]) => {
          const baseName = nick || chMem?.name || '';
          if (baseName) {
            const tag = owner ? `${baseName} · ${truncAddr4(owner)}` : baseName;
            this.tagCache.set(low, tag);
            if (onResolved) onResolved(tag);
            this._emit();
          }
        })
        .finally(() => {
          this._resolvingTags.delete(low);
        });
    }
    if (chMem?.name) return chMem.name;
    return `Id · ${truncAddr4(low)}`;
  }

  async resolveWalletIdentity(wallet) {
    if (!wallet) {
      this.myIdentityAddr = '';
      return '';
    }
    const rpcUrl = this.rpcUrlFn();
    const cachedRec = wallet.getIdentityRecord?.();
    if (cachedRec?.identityAddr) {
      this.myIdentityAddr = cachedRec.identityAddr.toLowerCase();
      return this.myIdentityAddr;
    }
    const onChainRec = await wallet.resolveVerifiedIdentity?.(rpcUrl).catch(() => null);
    if (onChainRec?.identityAddr) {
      this.myIdentityAddr = onChainRec.identityAddr.toLowerCase();
      return this.myIdentityAddr;
    }
    // Check if wallet EOA already owns one of the SocialCharter member Identities!
    if (this.charterSnap?.members?.length) {
      const myEoa = wallet.keypair.address.toLowerCase();
      const owners = await Promise.all(
        this.charterSnap.members.map((m) => readOnChainIdentityOwner(rpcUrl, m.identityAddr).catch(() => ''))
      );
      const idx = owners.findIndex((o) => String(o || '').toLowerCase() === myEoa);
      if (idx >= 0) {
        const mem = this.charterSnap.members[idx];
        wallet.saveIdentityRecord?.({
          identityAddr: mem.identityAddr,
          nickname: mem.name,
          handle: mem.handle.replace(/^@/, ''),
        });
        this.myIdentityAddr = mem.identityAddr.toLowerCase();
        return this.myIdentityAddr;
      }
    }
    this.myIdentityAddr = '';
    return '';
  }

  async refresh(wallet = null) {
    const suite = await this.ensureSuite();
    const rpcUrl = this.rpcUrlFn();
    const chanHash = appChannelHash(this.appId);

    const baseCalls = [
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.charter, data: SlxSocialAbi.getCharterSnapshot() }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.relationships, data: SlxSocialAbi.getRelationshipsSnapshot() }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.feed, data: SlxSocialAbi.getFeedSnapshot() }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.messaging, data: SlxSocialAbi.getRecentMessages(chanHash, 28) }, 'latest']).catch(() => '0x'),
    ];
    const [chrHex, relHex, feedHex, chanHex] = await Promise.all(baseCalls);

    this.charterSnap = decodeSocialCharterSnapshotHex(chrHex);
    this.relSnap = decodeSocialRelSnapshotHex(relHex);
    this.feedSnap = decodeSocialFeedSnapshotHex(feedHex);
    this.appChannelMsgs = decodeSocialMessagesHex(chanHex);

    if (wallet) {
      await this.resolveWalletIdentity(wallet);
    }

    const myIdLow = String(this.myIdentityAddr || '').toLowerCase();
    this.connectedIds.clear();
    this.incomingHandshakes = [];
    this.outgoingIds.clear();

    if (this.charterSnap && this.relSnap && myIdLow) {
      const byUid = new Map(this.charterSnap.members.map((m) => [m.uid, m]));
      const meMem = this.charterSnap.members.find((m) => m.identityAddr === myIdLow);
      if (meMem) {
        for (const e of this.relSnap.edges) {
          if (e.tier > 0) {
            if (e.u1 === meMem.uid && byUid.has(e.u2)) {
              this.connectedIds.add(byUid.get(e.u2).identityAddr);
            } else if (e.u2 === meMem.uid && byUid.has(e.u1)) {
              this.connectedIds.add(byUid.get(e.u1).identityAddr);
            }
          }
        }
        const curBlk = this.charterSnap.currentBlock || 0;
        for (const hs of this.relSnap.handshakes) {
          if (hs.expiresBlock >= curBlk) {
            if (hs.targetUid === meMem.uid && byUid.has(hs.initiatorUid)) {
              const initMem = byUid.get(hs.initiatorUid);
              this.incomingHandshakes.push({
                initiatorIdentity: initMem.identityAddr,
                initiatorName: initMem.name,
                tier: hs.tier,
                expiresBlock: hs.expiresBlock,
              });
            } else if (hs.initiatorUid === meMem.uid && byUid.has(hs.targetUid)) {
              this.outgoingIds.add(byUid.get(hs.targetUid).identityAddr);
            }
          }
        }
      }
    }

    // Auto-select first connected friend for DM if unset
    if (!this.activeDmPeerId && this.connectedIds.size > 0) {
      this.activeDmPeerId = [...this.connectedIds][0];
    }

    if (myIdLow && this.activeDmPeerId && myIdLow !== this.activeDmPeerId) {
      const dmHex = await slxNodeRpc(rpcUrl, 'eth_call', [
        { to: suite.feed, data: SlxSocialAbi.getDirectMessages(myIdLow, this.activeDmPeerId, 32) },
        'latest',
      ]).catch(() => '0x');
      this.dmMsgs = decodeSocialMessagesHex(dmHex);
    } else {
      this.dmMsgs = [];
    }

    for (const m of [...this.appChannelMsgs, ...this.dmMsgs]) {
      this.resolveDisplayTag(m.authorAddr);
    }
    this._emit();
    return this;
  }

  async setActiveDmPeer(peerIdentityAddr, wallet = null) {
    this.activeDmPeerId = String(peerIdentityAddr || '').toLowerCase();
    await this.refresh(wallet);
    return this.dmMsgs;
  }

  startLiveWatch(wallet, { onIncomingEvent = null } = {}) {
    if (this._watcher) {
      this._watcher.unsubscribe();
      this._watcher = null;
    }
    this.ensureSuite().then((suite) => {
      const addrs = [suite.charter, suite.relationships, suite.feed, suite.messaging].filter(Boolean);
      this._watcher = slxWatchChainApp({
        rpcUrl: () => this.rpcUrlFn(),
        filter: () => ({ address: addrs }),
        onLog: (lg) => {
          if (onIncomingEvent) onIncomingEvent(lg);
        },
        onRefresh: async () => {
          await this.refresh(wallet);
        },
      });
      this.refresh(wallet);
    });
    return () => {
      this._watcher?.unsubscribe();
      this._watcher = null;
    };
  }

  async _sendTx(wallet, to, data, extraTargets, label, gasLimit = 6_500_000n) {
    const rpcUrl = this.rpcUrlFn();
    const sent = await this.nonceQueue.sendSigned({
      privateKey: wallet.keypair.privateKey,
      to,
      data,
      gasLimit,
      extraTargets,
      label,
    });
    try {
      const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), sent.txHash);
      if (!rcpt || rcpt.status !== '0x1') {
        throw new Error(`Social transaction reverted (${label})`);
      }
      wallet.recordExternalRpcTx?.({
        txHash: sent.txHash,
        rawTx: sent.rawTx,
        from: sent.senderAddr,
        to,
        contractLabel: 'SubnetSocial',
        fnLabel: label,
        dataHex: data,
        blockNumber: Number(rcpt.blockNumber || 0),
        nonce: Number(sent.nonce),
      });
      this._watcher?.markReceiptSeen?.(rcpt);
      return rcpt;
    } finally {
      this.nonceQueue.release(sent.senderAddr, sent.nonce);
    }
  }

  async _ensureBothActiveAndInRange(wallet, idRec, peerIdentityAddr = '') {
    const suite = await this.ensureSuite();
    const myIdLow = idRec.identityAddr.toLowerCase();
    const peerLow = String(peerIdentityAddr || '').toLowerCase();

    let targetX = this.charterSnap?.centerX || 1500;
    let targetY = this.charterSnap?.centerY || 1500;

    if (peerLow && peerLow !== ZERO_ADDR) {
      const peerMem = this.charterSnap?.members?.find((m) => m.identityAddr === peerLow);
      if (peerMem && peerMem.xM > 0 && peerMem.yM > 0) {
        targetX = peerMem.xM;
        targetY = peerMem.yM;
      }
      if (!peerMem || !peerMem.isActive) {
        await this._sendTx(
          wallet,
          suite.charter,
          SlxSocialAbi.syncVerifiedIdentity(peerLow),
          this.suiteTargets([peerLow]),
          'syncVerifiedIdentity',
          6_000_000n
        );
      }
    }

    const meMem = this.charterSnap?.members?.find((m) => m.identityAddr === myIdLow);
    const rfLimit = Math.max(120, (this.charterSnap?.rfRangeM || 500) - 40);
    const desiredX = Math.max(100, Math.min(4900, targetX + 12));
    const desiredY = Math.max(100, Math.min(4900, targetY + 8));

    if (!meMem) {
      const meta = `${idRec.nickname || 'Citizen'}|@${idRec.handle || 'citizen'}|Subnet 1 Citizen|Universal Comms`;
      await this._sendTx(
        wallet,
        myIdLow,
        SlxSocialAbi.execViaIdentity(suite.charter, SlxSocialAbi.registerProfile(desiredX, desiredY, meta)),
        this.suiteTargets([myIdLow]),
        'registerProfile',
        6_500_000n
      );
    } else {
      const dist = Math.hypot((meMem.xM || 0) - targetX, (meMem.yM || 0) - targetY);
      if (!meMem.isActive || (peerLow && dist > rfLimit)) {
        await this._sendTx(
          wallet,
          myIdLow,
          SlxSocialAbi.execViaIdentity(suite.charter, SlxSocialAbi.pingPresence(desiredX, desiredY)),
          this.suiteTargets([myIdLow]),
          'pingPresence',
          5_000_000n
        );
      }
    }
  }

  async connectPeer(wallet, targetIdentityAddr, { appName = 'Subnet Social' } = {}) {
    const suite = await this.ensureSuite();
    const targetLow = String(targetIdentityAddr || '').toLowerCase();
    if (!targetLow || targetLow === ZERO_ADDR) return false;

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl: this.rpcUrlFn(), appName });
    if (!idRec?.identityAddr) return false;
    this.myIdentityAddr = idRec.identityAddr.toLowerCase();
    if (this.myIdentityAddr === targetLow) return false;

    await this.refresh(wallet);
    if (this.connectedIds.has(targetLow)) {
      this.activeDmPeerId = targetLow;
      await this.refresh(wallet);
      return true;
    }
    if (this.incomingHandshakes.some((h) => h.initiatorIdentity === targetLow)) {
      return this.acceptHandshake(wallet, targetLow, { appName });
    }

    await this._ensureBothActiveAndInRange(wallet, idRec, targetLow);
    const nonce = deterministicEncounterNonce(suite.charter, this.myIdentityAddr, targetLow);
    const commit = computeEncounterCommit(suite.charter, this.myIdentityAddr, targetLow, nonce);

    await this._sendTx(
      wallet,
      this.myIdentityAddr,
      SlxSocialAbi.execViaIdentity(
        suite.relationships,
        SlxSocialAbi.openEncounterHandshake(targetLow, 2, commit)
      ),
      this.suiteTargets([this.myIdentityAddr, targetLow]),
      'openEncounterHandshake',
      6_500_000n
    );
    this.outgoingIds.add(targetLow);
    await this.refresh(wallet);
    return true;
  }

  async acceptHandshake(wallet, initiatorIdentityAddr, { appName = 'Subnet Social' } = {}) {
    const suite = await this.ensureSuite();
    const initLow = String(initiatorIdentityAddr || '').toLowerCase();
    if (!initLow || initLow === ZERO_ADDR) return false;

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl: this.rpcUrlFn(), appName });
    if (!idRec?.identityAddr) return false;
    this.myIdentityAddr = idRec.identityAddr.toLowerCase();

    await this.refresh(wallet);
    await this._ensureBothActiveAndInRange(wallet, idRec, initLow);
    const nonce = deterministicEncounterNonce(suite.charter, initLow, this.myIdentityAddr);

    await this._sendTx(
      wallet,
      this.myIdentityAddr,
      SlxSocialAbi.execViaIdentity(
        suite.relationships,
        SlxSocialAbi.acceptEncounterHandshake(initLow, nonce)
      ),
      this.suiteTargets([this.myIdentityAddr, initLow]),
      'acceptEncounterHandshake',
      6_500_000n
    );
    this.activeDmPeerId = initLow;
    await this.refresh(wallet);
    return true;
  }

  async sendDirectMessage(wallet, peerIdentityAddr, text, { appName = 'Subnet Comms' } = {}) {
    const suite = await this.ensureSuite();
    const peerLow = String(peerIdentityAddr || '').toLowerCase();
    const clean = String(text || '').trim();
    if (!peerLow || !clean) return false;

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl: this.rpcUrlFn(), appName });
    if (!idRec?.identityAddr) return false;
    this.myIdentityAddr = idRec.identityAddr.toLowerCase();

    await this._ensureBothActiveAndInRange(wallet, idRec, peerLow);
    await this._sendTx(
      wallet,
      this.myIdentityAddr,
      SlxSocialAbi.execViaIdentity(suite.feed, SlxSocialAbi.sendDirectMessage(peerLow, clean)),
      this.suiteTargets([this.myIdentityAddr, peerLow]),
      'sendDirectMessage',
      7_000_000n
    );
    this.activeDmPeerId = peerLow;
    await this.refresh(wallet);
    return true;
  }

  async postAppChannel(wallet, text, { appName = 'Subnet Comms' } = {}) {
    const suite = await this.ensureSuite();
    const clean = String(text || '').trim();
    if (!clean) return false;

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl: this.rpcUrlFn(), appName });
    if (!idRec?.identityAddr) return false;
    this.myIdentityAddr = idRec.identityAddr.toLowerCase();

    await this._ensureBothActiveAndInRange(wallet, idRec);
    const chan = appChannelHash(this.appId);
    await this._sendTx(
      wallet,
      this.myIdentityAddr,
      SlxSocialAbi.execViaIdentity(suite.messaging, SlxSocialAbi.postMessage(chan, clean)),
      this.suiteTargets([this.myIdentityAddr]),
      'postAppChannel',
      6_500_000n
    );
    await this.refresh(wallet);
    return true;
  }

  async postWall(wallet, text, { visibility = 0, appName = 'Subnet Wall' } = {}) {
    const suite = await this.ensureSuite();
    const clean = String(text || '').trim();
    if (!clean) return false;

    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl: this.rpcUrlFn(), appName });
    if (!idRec?.identityAddr) return false;
    this.myIdentityAddr = idRec.identityAddr.toLowerCase();

    await this._ensureBothActiveAndInRange(wallet, idRec);
    await this._sendTx(
      wallet,
      this.myIdentityAddr,
      SlxSocialAbi.execViaIdentity(suite.feed, SlxSocialAbi.createPost(visibility, clean)),
      this.suiteTargets([this.myIdentityAddr]),
      'createPost',
      7_000_000n
    );
    await this.refresh(wallet);
    return true;
  }

  async reactWallPost(wallet, postId, { appName = 'Subnet Wall' } = {}) {
    const suite = await this.ensureSuite();
    const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl: this.rpcUrlFn(), appName });
    if (!idRec?.identityAddr) return false;
    this.myIdentityAddr = idRec.identityAddr.toLowerCase();

    await this._ensureBothActiveAndInRange(wallet, idRec);
    await this._sendTx(
      wallet,
      this.myIdentityAddr,
      SlxSocialAbi.execViaIdentity(suite.feed, SlxSocialAbi.reactPost(postId, 1)),
      this.suiteTargets([this.myIdentityAddr]),
      'reactPost',
      5_500_000n
    );
    await this.refresh(wallet);
    return true;
  }
}
