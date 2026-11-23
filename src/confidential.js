/**
 * @superlexicon/sdk/confidential
 *
 * Zero-dependency Confidential Accounting & Shielded Settlement Cryptography + ABI Builders:
 *  - Pure-BigInt synchronous SHA-512 (FIPS 180-4) & prime-order `Edwards25519` curve arithmetic
 *  - Additive Homomorphic Exponential ElGamal (`Enc_Y(v, r) = (r·B, v·B + r·Y)`) + fast BSGS decryption
 *  - 24-bit Non-Negative Binary-Decomposition ZK Range Prover & Verifier (`SLX_CONF_BIT01_V1:`)
 *  - Chaum-Pedersen DLEQ Sum Conservation Prover & Public Browser Verifier (`SLX_VM_DLEQ_CHAL_V1`)
 *  - Diagonal DLEQ `Edwards25519` Schnorr Prover & Verifier (for `$0`-gas ephemeral stealth EOA calls)
 *  - `IAS 24` Stealth Bilateral Counterparty Commitment & Charter Insider Non-Membership Prover/Verifier
 *  - Authenticated `secp256k1` ECDH Key-Wrap Envelopes & `(Category, Period)` KDF Subkey JSON Ciphers
 *  - High-level ABI calldata builders & binary slice decoders for `Identity` v3, `CorporateCharter`,
 *    `AssetLedger` Shielded Pool, `AccountingLedger`, and `ConfidentialLedger` (`HFS_TYPE_CONF_LEDGER`).
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
  generatePrivateKeyHex,
  deriveKeypairInfo,
  ecdhSharedSecretBytes,
  ecdhXorTransform,
} from './crypto.js';
import {
  encodeAbi,
  u16BEBytes,
  u64BEBytes,
  readU16BE,
  readU32BE,
  readU64BE,
  ZERO_ADDR,
} from './abi.js';

// ============================================================================
// 1. Synchronous Pure-BigInt SHA-512 (FIPS 180-4)
// ============================================================================

const SHA512_K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const SHA512_H0 = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

const M64 = 0xffffffffffffffffn;

function rotr64(x, n) {
  return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;
}

export function sha512Bytes(input) {
  const msg =
    input instanceof Uint8Array
      ? input
      : typeof input === 'string'
        ? input.startsWith('0x')
          ? hexToBytes(input)
          : utf8ToBytes(input)
        : new Uint8Array(input);

  const bitLen = BigInt(msg.length) * 8n;
  const padZero = (111 - (msg.length % 128) + 128) % 128;
  const totalLen = msg.length + 1 + padZero + 16;
  const buf = new Uint8Array(totalLen);
  buf.set(msg);
  buf[msg.length] = 0x80;
  let bl = bitLen;
  for (let i = 0; i < 16; i++) {
    buf[totalLen - 1 - i] = Number(bl & 0xffn);
    bl >>= 8n;
  }

  let [h0, h1, h2, h3, h4, h5, h6, h7] = SHA512_H0;
  const w = new Array(80).fill(0n);

  for (let off = 0; off < totalLen; off += 128) {
    for (let i = 0; i < 16; i++) {
      let v = 0n;
      const base = off + i * 8;
      for (let b = 0; b < 8; b++) v = (v << 8n) | BigInt(buf[base + b]);
      w[i] = v;
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7n);
      const s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M64;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & M64 & g);
      const temp1 = (h + S1 + ch + SHA512_K[i] + w[i]) & M64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & M64;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & M64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & M64;
    }
    h0 = (h0 + a) & M64;
    h1 = (h1 + b) & M64;
    h2 = (h2 + c) & M64;
    h3 = (h3 + d) & M64;
    h4 = (h4 + e) & M64;
    h5 = (h5 + f) & M64;
    h6 = (h6 + g) & M64;
    h7 = (h7 + h) & M64;
  }

  const out = new Uint8Array(64);
  const hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    let v = hs[i];
    for (let b = 7; b >= 0; b--) {
      out[i * 8 + b] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return out;
}

// ============================================================================
// 2. Prime-Order Edwards25519 Curve & Canonical Constants
// ============================================================================

export const ED25519_P = (1n << 255n) - 19n;
export const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;

export const CONF_RANGE_BITS = 24;
export const CONF_BIT_PROOF_STRIDE = 192;
export const CONF_RANGE_PROOF_BYTES = CONF_RANGE_BITS * CONF_BIT_PROOF_STRIDE; // 4,608 B
export const CONF_MIN_PADDED_SLOTS = 4;

export const CONF_CAT_KIND = Object.freeze({
  PAYROLL: 1,
  DEFENSE_B2B: 2,
  TRADE_AR: 3,
  VENDOR_OPEX: 4,
});

export const CONF_ROLLUP_MODE = Object.freeze({
  BATCH_OR_EPOCH: 1,
  LIVE_COUNTERPARTY_SHIELDED: 2,
});

export const CONF_CAT_IDS = Object.freeze({
  PAYROLL: keccak256Hex('CONF_CAT:MONTHLY_PAYROLL'),
  DEFENSE_B2B: keccak256Hex('CONF_CAT:DEFENSE_B2B_CONTRACTS'),
  DEFENSE_LIVE: keccak256Hex('CONF_CAT:DEFENSE_B2B_LIVE'),
  TRADE_AR: keccak256Hex('CONF_CAT:CONFIDENTIAL_TRADE_AR'),
  VENDOR_OPEX: keccak256Hex('CONF_CAT:CONFIDENTIAL_VENDOR_OPEX'),
});

function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function modPow(base, exp, m) {
  let res = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return res;
}

function modInv(a, m) {
  return modPow(a, m - 2n, m);
}

const ED_D = mod(-121665n * modInv(121666n, ED25519_P), ED25519_P);
const ED_SQRT_M1 = modPow(2n, (ED25519_P - 1n) / 4n, ED25519_P);
export const ED_IDENTITY_PT = Object.freeze({ X: 0n, Y: 1n, Z: 1n, T: 0n });

function recoverX(y, sign) {
  if (y >= ED25519_P) return null;
  const y2 = (y * y) % ED25519_P;
  const u = mod(y2 - 1n, ED25519_P);
  const v = mod(ED_D * y2 + 1n, ED25519_P);
  const x2 = (u * modInv(v, ED25519_P)) % ED25519_P;
  if (x2 === 0n) return sign ? null : 0n;
  let x = modPow(x2, (ED25519_P + 3n) / 8n, ED25519_P);
  if (mod(x * x - x2, ED25519_P) !== 0n) x = (x * ED_SQRT_M1) % ED25519_P;
  if (mod(x * x - x2, ED25519_P) !== 0n) return null;
  if ((x & 1n) !== BigInt(sign)) x = ED25519_P - x;
  return x;
}

const ED_BY = (4n * modInv(5n, ED25519_P)) % ED25519_P;
const ED_BX = recoverX(ED_BY, 0);
export const ED_BASE_PT = Object.freeze({
  X: ED_BX,
  Y: ED_BY,
  Z: 1n,
  T: (ED_BX * ED_BY) % ED25519_P,
});

export function edAdd(P, Q) {
  const A = mod((P.Y - P.X) * (Q.Y - Q.X), ED25519_P);
  const B = mod((P.Y + P.X) * (Q.Y + Q.X), ED25519_P);
  const C = mod(2n * P.T * Q.T * ED_D, ED25519_P);
  const D = mod(2n * P.Z * Q.Z, ED25519_P);
  const E = mod(B - A, ED25519_P);
  const F = mod(D - C, ED25519_P);
  const G = mod(D + C, ED25519_P);
  const H = mod(B + A, ED25519_P);
  return {
    X: (E * F) % ED25519_P,
    Y: (G * H) % ED25519_P,
    Z: (F * G) % ED25519_P,
    T: (E * H) % ED25519_P,
  };
}

export function edNeg(P) {
  return { X: mod(-P.X, ED25519_P), Y: P.Y, Z: P.Z, T: mod(-P.T, ED25519_P) };
}

export function edMul(scalar, P) {
  let R = ED_IDENTITY_PT;
  let Q = P;
  let k = mod(BigInt(scalar), ED25519_L);
  while (k > 0n) {
    if (k & 1n) R = edAdd(R, Q);
    Q = edAdd(Q, Q);
    k >>= 1n;
  }
  return R;
}

export function edEncode(P) {
  const zi = modInv(P.Z, ED25519_P);
  const x = (P.X * zi) % ED25519_P;
  const y = (P.Y * zi) % ED25519_P;
  const out = new Uint8Array(32);
  let tmp = y;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  out[31] |= Number(x & 1n) << 7;
  return out;
}

export function edDecode(bytesOrHex) {
  const bytes32 = bytesOrHex instanceof Uint8Array ? bytesOrHex : hexToBytes(bytesOrHex);
  if (!bytes32 || bytes32.length !== 32) return null;
  let y = 0n;
  for (let i = 0; i < 32; i++) {
    const b = i === 31 ? bytes32[31] & 0x7f : bytes32[i];
    y |= BigInt(b) << BigInt(8 * i);
  }
  const sign = (bytes32[31] >> 7) & 1;
  const x = recoverX(y, sign);
  if (x === null) return null;
  const P = { X: x, Y: y, Z: 1n, T: (x * y) % ED25519_P };
  const re = edEncode(P);
  for (let i = 0; i < 32; i++) {
    if (re[i] !== bytes32[i]) return null;
  }
  return P;
}

export function edIsIdentity(P) {
  return mod(P.X, ED25519_P) === 0n && mod(P.Y - P.Z, ED25519_P) === 0n;
}

export const ED25519_BASEPOINT_BYTES = edEncode(ED_BASE_PT);
export const IDENTITY_POINT_BYTES = edEncode(ED_IDENTITY_PT);
export const IDENTITY_CIPHERTEXT_64 = concatBytes(IDENTITY_POINT_BYTES, IDENTITY_POINT_BYTES);

export function leBytesToBigInt(bytes) {
  let acc = 0n;
  for (let i = 0; i < bytes.length; i++) {
    acc |= BigInt(bytes[i]) << BigInt(8 * i);
  }
  return acc;
}

export function scalarToLeBytes32(s) {
  const out = new Uint8Array(32);
  let v = mod(BigInt(s), ED25519_L);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function randomEdScalar() {
  const wide = randomBytes(64);
  let s = leBytesToBigInt(wide) % ED25519_L;
  if (s === 0n) s = 1n;
  return s;
}

function u32BeBytes(n) {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

export function encodePeriodTagBytes32(labelStr) {
  const raw = utf8ToBytes(String(labelStr || 'FY2026-P1').slice(0, 32));
  const out = new Uint8Array(32);
  out.set(raw);
  return out;
}

export function decodePeriodTagBytes32(bytesOrHex) {
  const b = bytesOrHex instanceof Uint8Array ? bytesOrHex : hexToBytes(bytesOrHex);
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return bytesToUtf8(b.slice(0, end));
}

// ============================================================================
// 3. Key Derivation, ECDH Officer/Employee Envelopes & Subkey Ciphers
// ============================================================================

export function deriveEd25519Keypair(seed32Input, ctxInput) {
  const seed32 = seed32Input instanceof Uint8Array ? seed32Input : hexToBytes(seed32Input);
  const ctx =
    ctxInput instanceof Uint8Array
      ? ctxInput
      : typeof ctxInput === 'string' && ctxInput.startsWith('0x')
        ? hexToBytes(ctxInput)
        : utf8ToBytes(String(ctxInput || ''));
  const digest = sha512Bytes(
    concatBytes(utf8ToBytes('SLX_ID_ED25519_V1'), seed32.slice(0, 32), u64BEBytes(ctx.length), ctx)
  );
  let secretScalar = leBytesToBigInt(digest) % ED25519_L;
  if (secretScalar === 0n) secretScalar = 1n;
  const pub32Bytes = edEncode(edMul(secretScalar, ED_BASE_PT));
  return {
    secretScalar,
    secretLeBytes32: scalarToLeBytes32(secretScalar),
    secretHex32: bytesToHex(scalarToLeBytes32(secretScalar), true),
    pub32Bytes,
    pub32Hex: bytesToHex(pub32Bytes, true),
  };
}

/**
 * Deterministically derives both `secp256k1` (64-byte `X||Y`) and `Edwards25519` (32-byte)
 * keys for an `Identity` HFS from the owner's wallet `privateKeyHex` + `identityAddrHex`.
 */
