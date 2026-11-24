/**
 * @superlexicon/sdk/ecies_messaging
 *
 * Sovereign ECIES (`secp256k1` ECDH + `AES-256-GCM` AEAD) Multi-Topic Identity Messaging Client:
 *  - Deduplicates `1-to-1` and `M-to-N` channels by hashing the concatenated sorted `secp256k1`
 *    public keys (`SLX_ECIES_PK_ROSTER_V1`) & sorted Identity HFS addresses (`SLX_ECIES_ID_ROSTER_V1`).
 *  - Automatically reuses pre-existing channels and creates a new sub-topic when a user opens a group
 *    with the same roster (`openChannelOrTopic` -> `createdNewChannel = 0`).
 *  - Bidirectional `Identity <-> Messaging` self-discovery with ZERO external indexers (`Identity` HFS
 *    whitelist register -> `Messaging.getIdentityChannels(identityAddr)`).
 *  - Rolling `AES-256-GCM` epoch keys: manual roll (`rotateChannelKey`), atomic join/remove rekey
 *    (`addChannelMember`, `removeChannelMember`), and lazy-on-next-send rekey after voluntary leave
 *    (`leaveChannel` -> `rekeyRequired = 1` -> `rotateAndPostTopicMessage`).
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  randomBytes,
  keccak256Bytes,
  keccak256Hex,
  selectorBytes,
} from './crypto.js';
import {
  encodeAbi,
  u16BEBytes,
  u64BEBytes,
  readU16BE,
  readU32BE,
  readU64BE,
  decodeUintWord,
  ZERO_ADDR,
  ZERO_BYTES32,
} from './abi.js';
import { SlxNonceQueue, slxNodeRpc } from './rpc.js';
import { slxWaitForReceipt } from './events.js';
import {
  IdentityHfsWhitelistAbi,
  decodeIdentityHfsSliceHex,
  HFS_ASSOC_STATUS,
} from './identity.js';
import {
  wrapSecretForRecipientSecp,
  unwrapSecretWithPrivKey,
} from './confidential.js';
import { resolveIdentityEncryptionKeys } from './recovery.js';

export const ECIES_CHANNEL_KEY_WRAP_TAG = 'SLX_ECIES_CH_KEY_V1';
export const HFS_TYPE_MESSAGING_ECIES = 'MESSAGING_ECIES';

function asBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return v.startsWith('0x') ? hexToBytes(v) : utf8ToBytes(v);
  return new Uint8Array(v || []);
}

function u32BEBytes(n) {
  const v = Number(n) >>> 0;
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function compareBytesLex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

// ============================================================================
// 1. Canonical Roster Sorting & Public-Key Concatenation Hash
// ============================================================================

export function packChannelMembersBytes(memberAddrs = []) {
  const uniq = [];
  const seen = new Set();
  for (const raw of memberAddrs) {
    const low = String(raw || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(low) || low === ZERO_ADDR) continue;
    if (!seen.has(low)) {
      seen.add(low);
      uniq.push(low);
    }
  }
  if (uniq.length < 2 || uniq.length > 16) {
    throw new Error(`ECIES channel requires 2..16 distinct Identity addresses (got ${uniq.length})`);
  }
  return concatBytes(...uniq.map((a) => hexToBytes(a).slice(-20)));
}

/**
 * Matches `compute_roster_hashes` in `messaging.wasm` byte-for-byte!
 * @param {Array<{ identityAddr: string, secpPub64Bytes?: Uint8Array|string }>} memberEntries
 */
export function computeCanonicalRosterHashes(memberEntries = []) {
  if (memberEntries.length < 2 || memberEntries.length > 16) {
    throw new Error('Roster requires 2..16 members');
  }
  const byId = memberEntries
    .map((e) => {
      const id20 = hexToBytes(e.identityAddr).slice(-20);
      let pk64 = e.secpPub64Bytes ? asBytes(e.secpPub64Bytes) : new Uint8Array(0);
      const hasValidPk = pk64.length === 64 && pk64.some((x) => x !== 0);
      if (!hasValidPk) {
        pk64 = new Uint8Array(64);
        pk64.set(id20, 44);
      }
      return {
        identityAddr: bytesToHex(id20, true).toLowerCase(),
        id20,
        pk64,
      };
    })
    .sort((a, b) => compareBytesLex(a.id20, b.id20));

  for (let i = 1; i < byId.length; i++) {
    if (compareBytesLex(byId[i - 1].id20, byId[i].id20) === 0) {
      throw new Error('Duplicate Identity in roster');
    }
  }

  const sortedPks = byId.map((x) => x.pk64).sort(compareBytesLex);
  for (let i = 1; i < sortedPks.length; i++) {
    if (compareBytesLex(sortedPks[i - 1], sortedPks[i]) === 0) {
      throw new Error('Duplicate secp256k1 public key in roster');
    }
  }

  const pkRosterHash = keccak256Hex(
    concatBytes(utf8ToBytes('SLX_ECIES_PK_ROSTER_V1'), ...sortedPks)
  );
  const idRosterHash = keccak256Hex(
    concatBytes(utf8ToBytes('SLX_ECIES_ID_ROSTER_V1'), ...byId.map((x) => x.id20))
  );
  return {
    sortedMembers: byId.map((x) => x.identityAddr),
    pkRosterHash,
    idRosterHash,
  };
}

