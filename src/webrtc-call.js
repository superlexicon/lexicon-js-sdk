/**
 * @superlexicon/sdk/webrtc
 *
 * Serverless WebRTC Voice, Video & Mesh Conference Client for `webrtc_signal.wasm` (HPS #28):
 *  - Deterministic `secp256k1` signaling key derivation & compressed point decompression (`parity`, `pubX`)
 *  - Gzip + `secp256k1` ECDH authenticated SDP/ICE envelope encryption (`sealRtcSignalEnvelope` / `openRtcSignalEnvelope`)
 *  - Zero-CA DTLS-SRTP `a=fingerprint:sha-256` extraction & on-chain `Identity` verification
 *  - Full ABI calldata builders & binary slice decoders for `webrtc_signal.wasm`
 *  - High-level `WebRtcSignalClient`, `SlxWebRtcPeerSession`, synthetic media fallback, ringtone synthesizer,
 *    and 1-click in-browser P2P loopback verifier.
 */

import {
  SECP256K1_P,
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Bytes,
  keccak256Hex,
  selectorHex,
  eventTopic,
  deriveKeypairInfo,
  signOrderedLexiconTx,
} from './crypto.js';
import {
  ZERO_ADDR,
  ZERO_BYTES32,
  encodeAbi,
  readU16BE,
  readU32BE,
  readU64BE,
  decodeUintWord,
  decodeAbiBytesHex,
} from './abi.js';
import {
  wrapSecretForRecipientSecp,
  unwrapSecretWithPrivKey,
} from './confidential.js';
import {
  getDefaultNodeWsUrl,
  SlxHfsCache,
  slxNodeRpc,
} from './rpc.js';
import { slxWaitForReceipt } from './events.js';
import { fetchRegisteredHfsByType } from './identity.js';

export const WEBRTC_SIGNAL_CODE_HASH =
  '0x98d13aeb1bc31f7b4a2e297b4026ef79238e0debad619cd81fea1be31e0574c5';

export const DEFAULT_SUBNET1_WEBRTC_HUB =
  '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';

export const RTC_AVAILABILITY = {
  OFFLINE: 0,
  ONLINE: 1,
  BUSY: 2,
  DND: 3,
};

export const RTC_AVAILABILITY_LABELS = {
  0: 'Offline',
  1: 'Online',
  2: 'In Call / Busy',
  3: 'Do Not Disturb',
};

export const RTC_MEDIA_KIND = {
  VOICE: 1,
  VIDEO: 2,
  SCREEN: 3,
};

export const RTC_MEDIA_LABELS = {
  1: 'Voice Call',
  2: 'HD Video Call',
  3: 'Screen Share',
};

export const RTC_CALL_STATUS = {
  RINGING: 1,
  ACTIVE: 2,
  DECLINED: 3,
  CANCELED: 4,
  ENDED: 5,
};

export const RTC_CALL_STATUS_LABELS = {
  1: 'Ringing',
  2: 'Connected (P2P)',
  3: 'Declined',
  4: 'Canceled',
  5: 'Ended',
};

export const RTC_ROOM_SIGNAL_TYPE = {
  OFFER: 1,
  ANSWER: 2,
  ICE_BATCH: 3,
  OFFER_WITH_ICE: 4,
  ANSWER_WITH_ICE: 5,
};

export const DEFAULT_RTC_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun.cloudflare.com:3478'] },
];

export const WEBRTC_EVENT_TOPICS = {
  WebRtcHubInitialized: eventTopic('WebRtcHubInitialized(address)'),
  RtcProfileUpdated: eventTopic('RtcProfileUpdated(address,uint64,bytes32)'),
  CallRinging: eventTopic('CallRinging(uint64,address,address,uint64)'),
  CallAnswered: eventTopic('CallAnswered(uint64,address,address)'),
  CallIceUpdated: eventTopic('CallIceUpdated(uint64,address,uint64)'),
  CallMediaUpdated: eventTopic('CallMediaUpdated(uint64,address,uint64,uint64,uint64)'),
  CallEnded: eventTopic('CallEnded(uint64,address,uint64,uint64)'),
  RoomCreated: eventTopic('RoomCreated(uint64,address,uint64)'),
  RoomPeerJoined: eventTopic('RoomPeerJoined(uint64,address,uint64)'),
  RoomPeerLeft: eventTopic('RoomPeerLeft(uint64,address,uint64)'),
  RoomSignalPosted: eventTopic('RoomSignalPosted(uint64,address,address)'),
};

const ENVELOPE_TAG_RAW_UTF8 = 0x00;
const ENVELOPE_TAG_GZIP_PLAIN = 0x01;
const ENVELOPE_TAG_GZIP_ECDH = 0x02;
const ENVELOPE_TAG_RAW_ECDH = 0x03;
const RTC_WRAP_CONTEXT = 'SLX_WEBRTC_SIG_V1';

const PEER_REC_HDR = 70;
const CALL_META_LEN = 148;
const ROOM_HDR_LEN = 50;
const ROOM_PEER_ENTRY_LEN = 60;

// ============================================================================
// 1. secp256k1 Signaling Key Derivation & Compressed Point Decompression
// ============================================================================

function modPow(base, exp, modVal) {
  let result = 1n;
  let b = ((base % modVal) + modVal) % modVal;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modVal;
    b = (b * b) % modVal;
    e >>= 1n;
  }
  return result;
}

/**
 * Decompresses `(parity: 2|3, pubXHex: bytes32)` on `secp256k1` into a 64-byte `X || Y` Uint8Array.
 * Returns `null` if `pubXHex` is zero or invalid.
 */