export function deriveIdentityEncryptionKeys(privateKeyHex, identityAddrHex) {
  const kp = deriveKeypairInfo(privateKeyHex);
  const secpPub64Bytes = hexToBytes(kp.uncompressedPubKey).slice(1, 65);
  const idBytes20 = hexToBytes(identityAddrHex).slice(-20);
  const ed = deriveEd25519Keypair(hexToBytes(kp.privateKey), idBytes20);
  return {
    secpPrivHex: kp.privateKey,
    secpPub64Bytes,
    secpPub64Hex: bytesToHex(secpPub64Bytes, true),
    edSecretScalar: ed.secretScalar,
    edSecretHex32: ed.secretHex32,
    edPub32Bytes: ed.pub32Bytes,
    edPub32Hex: ed.pub32Hex,
  };
}

export function deriveCompanyAuditKeypair(seedBytesOrHex, charterAddrHex, epoch = 1) {
  const seed = seedBytesOrHex ? (seedBytesOrHex instanceof Uint8Array ? seedBytesOrHex : hexToBytes(seedBytesOrHex)) : randomBytes(32);
  const ctx = concatBytes(
    utf8ToBytes('COMPANY_AUDIT_KEY:'),
    hexToBytes(charterAddrHex).slice(-20),
    u64BEBytes(epoch)
  );
  return deriveEd25519Keypair(seed, ctx);
}

/**
 * Derives a scoped `(Category, Period)` 32-byte symmetric subkey from `auditSecretLeBytes32`.
 * Granting this subkey to an External Auditor lets them decrypt ONLY `(categoryId, periodTag)`!
 */
export function deriveCategoryPeriodSubkey(auditSecretInput, categoryIdHex, periodTagInput) {
  const sk = auditSecretInput instanceof Uint8Array ? auditSecretInput : hexToBytes(auditSecretInput);
  const cat = hexToBytes(categoryIdHex).slice(0, 32);
  const per =
    periodTagInput instanceof Uint8Array
      ? periodTagInput.slice(0, 32)
      : String(periodTagInput || '').startsWith('0x') && String(periodTagInput).length === 66
        ? hexToBytes(periodTagInput)
        : encodePeriodTagBytes32(periodTagInput);
  return keccak256Bytes(
    concatBytes(utf8ToBytes('SLX_CONF_SUBKEY_V1:'), sk.slice(0, 32), cat, per)
  );
}

/**
 * Wraps `secretBytes` for `recipientSecpPub64` using an ephemeral `secp256k1` ECDH key + 16-byte MAC.
 * Wire layout: `[ephemSecpPub64 (64B) || cipher (N) || mac16 (16B)]`.
 */
export function wrapSecretForRecipientSecp(secretBytes, recipientSecpPub64, contextTag = 'SLX_AUDIT_WRAP') {
  const plain = secretBytes instanceof Uint8Array ? secretBytes : hexToBytes(secretBytes);
  const peerPub = recipientSecpPub64 instanceof Uint8Array ? recipientSecpPub64 : hexToBytes(recipientSecpPub64);
  if (peerPub.length !== 64) {
    throw new Error('wrapSecretForRecipientSecp expects 64-byte uncompressed secp256k1 pubkey');
  }
  const ephemPriv = generatePrivateKeyHex();
  const ephemInfo = deriveKeypairInfo(ephemPriv);
  const ephemPub64 = hexToBytes(ephemInfo.uncompressedPubKey).slice(1, 65);
  const shared32 = ecdhSharedSecretBytes(ephemPriv, peerPub, 'SLX_CONF_WRAP_V1');
  const ctxBytes = utf8ToBytes(String(contextTag));
  const cipher = ecdhXorTransform(shared32, concatBytes(ephemPub64, ctxBytes), plain);
  const mac16 = keccak256Bytes(
    concatBytes(utf8ToBytes('SLX_CONF_WMAC_V1:'), shared32, ctxBytes, ephemPub64, cipher)
  ).slice(0, 16);
  return concatBytes(ephemPub64, cipher, mac16);
}

export function unwrapSecretWithPrivKey(envelopeInput, recipientPrivateKeyHex, contextTag = 'SLX_AUDIT_WRAP') {
  try {
    const env = envelopeInput instanceof Uint8Array ? envelopeInput : hexToBytes(envelopeInput);
    if (env.length <= 80) return null;
    const ephemPub64 = env.slice(0, 64);
    const cipher = env.slice(64, env.length - 16);
    const mac16 = env.slice(env.length - 16);
    const shared32 = ecdhSharedSecretBytes(recipientPrivateKeyHex, ephemPub64, 'SLX_CONF_WRAP_V1');
    const ctxBytes = utf8ToBytes(String(contextTag));
    const expectedMac = keccak256Bytes(
      concatBytes(utf8ToBytes('SLX_CONF_WMAC_V1:'), shared32, ctxBytes, ephemPub64, cipher)
    ).slice(0, 16);
    let diff = 0;
    for (let i = 0; i < 16; i++) diff |= mac16[i] ^ expectedMac[i];
    if (diff !== 0) return null;
    return ecdhXorTransform(shared32, concatBytes(ephemPub64, ctxBytes), cipher);
  } catch (_) {
    return null;
  }
}

const COMPACT_NOTE_MAGIC_0 = 0x53; // 'S'
const COMPACT_NOTE_MAGIC_1 = 0x4c; // 'L'
const COMPACT_NOTE_VER = 0x01;

function tryPackCompactNotePlaintext(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const kindMap = { PAYSLIP_V1: 1, CHANGE_NOTE_V1: 2, B2B_PAYMENT_V1: 3 };
  const kind = kindMap[obj.t];
  if (!kind || !obj.rHex) return null;
  const r32 = hexToBytes(obj.rHex);
  if (r32.length !== 32) return null;
  const hasSk = Boolean(obj.claimSkHex);
  const sk32 = hasSk ? hexToBytes(obj.claimSkHex) : new Uint8Array(32);
  if (sk32.length !== 32) return null;
  const perB = utf8ToBytes(String(obj.per || '')).slice(0, 24);
  const memoB = utf8ToBytes(String(obj.memo || '')).slice(0, 64);
  return concatBytes(
    new Uint8Array([COMPACT_NOTE_MAGIC_0, COMPACT_NOTE_MAGIC_1, COMPACT_NOTE_VER, kind | (hasSk ? 0x80 : 0)]),
    u64BEBytes(Number(obj.amt || 0)),
    r32,
    sk32,
    new Uint8Array([perB.length]),
    perB,
    new Uint8Array([memoB.length]),
    memoB
  );
}