// ============================================================================
// 2. ECIES Channel Key Wrapping + WebCrypto `AES-256-GCM` Topic Message AEAD
// ============================================================================

export function generateChannelAesKey256() {
  return randomBytes(32);
}

/**
 * Wraps `aesKey32` via `secp256k1` ECIES for every member in `memberPubKeys`
 * (`Array<{ identityAddr: string, secpPub64Bytes: Uint8Array|string }>`).
 * Wire format: `[count: u8][memberAddr: 20][wrapLen: u16 BE][wrapBytes]*`.
 */
export function wrapChannelKeyForMembers(aesKey32, memberPubKeys = []) {
  const key = asBytes(aesKey32);
  if (key.length !== 32) throw new Error('AES-256 channel key must be 32 bytes');
  if (!memberPubKeys.length || memberPubKeys.length > 16) {
    throw new Error('wrapChannelKeyForMembers expects 1..16 members');
  }
  const chunks = [new Uint8Array([memberPubKeys.length])];
  for (const m of memberPubKeys) {
    const addr20 = hexToBytes(m.identityAddr).slice(-20);
    const pk64 = asBytes(m.secpPub64Bytes);
    if (pk64.length !== 64 || pk64.every((x) => x === 0)) {
      throw new Error(`Identity ${m.identityAddr} has no registered 64-byte secp256k1 encryption public key`);
    }
    const env = wrapSecretForRecipientSecp(key, pk64, ECIES_CHANNEL_KEY_WRAP_TAG);
    chunks.push(addr20, u16BEBytes(env.length), env);
  }
  return concatBytes(...chunks);
}

export function unwrapChannelKeyForEpoch(wrapEnvelopeInput, identitySecpPrivHex) {
  const key = unwrapSecretWithPrivKey(wrapEnvelopeInput, identitySecpPrivHex, ECIES_CHANNEL_KEY_WRAP_TAG);
  return key && key.length === 32 ? key : null;
}

export function buildTopicMessageAad(messagingAddr, channelIdHex, topicId, keyEpoch, authorIdentityAddr) {
  return concatBytes(
    utf8ToBytes('SLX_ECIES_MSG_AAD_V1:'),
    hexToBytes(messagingAddr).slice(-20),
    hexToBytes(channelIdHex).slice(0, 32),
    u64BEBytes(topicId),
    u32BEBytes(keyEpoch),
    hexToBytes(authorIdentityAddr).slice(-20)
  );
}

async function importAesGcmKey(aesKey32, usages) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle API required for AES-256-GCM');
  return subtle.importKey('raw', asBytes(aesKey32).slice(0, 32), { name: 'AES-GCM' }, false, usages);
}

/**
 * Encrypts a topic message payload using `AES-256-GCM` (`12B` random IV + `16B` auth tag)
 * bound to `AAD = messagingAddr || channelId || topicId || keyEpoch || authorIdentity`.
 * Wire format: `[ver=1 (1B) || iv12 (12B) || ciphertext || gcmTag16 (16B)]`.
 */
export async function encryptTopicMessageAesGcm(aesKey32, payloadOrText, aadBytes) {
  const bodyObj =
    typeof payloadOrText === 'string'
      ? { v: 1, text: payloadOrText, ts: Date.now() }
      : { v: 1, ts: Date.now(), ...payloadOrText };
  const plain = utf8ToBytes(JSON.stringify(bodyObj));
  const iv12 = randomBytes(12);
  const cryptoKey = await importAesGcmKey(aesKey32, ['encrypt']);
  const ctBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv12, additionalData: asBytes(aadBytes) },
    cryptoKey,
    plain
  );
  return concatBytes(new Uint8Array([1]), iv12, new Uint8Array(ctBuf));
}