export function decompressSecp256k1PubKey64(parity, pubXHex) {
  if (!pubXHex || pubXHex === ZERO_BYTES32) return null;
  try {
    const xBytes = pubXHex instanceof Uint8Array ? pubXHex : hexToBytes(pubXHex);
    if (xBytes.length !== 32) return null;
    let isZero = true;
    for (let i = 0; i < 32; i++) {
      if (xBytes[i] !== 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) return null;

    const x = BigInt(bytesToHex(xBytes, true));
    if (x <= 0n || x >= SECP256K1_P) return null;
    const rhs = (modPow(x, 3n, SECP256K1_P) + 7n) % SECP256K1_P;
    let y = modPow(rhs, (SECP256K1_P + 1n) / 4n, SECP256K1_P);
    if ((y * y) % SECP256K1_P !== rhs) return null;

    const wantOdd = (Number(parity) & 1) === 1;
    const isOdd = (y & 1n) === 1n;
    if (wantOdd !== isOdd) {
      y = SECP256K1_P - y;
    }
    const yBytes = hexToBytes('0x' + y.toString(16).padStart(64, '0'));
    return concatBytes(xBytes, yBytes);
  } catch {
    return null;
  }
}

/**
 * Decompresses a 33-byte compressed hex key (`0x02...` or `0x03...`) into 64-byte `X || Y`.
 */
export function decompressSecp256k1Compressed33(compressedHex) {
  if (!compressedHex) return null;
  try {
    const raw = compressedHex instanceof Uint8Array ? compressedHex : hexToBytes(compressedHex);
    if (raw.length === 64) return raw;
    if (raw.length === 65 && raw[0] === 0x04) return raw.slice(1, 65);
    if (raw.length !== 33 || (raw[0] !== 0x02 && raw[0] !== 0x03)) return null;
    return decompressSecp256k1PubKey64(raw[0], raw.slice(1, 33));
  } catch {
    return null;
  }
}

/**
 * Derives a dedicated domain-separated `secp256k1` signaling encryption keypair from a wallet's
 * master private key so ECDH call signaling never reuses the raw transaction-signing scalar.
 */
export function deriveRtcSignalingKeys(walletPrivateKeyHex, identityAddr = ZERO_ADDR) {
  const seed = keccak256Bytes(
    concatBytes(
      utf8ToBytes('SLX_RTC_SIGNAL_KEY_V1:'),
      hexToBytes(walletPrivateKeyHex),
      hexToBytes(String(identityAddr || ZERO_ADDR).toLowerCase())
    )
  );
  const signalPrivHex = bytesToHex(seed, true);
  const info = deriveKeypairInfo(signalPrivHex);
  const compBytes = hexToBytes(info.compressedPubKey);
  const parity = compBytes[0]; // 2 or 3
  const pubXHex = bytesToHex(compBytes.slice(1, 33), true);
  const uncompressedPub64 = hexToBytes(info.uncompressedPubKey).slice(1, 65);
  return {
    signalPrivHex,
    compressedPubKey: info.compressedPubKey,
    parity,
    pubXHex,
    uncompressedPub64,
  };
}

// ============================================================================
// 2. Zero-CA DTLS-SRTP Fingerprint Pinning & Gzip + ECDH Signal Envelopes
// ============================================================================

/**
 * Extracts the 32-byte `a=fingerprint:sha-256` digest from an SDP offer/answer as `0x` bytes32 hex.
 */
export function extractSdpSha256Fingerprint(sdp) {
  const text = String(sdp || '');
  const match = text.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]{95})/i);
  if (!match) return ZERO_BYTES32;
  const cleanHex = match[1].replace(/:/g, '').toLowerCase();
  return cleanHex.length === 64 ? '0x' + cleanHex : ZERO_BYTES32;
}

/**
 * Verifies that a remote WebRTC SDP's DTLS-SRTP `sha-256` certificate fingerprint matches the
 * 32-byte fingerprint authenticated on-chain by the peer's `Identity` HFS.
 */
export function verifyRemoteSdpDtlsFingerprint(remoteSdp, expectedFpHex) {
  const extractedFp = extractSdpSha256Fingerprint(remoteSdp);
  const expectedFp = String(expectedFpHex || ZERO_BYTES32).toLowerCase();
  if (!expectedFp || expectedFp === ZERO_BYTES32) {
    return { verified: false, extractedFp, expectedFp, reason: 'Missing on-chain DTLS fingerprint' };
  }
  if (extractedFp === ZERO_BYTES32) {
    return { verified: false, extractedFp, expectedFp, reason: 'SDP missing sha-256 fingerprint' };
  }
  const verified = extractedFp === expectedFp;
  return {
    verified,
    extractedFp,
    expectedFp,
    reason: verified ? 'DTLS-SRTP certificate matches on-chain Identity HFS' : 'DTLS FINGERPRINT MISMATCH (MITM BLOCKED)',
  };
}

/**
 * Normalizes SDP line endings to strict RFC 8866 `\r\n` without mutating media semantics.
 */
