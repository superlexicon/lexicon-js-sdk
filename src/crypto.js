/**
 * @superlexicon/sdk/crypto
 *
 * Zero-dependency cryptographic, RLP, and transaction-signing primitives for SuperLexicon:
 *  - Byte, hex & UTF-8 conversion helpers + CSPRNG `randomBytes`
 *  - Pure-BigInt Keccak-256 (`keccak256Bytes`, `keccak256Hex`, `selectorBytes`, `eventTopic`)
 *  - Pure-BigInt `secp256k1` key generation, public-key/EOA derivation & canonical low-S ECDSA signing
 *  - Lexicon 10-field EIP-155 `$0`-gas `extraTargets` RLP transaction signing (`signLexiconTx`)
 *  - Canonical intra-block `txHash` ordering (`signOrderedLexiconTx` via `lowerBoundHashHex`)
 */

// ---------------------------------------------------------------------------
// 1. Byte, Hex, UTF-8 & CSPRNG Utilities
// ---------------------------------------------------------------------------

export function hexToBytes(hex) {
  const s = String(hex || '');
  const clean = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
  if (clean.length === 0) return new Uint8Array(0);
  const padded = clean.length % 2 === 1 ? '0' + clean : clean;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes, prefix = true) {
  let s = prefix ? '0x' : '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

export function utf8ToBytes(str) {
  return new TextEncoder().encode(String(str ?? ''));
}

export function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

export function randomBytes(len) {
  const out = new Uint8Array(len);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(out);
  } else {
    throw new Error('CSPRNG crypto.getRandomValues is unavailable in this environment');
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Keccak-256 (Ethereum / SuperLexicon Standard, 0x01 Domain Byte)
// ---------------------------------------------------------------------------

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const KECCAK_ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const KECCAK_PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const MASK_64 = 0xffffffffffffffffn;

function rotl64(x, n) {
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK_64;
}

function keccakF1600(st) {
  const bc = new Array(5);
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) {
        st[j + i] = (st[j + i] ^ t) & MASK_64;
      }
    }
    let t = st[1];
    for (let i = 0; i < 24; i++) {
      const j = KECCAK_PILN[i];
      const tmp = st[j];
      st[j] = rotl64(t, KECCAK_ROTC[i]);
      t = tmp;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = st[j + i];
      for (let i = 0; i < 5; i++) {
        st[j + i] = (st[j + i] ^ ((~bc[(i + 1) % 5] & MASK_64) & bc[(i + 2) % 5])) & MASK_64;
      }
    }
    st[0] = (st[0] ^ KECCAK_RC[round]) & MASK_64;
  }
}

export function keccak256Bytes(input) {
  const data =
    typeof input === 'string'
      ? input.startsWith('0x') || input.startsWith('0X')
        ? hexToBytes(input)
        : utf8ToBytes(input)
      : input;
  const rate = 136; // 1088 bits
  const st = new Array(25).fill(0n);

  const rem = data.length % rate;
  const padded = new Uint8Array(data.length + (rate - rem));
  padded.set(data);
  padded[data.length] |= 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < 17; i++) {
      let lane = 0n;
      const base = off + i * 8;
      for (let b = 0; b < 8; b++) {
        lane |= BigInt(padded[base + b]) << BigInt(8 * b);
      }
      st[i] = (st[i] ^ lane) & MASK_64;
    }
    keccakF1600(st);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const lane = st[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number((lane >> BigInt(8 * b)) & 0xffn);
    }
  }
  return out;
}

export function keccak256Hex(input) {
  return bytesToHex(keccak256Bytes(input), true);
}

export function selectorBytes(signature) {
  return keccak256Bytes(utf8ToBytes(signature)).slice(0, 4);
}

export function selectorHex(signature) {
  return bytesToHex(selectorBytes(signature), true);
}

export function eventTopic(signature) {
  return keccak256Hex(utf8ToBytes(signature)).toLowerCase();
}