export async function decryptTopicMessageAesGcm(aesKey32, frameInput, aadBytes) {
  const frame = asBytes(frameInput);
  if (frame.length < 30 || frame[0] !== 1) return null;
  const iv12 = frame.slice(1, 13);
  const ct = frame.slice(13);
  try {
    const cryptoKey = await importAesGcmKey(aesKey32, ['decrypt']);
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv12, additionalData: asBytes(aadBytes) },
      cryptoKey,
      ct
    );
    const parsed = JSON.parse(bytesToUtf8(new Uint8Array(plainBuf)));
    return {
      text: String(parsed?.text ?? ''),
      ts: Number(parsed?.ts || 0),
      payload: parsed,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// 3. `Messaging` v2 ABI Calldata Builders & Binary View Decoders
// ============================================================================

export const SlxEciesMessagingAbi = {
  secp256k1PubKey() {
    return bytesToHex(selectorBytes('secp256k1PubKey()'), true);
  },
  executeViaIdentity(targetHfsAddr, innerCalldataHex) {
    return encodeAbi('execute(address,bytes)', [
      ['address', targetHfsAddr],
      ['bytes', hexToBytes(innerCalldataHex)],
    ]);
  },
  openChannelOrTopic(membersPackedBytes, channelLabel, topicTitle, epochWrapsPackedBytes) {
    return encodeAbi('openChannelOrTopic(bytes,string,string,bytes)', [
      ['bytes', asBytes(membersPackedBytes)],
      ['string', String(channelLabel || '').slice(0, 48)],
      ['string', String(topicTitle || 'General').slice(0, 64)],
      ['bytes', asBytes(epochWrapsPackedBytes || new Uint8Array(0))],
    ]);
  },
  createTopic(channelIdHex, topicTitle) {
    return encodeAbi('createTopic(bytes32,string)', [
      ['bytes32', channelIdHex],
      ['string', String(topicTitle || 'Topic').slice(0, 64)],
    ]);
  },
  rotateChannelKey(channelIdHex, epochWrapsPackedBytes) {
    return encodeAbi('rotateChannelKey(bytes32,bytes)', [
      ['bytes32', channelIdHex],
      ['bytes', asBytes(epochWrapsPackedBytes)],
    ]);
  },
  addChannelMember(channelIdHex, newMemberIdentityAddr, epochWrapsPackedBytes) {
    return encodeAbi('addChannelMember(bytes32,address,bytes)', [
      ['bytes32', channelIdHex],
      ['address', newMemberIdentityAddr],
      ['bytes', asBytes(epochWrapsPackedBytes)],
    ]);
  },
  removeChannelMember(channelIdHex, targetMemberIdentityAddr, epochWrapsPackedBytes) {
    return encodeAbi('removeChannelMember(bytes32,address,bytes)', [
      ['bytes32', channelIdHex],
      ['address', targetMemberIdentityAddr],
      ['bytes', asBytes(epochWrapsPackedBytes)],
    ]);
  },
  leaveChannel(channelIdHex) {
    return encodeAbi('leaveChannel(bytes32)', [['bytes32', channelIdHex]]);
  },
  postTopicMessage(channelIdHex, topicId, keyEpoch, ciphertextBytes) {
    return encodeAbi('postTopicMessage(bytes32,uint64,uint64,bytes)', [
      ['bytes32', channelIdHex],
      ['uint64', topicId],
      ['uint64', keyEpoch],
      ['bytes', asBytes(ciphertextBytes)],
    ]);
  },
  rotateAndPostTopicMessage(channelIdHex, topicId, epochWrapsPackedBytes, ciphertextBytes) {
    return encodeAbi('rotateAndPostTopicMessage(bytes32,uint64,bytes,bytes)', [
      ['bytes32', channelIdHex],
      ['uint64', topicId],
      ['bytes', asBytes(epochWrapsPackedBytes)],
      ['bytes', asBytes(ciphertextBytes)],
    ]);
  },
  resolveChannelByRoster(membersPackedBytes) {
    return encodeAbi('resolveChannelByRoster(bytes)', [['bytes', asBytes(membersPackedBytes)]]);
  },
  getIdentityChannels(identityAddr) {
    return encodeAbi('getIdentityChannels(address)', [['address', identityAddr]]);
  },
  getChannelDetails(channelIdHex, viewerIdentityAddr) {
    return encodeAbi('getChannelDetails(bytes32,address)', [
      ['bytes32', channelIdHex],
      ['address', viewerIdentityAddr || ZERO_ADDR],
    ]);
  },
  getTopicMessages(channelIdHex, topicId, maxMessages = 40) {
    return encodeAbi('getTopicMessages(bytes32,uint64,uint64)', [
      ['bytes32', channelIdHex],
      ['uint64', topicId],
      ['uint64', maxMessages],
    ]);
  },
};

export function decodeOpenChannelReturnHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 56) return null;
  return {
    channelId: bytesToHex(b.slice(0, 32), true).toLowerCase(),
    topicId: readU64BE(b, 32),
    keyEpoch: readU64BE(b, 40),
    createdNewChannel: readU64BE(b, 48) === 1,
  };
}