function tryUnpackCompactNotePlaintext(plain) {
  if (
    !plain ||
    plain.length < 78 ||
    plain[0] !== COMPACT_NOTE_MAGIC_0 ||
    plain[1] !== COMPACT_NOTE_MAGIC_1 ||
    plain[2] !== COMPACT_NOTE_VER
  ) {
    return null;
  }
  const flags = plain[3];
  const kind = flags & 0x7f;
  const hasSk = (flags & 0x80) !== 0;
  const t = kind === 1 ? 'PAYSLIP_V1' : kind === 2 ? 'CHANGE_NOTE_V1' : kind === 3 ? 'B2B_PAYMENT_V1' : 'NOTE_V1';
  const amt = Number(readU64BE(plain, 4));
  const rHex = bytesToHex(plain.slice(12, 44), true);
  const claimSkHex = hasSk ? bytesToHex(plain.slice(44, 76), true) : undefined;
  let pos = 76;
  const perLen = plain[pos++] || 0;
  const per = bytesToUtf8(plain.slice(pos, pos + perLen));
  pos += perLen;
  const memoLen = plain[pos++] || 0;
  const memo = bytesToUtf8(plain.slice(pos, pos + memoLen));
  return {
    t,
    amt,
    per,
    memo,
    rHex,
    ...(claimSkHex ? { claimSkHex } : {}),
  };
}

export function encryptJsonForRecipientSecp(obj, recipientSecpPub64, contextTag = 'SLX_LINE_ENV') {
  const compact = tryPackCompactNotePlaintext(obj);
  return wrapSecretForRecipientSecp(compact || utf8ToBytes(JSON.stringify(obj)), recipientSecpPub64, contextTag);
}

export function decryptJsonWithPrivKey(envelopeInput, recipientPrivateKeyHex, contextTag = 'SLX_LINE_ENV') {
  const plain = unwrapSecretWithPrivKey(envelopeInput, recipientPrivateKeyHex, contextTag);
  if (!plain) return null;
  const compactObj = tryUnpackCompactNotePlaintext(plain);
  if (compactObj) return compactObj;
  try {
    return JSON.parse(bytesToUtf8(plain));
  } catch (_) {
    return null;
  }
}

export function encryptJsonWithSubkey(subkey32Input, obj, contextTag = 'SLX_SUBKEY_JSON') {
  const key = subkey32Input instanceof Uint8Array ? subkey32Input : hexToBytes(subkey32Input);
  const nonce12 = randomBytes(12);
  const plain = utf8ToBytes(JSON.stringify(obj));
  const ctx = concatBytes(nonce12, utf8ToBytes(String(contextTag)));
  const cipher = ecdhXorTransform(key, ctx, plain);
  const mac16 = keccak256Bytes(concatBytes(utf8ToBytes('SLX_CONF_SMAC_V1:'), key, ctx, cipher)).slice(0, 16);
  return concatBytes(nonce12, cipher, mac16);
}

export function decryptJsonWithSubkey(subkey32Input, cipherInput, contextTag = 'SLX_SUBKEY_JSON') {
  try {
    const key = subkey32Input instanceof Uint8Array ? subkey32Input : hexToBytes(subkey32Input);
    const raw = cipherInput instanceof Uint8Array ? cipherInput : hexToBytes(cipherInput);
    if (raw.length <= 28) return null;
    const nonce12 = raw.slice(0, 12);
    const cipher = raw.slice(12, raw.length - 16);
    const mac16 = raw.slice(raw.length - 16);
    const ctx = concatBytes(nonce12, utf8ToBytes(String(contextTag)));
    const expected = keccak256Bytes(concatBytes(utf8ToBytes('SLX_CONF_SMAC_V1:'), key, ctx, cipher)).slice(0, 16);
    let diff = 0;
    for (let i = 0; i < 16; i++) diff |= mac16[i] ^ expected[i];
    if (diff !== 0) return null;
    return JSON.parse(bytesToUtf8(ecdhXorTransform(key, ctx, cipher)));
  } catch (_) {
    return null;
  }
}

// ============================================================================
// 4. Homomorphic ElGamal, BSGS Decryption, Range Proofs, DLEQ & IAS 24 Stealth
// ============================================================================

export function heEncryptU64(pkInput, value, rScalar = randomEdScalar()) {
  const Y = edDecode(pkInput);
  if (!Y || edIsIdentity(Y)) throw new Error('Invalid Ed25519 ElGamal public key');
  const C1 = edMul(rScalar, ED_BASE_PT);
  const C2 = edAdd(edMul(BigInt(value), ED_BASE_PT), edMul(rScalar, Y));
  return {
    ct64: concatBytes(edEncode(C1), edEncode(C2)),
    rScalar: mod(BigInt(rScalar), ED25519_L),
  };
}

export function heAddCiphertexts(caInput, cbInput) {
  const ca = caInput instanceof Uint8Array ? caInput : hexToBytes(caInput);
  const cb = cbInput instanceof Uint8Array ? cbInput : hexToBytes(cbInput);
  const a1 = edDecode(ca.slice(0, 32));
  const a2 = edDecode(ca.slice(32, 64));
  const b1 = edDecode(cb.slice(0, 32));
  const b2 = edDecode(cb.slice(32, 64));
  if (!a1 || !a2 || !b1 || !b2) return null;
  return concatBytes(edEncode(edAdd(a1, b1)), edEncode(edAdd(a2, b2)));
}

export function heSubCiphertexts(caInput, cbInput) {
  const ca = caInput instanceof Uint8Array ? caInput : hexToBytes(caInput);
  const cb = cbInput instanceof Uint8Array ? cbInput : hexToBytes(cbInput);
  const a1 = edDecode(ca.slice(0, 32));
  const a2 = edDecode(ca.slice(32, 64));
  const b1 = edDecode(cb.slice(0, 32));
  const b2 = edDecode(cb.slice(32, 64));
  if (!a1 || !a2 || !b1 || !b2) return null;
  return concatBytes(edEncode(edAdd(a1, edNeg(b1))), edEncode(edAdd(a2, edNeg(b2))));
}

export function heScaleCiphertext(ctInput, weight) {
  const ct = ctInput instanceof Uint8Array ? ctInput : hexToBytes(ctInput);
  const c1 = edDecode(ct.slice(0, 32));
  const c2 = edDecode(ct.slice(32, 64));
  if (!c1 || !c2) return null;
  const w = BigInt(weight);
  return concatBytes(edEncode(edMul(w, c1)), edEncode(edMul(w, c2)));
}

let _bsgsBabyTable = null;
let _bsgsGiantNeg = null;
const BSGS_STEP = 4096;

function ensureBsgsTable() {
  if (_bsgsBabyTable) return;
  _bsgsBabyTable = new Map();
  let cur = ED_IDENTITY_PT;
  for (let b = 0; b < BSGS_STEP; b++) {
    _bsgsBabyTable.set(bytesToHex(edEncode(cur), false), b);
    cur = edAdd(cur, ED_BASE_PT);
  }
  _bsgsGiantNeg = edNeg(edMul(BigInt(BSGS_STEP), ED_BASE_PT));
}

export function decryptElGamalU24(auditSecretScalarOrLeBytes, ctInput, maxBound = 16_777_216) {
  ensureBsgsTable();
  const sk =
    typeof auditSecretScalarOrLeBytes === 'bigint'
      ? auditSecretScalarOrLeBytes
      : leBytesToBigInt(
          auditSecretScalarOrLeBytes instanceof Uint8Array
            ? auditSecretScalarOrLeBytes
            : hexToBytes(auditSecretScalarOrLeBytes)
        );
  const ct = ctInput instanceof Uint8Array ? ctInput : hexToBytes(ctInput);
  const C1 = edDecode(ct.slice(0, 32));
  const C2 = edDecode(ct.slice(32, 64));
  if (!C1 || !C2) return null;
  let cur = edAdd(C2, edNeg(edMul(sk, C1)));
  const maxQ = Math.ceil(maxBound / BSGS_STEP);
  for (let q = 0; q <= maxQ; q++) {
    const hit = _bsgsBabyTable.get(bytesToHex(edEncode(cur), false));
    if (hit !== undefined) {
      const val = q * BSGS_STEP + hit;
      if (val <= maxBound) return val;
    }
    cur = edAdd(cur, _bsgsGiantNeg);
  }
  return null;
}

export function proveDleq(secretScalar, G1, Y1, G2, Y2, auxCtx) {
  const k = randomEdScalar();
  const R1 = edMul(k, G1);
  const R2 = edMul(k, G2);
  const digest = sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_VM_DLEQ_CHAL_V1'),
      edEncode(G1),
      edEncode(Y1),
      edEncode(G2),
      edEncode(Y2),
      edEncode(R1),
      edEncode(R2),
      u64BEBytes(auxCtx.length),
      auxCtx
    )
  );
  const c = leBytesToBigInt(digest) % ED25519_L;
  const z = mod(k + c * mod(BigInt(secretScalar), ED25519_L), ED25519_L);
  return concatBytes(scalarToLeBytes32(c), scalarToLeBytes32(z));
}