export function normalizeSdp(sdp) {
  const lines = String(sdp || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}

async function gzipBytesIfSupported(rawBytes) {
  if (typeof globalThis.CompressionStream !== 'function') {
    return { bytes: rawBytes, gzipped: false };
  }
  try {
    const cs = new globalThis.CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    await writer.write(rawBytes);
    await writer.close();
    const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    return { bytes: compressed, gzipped: true };
  } catch {
    return { bytes: rawBytes, gzipped: false };
  }
}

async function gunzipBytesIfNeeded(compBytes) {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('Browser DecompressionStream("gzip") unavailable');
  }
  const ds = new globalThis.DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  await writer.write(compBytes);
  await writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/**
 * Compresses a WebRTC signaling payload (`{ v, type, sdp, candidates, senderPub33, ts }`) with Gzip
 * and optionally encrypts it via `secp256k1` ECDH + Keccak-CTR + 16-byte MAC for `recipientPub64`.
 */
export async function sealRtcSignalEnvelope(payloadObj, { recipientPub64 = null } = {}) {
  const jsonStr = JSON.stringify(payloadObj);
  const rawUtf8 = utf8ToBytes(jsonStr);
  const { bytes: bodyBytes, gzipped } = await gzipBytesIfSupported(rawUtf8);

  let peer64 = null;
  if (recipientPub64) {
    peer64 =
      recipientPub64 instanceof Uint8Array && recipientPub64.length === 64
        ? recipientPub64
        : decompressSecp256k1Compressed33(recipientPub64);
  }

  let outBytes;
  let encrypted = false;
  if (peer64 && peer64.length === 64) {
    const wrapped = wrapSecretForRecipientSecp(bodyBytes, peer64, RTC_WRAP_CONTEXT);
    const tag = gzipped ? ENVELOPE_TAG_GZIP_ECDH : ENVELOPE_TAG_RAW_ECDH;
    outBytes = concatBytes(new Uint8Array([tag]), wrapped);
    encrypted = true;
  } else {
    const tag = gzipped ? ENVELOPE_TAG_GZIP_PLAIN : ENVELOPE_TAG_RAW_UTF8;
    outBytes = concatBytes(new Uint8Array([tag]), bodyBytes);
  }

  return {
    bytes: outBytes,
    hex: bytesToHex(outBytes, true),
    rawJsonBytes: rawUtf8.length,
    wireBytes: outBytes.length,
    encrypted,
    gzipped,
  };
}

/**
 * Opens & authenticates a signaling envelope produced by `sealRtcSignalEnvelope`.
 */
export async function openRtcSignalEnvelope(envelopeInput, { signalPrivHex = null } = {}) {
  if (!envelopeInput) return null;
  const env = envelopeInput instanceof Uint8Array ? envelopeInput : hexToBytes(envelopeInput);
  if (!env.length) return null;

  const tag = env[0];
  const rest = env.subarray(1);

  if (tag === ENVELOPE_TAG_GZIP_ECDH || tag === ENVELOPE_TAG_RAW_ECDH) {
    if (!signalPrivHex) {
      return { payload: null, encrypted: true, locked: true, wireBytes: env.length };
    }
    const unwrapped = unwrapSecretWithPrivKey(rest, signalPrivHex, RTC_WRAP_CONTEXT);
    if (!unwrapped) {
      return { payload: null, encrypted: true, locked: true, wireBytes: env.length };
    }
    const utf8 = tag === ENVELOPE_TAG_GZIP_ECDH ? await gunzipBytesIfNeeded(unwrapped) : unwrapped;
    return {
      payload: JSON.parse(bytesToUtf8(utf8)),
      encrypted: true,
      locked: false,
      wireBytes: env.length,
    };
  }

  if (tag === ENVELOPE_TAG_GZIP_PLAIN) {
    const utf8 = await gunzipBytesIfNeeded(rest);
    return {
      payload: JSON.parse(bytesToUtf8(utf8)),
      encrypted: false,
      locked: false,
      wireBytes: env.length,
    };
  }

  if (tag === ENVELOPE_TAG_RAW_UTF8) {
    return {
      payload: JSON.parse(bytesToUtf8(rest)),
      encrypted: false,
      locked: false,
      wireBytes: env.length,
    };
  }

  // Fallback raw JSON if untagged
  if (tag === 0x7b) {
    return {
      payload: JSON.parse(bytesToUtf8(env)),
      encrypted: false,
      locked: false,
      wireBytes: env.length,
    };
  }
  return null;
}

// ============================================================================
// 3. ABI Builders & Binary Decoders for `webrtc_signal.wasm`
// ============================================================================

export const WebRtcSignalAbi = {
  initialize(adminAddr) {
    return encodeAbi('initialize(address)', [['address', adminAddr]]);
  },
  abiVersion() {
    return selectorHex('abiVersion()');
  },
  getHubOverview() {
    return selectorHex('getHubOverview()');
  },
  registerRtcProfile(identity, secpPubX, parity, availability, displayLabel, stunHint = '') {
    return encodeAbi('registerRtcProfile(address,bytes32,uint64,uint64,string,string)', [
      ['address', identity],
      ['bytes32', secpPubX || ZERO_BYTES32],
      ['uint64', parity || 2],
      ['uint64', availability ?? RTC_AVAILABILITY.ONLINE],
      ['string', String(displayLabel || '').slice(0, 48)],
      ['string', String(stunHint || '').slice(0, 96)],
    ]);
  },
  heartbeatPresence(identity, availability) {
    return encodeAbi('heartbeatPresence(address,uint64)', [
      ['address', identity],
      ['uint64', availability ?? RTC_AVAILABILITY.ONLINE],
    ]);
  },
  getPeerProfile(identity) {
    return encodeAbi('getPeerProfile(address)', [['address', identity]]);
  },
  getDirectorySlice(start = 0, limit = 32) {
    return encodeAbi('getDirectorySlice(uint64,uint64)', [
      ['uint64', start],
      ['uint64', limit],
    ]);
  },
  placeCall(callerIdentity, calleeIdentity, mediaKind, callerDtlsFp, offerEnvelopeBytes) {
    return encodeAbi('placeCall(address,address,uint64,bytes32,bytes)', [
      ['address', callerIdentity],
      ['address', calleeIdentity],
      ['uint64', mediaKind || RTC_MEDIA_KIND.VIDEO],
      ['bytes32', callerDtlsFp],
      ['bytes', offerEnvelopeBytes],
    ]);
  },
  answerCall(callId, calleeIdentity, calleeDtlsFp, answerEnvelopeBytes) {
    return encodeAbi('answerCall(uint64,address,bytes32,bytes)', [
      ['uint64', callId],
      ['address', calleeIdentity],
      ['bytes32', calleeDtlsFp],
      ['bytes', answerEnvelopeBytes],
    ]);
  },
  appendIceBatch(callId, actorIdentity, iceEnvelopeBytes) {
    return encodeAbi('appendIceBatch(uint64,address,bytes)', [
      ['uint64', callId],
      ['address', actorIdentity],
      ['bytes', iceEnvelopeBytes],
    ]);
  },
  renegotiateMedia(callId, actorIdentity, mediaKind, isAnswer, sdpEnvelopeBytes) {
    return encodeAbi('renegotiateMedia(uint64,address,uint64,bool,bytes)', [
      ['uint64', callId],
      ['address', actorIdentity],
      ['uint64', mediaKind],
      ['bool', Boolean(isAnswer)],
      ['bytes', sdpEnvelopeBytes],
    ]);
  },
  endCall(callId, actorIdentity, reasonCode = 1) {
    return encodeAbi('endCall(uint64,address,uint64)', [
      ['uint64', callId],
      ['address', actorIdentity],
      ['uint64', reasonCode],
    ]);
  },
  getCallSession(callId) {
    return encodeAbi('getCallSession(uint64)', [['uint64', callId]]);
  },
  getRecentCallsForIdentity(identity) {
    return encodeAbi('getRecentCallsForIdentity(address)', [['address', identity]]);
  },
  createRoom(hostIdentity, title, mediaKind, e2eeRequired, hostDtlsFp) {
    return encodeAbi('createRoom(address,string,uint64,bool,bytes32)', [
      ['address', hostIdentity],
      ['string', String(title || '').slice(0, 64)],
      ['uint64', mediaKind || RTC_MEDIA_KIND.VIDEO],
      ['bool', Boolean(e2eeRequired)],
      ['bytes32', hostDtlsFp || ZERO_BYTES32],
    ]);
  },
  joinRoom(roomId, peerIdentity, dtlsFp) {
    return encodeAbi('joinRoom(uint64,address,bytes32)', [
      ['uint64', roomId],
      ['address', peerIdentity],
      ['bytes32', dtlsFp || ZERO_BYTES32],
    ]);
  },
  leaveRoom(roomId, peerIdentity) {
    return encodeAbi('leaveRoom(uint64,address)', [
      ['uint64', roomId],
      ['address', peerIdentity],
    ]);
  },
  postRoomSignal(roomId, fromIdentity, toIdentity, signalType, envelopeBytes) {
    return encodeAbi('postRoomSignal(uint64,address,address,uint64,bytes)', [
      ['uint64', roomId],
      ['address', fromIdentity],
      ['address', toIdentity],
      ['uint64', signalType],
      ['bytes', envelopeBytes],
    ]);
  },
  getRoomState(roomId) {
    return encodeAbi('getRoomState(uint64)', [['uint64', roomId]]);
  },
  getRoomsSlice(start = 0, limit = 24) {
    return encodeAbi('getRoomsSlice(uint64,uint64)', [
      ['uint64', start],
      ['uint64', limit],
    ]);
  },
  getPairSignal(roomId, fromIdentity, toIdentity) {
    return encodeAbi('getPairSignal(uint64,address,address)', [
      ['uint64', roomId],
      ['address', fromIdentity],
      ['address', toIdentity],
    ]);
  },
};

export function decodeHubOverviewHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < 48) {
    return {
      abiVersion: 1,
      totalProfiles: 0,
      totalCalls: 0,
      totalRooms: 0,
      currentBlock: 0,
      maxRoomPeers: 6,
    };
  }
  return {
    abiVersion: Number(readU64BE(b, 0)),
    totalProfiles: Number(readU64BE(b, 8)),
    totalCalls: Number(readU64BE(b, 16)),
    totalRooms: Number(readU64BE(b, 24)),
    currentBlock: Number(readU64BE(b, 32)),
    maxRoomPeers: Number(readU64BE(b, 40)),
  };
}

export function decodePeerProfileBytes(b, offset = 0) {
  if (!b || offset + PEER_REC_HDR > b.length) return null;
  const identity = bytesToHex(b.subarray(offset, offset + 20), true).toLowerCase();
  const secpPubX = bytesToHex(b.subarray(offset + 20, offset + 52), true).toLowerCase();
  const parity = b[offset + 52];
  const availability = b[offset + 53];
  const updatedBlock = Number(readU64BE(b, offset + 54));
  const totalCalls = readU32BE(b, offset + 62);
  const labelLen = readU16BE(b, offset + 66);
  const hintLen = readU16BE(b, offset + 68);
  const nextOffset = offset + PEER_REC_HDR + labelLen + hintLen;
  if (nextOffset > b.length) return null;

  const displayLabel = bytesToUtf8(b.subarray(offset + PEER_REC_HDR, offset + PEER_REC_HDR + labelLen));
  const stunHint = bytesToUtf8(
    b.subarray(offset + PEER_REC_HDR + labelLen, nextOffset)
  );
  const pub64 = decompressSecp256k1PubKey64(parity, secpPubX);
  const compressedPub33 =
    secpPubX !== ZERO_BYTES32
      ? '0x' + (parity === 3 ? '03' : '02') + secpPubX.slice(2)
      : null;

  return {
    record: {
      identity,
      secpPubX,
      parity,
      compressedPub33,
      pub64,
      hasE2eeKey: Boolean(pub64),
      availability,
      availabilityLabel: RTC_AVAILABILITY_LABELS[availability] || 'Offline',
      updatedBlock,
      totalCalls,
      displayLabel,
      stunHint,
    },
    nextOffset,
  };
}