export function decodeIdentityChannelsHex(hex, messagingAddr = '') {
  if (!hex || hex === '0x') return [];
  const b = hexToBytes(hex);
  if (b.length < 2) return [];
  const count = readU16BE(b, 0);
  let pos = 2;
  const out = [];
  for (let i = 0; i < count && pos + 81 <= b.length; i++) {
    const channelId = bytesToHex(b.slice(pos, pos + 32), true).toLowerCase();
    const isActiveMember = b[pos + 32] === 1;
    const rekeyRequired = b[pos + 33] === 1;
    const memberCount = b[pos + 34];
    const topicCount = b[pos + 35];
    const currentKeyEpoch = readU32BE(b, pos + 36);
    const lastBlock = readU64BE(b, pos + 40);
    const pkRosterHash = bytesToHex(b.slice(pos + 48, pos + 80), true).toLowerCase();
    const ll = b[pos + 80];
    pos += 81;
    if (pos + ll + memberCount * 20 > b.length) break;
    const label = bytesToUtf8(b.slice(pos, pos + ll));
    pos += ll;

    const members = [];
    for (let m = 0; m < memberCount; m++) {
      members.push(bytesToHex(b.slice(pos, pos + 20), true).toLowerCase());
      pos += 20;
    }

    const topics = [];
    for (let t = 0; t < topicCount && pos + 15 <= b.length; t++) {
      const topicId = readU16BE(b, pos);
      const msgCount = readU32BE(b, pos + 2);
      const topicLastBlock = readU64BE(b, pos + 6);
      const tl = b[pos + 14];
      pos += 15;
      if (pos + tl > b.length) break;
      const title = bytesToUtf8(b.slice(pos, pos + tl));
      pos += tl;
      topics.push({ topicId, msgCount, lastBlock: topicLastBlock, title });
    }

    if (pos + 2 > b.length) break;
    const wl = readU16BE(b, pos);
    pos += 2;
    if (pos + wl > b.length) break;
    const activeWrapBytes = b.slice(pos, pos + wl);
    pos += wl;

    out.push({
      messagingAddr: messagingAddr ? String(messagingAddr).toLowerCase() : '',
      channelId,
      isActiveMember,
      rekeyRequired,
      memberCount,
      topicCount,
      currentKeyEpoch,
      lastBlock,
      pkRosterHash,
      label,
      members,
      topics,
      activeWrapBytes,
    });
  }
  return out;
}

export function decodeChannelDetailsHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 1 || b[0] !== 1 || b.length < 110) return null;
  const isActiveMember = b[1] === 1;
  const rekeyRequired = b[2] === 1;
  const memberCount = b[3];
  const topicCount = b[4];
  const currentKeyEpoch = readU32BE(b, 5);
  const createdBlock = readU64BE(b, 9);
  const lastBlock = readU64BE(b, 17);
  const creator = bytesToHex(b.slice(25, 45), true).toLowerCase();
  const pkRosterHash = bytesToHex(b.slice(45, 77), true).toLowerCase();
  const idRosterHash = bytesToHex(b.slice(77, 109), true).toLowerCase();
  const ll = b[109];
  let pos = 110;
  if (pos + ll + memberCount * 20 > b.length) return null;
  const label = bytesToUtf8(b.slice(pos, pos + ll));
  pos += ll;

  const members = [];
  for (let i = 0; i < memberCount; i++) {
    members.push(bytesToHex(b.slice(pos, pos + 20), true).toLowerCase());
    pos += 20;
  }

  const topics = [];
  for (let t = 0; t < topicCount && pos + 35 <= b.length; t++) {
    const topicId = readU16BE(b, pos);
    const msgCount = readU32BE(b, pos + 2);
    const topicLastBlock = readU64BE(b, pos + 6);
    const topicCreator = bytesToHex(b.slice(pos + 14, pos + 34), true).toLowerCase();
    const tl = b[pos + 34];
    pos += 35;
    if (pos + tl > b.length) break;
    const title = bytesToUtf8(b.slice(pos, pos + tl));
    pos += tl;
    topics.push({ topicId, msgCount, lastBlock: topicLastBlock, creator: topicCreator, title });
  }

  const epochWraps = new Map();
  if (pos + 2 <= b.length) {
    const wc = readU16BE(b, pos);
    pos += 2;
    for (let w = 0; w < wc && pos + 6 <= b.length; w++) {
      const epoch = readU32BE(b, pos);
      const wl = readU16BE(b, pos + 4);
      pos += 6;
      if (pos + wl > b.length) break;
      epochWraps.set(epoch, b.slice(pos, pos + wl));
      pos += wl;
    }
  }

  return {
    isActiveMember,
    rekeyRequired,
    memberCount,
    topicCount,
    currentKeyEpoch,
    createdBlock,
    lastBlock,
    creator,
    pkRosterHash,
    idRosterHash,
    label,
    members,
    topics,
    epochWraps,
  };
}