// ---------------------------------------------------------------------------
// 3. Pure-BigInt secp256k1 Keypair Derivation & Canonical Low-S ECDSA Signing
// ---------------------------------------------------------------------------

export const SECP256K1_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_HALF_N = SECP256K1_N >> 1n;
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a, m = SECP256K1_P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInv(a, m = SECP256K1_P) {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = mod(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('secp256k1 value not invertible');
  return t < 0n ? t + m : t;
}

function pointDouble([X1, Y1, Z1]) {
  if (Z1 === 0n || Y1 === 0n) return [0n, 1n, 0n];
  const Y1_2 = mod(Y1 * Y1);
  const S = mod(4n * X1 * Y1_2);
  const M = mod(3n * mod(X1 * X1));
  const X3 = mod(M * M - 2n * S);
  const Y3 = mod(M * (S - X3) - 8n * mod(Y1_2 * Y1_2));
  const Z3 = mod(2n * Y1 * Z1);
  return [X3, Y3, Z3];
}

function pointAdd([X1, Y1, Z1], [X2, Y2, Z2]) {
  if (Z1 === 0n) return [X2, Y2, Z2];
  if (Z2 === 0n) return [X1, Y1, Z1];
  const Z1Z1 = mod(Z1 * Z1);
  const Z2Z2 = mod(Z2 * Z2);
  const U1 = mod(X1 * Z2Z2);
  const U2 = mod(X2 * Z1Z1);
  const S1 = mod(Y1 * mod(Z2 * Z2Z2));
  const S2 = mod(Y2 * mod(Z1 * Z1Z1));
  if (U1 === U2) {
    return S1 === S2 ? pointDouble([X1, Y1, Z1]) : [0n, 1n, 0n];
  }
  const H = mod(U2 - U1);
  const I = mod(4n * H * H);
  const J = mod(H * I);
  const r = mod(2n * (S2 - S1));
  const V = mod(U1 * I);
  const X3 = mod(r * r - J - 2n * V);
  const Y3 = mod(r * (V - X3) - 2n * S1 * J);
  const Z3 = mod(((Z1 + Z2) * (Z1 + Z2) - Z1Z1 - Z2Z2) * H);
  return [X3, Y3, Z3];
}

function scalarMulPoint(k, px, py) {
  const x = mod(px, SECP256K1_P);
  const y = mod(py, SECP256K1_P);
  // Verify point lies on secp256k1: y^2 == x^3 + 7 (mod p)
  const lhs = mod(y * y, SECP256K1_P);
  const rhs = mod(mod(x * x, SECP256K1_P) * x + 7n, SECP256K1_P);
  if (lhs !== rhs) {
    throw new Error('Invalid peer secp256k1 public key point');
  }
  let n = mod(k, SECP256K1_N);
  if (n === 0n) throw new Error('Invalid zero ECDH scalar');
  let res = [0n, 1n, 0n];
  let addend = [x, y, 1n];
  while (n > 0n) {
    if (n & 1n) res = pointAdd(res, addend);
    addend = pointDouble(addend);
    n >>= 1n;
  }
  if (res[2] === 0n) throw new Error('Invalid ECDH point at infinity');
  const zInv = modInv(res[2], SECP256K1_P);
  const zInv2 = mod(zInv * zInv);
  const zInv3 = mod(zInv2 * zInv);
  return [mod(res[0] * zInv2), mod(res[1] * zInv3)];
}

function scalarMulG(k) {
  return scalarMulPoint(k, SECP_GX, SECP_GY);
}

function bigIntTo32Bytes(n) {
  return hexToBytes(n.toString(16).padStart(64, '0'));
}

function bytesToBigInt(bytes) {
  if (bytes.length === 0) return 0n;
  return BigInt(bytesToHex(bytes, true));
}

export function generatePrivateKeyHex() {
  while (true) {
    const b = randomBytes(32);
    const d = bytesToBigInt(b);
    if (d > 0n && d < SECP256K1_N) return bytesToHex(b, true);
  }
}

export function normalizePrivateKeyHex(rawInput) {
  const trimmed = String(rawInput || '').trim();
  const clean = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Private key must be 64 hex characters (32 bytes).');
  }
  const bytes = hexToBytes(clean);
  const d = bytesToBigInt(bytes);
  if (d <= 0n || d >= SECP256K1_N) {
    throw new Error('Private key scalar out of valid secp256k1 range.');
  }
  return '0x' + clean.toLowerCase();
}