export function decodePeerProfileHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < PEER_REC_HDR) return null;
  const parsed = decodePeerProfileBytes(b, 0);
  return parsed ? parsed.record : null;
}

export function decodeDirectorySliceHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < 16) return { total: 0, profiles: [] };
  const total = Number(readU64BE(b, 0));
  const count = Number(readU64BE(b, 8));
  const profiles = [];
  let pos = 16;
  for (let i = 0; i < count && pos < b.length; i++) {
    const parsed = decodePeerProfileBytes(b, pos);
    if (!parsed) break;
    profiles.push(parsed.record);
    pos = parsed.nextOffset;
  }
  return { total, profiles };
}

export function decodeCallMetaBytes(b, offset = 0) {
  if (!b || offset + CALL_META_LEN > b.length) return null;
  const callId = Number(readU64BE(b, offset));
  const caller = bytesToHex(b.subarray(offset + 8, offset + 28), true).toLowerCase();
  const callee = bytesToHex(b.subarray(offset + 28, offset + 48), true).toLowerCase();
  const status = b[offset + 48];
  const mediaKind = b[offset + 49];
  const endReason = b[offset + 50];
  const renegSide = b[offset + 51];
  const callerIceCount = readU16BE(b, offset + 52);
  const calleeIceCount = readU16BE(b, offset + 54);
  const renegSeq = readU16BE(b, offset + 56);
  const callerDtlsFp = bytesToHex(b.subarray(offset + 60, offset + 92), true).toLowerCase();
  const calleeDtlsFp = bytesToHex(b.subarray(offset + 92, offset + 124), true).toLowerCase();
  const createdBlock = Number(readU64BE(b, offset + 124));
  const answeredBlock = Number(readU64BE(b, offset + 132));
  const updatedBlock = Number(readU64BE(b, offset + 140));

  return {
    callId,
    caller,
    callee,
    status,
    statusLabel: RTC_CALL_STATUS_LABELS[status] || `Status ${status}`,
    mediaKind,
    mediaLabel: RTC_MEDIA_LABELS[mediaKind] || 'Voice/Video',
    endReason,
    renegSide,
    callerIceCount,
    calleeIceCount,
    renegSeq,
    callerDtlsFp,
    calleeDtlsFp,
    createdBlock,
    answeredBlock,
    updatedBlock,
  };
}

export function decodeCallSessionHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < CALL_META_LEN) return null;
  const meta = decodeCallMetaBytes(b, 0);
  if (!meta) return null;

  let pos = CALL_META_LEN;
  const readVarBlob = () => {
    if (pos + 2 > b.length) return new Uint8Array(0);
    const len = readU16BE(b, pos);
    pos += 2;
    const end = Math.min(b.length, pos + len);
    const slice = b.subarray(pos, end);
    pos = end;
    return slice;
  };

  const offerEnvelope = readVarBlob();
  const answerEnvelope = readVarBlob();
  const renegEnvelope = readVarBlob();
  const callerIceBatches = [];
  for (let i = 0; i < meta.callerIceCount; i++) {
    callerIceBatches.push(readVarBlob());
  }
  const calleeIceBatches = [];
  for (let i = 0; i < meta.calleeIceCount; i++) {
    calleeIceBatches.push(readVarBlob());
  }

  return {
    ...meta,
    offerEnvelope,
    answerEnvelope,
    renegEnvelope,
    callerIceBatches,
    calleeIceBatches,
  };
}

export function decodeRecentCallsHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < 8) return [];
  const count = Number(readU64BE(b, 0));
  const calls = [];
  let pos = 8;
  for (let i = 0; i < count && pos + CALL_META_LEN <= b.length; i++) {
    const meta = decodeCallMetaBytes(b, pos);
    if (meta) calls.push(meta);
    pos += CALL_META_LEN;
  }
  return calls;
}

export function decodeRoomStateBytes(b, offset = 0) {
  if (!b || offset + ROOM_HDR_LEN > b.length) return null;
  const roomId = Number(readU64BE(b, offset));
  const host = bytesToHex(b.subarray(offset + 8, offset + 28), true).toLowerCase();
  const status = b[offset + 28];
  const mediaKind = b[offset + 29];
  const e2eeRequired = b[offset + 30] === 1;
  const peerCount = b[offset + 31];
  const createdBlock = Number(readU64BE(b, offset + 32));
  const updatedBlock = Number(readU64BE(b, offset + 40));
  const titleLen = readU16BE(b, offset + 48);

  const peersStart = offset + ROOM_HDR_LEN + titleLen;
  const nextOffset = peersStart + peerCount * ROOM_PEER_ENTRY_LEN;
  if (nextOffset > b.length) return null;

  const title = bytesToUtf8(b.subarray(offset + ROOM_HDR_LEN, peersStart));
  const peers = [];
  let p = peersStart;
  for (let i = 0; i < peerCount; i++) {
    peers.push({
      identity: bytesToHex(b.subarray(p, p + 20), true).toLowerCase(),
      dtlsFp: bytesToHex(b.subarray(p + 20, p + 52), true).toLowerCase(),
      joinedBlock: Number(readU64BE(b, p + 52)),
    });
    p += ROOM_PEER_ENTRY_LEN;
  }

  return {
    record: {
      roomId,
      host,
      status,
      isOpen: status === 1,
      mediaKind,
      mediaLabel: RTC_MEDIA_LABELS[mediaKind] || 'Video Mesh',
      e2eeRequired,
      peerCount,
      createdBlock,
      updatedBlock,
      title,
      peers,
    },
    nextOffset,
  };
}

export function decodeRoomStateHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < ROOM_HDR_LEN) return null;
  const parsed = decodeRoomStateBytes(b, 0);
  return parsed ? parsed.record : null;
}

export function decodeRoomsSliceHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < 16) return { total: 0, rooms: [] };
  const total = Number(readU64BE(b, 0));
  const count = Number(readU64BE(b, 8));
  const rooms = [];
  let pos = 16;
  for (let i = 0; i < count && pos < b.length; i++) {
    const parsed = decodeRoomStateBytes(b, pos);
    if (!parsed) break;
    rooms.push(parsed.record);
    pos = parsed.nextOffset;
  }
  return { total, rooms };
}

export function decodePairSignalHex(retHex) {
  const b = decodeAbiBytesHex(retHex);
  if (!b || b.length < 19) return null;
  const seq = Number(readU64BE(b, 0));
  const signalType = b[8];
  const updatedBlock = Number(readU64BE(b, 9));
  const envLen = readU16BE(b, 17);
  const envelope = b.subarray(19, Math.min(b.length, 19 + envLen));
  return { seq, signalType, updatedBlock, envelope };
}