export function decodeTopicMessagesHex(hex) {
  if (!hex || hex === '0x') return { returnedCount: 0, totalCount: 0, messages: [] };
  const b = hexToBytes(hex);
  if (b.length < 8) return { returnedCount: 0, totalCount: 0, messages: [] };
  const returnedCount = readU32BE(b, 0);
  const totalCount = readU32BE(b, 4);
  let pos = 8;
  const messages = [];
  for (let i = 0; i < returnedCount && pos + 38 <= b.length; i++) {
    const msgSeq = readU32BE(b, pos);
    const blockNumber = readU64BE(b, pos + 4);
    const keyEpoch = readU32BE(b, pos + 12);
    const author = bytesToHex(b.slice(pos + 16, pos + 36), true).toLowerCase();
    const ctLen = readU16BE(b, pos + 36);
    pos += 38;
    if (pos + ctLen > b.length) break;
    const ciphertextBytes = b.slice(pos, pos + ctLen);
    pos += ctLen;
    messages.push({
      msgSeq,
      blockNumber,
      keyEpoch,
      author,
      ciphertextBytes,
      ciphertextHex: bytesToHex(ciphertextBytes, true),
    });
  }
  return { returnedCount, totalCount, messages };
}

// ============================================================================
// 4. High-Level `SlxEciesChannelClient` (Self-Discovery + Auto Epoch Key Mgmt)
// ============================================================================

function extractPrivKey(walletOrPriv) {
  if (!walletOrPriv) return '';
  if (typeof walletOrPriv === 'string') return walletOrPriv;
  return walletOrPriv.privateKey || walletOrPriv.keypair?.privateKey || '';
}

export class SlxEciesChannelClient {
  constructor({ rpcUrl, rpcUrlFn = null, defaultMessagingAddr = '', gasLimit = 6_500_000n } = {}) {
    this._rpcUrlFn = rpcUrlFn || (() => rpcUrl);
    this.defaultMessagingAddr = String(defaultMessagingAddr || '').toLowerCase();
    this.gasLimit = gasLimit;
    this._nonceQueue = new SlxNonceQueue({ rpcUrlFn: () => this.rpcUrl });
    this._epochKeyCache = new Map(); // `${msgAddr}:${cid}:${epoch}:${idAddr}` -> Uint8Array(32)
  }

  get rpcUrl() {
    return this._rpcUrlFn();
  }