export function deriveKeypairInfo(privateKeyHex) {
  const normPriv = normalizePrivateKeyHex(privateKeyHex);
  const d = bytesToBigInt(hexToBytes(normPriv));
  const [px, py] = scalarMulG(d);
  const xBytes = bigIntTo32Bytes(px);
  const yBytes = bigIntTo32Bytes(py);
  const pubRaw64 = concatBytes(xBytes, yBytes);
  const hash = keccak256Bytes(pubRaw64);
  const address = bytesToHex(hash.slice(12, 32), true);
  const prefixByte = (py & 1n) === 0n ? 0x02 : 0x03;
  const compressedPubKey = bytesToHex(concatBytes(new Uint8Array([prefixByte]), xBytes), true);
  const uncompressedPubKey = bytesToHex(concatBytes(new Uint8Array([0x04]), pubRaw64), true);
  return {
    privateKey: normPriv,
    compressedPubKey,
    uncompressedPubKey,
    address,
  };
}

export function computeAddress(privateKeyHex) {
  const normPriv = normalizePrivateKeyHex(privateKeyHex);
  const d = bytesToBigInt(hexToBytes(normPriv));
  const [px, py] = scalarMulG(d);
  const pubUncompressed = concatBytes(bigIntTo32Bytes(px), bigIntTo32Bytes(py));
  const hash = keccak256Bytes(pubUncompressed);
  return bytesToHex(hash.slice(12, 32), true);
}

/**
 * Compute a 32-byte `secp256k1` ECDH shared secret (`keccak256(domain || sharedX)`)
 * from `privateKeyHex` and `peerUncompressedPubHex` (`64`-byte `X||Y` or `65`-byte `0x04||X||Y`).
 */
export function ecdhSharedSecretBytes(
  privateKeyHex,
  peerUncompressedPubHex,
  domain = 'SLX_ECDH_V1'
) {
  const normPriv = normalizePrivateKeyHex(privateKeyHex);
  const d = bytesToBigInt(hexToBytes(normPriv));
  const raw =
    peerUncompressedPubHex instanceof Uint8Array
      ? peerUncompressedPubHex
      : hexToBytes(peerUncompressedPubHex);
  let xy;
  if (raw.length === 65 && raw[0] === 0x04) {
    xy = raw.slice(1, 65);
  } else if (raw.length === 64) {
    xy = raw;
  } else {
    throw new Error('ECDH expects 64-byte raw X||Y or 65-byte 0x04||X||Y uncompressed public key');
  }
  const px = bytesToBigInt(xy.slice(0, 32));
  const py = bytesToBigInt(xy.slice(32, 64));
  const [sx] = scalarMulPoint(d, px, py);
  return keccak256Bytes(concatBytes(utf8ToBytes(domain), bigIntTo32Bytes(sx)));
}

/**
 * Symmetric Keccak-256 CTR stream cipher over an `ecdhSharedSecretBytes` key + context nonce.
 * Encrypts and decrypts identically (`ecdhXorTransform(key, ctx, cipher) === plain`).
 */