// ============================================================================
// 4. High-Level `WebRtcSignalClient`
// ============================================================================

export class WebRtcSignalClient {
  constructor({ rpcUrl = getDefaultNodeWsUrl(), hubAddr = '' } = {}) {
    this.rpcUrl = rpcUrl;
    this.hubAddr = hubAddr ? String(hubAddr).toLowerCase() : '';
  }

  setHubAddress(addr) {
    this.hubAddr = addr ? String(addr).toLowerCase() : '';
  }

  async resolveHubAddress({ forceRefresh = false } = {}) {
    if (this.hubAddr && !forceRefresh) return this.hubAddr;

    try {
      const { manifest } = await SlxHfsCache.hydrateWithManifest();
      if (manifest?.hfsRegistry) {
        const list = await fetchRegisteredHfsByType({
          rpcUrl: this.rpcUrl,
          registryAddr: manifest.hfsRegistry,
          typeName: 'WEBRTC_SIGNAL',
        });
        const active = list.find((it) => it.status === 1 && it.primaryAddr);
        if (active?.primaryAddr) {
          this.hubAddr = active.primaryAddr.toLowerCase();
          return this.hubAddr;
        }
      }
      if (manifest?.webrtcSignal?.contractAddr) {
        this.hubAddr = String(manifest.webrtcSignal.contractAddr).toLowerCase();
        return this.hubAddr;
      }
    } catch {
      // fall through to Subnet 1 default
    }

    this.hubAddr = DEFAULT_SUBNET1_WEBRTC_HUB;
    return this.hubAddr;
  }

  async _ethCall(dataHex) {
    const to = await this.resolveHubAddress();
    return slxNodeRpc(this.rpcUrl, 'eth_call', [{ to, data: dataHex }, 'latest']);
  }

  async _sendHubTx({ wallet, identityAddr, dataHex, gasLimit = 5_200_000n }) {
    const to = await this.resolveHubAddress();
    const eoa = wallet.keypair.address;
    const priv = wallet.keypair.privateKey;
    const nonceHex = await slxNodeRpc(this.rpcUrl, 'eth_getTransactionCount', [eoa, 'latest']);
    const nonce = BigInt(nonceHex);
    const extraTargets = [to];
    if (identityAddr && identityAddr.toLowerCase() !== eoa.toLowerCase()) {
      extraTargets.push(identityAddr.toLowerCase());
    }
    const signed = signOrderedLexiconTx({
      privateKey: priv,
      nonce,
      to,
      data: dataHex,
      gasLimit: BigInt(gasLimit),
      extraTargets,
    });
    const txHash = await slxNodeRpc(this.rpcUrl, 'eth_sendRawTransaction', [signed.raw]);
    const receipt = await slxWaitForReceipt((m, p) => slxNodeRpc(this.rpcUrl, m, p), txHash, {
      timeoutMs: 45_000,
      fallbackPollMs: 750,
    });
    if (!receipt || receipt.status !== '0x1') {
      throw new Error(`WebRTC HFS transaction reverted (${String(txHash).slice(0, 10)}…)`);
    }
    return { txHash, receipt };
  }

  async getOverview() {
    const hex = await this._ethCall(WebRtcSignalAbi.getHubOverview());
    return decodeHubOverviewHex(hex);
  }

  async getPeerProfile(identityAddr) {
    const hex = await this._ethCall(WebRtcSignalAbi.getPeerProfile(identityAddr));
    return decodePeerProfileHex(hex);
  }

  async getDirectory(start = 0, limit = 32) {
    const hex = await this._ethCall(WebRtcSignalAbi.getDirectorySlice(start, limit));
    return decodeDirectorySliceHex(hex);
  }

  async getCallSession(callId) {
    const hex = await this._ethCall(WebRtcSignalAbi.getCallSession(callId));
    return decodeCallSessionHex(hex);
  }

  async getRecentCalls(identityAddr) {
    const hex = await this._ethCall(WebRtcSignalAbi.getRecentCallsForIdentity(identityAddr));
    return decodeRecentCallsHex(hex);
  }

  async getRooms(start = 0, limit = 24) {
    const hex = await this._ethCall(WebRtcSignalAbi.getRoomsSlice(start, limit));
    return decodeRoomsSliceHex(hex);
  }

  async getRoomState(roomId) {
    const hex = await this._ethCall(WebRtcSignalAbi.getRoomState(roomId));
    return decodeRoomStateHex(hex);
  }

  async getPairSignal(roomId, fromIdentity, toIdentity) {
    const hex = await this._ethCall(WebRtcSignalAbi.getPairSignal(roomId, fromIdentity, toIdentity));
    return decodePairSignalHex(hex);
  }

  async registerProfile({
    wallet,
    identityAddr,
    availability = RTC_AVAILABILITY.ONLINE,
    displayLabel = '',
    stunHint = 'LAN + Public STUN',
  }) {
    const sigKeys = deriveRtcSignalingKeys(wallet.keypair.privateKey, identityAddr);
    const cd = WebRtcSignalAbi.registerRtcProfile(
      identityAddr,
      sigKeys.pubXHex,
      sigKeys.parity,
      availability,
      displayLabel,
      stunHint
    );
    const res = await this._sendHubTx({ wallet, identityAddr, dataHex: cd });
    return { ...res, sigKeys };
  }

  async heartbeat({ wallet, identityAddr, availability = RTC_AVAILABILITY.ONLINE }) {
    const cd = WebRtcSignalAbi.heartbeatPresence(identityAddr, availability);
    return this._sendHubTx({ wallet, identityAddr, dataHex: cd });
  }

  async placeCall({
    wallet,
    callerIdentity,
    calleeIdentity,
    mediaKind = RTC_MEDIA_KIND.VIDEO,
    callerDtlsFp,
    offerEnvelopeBytes,
  }) {
    const cd = WebRtcSignalAbi.placeCall(
      callerIdentity,
      calleeIdentity,
      mediaKind,
      callerDtlsFp,
      offerEnvelopeBytes
    );
    const { txHash, receipt } = await this._sendHubTx({
      wallet,
      identityAddr: callerIdentity,
      dataHex: cd,
      gasLimit: 6_200_000n,
    });

    let callId = 0;
    for (const log of receipt.logs || []) {
      const t0 = String(log.topics?.[0] || '').toLowerCase();
      if (t0 === WEBRTC_EVENT_TOPICS.CallRinging && log.topics?.[1]) {
        callId = Number(decodeUintWord(log.topics[1]));
        break;
      }
    }
    if (!callId) {
      const recent = await this.getRecentCalls(callerIdentity);
      callId = recent[0]?.callId || 0;
    }
    return { callId, txHash, receipt };
  }

  async answerCall({ wallet, callId, calleeIdentity, calleeDtlsFp, answerEnvelopeBytes }) {
    const cd = WebRtcSignalAbi.answerCall(callId, calleeIdentity, calleeDtlsFp, answerEnvelopeBytes);
    return this._sendHubTx({
      wallet,
      identityAddr: calleeIdentity,
      dataHex: cd,
      gasLimit: 6_000_000n,
    });
  }

  async appendIceBatch({ wallet, callId, actorIdentity, iceEnvelopeBytes }) {
    const cd = WebRtcSignalAbi.appendIceBatch(callId, actorIdentity, iceEnvelopeBytes);
    return this._sendHubTx({
      wallet,
      identityAddr: actorIdentity,
      dataHex: cd,
      gasLimit: 4_800_000n,
    });
  }