export function verifyDleq(G1, Y1, G2, Y2, auxCtx, proof64Input) {
  const pf = proof64Input instanceof Uint8Array ? proof64Input : hexToBytes(proof64Input);
  if (pf.length !== 64) return false;
  const c = leBytesToBigInt(pf.slice(0, 32));
  const z = leBytesToBigInt(pf.slice(32, 64));
  if (c >= ED25519_L || z >= ED25519_L) return false;
  const R1 = edAdd(edMul(z, G1), edNeg(edMul(c, Y1)));
  const R2 = edAdd(edMul(z, G2), edNeg(edMul(c, Y2)));
  const digest = sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_VM_DLEQ_CHAL_V1'),
      edEncode(G1),
      edEncode(Y1),
      edEncode(G2),
      edEncode(Y2),
      edEncode(R1),
      edEncode(R2),
      u64BEBytes(auxCtx.length),
      auxCtx
    )
  );
  return c === leBytesToBigInt(digest) % ED25519_L;
}

export function proveHeZeroOrOne(pkInput, bit, rScalar, auxCtx) {
  const Y = edDecode(pkInput);
  if (!Y || edIsIdentity(Y)) throw new Error('Invalid ElGamal PK');
  const C1 = edMul(rScalar, ED_BASE_PT);
  const C2 = bit === 1 ? edAdd(ED_BASE_PT, edMul(rScalar, Y)) : edMul(rScalar, Y);

  const k = randomEdScalar();
  const simC = randomEdScalar();
  const simZ = randomEdScalar();

  let A0, B0, A1, B1;
  if (bit === 0) {
    A0 = edMul(k, ED_BASE_PT);
    B0 = edMul(k, Y);
    const M1 = edAdd(C2, edNeg(ED_BASE_PT));
    A1 = edAdd(edMul(simZ, ED_BASE_PT), edNeg(edMul(simC, C1)));
    B1 = edAdd(edMul(simZ, Y), edNeg(edMul(simC, M1)));
  } else {
    A0 = edAdd(edMul(simZ, ED_BASE_PT), edNeg(edMul(simC, C1)));
    B0 = edAdd(edMul(simZ, Y), edNeg(edMul(simC, C2)));
    A1 = edMul(k, ED_BASE_PT);
    B1 = edMul(k, Y);
  }

  const chal = sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_HE_OR01_V1'),
      edEncode(Y),
      edEncode(C1),
      edEncode(C2),
      edEncode(A0),
      edEncode(B0),
      edEncode(A1),
      edEncode(B1),
      u64BEBytes(auxCtx.length),
      auxCtx
    )
  );
  const c = leBytesToBigInt(chal) % ED25519_L;

  let c0, z0, c1, z1;
  if (bit === 0) {
    c0 = mod(c - simC, ED25519_L);
    z0 = mod(k + c0 * rScalar, ED25519_L);
    c1 = simC;
    z1 = simZ;
  } else {
    c1 = mod(c - simC, ED25519_L);
    z1 = mod(k + c1 * rScalar, ED25519_L);
    c0 = simC;
    z0 = simZ;
  }

  return {
    ct64: concatBytes(edEncode(C1), edEncode(C2)),
    proof128: concatBytes(
      scalarToLeBytes32(c0),
      scalarToLeBytes32(z0),
      scalarToLeBytes32(c1),
      scalarToLeBytes32(z1)
    ),
  };
}

export function verifyHeZeroOrOne(pkInput, ct64Input, auxCtx, proof128Input) {
  const Y = edDecode(pkInput);
  const ct = ct64Input instanceof Uint8Array ? ct64Input : hexToBytes(ct64Input);
  const pf = proof128Input instanceof Uint8Array ? proof128Input : hexToBytes(proof128Input);
  if (!Y || edIsIdentity(Y) || ct.length !== 64 || pf.length !== 128) return false;
  const C1 = edDecode(ct.slice(0, 32));
  const C2 = edDecode(ct.slice(32, 64));
  if (!C1 || edIsIdentity(C1) || !C2) return false;
  const c0 = leBytesToBigInt(pf.slice(0, 32));
  const z0 = leBytesToBigInt(pf.slice(32, 64));
  const c1 = leBytesToBigInt(pf.slice(64, 96));
  const z1 = leBytesToBigInt(pf.slice(96, 128));
  if (c0 >= ED25519_L || z0 >= ED25519_L || c1 >= ED25519_L || z1 >= ED25519_L) return false;

  const M1 = edAdd(C2, edNeg(ED_BASE_PT));
  const A0 = edAdd(edMul(z0, ED_BASE_PT), edNeg(edMul(c0, C1)));
  const B0 = edAdd(edMul(z0, Y), edNeg(edMul(c0, C2)));
  const A1 = edAdd(edMul(z1, ED_BASE_PT), edNeg(edMul(c1, C1)));
  const B1 = edAdd(edMul(z1, Y), edNeg(edMul(c1, M1)));

  const chal = sha512Bytes(
    concatBytes(
      utf8ToBytes('SLX_HE_OR01_V1'),
      edEncode(Y),
      edEncode(C1),
      edEncode(C2),
      edEncode(A0),
      edEncode(B0),
      edEncode(A1),
      edEncode(B1),
      u64BEBytes(auxCtx.length),
      auxCtx
    )
  );
  return mod(c0 + c1, ED25519_L) === leBytesToBigInt(chal) % ED25519_L;
}

export function proveHeRangeU24(pkInput, value, ctxPrefixBytes, slotIdx) {
  const valNum = Number(value);
  if (!Number.isInteger(valNum) || valNum < 0 || valNum >= 1 << CONF_RANGE_BITS) {
    throw new Error(`Value ${value} out of 24-bit confidential range [0, 16,777,215]`);
  }
  const pkBytes = pkInput instanceof Uint8Array ? pkInput : hexToBytes(pkInput);
  const packed = new Uint8Array(CONF_RANGE_PROOF_BYTES);
  const rBits = new Array(CONF_RANGE_BITS);
  const tag = utf8ToBytes('SLX_CONF_BIT01_V1:');
  const slotBe = u32BeBytes(slotIdx >>> 0);

  for (let b = 0; b < CONF_RANGE_BITS; b++) {
    const bit = (valNum >>> b) & 1;
    const rb = randomEdScalar();
    rBits[b] = rb;
    const bitCtx = concatBytes(tag, ctxPrefixBytes, slotBe, new Uint8Array([b]));
    const { ct64, proof128 } = proveHeZeroOrOne(pkBytes, bit, rb, bitCtx);
    const off = b * CONF_BIT_PROOF_STRIDE;
    packed.set(ct64, off);
    packed.set(proof128, off + 64);
  }

  let rSlot = rBits[CONF_RANGE_BITS - 1];
  for (let b = CONF_RANGE_BITS - 2; b >= 0; b--) {
    rSlot = mod(rSlot + rSlot + rBits[b], ED25519_L);
  }
  const { ct64: slotCt64 } = heEncryptU64(pkBytes, valNum, rSlot);
  return {
    ct64: slotCt64,
    rScalar: rSlot,
    proof4608: packed,
  };
}

export function verifyHeRangeU24(pkInput, ctxPrefixBytes, slotIdx, proof4608Input) {
  const pkBytes = pkInput instanceof Uint8Array ? pkInput : hexToBytes(pkInput);
  const pf = proof4608Input instanceof Uint8Array ? proof4608Input : hexToBytes(proof4608Input);
  if (pf.length !== CONF_RANGE_PROOF_BYTES) return null;
  const tag = utf8ToBytes('SLX_CONF_BIT01_V1:');
  const slotBe = u32BeBytes(slotIdx >>> 0);
  const bitCts = new Array(CONF_RANGE_BITS);

  for (let b = 0; b < CONF_RANGE_BITS; b++) {
    const off = b * CONF_BIT_PROOF_STRIDE;
    const ct = pf.slice(off, off + 64);
    const orPf = pf.slice(off + 64, off + 192);
    const bitCtx = concatBytes(tag, ctxPrefixBytes, slotBe, new Uint8Array([b]));
    if (!verifyHeZeroOrOne(pkBytes, ct, bitCtx, orPf)) return null;
    bitCts[b] = ct;
  }

  let acc = bitCts[CONF_RANGE_BITS - 1];
  for (let b = CONF_RANGE_BITS - 2; b >= 0; b--) {
    acc = heScaleCiphertext(acc, 2n);
    acc = heAddCiphertexts(acc, bitCts[b]);
    if (!acc) return null;
  }
  return acc;
}

export function proveHeSumEqualsU64(pkInput, rSumScalar, sumCtxBytes) {
  const r = mod(BigInt(rSumScalar), ED25519_L);
  if (r === 0n) return new Uint8Array(64);
  const Y = edDecode(pkInput);
  if (!Y || edIsIdentity(Y)) throw new Error('Invalid ElGamal PK');
  const C1 = edMul(r, ED_BASE_PT);
  const Mdiff = edMul(r, Y);
  return proveDleq(r, ED_BASE_PT, C1, Y, Mdiff, sumCtxBytes);
}

