/**
 * Phantom Fleet In-Game Social Network & VHF Comms Client (`slx-fleet-social.js`)
 *
 * Bridges `battleship.wasm` with Subnet 1's live `Messaging`, `SocialCharter`,
 * `SocialRelationships`, and `SocialFeed` Haltproof Subroutines (`manifest.fleetSocial`),
 * using each Captain's cross-app `Identity` HFS (`<Nickname> · <4-char addr>`):
 *
 *  1. 🌐 Bridge VHF Ch.16 (`NAVAL_BRIDGE:<battleId>` on `Messaging` HFS) — All-Hands Arena Radio.
 *  2. 🚩 Squadron Tactical (`NAVAL_TEAM:<battleId>:<team>` on `Messaging` HFS) — Team-Only Comms.
 *  3. 🤝 Captain Connections (`SocialCharter` + `SocialRelationships`) — Mutual Handshakes (`+3 Trust`).
 *  4. 💬 Direct Comms & Fleet Wall (`SocialFeed` + protected `Messaging` pair channels).
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Hex,
  selectorBytes,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  truncAddr4,
  readOnChainIdentityNickname,
  readOnChainIdentityOwner,
} from './index.js';

function wordU64(v) {
  const b = new Uint8Array(32);
  let x = BigInt(Math.max(0, Math.floor(Number(v))));
  for (let i = 31; i >= 24; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function wordAddr(addrHex) {
  const b = new Uint8Array(32);
  if (addrHex && addrHex !== '0x') {
    b.set(hexToBytes(addrHex).slice(-20), 12);
  }
  return b;
}

function wordB32(b32Hex) {
  const b = new Uint8Array(32);
  if (b32Hex && b32Hex !== '0x') {
    b.set(hexToBytes(b32Hex).slice(0, 32), 0);
  }
  return b;
}

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

export function bridgeChannelHash(battleId) {
  return keccak256Hex(utf8ToBytes(`NAVAL_BRIDGE:${String(battleId || '').toLowerCase()}`));
}

export function squadronChannelHash(battleId, team) {
  return keccak256Hex(
    utf8ToBytes(`NAVAL_TEAM:${String(battleId || '').toLowerCase()}:${Number(team) || 0}`)
  );
}

export function oceanToSocialCoords(gridX = 24, gridY = 15) {
  return {
    xM: Math.max(1350, Math.min(1650, 1400 + Math.round(gridX) * 4)),
    yM: Math.max(1350, Math.min(1650, 1430 + Math.round(gridY) * 4)),
  };
}

export const FleetSocialAbi = {
  execViaIdentity(targetAddr, innerCalldataHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('execute(address,bytes)'),
        wordAddr(targetAddr),
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
      concatBytes(selectorBytes('syncVerifiedIdentity(address)'), wordAddr(identityAddr))
    );
  },
  getCharterSnapshot() {
    return bytesToHex(selectorBytes('getCharterSnapshot()'));
  },
  openEncounterHandshake(targetIdAddr, tier, commitHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('openEncounterHandshake(address,uint64,bytes32)'),
        wordAddr(targetIdAddr),
        wordU64(tier),
        wordB32(commitHex)
      )
    );
  },
  acceptEncounterHandshake(initiatorIdAddr, secretNonceHex) {
    return bytesToHex(
      concatBytes(
        selectorBytes('acceptEncounterHandshake(address,bytes32)'),
        wordAddr(initiatorIdAddr),
        wordB32(secretNonceHex)
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
        wordB32(channelB32),
        wordU64(0x40),
        tailBytes(textStr)
      )
    );
  },
  getRecentMessages(channelB32, maxCount = 24) {
    return bytesToHex(
      concatBytes(
        selectorBytes('getRecentMessages(bytes32,uint64)'),
        wordB32(channelB32),
        wordU64(maxCount)
      )
    );
  },
  sendDirectMessage(recipientIdAddr, textStr) {
    return bytesToHex(
      concatBytes(
        selectorBytes('sendDirectMessage(address,bytes)'),
        wordAddr(recipientIdAddr),
        wordU64(0x40),
        tailBytes(textStr)
      )
    );
  },
  getDirectMessages(idA, idB, maxCount = 24) {
    return bytesToHex(
      concatBytes(
        selectorBytes('getDirectMessages(address,address,uint64)'),
        wordAddr(idA),
        wordAddr(idB),
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

export function decodeFleetMessagesHex(hex) {
  if (!hex || hex === '0x') return [];
  const b = hexToBytes(hex);
  if (b.length < 4) return [];
  // `getRecentMessages` returns newest-first; reverse so chat scrolls chronologically oldest->newest!
  return parseMsgEntries(b, 4, readU32LE(b, 0)).list.reverse();
}

export function decodeFleetCharterSnapshotHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 136 || b[0] !== 1) return null;

  const memberCount = b[1];
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
    const [name = 'Captain', handle = '@captain', role = 'Naval Officer'] = metaStr.split('|');

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

  return { currentBlock, members };
}

export function decodeFleetRelSnapshotHex(hex) {
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

export function decodeFleetFeedSnapshotHex(hex) {
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

export class FleetSocialClient {
  constructor({ rpcUrlFn = () => getDefaultNodeWsUrl() } = {}) {
    this.rpcUrlFn = rpcUrlFn;
    this.suite = null;
    this.charterSnap = null;
    this.relSnap = null;
    this.feedSnap = { totalPosts: 0, posts: [] };
    this.bridgeMsgs = [];
    this.squadronMsgs = [];
    this.dmMsgs = [];
    this.connectedIds = new Set();
    this.incomingHandshakes = [];
    this.outgoingIds = new Set();
    this.identityTagCache = new Map(); // identityAddr -> "<Nickname> · <4-char>"
    this._resolvingIds = new Set();
  }

  async ensureSuiteLoaded() {
    if (this.suite?.charter && this.suite?.messaging) return this.suite;
    const { manifest } = await SlxHfsCache.hydrateWithManifest();
    this.suite = manifest?.fleetSocial || manifest?.commonsRf || null;
    return this.suite;
  }

  suiteTargets(extra = []) {
    if (!this.suite) return extra.filter(Boolean);
    return Array.from(
      new Set(
        [
          this.suite.identityRegistry,
          this.suite.messaging,
          this.suite.charter,
          this.suite.relationships,
          this.suite.feed,
          this.suite.events,
          ...extra,
        ].filter(Boolean)
      )
    );
  }

  async resolveAuthorTag(identityOrEoaAddr, fallbackPlayers = []) {
    const low = String(identityOrEoaAddr || '').toLowerCase();
    if (!low) return 'Captain';
    if (this.identityTagCache.has(low)) return this.identityTagCache.get(low);

    // Check Phantom Fleet players list first
    const byId = fallbackPlayers.find((p) => (p.identityAddr || '').toLowerCase() === low);
    if (byId) {
      const chMember = this.charterSnap?.members?.find((m) => m.identityAddr === low);
      if (chMember?.name) {
        const tag = `${chMember.name} · ${truncAddr4(byId.addr)}`;
        this.identityTagCache.set(low, tag);
        return tag;
      }
    }

    const chMem = this.charterSnap?.members?.find((m) => m.identityAddr === low);
    if (!this._resolvingIds.has(low)) {
      this._resolvingIds.add(low);
      const rpcUrl = this.rpcUrlFn();
      Promise.all([
        readOnChainIdentityNickname(rpcUrl, low).catch(() => ''),
        readOnChainIdentityOwner(rpcUrl, low).catch(() => ''),
      ])
        .then(([nick, owner]) => {
          const finalName = nick || chMem?.name || '';
          if (finalName) {
            const tag = owner ? `${finalName} · ${truncAddr4(owner)}` : finalName;
            this.identityTagCache.set(low, tag);
          }
        })
        .finally(() => {
          this._resolvingIds.delete(low);
        });
    }

    if (chMem?.name) return chMem.name;
    return `Capt · ${truncAddr4(low)}`;
  }

  async refresh({
    battleId,
    myTeam = 0,
    myIdentityAddr = '',
    activeDmPeerId = '',
    players = [],
  } = {}) {
    const suite = await this.ensureSuiteLoaded();
    if (!suite?.charter || !suite?.messaging || !battleId) return null;

    const rpcUrl = this.rpcUrlFn();
    const bChan = bridgeChannelHash(battleId);
    const tChan = squadronChannelHash(battleId, myTeam);
    const myIdLow = String(myIdentityAddr || '').toLowerCase();
    const dmPeerLow = String(activeDmPeerId || '').toLowerCase();

    const calls = [
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.charter, data: FleetSocialAbi.getCharterSnapshot() }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.relationships, data: FleetSocialAbi.getRelationshipsSnapshot() }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.messaging, data: FleetSocialAbi.getRecentMessages(bChan, 24) }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.messaging, data: FleetSocialAbi.getRecentMessages(tChan, 24) }, 'latest']).catch(() => '0x'),
      slxNodeRpc(rpcUrl, 'eth_call', [{ to: suite.feed, data: FleetSocialAbi.getFeedSnapshot() }, 'latest']).catch(() => '0x'),
    ];
    if (myIdLow && dmPeerLow && myIdLow !== dmPeerLow) {
      calls.push(
        slxNodeRpc(rpcUrl, 'eth_call', [
          { to: suite.feed, data: FleetSocialAbi.getDirectMessages(myIdLow, dmPeerLow, 24) },
          'latest',
        ]).catch(() => '0x')
      );
    }

    const [chrHex, relHex, bridgeHex, teamHex, feedHex, dmHex] = await Promise.all(calls);
    this.charterSnap = decodeFleetCharterSnapshotHex(chrHex);
    this.relSnap = decodeFleetRelSnapshotHex(relHex);
    this.bridgeMsgs = decodeFleetMessagesHex(bridgeHex);
    this.squadronMsgs = decodeFleetMessagesHex(teamHex);
    this.feedSnap = decodeFleetFeedSnapshotHex(feedHex);
    if (dmHex !== undefined) {
      this.dmMsgs = decodeFleetMessagesHex(dmHex);
    }

    // Build connectedIds, incomingHandshakes, outgoingIds for `myIdLow`
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

    // Warm nickname cache for visible message authors
    for (const msg of [...this.bridgeMsgs, ...this.squadronMsgs, ...this.dmMsgs]) {
      this.resolveAuthorTag(msg.authorAddr, players);
    }

    return {
      charter: this.charterSnap,
      relationships: this.relSnap,
      bridgeMsgs: this.bridgeMsgs,
      squadronMsgs: this.squadronMsgs,
      dmMsgs: this.dmMsgs,
      feed: this.feedSnap,
      connectedIds: this.connectedIds,
      incomingHandshakes: this.incomingHandshakes,
      outgoingIds: this.outgoingIds,
    };
  }

  /**
   * Prepends `registerProfile` or `pingPresence` automatically if the player's Identity
   * is not yet enrolled or needs a heartbeat refresh on `fleetSocial.charter`!
   */
  async ensureOnboardedAndActive({
    sendIdentityTx,
    myIdentityAddr,
    myNickname,
    myHandle,
    myTeam = 0,
    gridX = 24,
    gridY = 15,
  }) {
    const suite = await this.ensureSuiteLoaded();
    if (!suite?.charter || !myIdentityAddr) return;
    const myIdLow = myIdentityAddr.toLowerCase();
    const { xM, yM } = oceanToSocialCoords(gridX, gridY);
    const meMem = this.charterSnap?.members?.find((m) => m.identityAddr === myIdLow);
    const curBlk = this.charterSnap?.currentBlock || 0;

    if (!meMem) {
      const role = myTeam === 0 ? 'Red Armada Captain' : 'Blue Coalition Captain';
      const metaStr = `${myNickname || 'Captain'}|@${myHandle || 'captain'}|${role}|Naval VHF`;
      await sendIdentityTx(
        myIdLow,
        FleetSocialAbi.execViaIdentity(suite.charter, FleetSocialAbi.registerProfile(xM, yM, metaStr)),
        this.suiteTargets([myIdLow]),
        6_500_000n
      );
    } else if (!meMem.isActive) {
      await sendIdentityTx(
        myIdLow,
        FleetSocialAbi.execViaIdentity(suite.charter, FleetSocialAbi.pingPresence(xM, yM)),
        this.suiteTargets([myIdLow]),
        5_000_000n
      );
    }
  }

  /**
   * Ensures a target verified `Identity` HFS (e.g. another human Captain in the arena who
   * has not clicked Comms yet) is onboarded and active on `SocialCharter` before opening or
   * accepting a relationship handshake or sending a Direct Message!
   */
  async ensurePeerActive({ sendIdentityTx, peerIdentityAddr }) {
    const suite = await this.ensureSuiteLoaded();
    if (!suite?.charter || !peerIdentityAddr) return;
    const peerLow = peerIdentityAddr.toLowerCase();
    const peerMem = this.charterSnap?.members?.find((m) => m.identityAddr === peerLow);
    if (!peerMem || !peerMem.isActive) {
      await sendIdentityTx(
        suite.charter,
        FleetSocialAbi.syncVerifiedIdentity(peerLow),
        this.suiteTargets([peerLow]),
        6_000_000n
      );
    }
  }
}