  async fetchMemberEncryptionPubKey(identityAddr) {
    const rawHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: identityAddr, data: SlxEciesMessagingAbi.secp256k1PubKey() },
      'latest',
    ]);
    const b = hexToBytes(rawHex || '0x');
    if (b.length < 64 || b.slice(0, 64).every((x) => x === 0)) {
      return null;
    }
    return b.slice(0, 64);
  }

  async fetchRosterPubKeys(memberAddrs = []) {
    const uniq = [...new Set(memberAddrs.map((a) => String(a || '').toLowerCase()).filter(Boolean))];
    const entries = await Promise.all(
      uniq.map(async (identityAddr) => ({
        identityAddr,
        secpPub64Bytes: await this.fetchMemberEncryptionPubKey(identityAddr),
      }))
    );
    return entries;
  }

  /**
   * Requirement #3: Discovers ALL `Messaging` HFSes associated with `identityAddr` directly
   * from `identityAddr`'s on-chain HFS Register (excluding `SPAM = 3`) — zero external indexers!
   */
  async discoverMessagingSubroutinesFromIdentity(identityAddr) {
    const discovered = new Set();
    if (this.defaultMessagingAddr && this.defaultMessagingAddr !== ZERO_ADDR) {
      discovered.add(this.defaultMessagingAddr);
    }
    try {
      const sliceHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: identityAddr, data: IdentityHfsWhitelistAbi.getHfsAssociationsSlice(0, 64) },
        'latest',
      ]);
      const { items } = decodeIdentityHfsSliceHex(sliceHex);
      for (const it of items) {
        if (it.status === HFS_ASSOC_STATUS.SPAM) {
          discovered.delete(it.hfsAddr.toLowerCase());
          continue;
        }
        if (
          it.typeName === HFS_TYPE_MESSAGING_ECIES ||
          it.typeName === 'MESSAGING' ||
          it.label.toLowerCase().includes('ecies') ||
          it.label.toLowerCase().includes('messaging')
        ) {
          discovered.add(it.hfsAddr.toLowerCase());
        }
      }
    } catch {
      // Fallback to defaultMessagingAddr
    }
    return [...discovered];
  }

  async listIdentityChannels(identityAddr) {
    const msgAddrs = await this.discoverMessagingSubroutinesFromIdentity(identityAddr);
    const batches = await Promise.all(
      msgAddrs.map(async (mAddr) => {
        try {
          const rawHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
            { to: mAddr, data: SlxEciesMessagingAbi.getIdentityChannels(identityAddr) },
            'latest',
          ]);
          return decodeIdentityChannelsHex(rawHex, mAddr);
        } catch {
          return [];
        }
      })
    );
    return batches.flat().sort((a, b) => b.lastBlock - a.lastBlock);
  }

  async _execViaIdentity(wallet, identityAddr, messagingAddr, innerCalldataHex, extraTargets = [], label = 'eciesChannel') {
    const privateKey = extractPrivKey(wallet);
    if (!privateKey) throw new Error('Missing wallet privateKey for ECIES transaction');
    const outer = SlxEciesMessagingAbi.executeViaIdentity(messagingAddr, innerCalldataHex);
    const targets = Array.from(
      new Set([messagingAddr, ...extraTargets].map((x) => String(x || '').toLowerCase()).filter((x) => x && x !== ZERO_ADDR))
    );
    const sent = await this._nonceQueue.sendSigned({
      privateKey,
      to: identityAddr,
      data: outer,
      gasLimit: this.gasLimit,
      extraTargets: targets,
      label,
    });
    try {
      const receipt = await slxWaitForReceipt((m, p) => slxNodeRpc(this.rpcUrl, m, p), sent.txHash, 18_000);
      if (!receipt || receipt.status !== '0x1') {
        throw new Error(`ECIES Messaging HFS transaction reverted (${label}: ${sent.txHash})`);
      }
      wallet?.recordExternalRpcTx?.({
        txHash: sent.txHash,
        rawTx: sent.rawTx,
        from: sent.senderAddr,
        to: identityAddr,
        contractLabel: 'EciesMessaging',
        fnLabel: label,
        dataHex: outer,
        blockNumber: Number(receipt.blockNumber || 0),
        nonce: Number(sent.nonce),
      });
      return { txHash: sent.txHash, receipt };
    } finally {
      this._nonceQueue.release(sent.senderAddr, sent.nonce);
    }
  }

  /**
   * Opens a `1-to-1` or `M-to-N` ECIES channel OR automatically reuses an existing channel
   * matching the sorted public-key roster and appends a new `topicTitle` under it!
   */
  async openOrReuseChannelWithTopic(wallet, myIdentityAddr, { members, channelLabel = '', topicTitle = 'General', messagingAddr = '' }) {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const fullMembers = [...new Set([myIdentityAddr.toLowerCase(), ...(members || []).map((x) => x.toLowerCase())])];
    const membersPacked = packChannelMembersBytes(fullMembers);

    // Check first whether an active channel already exists for this roster!
    const existingHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.resolveChannelByRoster(membersPacked) },
      'latest',
    ]);
    const existingCid = existingHex && existingHex.length >= 66 ? existingHex.slice(0, 66).toLowerCase() : ZERO_BYTES32;
    let wrapsPacked = new Uint8Array(0);
    let generatedAesKey = null;

    if (!existingCid || existingCid === ZERO_BYTES32) {
      const rosterPks = await this.fetchRosterPubKeys(fullMembers);
      generatedAesKey = generateChannelAesKey256();
      wrapsPacked = wrapChannelKeyForMembers(generatedAesKey, rosterPks);
    }

    const isNew = !existingCid || existingCid === ZERO_BYTES32;
    const inner = SlxEciesMessagingAbi.openChannelOrTopic(membersPacked, channelLabel, topicTitle, wrapsPacked);
    const { txHash, receipt } = await this._execViaIdentity(
      wallet,
      myIdentityAddr,
      mAddr,
      inner,
      fullMembers,
      'openChannelOrTopic'
    );

    const resolvedHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.resolveChannelByRoster(membersPacked) },
      'latest',
    ]);
    const channelId = resolvedHex && resolvedHex.length >= 66 ? resolvedHex.slice(0, 66).toLowerCase() : existingCid;
    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(channelId, myIdentityAddr) },
      'latest',
    ]);
    const details = decodeChannelDetailsHex(detailsHex);
    const topicId = Math.max(0, (details?.topicCount || 1) - 1);
    const keyEpoch = details?.currentKeyEpoch || 1;

    if (isNew && channelId && generatedAesKey) {
      this._epochKeyCache.set(
        `${mAddr}:${channelId}:1:${myIdentityAddr.toLowerCase()}`,
        generatedAesKey
      );
    }
    return {
      txHash,
      receipt,
      channelId,
      topicId,
      keyEpoch,
      createdNewChannel: isNew,
      messagingAddr: mAddr,
    };
  }

  async createTopic(wallet, myIdentityAddr, channelId, topicTitle, messagingAddr = '') {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const inner = SlxEciesMessagingAbi.createTopic(channelId, topicTitle);
    const { txHash, receipt } = await this._execViaIdentity(wallet, myIdentityAddr, mAddr, inner, [], 'createTopic');
    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(channelId, myIdentityAddr) },
      'latest',
    ]);
    const details = decodeChannelDetailsHex(detailsHex);
    const topicId = Math.max(0, (details?.topicCount || 1) - 1);
    return { txHash, receipt, channelId, topicId };
  }

  async rollChannelKey(wallet, myIdentityAddr, channelId, messagingAddr = '') {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(channelId, myIdentityAddr) },
      'latest',
    ]);
    const details = decodeChannelDetailsHex(detailsHex);
    if (!details || !details.isActiveMember) throw new Error('Caller is not an active channel member');
    const rosterPks = await this.fetchRosterPubKeys(details.members);
    const newAesKey = generateChannelAesKey256();
    const wrapsPacked = wrapChannelKeyForMembers(newAesKey, rosterPks);
    const inner = SlxEciesMessagingAbi.rotateChannelKey(channelId, wrapsPacked);
    const { txHash, receipt } = await this._execViaIdentity(
      wallet,
      myIdentityAddr,
      mAddr,
      inner,
      details.members,
      'rotateChannelKey'
    );
    const newKeyEpoch = details.currentKeyEpoch + 1;
    this._epochKeyCache.set(`${mAddr}:${channelId.toLowerCase()}:${newKeyEpoch}:${myIdentityAddr.toLowerCase()}`, newAesKey);
    return { txHash, receipt, newKeyEpoch };
  }

  async addChannelMember(wallet, myIdentityAddr, channelId, newMemberIdentityAddr, messagingAddr = '') {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(channelId, myIdentityAddr) },
      'latest',
    ]);
    const details = decodeChannelDetailsHex(detailsHex);
    if (!details || !details.isActiveMember) throw new Error('Caller is not an active channel member');
    const nextMembers = [...new Set([...details.members, newMemberIdentityAddr.toLowerCase()])];
    const rosterPks = await this.fetchRosterPubKeys(nextMembers);
    const newAesKey = generateChannelAesKey256();
    const wrapsPacked = wrapChannelKeyForMembers(newAesKey, rosterPks);
    const inner = SlxEciesMessagingAbi.addChannelMember(channelId, newMemberIdentityAddr, wrapsPacked);
    const { txHash, receipt } = await this._execViaIdentity(
      wallet,
      myIdentityAddr,
      mAddr,
      inner,
      nextMembers,
      'addChannelMember'
    );
    const newKeyEpoch = details.currentKeyEpoch + 1;
    this._epochKeyCache.set(`${mAddr}:${channelId.toLowerCase()}:${newKeyEpoch}:${myIdentityAddr.toLowerCase()}`, newAesKey);
    return { txHash, receipt, newKeyEpoch };
  }

  async removeChannelMember(wallet, myIdentityAddr, channelId, targetMemberIdentityAddr, messagingAddr = '') {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(channelId, myIdentityAddr) },
      'latest',
    ]);
    const details = decodeChannelDetailsHex(detailsHex);
    if (!details || !details.isActiveMember) throw new Error('Caller is not an active channel member');
    const surviving = details.members.filter((m) => m.toLowerCase() !== targetMemberIdentityAddr.toLowerCase());
    const rosterPks = await this.fetchRosterPubKeys(surviving);
    const newAesKey = generateChannelAesKey256();
    const wrapsPacked = wrapChannelKeyForMembers(newAesKey, rosterPks);
    const inner = SlxEciesMessagingAbi.removeChannelMember(channelId, targetMemberIdentityAddr, wrapsPacked);
    const { txHash, receipt } = await this._execViaIdentity(
      wallet,
      myIdentityAddr,
      mAddr,
      inner,
      details.members,
      'removeChannelMember'
    );
    const newKeyEpoch = details.currentKeyEpoch + 1;
    this._epochKeyCache.set(`${mAddr}:${channelId.toLowerCase()}:${newKeyEpoch}:${myIdentityAddr.toLowerCase()}`, newAesKey);
    return { txHash, receipt, newKeyEpoch };
  }

  async leaveChannel(wallet, myIdentityAddr, channelId, messagingAddr = '') {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(channelId, myIdentityAddr) },
      'latest',
    ]).catch(() => '0x');
    const details = decodeChannelDetailsHex(detailsHex);
    const inner = SlxEciesMessagingAbi.leaveChannel(channelId);
    return this._execViaIdentity(wallet, myIdentityAddr, mAddr, inner, details?.members || [], 'leaveChannel');
  }

  async sendTopicMessage(wallet, myIdentityAddr, { channelId, topicId = 0, text, messagingAddr = '' }) {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const cidLow = channelId.toLowerCase();
    const myLow = myIdentityAddr.toLowerCase();
    const privHex = extractPrivKey(wallet);

    const detailsHex = await slxNodeRpc(this.rpcUrl, 'eth_call', [
      { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(cidLow, myLow) },
      'latest',
    ]);
    const details = decodeChannelDetailsHex(detailsHex);
    if (!details || !details.isActiveMember) throw new Error('Not an active member of this ECIES channel');

    // If a member voluntarily left (`rekeyRequired == true`), atomically roll `keyEpoch++` AND post in 1 tx!
    if (details.rekeyRequired) {
      const rosterPks = await this.fetchRosterPubKeys(details.members);
      const freshAesKey = generateChannelAesKey256();
      const wrapsPacked = wrapChannelKeyForMembers(freshAesKey, rosterPks);
      const nextEpoch = details.currentKeyEpoch + 1;
      const aad = buildTopicMessageAad(mAddr, cidLow, topicId, nextEpoch, myLow);
      const ct = await encryptTopicMessageAesGcm(freshAesKey, text, aad);
      const inner = SlxEciesMessagingAbi.rotateAndPostTopicMessage(cidLow, topicId, wrapsPacked, ct);
      const { txHash, receipt } = await this._execViaIdentity(
        wallet,
        myLow,
        mAddr,
        inner,
        details.members,
        'rotateAndPostTopicMessage'
      );
      this._epochKeyCache.set(`${mAddr}:${cidLow}:${nextEpoch}:${myLow}`, freshAesKey);
      return { txHash, receipt, keyEpoch: nextEpoch, rotatedKeyAutomatically: true };
    }

    const ep = details.currentKeyEpoch;
    let aesKey = this._epochKeyCache.get(`${mAddr}:${cidLow}:${ep}:${myLow}`);
    if (!aesKey) {
      const wrapBytes = details.epochWraps.get(ep);
      if (!wrapBytes) throw new Error(`Missing wrapped AES key for epoch #${ep}`);
      const idEncKeys = await resolveIdentityEncryptionKeys(this.rpcUrl, privHex, myLow);
      aesKey = unwrapChannelKeyForEpoch(wrapBytes, idEncKeys.secpPrivHex);
      if (!aesKey) throw new Error(`Unable to unwrap channel AES key for epoch #${ep}`);
      this._epochKeyCache.set(`${mAddr}:${cidLow}:${ep}:${myLow}`, aesKey);
    }

    const aad = buildTopicMessageAad(mAddr, cidLow, topicId, ep, myLow);
    const ct = await encryptTopicMessageAesGcm(aesKey, text, aad);
    const inner = SlxEciesMessagingAbi.postTopicMessage(cidLow, topicId, ep, ct);
    const { txHash, receipt } = await this._execViaIdentity(wallet, myLow, mAddr, inner, [], 'postTopicMessage');
    return { txHash, receipt, keyEpoch: ep, rotatedKeyAutomatically: false };
  }

  async readDecryptedTopicMessages(wallet, myIdentityAddr, { channelId, topicId = 0, maxMessages = 40, messagingAddr = '' }) {
    const mAddr = (messagingAddr || this.defaultMessagingAddr).toLowerCase();
    const cidLow = channelId.toLowerCase();
    const myLow = myIdentityAddr.toLowerCase();
    const privHex = extractPrivKey(wallet);

    const [detailsHex, msgsHex, idEncKeys] = await Promise.all([
      slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: mAddr, data: SlxEciesMessagingAbi.getChannelDetails(cidLow, myLow) },
        'latest',
      ]),
      slxNodeRpc(this.rpcUrl, 'eth_call', [
        { to: mAddr, data: SlxEciesMessagingAbi.getTopicMessages(cidLow, topicId, maxMessages) },
        'latest',
      ]),
      privHex ? resolveIdentityEncryptionKeys(this.rpcUrl, privHex, myLow) : Promise.resolve(null),
    ]);

    const details = decodeChannelDetailsHex(detailsHex);
    const { totalCount, messages } = decodeTopicMessagesHex(msgsHex);
    if (!details) return { details: null, totalCount: 0, messages: [] };

    const decrypted = await Promise.all(
      messages.map(async (m) => {
        let plain = null;
        if (idEncKeys) {
          const cacheK = `${mAddr}:${cidLow}:${m.keyEpoch}:${myLow}`;
          let aesKey = this._epochKeyCache.get(cacheK);
          if (!aesKey) {
            const w = details.epochWraps.get(m.keyEpoch);
            if (w) {
              aesKey = unwrapChannelKeyForEpoch(w, idEncKeys.secpPrivHex);
              if (aesKey) this._epochKeyCache.set(cacheK, aesKey);
            }
          }
          if (aesKey) {
            const aad = buildTopicMessageAad(mAddr, cidLow, topicId, m.keyEpoch, m.author);
            plain = await decryptTopicMessageAesGcm(aesKey, m.ciphertextBytes, aad);
          }
        }
        return {
          ...m,
          decrypted: Boolean(plain),
          text: plain ? plain.text : '🔒 [ECIES Encrypted — Unauthorized Key Epoch]',
          ts: plain?.ts || 0,
        };
      })
    );

    return {
      details,
      totalCount,
      messages: decrypted,
    };
  }
}