export function verifyHeSumEqualsU64(pkInput, cSum64Input, publicAmount, sumCtxBytes, dleq64Input) {
  const Y = edDecode(pkInput);
  const cs = cSum64Input instanceof Uint8Array ? cSum64Input : hexToBytes(cSum64Input);
  const pf = dleq64Input instanceof Uint8Array ? dleq64Input : hexToBytes(dleq64Input);
  if (!Y || edIsIdentity(Y) || cs.length !== 64 || pf.length !== 64) return false;
  const C1 = edDecode(cs.slice(0, 32));
  const C2 = edDecode(cs.slice(32, 64));
  if (!C1 || !C2) return false;
  const pubPt = BigInt(publicAmount) === 0n ? ED_IDENTITY_PT : edMul(BigInt(publicAmount), ED_BASE_PT);
  const Mdiff = edAdd(C2, edNeg(pubPt));
  if (edIsIdentity(C1)) {
    return edIsIdentity(Mdiff) && pf.every((b) => b === 0);
  }
  return verifyDleq(ED_BASE_PT, C1, Y, Mdiff, sumCtxBytes, pf);
}

export function proveEd25519Schnorr(secretScalar, base32Input, msgCtxBytes) {
  const B = edDecode(base32Input);
  if (!B || edIsIdentity(B)) throw new Error('Invalid Schnorr base point');
  const P = edMul(secretScalar, B);
  return proveDleq(secretScalar, B, P, B, P, msgCtxBytes);
}

export function verifyEd25519Schnorr(base32Input, pub32Input, msgCtxBytes, sig64Input) {
  const B = edDecode(base32Input);
  const P = edDecode(pub32Input);
  if (!B || edIsIdentity(B) || !P || edIsIdentity(P)) return false;
  return verifyDleq(B, P, B, P, msgCtxBytes, sig64Input);
}

export function proveStealthNonInsider(rhoScalar, clientEdPubInput, insiderEdPubs, ctxPrefixBytes) {
  const clientPt = edDecode(clientEdPubInput);
  if (!clientPt || edIsIdentity(clientPt)) throw new Error('Invalid client Ed25519 public key');
  const H = edMul(rhoScalar, ED_BASE_PT);
  const Pblind = edMul(rhoScalar, clientPt);
  const h32 = edEncode(H);
  const pBlind32 = edEncode(Pblind);
  const pBlindHex = bytesToHex(pBlind32, false);

  const chunks = [];
  const tag = utf8ToBytes('SLX_IAS24_NEQ_V1:');
  for (let j = 0; j < insiderEdPubs.length; j++) {
    const pkBytes =
      insiderEdPubs[j] instanceof Uint8Array ? insiderEdPubs[j] : hexToBytes(insiderEdPubs[j]);
    const isZero = pkBytes.every((b) => b === 0);
    const insPt = isZero ? null : edDecode(pkBytes);
    if (!insPt || edIsIdentity(insPt)) {
      chunks.push(new Uint8Array(96));
      continue;
    }
    const Q = edMul(rhoScalar, insPt);
    const q32 = edEncode(Q);
    if (bytesToHex(q32, false) === pBlindHex) {
      throw new Error('IAS 24 Guard: Counterparty is a related-party insider of this CorporateCharter');
    }
    const ctx = concatBytes(tag, ctxPrefixBytes, u32BeBytes(j));
    const dleq = proveDleq(rhoScalar, ED_BASE_PT, H, insPt, Q, ctx);
    chunks.push(concatBytes(q32, dleq));
  }
  return {
    stealthH32: h32,
    stealthH32Hex: bytesToHex(h32, true),
    blindedClientPk32: pBlind32,
    blindedClientPk32Hex: bytesToHex(pBlind32, true),
    proofBlob: concatBytes(...chunks),
  };
}

export function verifyStealthNonInsider(h32Input, pBlind32Input, insiderEdPubs, ctxPrefixBytes, proofBlobInput) {
  const H = edDecode(h32Input);
  const Pblind = edDecode(pBlind32Input);
  const blob = proofBlobInput instanceof Uint8Array ? proofBlobInput : hexToBytes(proofBlobInput);
  if (!H || edIsIdentity(H) || !Pblind || edIsIdentity(Pblind) || blob.length !== insiderEdPubs.length * 96) {
    return false;
  }
  const pBlindHex = bytesToHex(edEncode(Pblind), false);
  const tag = utf8ToBytes('SLX_IAS24_NEQ_V1:');
  for (let j = 0; j < insiderEdPubs.length; j++) {
    const pkBytes =
      insiderEdPubs[j] instanceof Uint8Array ? insiderEdPubs[j] : hexToBytes(insiderEdPubs[j]);
    const insPt = pkBytes.every((b) => b === 0) ? null : edDecode(pkBytes);
    if (!insPt || edIsIdentity(insPt)) continue;
    const off = j * 96;
    const q32 = blob.slice(off, off + 32);
    const dleq = blob.slice(off + 32, off + 96);
    const Q = edDecode(q32);
    if (!Q || edIsIdentity(Q) || bytesToHex(q32, false) === pBlindHex) return false;
    const ctx = concatBytes(tag, ctxPrefixBytes, u32BeBytes(j));
    if (!verifyDleq(ED_BASE_PT, H, insPt, Q, ctx, dleq)) return false;
  }
  return true;
}

// ============================================================================
// 5. High-Level Confidential Accounting & Shielded Note Payload Builders
// ============================================================================

export function computeConfidentialBatchTag(confLedgerAddrHex, batchId) {
  return keccak256Bytes(
    concatBytes(
      utf8ToBytes('SLX_CONF_BTAG_1:'),
      hexToBytes(confLedgerAddrHex).slice(-20),
      u64BEBytes(batchId)
    )
  );
}

/**
 * Builds calldata & proofs for `ConfidentialLedger.postConfidentialPayableBatch(...)`,
 * automatically padding with zero-value dummy slots up to `minSlots` (default 4).
 */
export function buildConfidentialPayableBatchTx({
  confLedgerAddr,
  accountingLedgerAddr,
  treasuryIdentityAddr,
  batchId,
  categoryIdHex = CONF_CAT_IDS.PAYROLL,
  periodLabel = 'FY2026-M11',
  auditPub32Hex,
  subkey32,
  isPaidNow = true,
  items = [],
  minSlots = CONF_MIN_PADDED_SLOTS,
  authObj = ZERO_ADDR,
}) {
  if (!items.length) throw new Error('At least 1 line item is required');
  const periodBytes =
    String(periodLabel).startsWith('0x') && String(periodLabel).length === 66
      ? hexToBytes(periodLabel)
      : encodePeriodTagBytes32(periodLabel);
  const periodHex = bytesToHex(periodBytes, true);
  const catBytes = hexToBytes(categoryIdHex);
  const confBytes = hexToBytes(confLedgerAddr).slice(-20);
  const accBytes = hexToBytes(accountingLedgerAddr).slice(-20);
  const treasBytes = hexToBytes(treasuryIdentityAddr).slice(-20);

  const slots = items.map((it) => ({
    recipientIdentity: it.recipientIdentity || ZERO_ADDR,
    recipientLabel: it.recipientLabel || '',
    recipientSecpPub64Hex: it.recipientSecpPub64Hex || null,
    amount: Number(it.amount || 0),
    memo: it.memo || '',
    isDummy: false,
  }));
  while (slots.length < minSlots) {
    slots.push({
      recipientIdentity: ZERO_ADDR,
      recipientLabel: 'Dummy Padding Slot',
      recipientSecpPub64Hex: null,
      amount: 0,
      memo: 'PAD',
      isDummy: true,
    });
  }

  let totalAmount = 0;
  for (const s of slots) totalAmount += s.amount;
  if (totalAmount <= 0) throw new Error('Total batch amount must be > 0');

  const ctxPrefix = concatBytes(
    utf8ToBytes('SLX_CONF_PBAT_1:'),
    confBytes,
    catBytes,
    periodBytes,
    u64BEBytes(batchId)
  );

  const proofChunks = [];
  const lockEnvChunks = [u16BEBytes(slots.length)];
  const auditLines = [];
  let rSum = 0n;

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const { rScalar, proof4608 } = proveHeRangeU24(auditPub32Hex, s.amount, ctxPrefix, i);
    proofChunks.push(proof4608);
    rSum = mod(rSum + rScalar, ED25519_L);

    const claimKey = deriveEd25519Keypair(randomBytes(32), `NOTE_LOCK_${batchId}_${i}`);
    let empEnv = new Uint8Array(0);
    if (!s.isDummy && s.recipientSecpPub64Hex) {
      empEnv = encryptJsonForRecipientSecp(
        {
          t: 'PAYSLIP_V1',
          cat: categoryIdHex,
          per: decodePeriodTagBytes32(periodBytes),
          amt: s.amount,
          memo: s.memo,
          rHex: bytesToHex(scalarToLeBytes32(rScalar), true),
          claimSkHex: claimKey.secretHex32,
          recipient: s.recipientIdentity,
        },
        s.recipientSecpPub64Hex,
        'SLX_CONF_LINE_V1'
      );
    }
    lockEnvChunks.push(claimKey.pub32Bytes, u16BEBytes(empEnv.length), empEnv);
    if (!s.isDummy) {
      auditLines.push({
        slot: i,
        recipient: s.recipientIdentity,
        label: s.recipientLabel,
        amount: s.amount,
        memo: s.memo,
        rHex: bytesToHex(scalarToLeBytes32(rScalar), true),
      });
    }
  }

  // Ensure rSum != 0 mod L
  const batchTag32 = computeConfidentialBatchTag(confLedgerAddr, batchId);
  const sumCtx = concatBytes(
    utf8ToBytes('SLX_CONF_BSUM_1:'),
    accBytes,
    treasBytes,
    batchTag32,
    u64BEBytes(totalAmount)
  );
  const sumDleq64 = proveHeSumEqualsU64(auditPub32Hex, rSum, sumCtx);

  const auditCipher = subkey32
    ? encryptJsonWithSubkey(
        subkey32,
        {
          v: 1,
          kind: 'PAYABLE_BATCH',
          period: decodePeriodTagBytes32(periodBytes),
          totalAmount,
          isPaidNow,
          realCount: items.length,
          paddedSlots: slots.length,
          lines: auditLines,
        },
        'SLX_CONF_AUDIT_V1'
      )
    : new Uint8Array(0);

  const calldata = encodeAbi(
    'postConfidentialPayableBatch(bytes32,bytes32,uint64,bool,bytes,bytes,bytes,bytes,address)',
    [
      ['bytes32', categoryIdHex],
      ['bytes32', periodHex],
      ['uint64', totalAmount],
      ['bool', isPaidNow],
      ['bytes', concatBytes(...proofChunks)],
      ['bytes', sumDleq64],
      ['bytes', auditCipher],
      ['bytes', concatBytes(...lockEnvChunks)],
      ['address', authObj],
    ]
  );

  return {
    calldata,
    totalAmount,
    slotCount: slots.length,
    periodHex,
    sumDleq64,
  };
}