  async renegotiateMedia({ wallet, callId, actorIdentity, mediaKind, isAnswer, sdpEnvelopeBytes }) {
    const cd = WebRtcSignalAbi.renegotiateMedia(
      callId,
      actorIdentity,
      mediaKind,
      isAnswer,
      sdpEnvelopeBytes
    );
    return this._sendHubTx({
      wallet,
      identityAddr: actorIdentity,
      dataHex: cd,
      gasLimit: 6_000_000n,
    });
  }

  async endCall({ wallet, callId, actorIdentity, reasonCode = 1 }) {
    const cd = WebRtcSignalAbi.endCall(callId, actorIdentity, reasonCode);
    return this._sendHubTx({ wallet, identityAddr: actorIdentity, dataHex: cd });
  }

  async createRoom({
    wallet,
    hostIdentity,
    title,
    mediaKind = RTC_MEDIA_KIND.VIDEO,
    e2eeRequired = true,
    hostDtlsFp = ZERO_BYTES32,
  }) {
    const cd = WebRtcSignalAbi.createRoom(hostIdentity, title, mediaKind, e2eeRequired, hostDtlsFp);
    const { txHash, receipt } = await this._sendHubTx({
      wallet,
      identityAddr: hostIdentity,
      dataHex: cd,
    });
    let roomId = 0;
    for (const log of receipt.logs || []) {
      const t0 = String(log.topics?.[0] || '').toLowerCase();
      if (t0 === WEBRTC_EVENT_TOPICS.RoomCreated && log.topics?.[1]) {
        roomId = Number(decodeUintWord(log.topics[1]));
        break;
      }
    }
    return { roomId, txHash, receipt };
  }

  async joinRoom({ wallet, roomId, peerIdentity, dtlsFp = ZERO_BYTES32 }) {
    const cd = WebRtcSignalAbi.joinRoom(roomId, peerIdentity, dtlsFp);
    return this._sendHubTx({ wallet, identityAddr: peerIdentity, dataHex: cd });
  }

  async leaveRoom({ wallet, roomId, peerIdentity }) {
    const cd = WebRtcSignalAbi.leaveRoom(roomId, peerIdentity);
    return this._sendHubTx({ wallet, identityAddr: peerIdentity, dataHex: cd });
  }

  async postRoomSignal({ wallet, roomId, fromIdentity, toIdentity, signalType, envelopeBytes }) {
    const cd = WebRtcSignalAbi.postRoomSignal(
      roomId,
      fromIdentity,
      toIdentity,
      signalType,
      envelopeBytes
    );
    return this._sendHubTx({
      wallet,
      identityAddr: fromIdentity,
      dataHex: cd,
      gasLimit: 6_000_000n,
    });
  }
}

// ============================================================================
// 5. Browser Media Acquisition, Synthetic Test Stream & Ringtone Synthesizer
// ============================================================================

/**
 * Generates an animated `<canvas>` + gentle WebAudio harmonic stream so camera-less desktops,
 * VMs, or 2-tab solo testers can place & verify live WebRTC video/voice calls immediately.
 */
export function createSyntheticTestMediaStream({
  label = 'EtherCall Sim',
  includeVideo = true,
  includeAudio = true,
} = {}) {
  const tracks = [];
  let cleanupVideo = () => {};
  let cleanupAudio = () => {};

  if (includeVideo && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const timer = setInterval(() => {
      frame += 1;
      const t = frame * 0.05;
      const grad = ctx.createLinearGradient(0, 0, 640, 360);
      grad.addColorStop(0, '#050d1e');
      grad.addColorStop(0.5, '#0b1e3b');
      grad.addColorStop(1, '#071526');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 360);

      // Animated RF radar rings
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1.5;
      for (let r = 36; r <= 150; r += 38) {
        ctx.beginPath();
        ctx.arc(320, 170, r + Math.sin(t + r * 0.03) * 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Live sine waveform
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 60; x <= 580; x += 6) {
        const y =
          170 +
          Math.sin(x * 0.03 + t * 2.4) * 28 * Math.cos(t * 0.7) +
          Math.cos(x * 0.07 - t * 1.6) * 12;
        if (x === 60) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 18px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`📡 ${label}`, 26, 38);
      ctx.fillStyle = '#6ee7b7';
      ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(`HFS DTLS-SRTP P2P STREAM • FRAME #${frame}`, 26, 334);
    }, 42);

    const vStream = canvas.captureStream(24);
    for (const tr of vStream.getVideoTracks()) tracks.push(tr);
    cleanupVideo = () => {
      clearInterval(timer);
      for (const tr of vStream.getTracks()) tr.stop();
    };
  }

  if (includeAudio && typeof window !== 'undefined') {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        const actx = new AudioCtx();
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        const dest = actx.createMediaStreamDestination();
        osc.type = 'sine';
        osc.frequency.value = 432;
        // Very quiet pulsed carrier so audio level meters move without startling speakers
        gain.gain.value = 0.015;
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        for (const tr of dest.stream.getAudioTracks()) tracks.push(tr);
        cleanupAudio = () => {
          try {
            osc.stop();
            actx.close();
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore audio context restrictions
      }
    }
  }

  const stream = new MediaStream(tracks);
  stream._slxSyntheticCleanup = () => {
    cleanupVideo();
    cleanupAudio();
  };
  stream._slxIsSynthetic = true;
  return stream;
}

export async function acquireCallMediaStream({
  mediaKind = RTC_MEDIA_KIND.VIDEO,
  audioDeviceId = '',
  videoDeviceId = '',
  forceSynthetic = false,
  syntheticLabel = 'EtherCall Test Feed',
} = {}) {
  if (forceSynthetic) {
    return {
      stream: createSyntheticTestMediaStream({
        label: syntheticLabel,
        includeVideo: mediaKind !== RTC_MEDIA_KIND.VOICE,
        includeAudio: true,
      }),
      isSynthetic: true,
    };
  }

  if (mediaKind === RTC_MEDIA_KIND.SCREEN && navigator.mediaDevices?.getDisplayMedia) {
    const dispStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 24, max: 30 } },
      audio: true,
    });
    if (dispStream.getAudioTracks().length === 0 && navigator.mediaDevices?.getUserMedia) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
          },
          video: false,
        });
        for (const t of mic.getAudioTracks()) dispStream.addTrack(t);
      } catch {
        // screen-only is fine
      }
    }
    return { stream: dispStream, isSynthetic: false };
  }

  const wantVideo = mediaKind !== RTC_MEDIA_KIND.VOICE;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
      },
      video: wantVideo
        ? {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 24, max: 30 },
            ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
          }
        : false,
    });
    return { stream, isSynthetic: false };
  } catch (err) {
    // Graceful fallback if only camera is missing or running headless
    if (wantVideo && navigator.mediaDevices?.getUserMedia) {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const synth = createSyntheticTestMediaStream({
          label: syntheticLabel,
          includeVideo: true,
          includeAudio: false,
        });
        for (const vt of synth.getVideoTracks()) audioOnly.addTrack(vt);
        audioOnly._slxSyntheticCleanup = synth._slxSyntheticCleanup;
        return { stream: audioOnly, isSynthetic: true, fallbackReason: err?.message || 'No camera' };
      } catch {
        // fall through to full synthetic
      }
    }
    return {
      stream: createSyntheticTestMediaStream({
        label: syntheticLabel,
        includeVideo: wantVideo,
        includeAudio: true,
      }),
      isSynthetic: true,
      fallbackReason: err?.message || 'Hardware mic/camera unavailable',
    };
  }
}