export function ecdhXorTransform(sharedSecret32, contextBytes, payloadBytes) {
  const key = typeof sharedSecret32 === 'string' ? hexToBytes(sharedSecret32) : sharedSecret32;
  const ctx =
    typeof contextBytes === 'string'
      ? contextBytes.startsWith('0x')
        ? hexToBytes(contextBytes)
        : utf8ToBytes(contextBytes)
      : contextBytes;
  const data = typeof payloadBytes === 'string' ? hexToBytes(payloadBytes) : payloadBytes;
  const out = new Uint8Array(data.length);
  const ctr = new Uint8Array(4);
  for (let off = 0, blk = 0; off < data.length; off += 32, blk++) {
    ctr[0] = (blk >>> 24) & 0xff;
    ctr[1] = (blk >>> 16) & 0xff;
    ctr[2] = (blk >>> 8) & 0xff;
    ctr[3] = blk & 0xff;
    const stream = keccak256Bytes(concatBytes(key, ctx, ctr));
    const take = Math.min(32, data.length - off);
    for (let i = 0; i < take; i++) {
      out[off + i] = data[off + i] ^ stream[i];
    }
  }
  return out;
}

export function signSecp256k1(privateKeyHex, digest32) {
  const normPriv = normalizePrivateKeyHex(privateKeyHex);
  const d = bytesToBigInt(hexToBytes(normPriv));
  const digestBytes = typeof digest32 === 'string' ? hexToBytes(digest32) : digest32;
  if (digestBytes.length !== 32) {
    throw new Error('signSecp256k1 expects a 32-byte message digest');
  }
  const z = bytesToBigInt(digestBytes);

  for (let counter = 0; counter < 64; counter++) {
    const kSeed = keccak256Bytes(
      concatBytes(bigIntTo32Bytes(d), digestBytes, new Uint8Array([counter]))
    );
    const k = bytesToBigInt(kSeed);
    if (k === 0n || k >= SECP256K1_N) continue;

    const [rx, ry] = scalarMulG(k);
    const r = rx % SECP256K1_N;
    if (r === 0n) continue;

    const kInv = modInv(k, SECP256K1_N);
    let s = mod(kInv * mod(z + r * d, SECP256K1_N), SECP256K1_N);
    if (s === 0n) continue;

    let yParity = Number(ry & 1n);
    if (s > SECP_HALF_N) {
      s = SECP256K1_N - s;
      yParity ^= 1;
    }
    return { r, s, yParity };
  }
  throw new Error('Failed to generate canonical secp256k1 signature');
}

// ---------------------------------------------------------------------------
// 4. RLP & SuperLexicon 10-Field Zero-Gas `extraTargets` Transaction Signing
// ---------------------------------------------------------------------------

function encodeLength(len, offset) {
  if (len < 56) return new Uint8Array([len + offset]);
  let hex = len.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  const lenBytes = hexToBytes(hex);
  return concatBytes(new Uint8Array([offset + 55 + lenBytes.length]), lenBytes);
}

export function encodeRlpBytes(item) {
  if (Array.isArray(item)) {
    const encodedItems = item.map((sub) => encodeRlpBytes(sub));
    const payload = concatBytes(...encodedItems);
    return concatBytes(encodeLength(payload.length, 0xc0), payload);
  }
  const bytes = typeof item === 'string' ? hexToBytes(item) : item;
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return concatBytes(encodeLength(bytes.length, 0x80), bytes);
}

function bigIntToRlpItem(v) {
  const n = BigInt(v);
  if (n === 0n) return new Uint8Array(0);
  let hex = n.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  return hexToBytes(hex);
}

export function computeRawTxHash(rawTxHex) {
  return keccak256Hex(hexToBytes(rawTxHex)).toLowerCase();
}