/**
 * Builds calldata & proofs for `ConfidentialLedger.proposeConfidentialReceivable(...)`.
 */
export function buildConfidentialReceivableProposal({
  confLedgerAddr,
  recId,
  categoryIdHex = CONF_CAT_IDS.DEFENSE_B2B,
  periodLabel = 'FY2026-Q4',
  monthlyAmount,
  totalMonths = 6,
  monthBlocks = 25,
  auditPub32Hex,
  subkey32,
  clientIdentityAddr,
  clientLabel = '',
  clientEdPub32Hex,
  clientSecpPub64Hex,
  contractTitle = 'Classified Defense Milestone Contract',
  insiderEdPubs = [],
  authObj = ZERO_ADDR,
}) {
  const periodBytes =
    String(periodLabel).startsWith('0x') && String(periodLabel).length === 66
      ? hexToBytes(periodLabel)
      : encodePeriodTagBytes32(periodLabel);
  const periodHex = bytesToHex(periodBytes, true);
  const confBytes = hexToBytes(confLedgerAddr).slice(-20);
  const catBytes = hexToBytes(categoryIdHex);

  const rho = randomEdScalar();
  const iasCtx = concatBytes(utf8ToBytes('SLX_CONF_RIAS_1:'), confBytes, u64BEBytes(recId));
  const stealth = proveStealthNonInsider(rho, clientEdPub32Hex, insiderEdPubs, iasCtx);

  const claimKey = deriveEd25519Keypair(randomBytes(32), `CONF_REC_CLAIM_${recId}`);
  const rprpPrefix = concatBytes(
    utf8ToBytes('SLX_CONF_RPRP_1:'),
    confBytes,
    catBytes,
    periodBytes,
    u64BEBytes(recId)
  );
  const { ct64: cMonthly64, rScalar: rMonthly, proof4608 } = proveHeRangeU24(
    auditPub32Hex,
    monthlyAmount,
    rprpPrefix,
    recId
  );
  const rBacklog = mod(rMonthly * BigInt(totalMonths), ED25519_L);

  const auditEnv = subkey32
    ? encryptJsonWithSubkey(
        subkey32,
        {
          v: 1,
          recId,
          title: contractTitle,
          client: clientIdentityAddr,
          clientLabel,
          monthlyAmount: Number(monthlyAmount),
          totalMonths: Number(totalMonths),
          backlogTotal: Number(monthlyAmount) * Number(totalMonths),
          rMonthlyHex: bytesToHex(scalarToLeBytes32(rMonthly), true),
          rBacklogHex: bytesToHex(scalarToLeBytes32(rBacklog), true),
          claimSkHex: claimKey.secretHex32,
        },
        'SLX_CONF_AUDIT_V1'
      )
    : new Uint8Array(0);

  const clientEnv = clientSecpPub64Hex
    ? encryptJsonForRecipientSecp(
        {
          v: 1,
          confLedger: confLedgerAddr,
          recId,
          cat: categoryIdHex,
          per: decodePeriodTagBytes32(periodBytes),
          title: contractTitle,
          monthlyAmount: Number(monthlyAmount),
          totalMonths: Number(totalMonths),
          rhoHex: bytesToHex(scalarToLeBytes32(rho), true),
          rBacklogHex: bytesToHex(scalarToLeBytes32(rBacklog), true),
          claimLockHex: claimKey.pub32Hex,
        },
        clientSecpPub64Hex,
        'SLX_CONF_LINE_V1'
      )
    : new Uint8Array(0);

  const actionHashCalldata = encodeAbi(
    'hashProposeConfidentialReceivable(bytes32,bytes32,uint64,uint64,bytes32,bytes32,bytes32)',
    [
      ['bytes32', categoryIdHex],
      ['bytes32', periodHex],
      ['uint64', totalMonths],
      ['uint64', monthBlocks],
      ['bytes32', stealth.stealthH32Hex],
      ['bytes32', stealth.blindedClientPk32Hex],
      ['bytes32', claimKey.pub32Hex],
    ]
  );

  const buildCalldata = (finalAuthObj = authObj) =>
    encodeAbi(
      'proposeConfidentialReceivable(bytes32,bytes32,uint64,uint64,bytes32,bytes32,bytes32,bytes,bytes,bytes,address)',
      [
        ['bytes32', categoryIdHex],
        ['bytes32', periodHex],
        ['uint64', totalMonths],
        ['uint64', monthBlocks],
        ['bytes32', stealth.stealthH32Hex],
        ['bytes32', stealth.blindedClientPk32Hex],
        ['bytes32', claimKey.pub32Hex],
        ['bytes', proof4608],
        ['bytes', auditEnv],
        ['bytes', clientEnv],
        ['address', finalAuthObj],
      ]
    );

  return {
    calldata: buildCalldata(authObj),
    buildCalldata,
    actionHashCalldata,
    stealthH32Hex: stealth.stealthH32Hex,
    blindedClientPk32Hex: stealth.blindedClientPk32Hex,
    claimLockHex: claimKey.pub32Hex,
    claimSecretHex: claimKey.secretHex32,
    rhoScalar: rho,
    rMonthlyScalar: rMonthly,
    rBacklogScalar: rBacklog,
    ias24ProofBlob: stealth.proofBlob,
    cMonthly64,
    periodHex,
  };
}

/**
 * Builds `$0`-gas ephemeral EOA calldata for `ConfidentialLedger.stealthCosignConfidentialReceivable(...)`.
 */
export function buildStealthCosignTx({
  confLedgerAddr,
  recId,
  cBacklog64,
  stealthH32Hex,
  clientEdSecretScalar,
  clientEdPub32Hex,
  rhoScalar,
  insiderEdPubs = [],
  isLiveMode2 = false,
  publicLiveTotal = 0,
  auditPub32Hex = null,
  rBacklogScalar = 0n,
}) {
  const confBytes = hexToBytes(confLedgerAddr).slice(-20);
  const cb = cBacklog64 instanceof Uint8Array ? cBacklog64 : hexToBytes(cBacklog64);
  const cosignCtx = concatBytes(
    utf8ToBytes('SLX_CONF_RCOS_1:'),
    confBytes,
    u64BEBytes(recId),
    cb
  );
  const cosignSig64 = proveEd25519Schnorr(clientEdSecretScalar, stealthH32Hex, cosignCtx);

  const iasCtx = concatBytes(utf8ToBytes('SLX_CONF_RIAS_1:'), confBytes, u64BEBytes(recId));
  const stealth = proveStealthNonInsider(rhoScalar, clientEdPub32Hex, insiderEdPubs, iasCtx);

  let liveDleq = new Uint8Array(0);
  const pubTotal = isLiveMode2 ? Number(publicLiveTotal) : 0;
  if (isLiveMode2) {
    const liveCtx = concatBytes(
      utf8ToBytes('SLX_CONF_RLIV_1:'),
      confBytes,
      u64BEBytes(recId),
      u64BEBytes(pubTotal)
    );
    liveDleq = proveHeSumEqualsU64(auditPub32Hex, rBacklogScalar, liveCtx);
  }

  return encodeAbi('stealthCosignConfidentialReceivable(uint64,uint64,bytes,bytes,bytes)', [
    ['uint64', recId],
    ['uint64', pubTotal],
    ['bytes', cosignSig64],
    ['bytes', stealth.proofBlob],
    ['bytes', liveDleq],
  ]);
}

/**
 * Builds calldata for `flushConfidentialReceivableEpoch` or `billConfidentialCategoryEpoch`.
 */