export function stopCallMediaStream(stream) {
  if (!stream) return;
  try {
    if (typeof stream._slxSyntheticCleanup === 'function') {
      stream._slxSyntheticCleanup();
    }
    for (const tr of stream.getTracks?.() || []) {
      tr.stop();
    }
  } catch {
    // ignore
  }
}

/**
 * WebAudio incoming-call ringtone controller (zero external `.mp3` dependencies).
 */
export function createCallRingtoneController() {
  let timer = null;
  let actx = null;

  const pulse = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!actx) actx = new AudioCtx();
      const now = actx.currentTime;
      for (const [offset, freq] of [
        [0, 587.33],
        [0.18, 880.0],
      ]) {
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + offset);
        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.06, now + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.26);
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.28);
      }
    } catch {
      // autoplay blocked until user gesture
    }
  };

  return {
    start() {
      if (timer) return;
      pulse();
      timer = setInterval(pulse, 2200);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// ============================================================================
// 6. `SlxWebRtcPeerSession` — Reusable RTCPeerConnection + DataChannel Wrapper
// ============================================================================

export class SlxWebRtcPeerSession {
  constructor({
    iceServers = DEFAULT_RTC_ICE_SERVERS,
    localStream = null,
    isInitiator = false,
    onRemoteStream = null,
    onTrickleCandidates = null,
    onConnectionState = null,
    onDataMessage = null,
    onDataChannelOpen = null,
  } = {}) {
    this.pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 4,
    });
    this.localStream = localStream;
    this.remoteStream = new MediaStream();
    this.isInitiator = isInitiator;
    this.dataChannel = null;
    this.initialCandidates = [];
    this.trickleBuffer = [];
    this._trickleFlushTimer = null;
    this._initialDone = false;
    this._appliedCandidateKeys = new Set();
    this._pendingRemoteCandidates = [];

    if (localStream) {
      for (const track of localStream.getTracks()) {
        this.pc.addTrack(track, localStream);
      }
    }

    this.pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        for (const tr of ev.streams[0].getTracks()) {
          this.remoteStream.addTrack(tr);
        }
      } else if (ev.track) {
        this.remoteStream.addTrack(ev.track);
      }
      onRemoteStream?.(this.remoteStream);
    };

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const candObj = {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex,
      };
      if (!this._initialDone) {
        this.initialCandidates.push(candObj);
      } else {
        this.trickleBuffer.push(candObj);
        if (!this._trickleFlushTimer && onTrickleCandidates) {
          this._trickleFlushTimer = setTimeout(() => {
            this._trickleFlushTimer = null;
            if (this.trickleBuffer.length > 0) {
              const batch = this.trickleBuffer.splice(0, this.trickleBuffer.length);
              onTrickleCandidates(batch);
            }
          }, 950);
        }
      }
    };

    const emitConnState = () => {
      onConnectionState?.({
        connectionState: this.pc.connectionState,
        iceConnectionState: this.pc.iceConnectionState,
        signalingState: this.pc.signalingState,
      });
    };
    this.pc.onconnectionstatechange = emitConnState;
    this.pc.oniceconnectionstatechange = emitConnState;

    const bindChannel = (ch) => {
      this.dataChannel = ch;
      ch.onopen = () => onDataChannelOpen?.(ch);
      ch.onmessage = (e) => {
        try {
          onDataMessage?.(JSON.parse(e.data));
        } catch {
          onDataMessage?.({ text: String(e.data), ts: Date.now() });
        }
      };
    };

    if (isInitiator) {
      bindChannel(this.pc.createDataChannel('slx-ether-call', { ordered: true }));
    } else {
      this.pc.ondatachannel = (ev) => {
        if (ev.channel) bindChannel(ev.channel);
      };
    }
  }

  async _waitInitialIce(timeoutMs = 950) {
    if (this.pc.iceGatheringState === 'complete') {
      this._initialDone = true;
      return;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this._initialDone = true;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          this.pc.removeEventListener('icegatheringstatechange', check);
          finish();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', check);
    });
  }

  async createBundledOffer({ iceWaitMs = 950 } = {}) {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc.setLocalDescription(offer);
    await this._waitInitialIce(iceWaitMs);
    const localSdp = normalizeSdp(this.pc.localDescription?.sdp || offer.sdp);
    const dtlsFp = extractSdpSha256Fingerprint(localSdp);
    return {
      sdp: localSdp,
      dtlsFp,
      candidates: [...this.initialCandidates],
    };
  }

  async acceptOfferAndCreateBundledAnswer(
    remoteOfferPayload,
    expectedCallerDtlsFp,
    { iceWaitMs = 950 } = {}
  ) {
    const normSdp = normalizeSdp(remoteOfferPayload.sdp);
    const fpCheck = verifyRemoteSdpDtlsFingerprint(normSdp, expectedCallerDtlsFp);
    if (!fpCheck.verified) {
      throw new Error(fpCheck.reason);
    }
    await this.pc.setRemoteDescription({ type: 'offer', sdp: normSdp });
    await this.applyRemoteCandidates(remoteOfferPayload.candidates || []);

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._waitInitialIce(iceWaitMs);
    const localSdp = normalizeSdp(this.pc.localDescription?.sdp || answer.sdp);
    const dtlsFp = extractSdpSha256Fingerprint(localSdp);
    return {
      sdp: localSdp,
      dtlsFp,
      candidates: [...this.initialCandidates],
      peerDtlsCheck: fpCheck,
    };
  }

  async applyBundledAnswer(remoteAnswerPayload, expectedCalleeDtlsFp) {
    const normSdp = normalizeSdp(remoteAnswerPayload.sdp);
    const fpCheck = verifyRemoteSdpDtlsFingerprint(normSdp, expectedCalleeDtlsFp);
    if (!fpCheck.verified) {
      throw new Error(fpCheck.reason);
    }
    if (this.pc.signalingState === 'have-local-offer') {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: normSdp });
    }
    await this.applyRemoteCandidates(remoteAnswerPayload.candidates || []);
    return fpCheck;
  }

  async applyRemoteCandidates(candidates = []) {
    for (const c of candidates) {
      if (!c || !c.candidate) continue;
      const key = `${c.sdpMid ?? ''}:${c.sdpMLineIndex ?? 0}:${c.candidate}`;
      if (this._appliedCandidateKeys.has(key)) continue;
      this._appliedCandidateKeys.add(key);
      if (!this.pc.remoteDescription) {
        this._pendingRemoteCandidates.push(c);
        continue;
      }
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // ignore duplicate or stale candidate
      }
    }
    if (this.pc.remoteDescription && this._pendingRemoteCandidates.length > 0) {
      const pending = this._pendingRemoteCandidates.splice(0, this._pendingRemoteCandidates.length);
      for (const p of pending) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(p));
        } catch {
          // ignore
        }
      }
    }
  }

  async replaceVideoTrack(newVideoTrack) {
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newVideoTrack);
      return true;
    }
    return false;
  }

  sendChatMessage(text, senderLabel = '') {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return false;
    }
    const msg = { text: String(text || ''), sender: senderLabel, ts: Date.now() };
    this.dataChannel.send(JSON.stringify(msg));
    return true;
  }

  flushPendingTrickleCandidates() {
    if (this._trickleFlushTimer) {
      clearTimeout(this._trickleFlushTimer);
      this._trickleFlushTimer = null;
    }
    return this.trickleBuffer.splice(0, this.trickleBuffer.length);
  }

  async pollStats() {
    try {
      const report = await this.pc.getStats();
      let rttMs = null;
      let bytesSent = 0;
      let bytesReceived = 0;
      let localCandidateId = null;
      let remoteCandidateId = null;
      const candidates = new Map();

      report.forEach((stat) => {
        if (stat.type === 'local-candidate' || stat.type === 'remote-candidate') {
          candidates.set(stat.id, stat);
        }
        if (stat.type === 'candidate-pair' && (stat.state === 'succeeded' || stat.nominated)) {
          if (typeof stat.currentRoundTripTime === 'number') {
            rttMs = Math.round(stat.currentRoundTripTime * 1000);
          }
          bytesSent = Math.max(bytesSent, stat.bytesSent || 0);
          bytesReceived = Math.max(bytesReceived, stat.bytesReceived || 0);
          localCandidateId = stat.localCandidateId;
          remoteCandidateId = stat.remoteCandidateId;
        }
        if (stat.type === 'outbound-rtp' && typeof stat.bytesSent === 'number') {
          bytesSent = Math.max(bytesSent, stat.bytesSent);
        }
        if (stat.type === 'inbound-rtp' && typeof stat.bytesReceived === 'number') {
          bytesReceived = Math.max(bytesReceived, stat.bytesReceived);
        }
      });

      const localCand = localCandidateId ? candidates.get(localCandidateId) : null;
      const remoteCand = remoteCandidateId ? candidates.get(remoteCandidateId) : null;
      return {
        connectionState: this.pc.connectionState,
        iceConnectionState: this.pc.iceConnectionState,
        rttMs,
        bytesSent,
        bytesReceived,
        localCandidateType: localCand?.candidateType || 'host/stun',
        remoteCandidateType: remoteCand?.candidateType || 'host/stun',
        protocol: localCand?.protocol || 'udp',
      };
    } catch {
      return {
        connectionState: this.pc.connectionState,
        iceConnectionState: this.pc.iceConnectionState,
        rttMs: null,
        bytesSent: 0,
        bytesReceived: 0,
        localCandidateType: '—',
        remoteCandidateType: '—',
        protocol: 'udp',
      };
    }
  }

  close() {
    if (this._trickleFlushTimer) {
      clearTimeout(this._trickleFlushTimer);
      this._trickleFlushTimer = null;
    }
    try {
      this.dataChannel?.close();
    } catch {
      // ignore
    }
    try {
      this.pc.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Executes a full in-browser Loopback Verification (`Caller PC ⇄ Gzip+ECDH Envelope ⇄ DTLS Check ⇄ Callee PC`)
 * so a single user can immediately verify end-to-end WebRTC media + DataChannel + HFS envelope encryption.
 */
export async function createLocalLoopbackPair({
  localStream,
  callerWalletPrivHex,
  callerIdentity = '0x00000000000000000000000000000000000a11ce',
  onRemoteStream = null,
  onDataMessage = null,
  onStep = null,
} = {}) {
  const callerKeys = deriveRtcSignalingKeys(callerWalletPrivHex, callerIdentity);
  const calleeKeys = deriveRtcSignalingKeys(callerWalletPrivHex, '0x000000000000000000000000000000000000b0bb');

  const callerSession = new SlxWebRtcPeerSession({
    iceServers: [],
    localStream,
    isInitiator: true,
    onRemoteStream,
    onDataMessage,
  });

  const calleeStream = createSyntheticTestMediaStream({
    label: 'Loopback Peer (DTLS Verified)',
    includeVideo: true,
    includeAudio: true,
  });

  const calleeSession = new SlxWebRtcPeerSession({
    iceServers: [],
    localStream: calleeStream,
    isInitiator: false,
    onDataChannelOpen: (ch) => {
      ch.send(
        JSON.stringify({
          sender: 'Loopback Callee',
          text: '✅ 0ms P2P RTCDataChannel active! Both DTLS-SRTP fingerprints & secp256k1 ECDH envelopes verified.',
          ts: Date.now(),
        })
      );
    },
    onDataMessage: (msg) => {
      calleeSession.sendChatMessage(`Echo: ${msg.text}`, 'Loopback Callee');
    },
  });

  onStep?.('1/4 Creating Caller RTCPeerConnection Offer + gathering host ICE…');
  const offerBundle = await callerSession.createBundledOffer({ iceWaitMs: 350 });
  const sealedOffer = await sealRtcSignalEnvelope(
    {
      v: 1,
      type: 'offer',
      sdp: offerBundle.sdp,
      candidates: offerBundle.candidates,
      senderPub33: callerKeys.compressedPubKey,
      ts: Date.now(),
    },
    { recipientPub64: calleeKeys.uncompressedPub64 }
  );

  onStep?.(`2/4 Sealed Offer (${sealedOffer.rawJsonBytes} B → ${sealedOffer.wireBytes} B ECDH+Gzip) — opening as Callee…`);
  const openedOffer = await openRtcSignalEnvelope(sealedOffer.bytes, {
    signalPrivHex: calleeKeys.signalPrivHex,
  });

  const answerBundle = await calleeSession.acceptOfferAndCreateBundledAnswer(
    openedOffer.payload,
    offerBundle.dtlsFp,
    { iceWaitMs: 350 }
  );

  const sealedAnswer = await sealRtcSignalEnvelope(
    {
      v: 1,
      type: 'answer',
      sdp: answerBundle.sdp,
      candidates: answerBundle.candidates,
      senderPub33: calleeKeys.compressedPubKey,
      ts: Date.now(),
    },
    { recipientPub64: callerKeys.uncompressedPub64 }
  );

  onStep?.(`3/4 Sealed Answer (${sealedAnswer.rawJsonBytes} B → ${sealedAnswer.wireBytes} B ECDH+Gzip) — verifying Callee DTLS-SRTP…`);
  const openedAnswer = await openRtcSignalEnvelope(sealedAnswer.bytes, {
    signalPrivHex: callerKeys.signalPrivHex,
  });
  const calleeFpCheck = await callerSession.applyBundledAnswer(
    openedAnswer.payload,
    answerBundle.dtlsFp
  );

  onStep?.('4/4 P2P DTLS-SRTP media & RTCDataChannel established!');

  return {
    callerSession,
    calleeSession,
    calleeStream,
    telemetry: {
      callerDtlsFp: offerBundle.dtlsFp,
      calleeDtlsFp: answerBundle.dtlsFp,
      dtlsVerified: calleeFpCheck.verified && answerBundle.peerDtlsCheck.verified,
      offerRawBytes: sealedOffer.rawJsonBytes,
      offerWireBytes: sealedOffer.wireBytes,
      answerRawBytes: sealedAnswer.rawJsonBytes,
      answerWireBytes: sealedAnswer.wireBytes,
      encrypted: sealedOffer.encrypted && sealedAnswer.encrypted,
    },
    cleanup() {
      callerSession.close();
      calleeSession.close();
      stopCallMediaStream(calleeStream);
    },
  };
}