function signLexiconTxSingle({
  privateKey,
  nonce,
  to = null,
  value = 0n,
  data = '0x',
  gasLimit = 5_000_000n,
  gasPrice = 1_000_000_000n,
  chainId = 1337n,
  extraTargets = [],
}) {
  const toBytes = to ? hexToBytes(to) : new Uint8Array(0);
  const dataBytes = typeof data === 'string' ? hexToBytes(data) : data;
  const targetSet = [];
  if (to) targetSet.push(String(to).toLowerCase());
  for (const t of extraTargets || []) {
    if (!t) continue;
    const low = String(t).toLowerCase();
    if (!targetSet.includes(low)) targetSet.push(low);
  }
  const targetItems = targetSet.map((a) => hexToBytes(a));

  const preimage = encodeRlpBytes([
    bigIntToRlpItem(nonce),
    bigIntToRlpItem(gasPrice),
    bigIntToRlpItem(gasLimit),
    toBytes,
    bigIntToRlpItem(value),
    dataBytes,
    targetItems,
    bigIntToRlpItem(chainId),
    new Uint8Array(0),
    new Uint8Array(0),
  ]);

  const digest = keccak256Bytes(preimage);
  const sig = signSecp256k1(privateKey, digest);
  const v = BigInt(sig.yParity) + BigInt(chainId) * 2n + 35n;

  const rawTx = encodeRlpBytes([
    bigIntToRlpItem(nonce),
    bigIntToRlpItem(gasPrice),
    bigIntToRlpItem(gasLimit),
    toBytes,
    bigIntToRlpItem(value),
    dataBytes,
    bigIntToRlpItem(v),
    bigIntToRlpItem(sig.r),
    bigIntToRlpItem(sig.s),
    targetItems,
  ]);

  return bytesToHex(rawTx, true);
}

/**
 * Sign a SuperLexicon transaction AND optionally enforce canonical intra-block `txHash` ordering
 * (`txHash > lowerBoundHashHex`) so dependent transactions execute sequentially in a single block!
 * Returns `{ raw, txHash, gasLimitUsed }`.
 */
export function signOrderedLexiconTx({
  privateKey,
  nonce,
  to = null,
  value = 0n,
  data = '0x',
  gasLimit = 5_000_000n,
  gasPrice = 50_000_000_000n,
  chainId = 1337n,
  extraTargets = [],
  lowerBoundHashHex = null,
  candidatePool = 12,
  maxSalt = 192n,
}) {
  const baseGas = BigInt(gasLimit);
  const lb = lowerBoundHashHex ? String(lowerBoundHashHex).toLowerCase() : null;
  if (!lb) {
    const raw = signLexiconTxSingle({
      privateKey,
      nonce,
      to,
      value,
      data,
      gasLimit: baseGas,
      gasPrice,
      chainId,
      extraTargets,
    });
    return { raw, txHash: computeRawTxHash(raw), gasLimitUsed: baseGas };
  }

  let best = null;
  let valid = 0;
  for (let salt = 0n; salt < BigInt(maxSalt); salt++) {
    const tryGas = baseGas + salt;
    const raw = signLexiconTxSingle({
      privateKey,
      nonce,
      to,
      value,
      data,
      gasLimit: tryGas,
      gasPrice,
      chainId,
      extraTargets,
    });
    const txHash = computeRawTxHash(raw);
    if (txHash > lb) {
      if (!best || txHash < best.txHash) {
        best = { raw, txHash, gasLimitUsed: tryGas };
      }
      valid += 1;
      if (valid >= candidatePool) break;
    }
  }
  if (best) return best;

  const fallback = signLexiconTxSingle({
    privateKey,
    nonce,
    to,
    value,
    data,
    gasLimit: baseGas,
    gasPrice,
    chainId,
    extraTargets,
  });
  return { raw: fallback, txHash: computeRawTxHash(fallback), gasLimitUsed: baseGas };
}

/**
 * Sign a SuperLexicon 10-field EIP-155 `$0`-gas transaction and return the `0x`-prefixed RLP hex string.
 * Supports optional `lowerBoundHashHex` for same-block sequential pipelining.
 */
export function signLexiconTx(txParams) {
  if (txParams && txParams.lowerBoundHashHex) {
    return signOrderedLexiconTx(txParams).raw;
  }
  return signLexiconTxSingle(txParams);
}