export function buildConfidentialEpochRollupTx({
  isBilling = false,
  confLedgerAddr,
  batchId,
  categoryIdHex = CONF_CAT_IDS.DEFENSE_B2B,
  periodLabel = 'FY2026-Q4',
  auditPub32Hex,
  subkey32,
  entries = [], // [{ recId, amount, rScalar, label }]
  minSlots = CONF_MIN_PADDED_SLOTS,
  authObj = ZERO_ADDR,
}) {
  if (!entries.length) throw new Error('At least 1 receivable entry is required');
  const periodBytes =
    String(periodLabel).startsWith('0x') && String(periodLabel).length === 66
      ? hexToBytes(periodLabel)
      : encodePeriodTagBytes32(periodLabel);
  const periodHex = bytesToHex(periodBytes, true);
  const confBytes = hexToBytes(confLedgerAddr).slice(-20);
  const catBytes = hexToBytes(categoryIdHex);

  const dummyCount = Math.max(0, minSlots - entries.length);
  const dummyTag = utf8ToBytes(isBilling ? 'SLX_CONF_EBIL_1:' : 'SLX_CONF_EFLS_1:');
  const sumTag = utf8ToBytes(isBilling ? 'SLX_CONF_BILS_1:' : 'SLX_CONF_ESUM_1:');
  const dummyPrefix = concatBytes(dummyTag, confBytes, catBytes, periodBytes, u64BEBytes(batchId));

  let publicTotal = 0;
  let rSum = 0n;
  const idChunks = [];
  for (const e of entries) {
    publicTotal += Number(e.amount);
    const r =
      typeof e.rScalar === 'bigint'
        ? e.rScalar
        : leBytesToBigInt(e.rScalar instanceof Uint8Array ? e.rScalar : hexToBytes(e.rScalar));
    rSum = mod(rSum + r, ED25519_L);
    idChunks.push(u64BEBytes(e.recId));
  }

  const dummyProofs = [];
  for (let d = 0; d < dummyCount; d++) {
    const { rScalar: dr, proof4608 } = proveHeRangeU24(auditPub32Hex, 0, dummyPrefix, d);
    rSum = mod(rSum + dr, ED25519_L);
    dummyProofs.push(proof4608);
  }

  const sumCtx = concatBytes(
    sumTag,
    confBytes,
    catBytes,
    periodBytes,
    u64BEBytes(batchId),
    u64BEBytes(publicTotal)
  );
  const sumDleq64 = proveHeSumEqualsU64(auditPub32Hex, rSum, sumCtx);

  const auditCipher = subkey32
    ? encryptJsonWithSubkey(
        subkey32,
        {
          v: 1,
          kind: isBilling ? 'EPOCH_BILLING' : 'EPOCH_BACKLOG_FLUSH',
          period: decodePeriodTagBytes32(periodBytes),
          totalAmount: publicTotal,
          realCount: entries.length,
          paddedSlots: entries.length + dummyCount,
          lines: entries.map((e) => ({ recId: e.recId, amount: e.amount, label: e.label || '' })),
        },
        'SLX_CONF_AUDIT_V1'
      )
    : new Uint8Array(0);

  const fnSig = isBilling
    ? 'billConfidentialCategoryEpoch(bytes32,bytes32,uint64,bytes,bytes,bytes,bytes,address)'
    : 'flushConfidentialReceivableEpoch(bytes32,bytes32,uint64,bytes,bytes,bytes,bytes,address)';

  return {
    calldata: encodeAbi(fnSig, [
      ['bytes32', categoryIdHex],
      ['bytes32', periodHex],
      ['uint64', publicTotal],
      ['bytes', concatBytes(...idChunks)],
      ['bytes', concatBytes(...dummyProofs)],
      ['bytes', sumDleq64],
      ['bytes', auditCipher],
      ['address', authObj],
    ]),
    publicTotal,
    slotCount: entries.length + dummyCount,
  };
}

/**
 * Builds `$0`-gas ephemeral EOA calldata for `AssetLedger.spendOrRedeemShieldedNote(...)`
 * supporting full public redemption, partial public withdrawal + shielded change note,
 * OR 1-to-2 shielded split payment (`payAmount` + `changeAmount` with `publicRedeemAmt = 0`).
 */
export function buildSpendOrRedeemShieldedNoteTx({
  bankLedgerAddr,
  noteId,
  noteAmount,
  noteRScalar,
  claimSecretScalarOrHex,
  auditPub32Hex,
  publicRedeemAmt = 0,
  publicRecipient = ZERO_ADDR,
  payAmount = 0,
  payLockPtHex = null,
  payRecipientSecpPub64Hex = null,
  ownerSecpPub64Hex = null,
}) {
  const bankBytes = hexToBytes(bankLedgerAddr).slice(-20);
  const rOld =
    typeof noteRScalar === 'bigint'
      ? noteRScalar
      : leBytesToBigInt(noteRScalar instanceof Uint8Array ? noteRScalar : hexToBytes(noteRScalar));
  const claimSk =
    typeof claimSecretScalarOrHex === 'bigint'
      ? claimSecretScalarOrHex
      : leBytesToBigInt(
          claimSecretScalarOrHex instanceof Uint8Array
            ? claimSecretScalarOrHex
            : hexToBytes(claimSecretScalarOrHex)
        );

  const hasPay = Number(payAmount) > 0 && Boolean(payLockPtHex);
  const changeAmount = Number(noteAmount) - Number(publicRedeemAmt) - (hasPay ? Number(payAmount) : 0);
  if (changeAmount < 0) throw new Error('Shielded note amount insufficient for requested split/redeem');

  const hasChange = hasPay || changeAmount > 0 || Number(publicRedeemAmt) === 0;
  const nullifier = keccak256Bytes(
    concatBytes(utf8ToBytes('SLX_NULLIFIER_V1:'), bankBytes, u64BEBytes(noteId), scalarToLeBytes32(claimSk))
  );

  const changeClaimKey = hasChange
    ? deriveEd25519Keypair(randomBytes(32), `SHD_CHANGE_${noteId}`)
    : null;
  const changeLockBytes = hasChange ? changeClaimKey.pub32Bytes : new Uint8Array(32);
  const payLockBytes = hasPay ? hexToBytes(payLockPtHex) : new Uint8Array(32);
  const pubRecipAddr = Number(publicRedeemAmt) > 0 ? publicRecipient : ZERO_ADDR;

  const spendCtx = concatBytes(
    utf8ToBytes('SLX_SHD_SPEND_V1:'),
    bankBytes,
    u64BEBytes(noteId),
    nullifier,
    u64BEBytes(publicRedeemAmt),
    hexToBytes(pubRecipAddr).slice(-20),
    changeLockBytes,
    payLockBytes
  );
  const spendSig64 = proveEd25519Schnorr(claimSk, ED25519_BASEPOINT_BYTES, spendCtx);

  const splitPrefix = concatBytes(
    utf8ToBytes('SLX_SHD_SPLIT_V1:'),
    bankBytes,
    u64BEBytes(noteId),
    nullifier
  );

  let rangeProofsBlob = new Uint8Array(0);
  let rRem = rOld;
  let changeEnv = new Uint8Array(0);
  let payEnv = new Uint8Array(0);

  if (hasPay) {
    const payPrf = proveHeRangeU24(auditPub32Hex, payAmount, splitPrefix, 0);
    const chPrf = proveHeRangeU24(auditPub32Hex, changeAmount, splitPrefix, 1);
    rangeProofsBlob = concatBytes(payPrf.proof4608, chPrf.proof4608);
    rRem = mod(rOld - payPrf.rScalar - chPrf.rScalar, ED25519_L);
    if (payRecipientSecpPub64Hex) {
      payEnv = encryptJsonForRecipientSecp(
        {
          t: 'B2B_PAYMENT_V1',
          amt: Number(payAmount),
          rHex: bytesToHex(scalarToLeBytes32(payPrf.rScalar), true),
        },
        payRecipientSecpPub64Hex,
        'SLX_CONF_LINE_V1'
      );
    }
    if (ownerSecpPub64Hex) {
      changeEnv = encryptJsonForRecipientSecp(
        {
          t: 'CHANGE_NOTE_V1',
          amt: changeAmount,
          rHex: bytesToHex(scalarToLeBytes32(chPrf.rScalar), true),
          claimSkHex: changeClaimKey.secretHex32,
        },
        ownerSecpPub64Hex,
        'SLX_CONF_LINE_V1'
      );
    }
  } else if (hasChange) {
    const chPrf = proveHeRangeU24(auditPub32Hex, changeAmount, splitPrefix, 1);
    rangeProofsBlob = chPrf.proof4608;
    rRem = mod(rOld - chPrf.rScalar, ED25519_L);
    if (ownerSecpPub64Hex) {
      changeEnv = encryptJsonForRecipientSecp(
        {
          t: 'CHANGE_NOTE_V1',
          amt: changeAmount,
          rHex: bytesToHex(scalarToLeBytes32(chPrf.rScalar), true),
          claimSkHex: changeClaimKey.secretHex32,
        },
        ownerSecpPub64Hex,
        'SLX_CONF_LINE_V1'
      );
    }
  }

  const modeByte = hasPay ? 2 : hasChange ? 1 : 0;
  const consCtx = concatBytes(
    utf8ToBytes('SLX_SHD_CONS_V1:'),
    bankBytes,
    u64BEBytes(noteId),
    nullifier,
    u64BEBytes(publicRedeemAmt),
    new Uint8Array([modeByte])
  );
  const consDleq64 = proveHeSumEqualsU64(auditPub32Hex, rRem, consCtx);
  const envBlob =
    changeEnv.length > 0 || payEnv.length > 0
      ? concatBytes(u16BEBytes(changeEnv.length), changeEnv, u16BEBytes(payEnv.length), payEnv)
      : new Uint8Array(0);

  return {
    calldata: encodeAbi(
      'spendOrRedeemShieldedNote(uint64,bytes32,uint64,address,bytes32,bytes32,bytes,bytes,bytes)',
      [
        ['uint64', noteId],
        ['bytes32', bytesToHex(nullifier, true)],
        ['uint64', publicRedeemAmt],
        ['address', pubRecipAddr],
        ['bytes32', bytesToHex(changeLockBytes, true)],
        ['bytes32', bytesToHex(payLockBytes, true)],
        ['bytes', rangeProofsBlob],
        ['bytes', concatBytes(spendSig64, consDleq64)],
        ['bytes', envBlob],
      ]
    ),
    nullifierHex: bytesToHex(nullifier, true),
    changeAmount,
    changeClaimSecretHex: changeClaimKey ? changeClaimKey.secretHex32 : null,
  };
}

// ============================================================================
// 6. Binary Slice Decoders for UI & SDK Consumers
// ============================================================================

export function decodeConfidentialCategoriesHex(rawHex) {
  const b = hexToBytes(rawHex);
  if (b.length < 4) return [];
  const count = readU32BE(b, 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = 4 + i * 120;
    if (off + 120 > b.length) break;
    const lblLen = Math.min(48, b[off + 35]);
    out.push({
      categoryId: bytesToHex(b.slice(off, off + 32), true),
      kind: b[off + 32],
      mode: b[off + 33],
      minSlots: b[off + 34],
      batchCount: readU32BE(b, off + 36),
      totalPosted: Number(readU64BE(b, off + 40)),
      activeBacklog: Number(readU64BE(b, off + 48)),
      openArOrAp: Number(readU64BE(b, off + 56)),
      settledCash: Number(readU64BE(b, off + 64)),
      label: bytesToUtf8(b.slice(off + 72, off + 72 + lblLen)),
    });
  }
  return out;
}

export function decodeConfidentialBatchesSliceHex(rawHex) {
  const b = hexToBytes(rawHex);
  if (b.length < 16) return { total: 0, items: [] };
  const total = Number(readU64BE(b, 0));
  const returned = Number(readU64BE(b, 8));
  const items = [];
  let pos = 16;
  for (let i = 0; i < returned && pos + 8 + 244 + 4 <= b.length; i++) {
    const batchId = Number(readU64BE(b, pos));
    pos += 8;
    const hdr = b.slice(pos, pos + 244);
    pos += 244;
    const audLen = readU16BE(b, pos);
    const slLen = readU16BE(b, pos + 2);
    pos += 4;
    if (pos + audLen + slLen > b.length) break;
    const audBytes = b.slice(pos, pos + audLen);
    pos += audLen;
    const slBytes = b.slice(pos, pos + slLen);
    pos += slLen;

    const slots = [];
    if (slBytes.length >= 2 && hdr[73] === 1) {
      const scnt = readU16BE(slBytes, 0);
      let sp = 2;
      for (let s = 0; s < scnt && sp + 98 <= slBytes.length; s++) {
        const claimLockHex = bytesToHex(slBytes.slice(sp, sp + 32), true);
        const ct64 = slBytes.slice(sp + 32, sp + 96);
        const elen = readU16BE(slBytes, sp + 96);
        sp += 98;
        if (sp + elen > slBytes.length) break;
        const env = slBytes.slice(sp, sp + elen);
        sp += elen;
        slots.push({ slotIdx: s, claimLockHex, ct64, envelope: env });
      }
    }

    const firstNoteRaw = readU64BE(hdr, 84);
    items.push({
      batchId,
      categoryId: bytesToHex(hdr.slice(0, 32), true),
      periodHex: bytesToHex(hdr.slice(32, 64), true),
      periodLabel: decodePeriodTagBytes32(hdr.slice(32, 64)),
      auditEpoch: Number(readU64BE(hdr, 64)),
      kind: hdr[72],
      batchType: hdr[73],
      isPaid: hdr[74] === 1,
      slotCount: hdr[75],
      totalAmount: Number(readU64BE(hdr, 76)),
      firstNoteId: firstNoteRaw === 0xffffffffffffffffn ? null : Number(firstNoteRaw),
      journalId: Number(readU64BE(hdr, 92)),
      blockNumber: Number(readU64BE(hdr, 100)),
      cSum64: hdr.slice(108, 172),
      sumDleq64: hdr.slice(172, 236),
      auditCipher: audBytes,
      slots,
      rawSlotsBlob: slBytes,
    });
  }
  return { total, items };
}

export function decodeConfidentialReceivablesSliceHex(rawHex) {
  const b = hexToBytes(rawHex);
  if (b.length < 16) return { total: 0, items: [] };
  const total = Number(readU64BE(b, 0));
  const returned = Number(readU64BE(b, 8));
  const items = [];
  let pos = 16;
  for (let i = 0; i < returned && pos + 8 + 324 + 4 <= b.length; i++) {
    const recId = Number(readU64BE(b, pos));
    pos += 8;
    const hdr = b.slice(pos, pos + 324);
    pos += 324;
    const audLen = readU16BE(b, pos);
    const cliLen = readU16BE(b, pos + 2);
    pos += 4;
    if (pos + audLen + cliLen > b.length) break;
    const audEnv = b.slice(pos, pos + audLen);
    pos += audLen;
    const cliEnv = b.slice(pos, pos + cliLen);
    pos += cliLen;

    items.push({
      recId,
      categoryId: bytesToHex(hdr.slice(0, 32), true),
      periodHex: bytesToHex(hdr.slice(32, 64), true),
      periodLabel: decodePeriodTagBytes32(hdr.slice(32, 64)),
      auditEpoch: Number(readU64BE(hdr, 64)),
      status: hdr[72],
      totalMonths: readU32BE(hdr, 76),
      billedMonths: readU32BE(hdr, 80),
      monthBlocks: Number(readU64BE(hdr, 84)),
      startBlock: Number(readU64BE(hdr, 92)),
      stealthH32Hex: bytesToHex(hdr.slice(100, 132), true),
      blindedClientPk32Hex: bytesToHex(hdr.slice(132, 164), true),
      claimLockHex: bytesToHex(hdr.slice(164, 196), true),
      cMonthly64: hdr.slice(196, 260),
      cBacklog64: hdr.slice(260, 324),
      auditEnvelope: audEnv,
      clientEnvelope: cliEnv,
    });
  }
  return { total, items };
}

export function decodeShieldedNotesSliceHex(rawHex) {
  const b = hexToBytes(rawHex);
  if (b.length < 16) return { total: 0, items: [] };
  const total = Number(readU64BE(b, 0));
  const returned = Number(readU64BE(b, 8));
  const items = [];
  let pos = 16;
  for (let i = 0; i < returned && pos + 10 <= b.length; i++) {
    const noteId = Number(readU64BE(b, pos));
    const recLen = readU16BE(b, pos + 8);
    pos += 10;
    if (recLen < 155 || pos + recLen > b.length) break;
    const r = b.slice(pos, pos + recLen);
    pos += recLen;
    const envLen = readU16BE(r, 153);
    items.push({
      noteId,
      spent: r[0] === 1,
      auditPkHex: bytesToHex(r.slice(1, 33), true),
      claimLockHex: bytesToHex(r.slice(33, 65), true),
      ct64: r.slice(65, 129),
      batchTagHex: bytesToHex(r.slice(129, 145), true),
      createdBlock: Number(readU64BE(r, 145)),
      envelope: r.slice(155, 155 + envLen),
    });
  }
  return { total, items };
}

export function decodeAuditorGrantsSliceHex(rawHex) {
  const b = hexToBytes(rawHex);
  if (b.length < 16) return { total: 0, items: [] };
  const total = Number(readU64BE(b, 0));
  const returned = Number(readU64BE(b, 8));
  const items = [];
  let pos = 16;
  for (let i = 0; i < returned && pos + 10 <= b.length; i++) {
    const grantId = Number(readU64BE(b, pos));
    const recLen = readU16BE(b, pos + 8);
    pos += 10;
    if (recLen < 103 || pos + recLen > b.length) break;
    const r = b.slice(pos, pos + recLen);
    pos += recLen;
    const envLen = readU16BE(r, 101);
    items.push({
      grantId,
      epoch: Number(readU64BE(r, 0)),
      categoryId: bytesToHex(r.slice(8, 40), true),
      periodHex: bytesToHex(r.slice(40, 72), true),
      periodLabel: decodePeriodTagBytes32(r.slice(40, 72)),
      auditorIdentity: bytesToHex(r.slice(72, 92), true).toLowerCase(),
      grantedBlock: Number(readU64BE(r, 92)),
      revoked: r[100] === 1,
      envelope: r.slice(103, 103 + envLen),
    });
  }
  return { total, items };
}

export function decodeIas24InsidersHex(rawHex) {
  const b = hexToBytes(rawHex);
  if (b.length < 2) return [];
  const count = readU16BE(b, 0);
  const out = [];
  for (let i = 0; i < count && 2 + (i + 1) * 52 <= b.length; i++) {
    const off = 2 + i * 52;
    const idLow = bytesToHex(b.slice(off, off + 20), true).toLowerCase();
    out.push({
      identity: idLow,
      identityAddr: idLow,
      edPub32Bytes: b.slice(off + 20, off + 52),
      edPub32Hex: bytesToHex(b.slice(off + 20, off + 52), true),
    });
  }
  return out;
}
