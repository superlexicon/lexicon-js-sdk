/**
 * @superlexicon/sdk/bulletproofs
 *
 * Zero-Trusted-Setup Bulletproofs (`Edwards25519`) Range & Sparse R1CS Prover/Verifier
 * + Arbiter-Free Zero-Knowledge `Cipher Noir` Cryptographic Suite:
 *  - Byte-for-byte identical to `superlexicon-app` (`src/vm/bulletproofs.rs`) and `hps-sdk`
 *  - `bpProveRangeU64Batch` / `bpVerifyRangeU64Batch` (`[0, 2^bitWidth)`)
 *  - `BpCsBuilder` + `bpProveR1cs` / `bpVerifyR1cs` (General Sparse R1CS over `Edwards25519`)
 *  - Deterministic `Cipher Noir` Seat Key & DDH/Pedersen Blinding Derivation, 16-gate Grand-Product
 *    Deck Shuffle Proofs, 16-gate Non-Membership `passAlibiCheck` R1CS Proofs, 1-of-3 Disjunctive
 *    Schnorr ElGamal Whispers, and Non-Zero Co-Blinded Indictment Proofs.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  keccak256Bytes,
} from './crypto.js';
import { u16BEBytes, u64BEBytes, readU16BE, readU32BE, readU64BE } from './abi.js';
import {
  sha512Bytes,
  ED25519_L,
  ED_IDENTITY_PT,
  ED_BASE_PT,
  edAdd,
  edNeg,
  edMul,
  edEncode,
  edDecode,
  edIsIdentity,
  IDENTITY_POINT_BYTES,
  leBytesToBigInt,
  scalarToLeBytes32,
  randomEdScalar,
} from './confidential.js';

export const BP_WIRE_A_L = 0;
export const BP_WIRE_A_R = 1;
export const BP_WIRE_A_O = 2;
export const BP_WIRE_VAR = 3;

export const BP_H_BLIND_HEX =
  '0xe0d1712b6bdf25292168e835af4933c5a7deba279dd57971d41ed81bea17bd8b';

function modL(x) {
  const r = BigInt(x) % ED25519_L;
  return r < 0n ? r + ED25519_L : r;
}

function modPowL(base, exp) {
  let res = 1n;
  let b = modL(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % ED25519_L;
    b = (b * b) % ED25519_L;
    e >>= 1n;
  }
  return res;
}

export function scalarInvL(a) {
  const x = modL(a);
  if (x === 0n) throw new Error('scalarInvL(0)');
  return modPowL(x, ED25519_L - 2n);
}

function u32BE(n) {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function asBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return v.startsWith('0x') ? hexToBytes(v) : utf8ToBytes(v);
  return new Uint8Array(v || []);
}

function edMulCofactor8(P) {
  const p2 = edAdd(P, P);
  const p4 = edAdd(p2, p2);
  return edAdd(p4, p4);
}

/**
 * Matches `vrf::hash_to_curve` (`SLX_VM_VRF_H2C_V1` + Try-and-Increment + `8 * P` cofactor clear).
 */
export function edHashToCurve(alphaInput) {
  const alpha = asBytes(alphaInput);
  const prefix = utf8ToBytes('SLX_VM_VRF_H2C_V1');
  const lenBe = u64BEBytes(alpha.length);
  for (let ctr = 0; ctr <= 255; ctr++) {
    const digest = sha512Bytes(concatBytes(prefix, lenBe, alpha, new Uint8Array([ctr])));
    const cand = digest.slice(0, 32);
    cand[31] &= 0x7f;
    const rawPt = edDecode(cand);
    if (rawPt) {
      const cleared = edMulCofactor8(rawPt);
      if (!edIsIdentity(cleared)) return cleared;
    }
  }
  return ED_BASE_PT;
}

let _cachedGens = null;
const _gVecCache = [];
const _hVecCache = [];

export function bpGenerators(minVecLen = 16) {
  if (!_cachedGens) {
    _cachedGens = {
      bVal: ED_BASE_PT,
      hBlind: edHashToCurve('SLX_BP_H_BLIND_V1'),
      uIpa: edHashToCurve('SLX_BP_U_IPA_V1'),
    };
  }
  while (_gVecCache.length < minVecLen) {
    const idx = _gVecCache.length;
    _gVecCache.push(edHashToCurve(concatBytes(utf8ToBytes('SLX_BP_G_VEC_V1:'), u32BE(idx))));
    _hVecCache.push(edHashToCurve(concatBytes(utf8ToBytes('SLX_BP_H_VEC_V1:'), u32BE(idx))));
  }
  return {
    bVal: _cachedGens.bVal,
    hBlind: _cachedGens.hBlind,
    uIpa: _cachedGens.uIpa,
    gVec: _gVecCache,
    hVec: _hVecCache,
  };
}

export function bpPedersenCommit(valScalar, blindScalar) {
  const gens = bpGenerators(0);
  return edEncode(edAdd(edMul(modL(valScalar), gens.bVal), edMul(modL(blindScalar), gens.hBlind)));
}

export function bpPedersenCommitU64(valU64, blindScalar) {
  return bpPedersenCommit(BigInt(valU64), blindScalar);
}

function edMultiScalarMul(scalars, points) {
  let acc = ED_IDENTITY_PT;
  for (let i = 0; i < scalars.length; i++) {
    const s = modL(scalars[i]);
    if (s !== 0n) {
      acc = edAdd(acc, edMul(s, points[i]));
    }
  }
  return acc;
}

// ============================================================================
// Deterministic SHA-512 Fiat-Shamir Transcript (`SLX_BP_TRANSCRIPT_INIT_V1_000000`)
// ============================================================================

export class BpTranscript {
  constructor(domain) {
    this.state = utf8ToBytes('SLX_BP_TRANSCRIPT_INIT_V1_000000');
    this.appendBytes('dom-sep', domain);
  }

  appendBytes(label, data) {
    const lb = asBytes(label);
    const db = asBytes(data);
    const d = sha512Bytes(
      concatBytes(
        utf8ToBytes('SLX_BP_FS_ABSORB'),
        this.state,
        u32BE(lb.length),
        lb,
        u32BE(db.length),
        db
      )
    );
    this.state = d.slice(0, 32);
  }

  appendU64(label, val) {
    this.appendBytes(label, u64BEBytes(BigInt(val)));
  }

  appendPoint(label, pt) {
    this.appendBytes(label, edEncode(pt));
  }

  appendScalar(label, sc) {
    this.appendBytes(label, scalarToLeBytes32(sc));
  }

  challengeScalar(label) {
    const lb = asBytes(label);
    const wide = sha512Bytes(
      concatBytes(utf8ToBytes('SLX_BP_FS_SQUEEZE'), this.state, u32BE(lb.length), lb)
    );
    const nextD = sha512Bytes(concatBytes(utf8ToBytes('SLX_BP_FS_NEXT'), wide));
    this.state = nextD.slice(0, 32);
    const sc = leBytesToBigInt(wide) % ED25519_L;
    return sc === 0n ? 1n : sc;
  }
}

function deriveBlindingScalar(seed32, domainStr, idx) {
  const dom = utf8ToBytes(domainStr);
  const wide = sha512Bytes(
    concatBytes(utf8ToBytes('SLX_BP_BLIND_NONCE_V1'), seed32, u32BE(dom.length), dom, u32BE(idx))
  );
  return leBytesToBigInt(wide) % ED25519_L;
}

function innerProduct(a, b) {
  let acc = 0n;
  for (let i = 0; i < a.length; i++) {
    acc = (acc + modL(a[i]) * modL(b[i])) % ED25519_L;
  }
  return acc;
}

function powersOf(base, n) {
  const out = new Array(n);
  let cur = 1n;
  const b = modL(base);
  for (let i = 0; i < n; i++) {
    out[i] = cur;
    cur = (cur * b) % ED25519_L;
  }
  return out;
}

function proveIpa(tr, gIn, hIn, qPt, aIn, bIn) {
  let gVec = gIn.slice();
  let hVec = hIn.slice();
  let aVec = aIn.slice();
  let bVec = bIn.slice();
  let n = aVec.length;
  tr.appendU64('ipa-n', n);

  const chunks = [];
  while (n > 1) {
    const half = n >> 1;
    const aL = aVec.slice(0, half);
    const aR = aVec.slice(half);
    const bL = bVec.slice(0, half);
    const bR = bVec.slice(half);
    const gL = gVec.slice(0, half);
    const gR = gVec.slice(half);
    const hL = hVec.slice(0, half);
    const hR = hVec.slice(half);

    const cL = innerProduct(aL, bR);
    const cR = innerProduct(aR, bL);

    const lPt = edMultiScalarMul([...aL, ...bR, cL], [...gR, ...hL, qPt]);
    const rPt = edMultiScalarMul([...aR, ...bL, cR], [...gL, ...hR, qPt]);

    chunks.push(edEncode(lPt), edEncode(rPt));
    tr.appendPoint('L', lPt);
    tr.appendPoint('R', rPt);
    const u = tr.challengeScalar('u');
    const uInv = scalarInvL(u);

    const nextA = new Array(half);
    const nextB = new Array(half);
    const nextG = new Array(half);
    const nextH = new Array(half);
    for (let i = 0; i < half; i++) {
      nextA[i] = modL(u * aL[i] + uInv * aR[i]);
      nextB[i] = modL(uInv * bL[i] + u * bR[i]);
      nextG[i] = edAdd(edMul(uInv, gL[i]), edMul(u, gR[i]));
      nextH[i] = edAdd(edMul(u, hL[i]), edMul(uInv, hR[i]));
    }
    aVec = nextA;
    bVec = nextB;
    gVec = nextG;
    hVec = nextH;
    n = half;
  }

  chunks.push(scalarToLeBytes32(aVec[0]), scalarToLeBytes32(bVec[0]));
  return concatBytes(...chunks);
}

function ipaVerificationScalars(tr, n, lPts, rPts) {
  const k = lPts.length;
  tr.appendU64('ipa-n', n);
  const uInvArr = new Array(k);
  const uSq = new Array(k);
  const uInvSq = new Array(k);
  let allInv = 1n;
  for (let j = 0; j < k; j++) {
    tr.appendPoint('L', lPts[j]);
    tr.appendPoint('R', rPts[j]);
    const u = tr.challengeScalar('u');
    const uInv = scalarInvL(u);
    uInvArr[j] = uInv;
    uSq[j] = (u * u) % ED25519_L;
    uInvSq[j] = (uInv * uInv) % ED25519_L;
    allInv = (allInv * uInv) % ED25519_L;
  }

  const s = new Array(n).fill(0n);
  s[0] = allInv;
  for (let i = 1; i < n; i++) {
    const lgI = 31 - Math.clz32(i);
    const bitPos = 1 << lgI;
    const roundIdx = k - 1 - lgI;
    s[i] = (s[i ^ bitPos] * uSq[roundIdx]) % ED25519_L;
  }
  const sInv = s.map((v) => scalarInvL(v));
  return { s, sInv, uSq, uInvSq };
}

function readCanonicalScalar32(buf, off) {
  if (off + 32 > buf.length) return null;
  const sc = leBytesToBigInt(buf.slice(off, off + 32));
  return sc < ED25519_L ? sc : null;
}

// ============================================================================
// 1. Aggregated `u64` Range Proof (`[0, 2^bitWidth)`)
// ============================================================================

function rangeDelta(n, m, y, z) {
  const z2 = (z * z) % ED25519_L;
  const sumY = powersOf(y, m * n).reduce((a, b) => (a + b) % ED25519_L, 0n);
  const sum2 = powersOf(2n, n).reduce((a, b) => (a + b) % ED25519_L, 0n);
  let sumZ = 0n;
  let zPow = (z2 * z) % ED25519_L;
  for (let j = 0; j < m; j++) {
    sumZ = (sumZ + zPow) % ED25519_L;
    zPow = (zPow * z) % ED25519_L;
  }
  return modL(modL(z - z2) * sumY - sumZ * sum2);
}

export function bpProveRangeU64Batch(values, blindings, bitWidth = 64, ctx = '', entropy32 = null) {
  const m = values.length;
  const nTot = m * bitWidth;
  if (m === 0 || (m & (m - 1)) !== 0 || ![8, 16, 24, 32, 64].includes(bitWidth) || nTot > 256) {
    throw new Error('Invalid Bulletproof range parameters');
  }
  const ent = entropy32 ? asBytes(entropy32).slice(0, 32) : randomBytes(32);
  const gens = bpGenerators(nTot);

  const commits = [];
  const aL = [];
  const aR = [];
  for (let j = 0; j < m; j++) {
    const v = BigInt(values[j]);
    if (v < 0n || (bitWidth < 64 && v >= 1n << BigInt(bitWidth))) {
      throw new Error(`Value ${v} out of ${bitWidth}-bit range`);
    }
    commits.push(bpPedersenCommitU64(v, blindings[j]));
    for (let bit = 0; bit < bitWidth; bit++) {
      const b = (v >> BigInt(bit)) & 1n;
      aL.push(b);
      aR.push(modL(b - 1n));
    }
  }

  const alpha = deriveBlindingScalar(ent, 'range-alpha', 0);
  const rho = deriveBlindingScalar(ent, 'range-rho', 1);
  const tau1 = deriveBlindingScalar(ent, 'range-tau1', 2);
  const tau2 = deriveBlindingScalar(ent, 'range-tau2', 3);
  const sL = Array.from({ length: nTot }, (_, i) => deriveBlindingScalar(ent, 'range-sL', i));
  const sR = Array.from({ length: nTot }, (_, i) => deriveBlindingScalar(ent, 'range-sR', i));

  const aComm = edMultiScalarMul(
    [alpha, ...aL, ...aR],
    [gens.hBlind, ...gens.gVec.slice(0, nTot), ...gens.hVec.slice(0, nTot)]
  );
  const sComm = edMultiScalarMul(
    [rho, ...sL, ...sR],
    [gens.hBlind, ...gens.gVec.slice(0, nTot), ...gens.hVec.slice(0, nTot)]
  );

  const tr = new BpTranscript('SLX_BP_RANGE_U64_V1');
  tr.appendU64('m', m);
  tr.appendU64('n', bitWidth);
  tr.appendBytes('ctx', ctx);
  for (const c of commits) tr.appendBytes('V', c);
  tr.appendPoint('A', aComm);
  tr.appendPoint('S', sComm);

  const y = tr.challengeScalar('y');
  const z = tr.challengeScalar('z');
  const yPows = powersOf(y, nTot);
  const twoPows = powersOf(2n, bitWidth);
  const z2 = (z * z) % ED25519_L;

  const zTwoVec = new Array(nTot).fill(0n);
  let zJ = z2;
  for (let j = 0; j < m; j++) {
    for (let bit = 0; bit < bitWidth; bit++) {
      zTwoVec[j * bitWidth + bit] = (zJ * twoPows[bit]) % ED25519_L;
    }
    zJ = (zJ * z) % ED25519_L;
  }

  const l0 = aL.map((v) => modL(v - z));
  const r0 = aR.map((v, i) => modL(yPows[i] * modL(v + z) + zTwoVec[i]));
  const r1 = sR.map((v, i) => (yPows[i] * v) % ED25519_L);

  const t1 = modL(innerProduct(l0, r1) + innerProduct(sL, r0));
  const t2 = innerProduct(sL, r1);
  const t1Comm = edAdd(edMul(t1, gens.bVal), edMul(tau1, gens.hBlind));
  const t2Comm = edAdd(edMul(t2, gens.bVal), edMul(tau2, gens.hBlind));

  tr.appendPoint('T1', t1Comm);
  tr.appendPoint('T2', t2Comm);
  const x = tr.challengeScalar('x');

  const lEval = l0.map((v, i) => modL(v + sL[i] * x));
  const rEval = r0.map((v, i) => modL(v + r1[i] * x));
  const tHat = innerProduct(lEval, rEval);

  let zBlindSum = 0n;
  let zPow = z2;
  for (let j = 0; j < m; j++) {
    zBlindSum = modL(zBlindSum + zPow * modL(blindings[j]));
    zPow = (zPow * z) % ED25519_L;
  }
  const tauX = modL(tau2 * ((x * x) % ED25519_L) + tau1 * x + zBlindSum);
  const mu = modL(alpha + rho * x);

  tr.appendScalar('tau_x', tauX);
  tr.appendScalar('mu', mu);
  tr.appendScalar('t_hat', tHat);
  const w = tr.challengeScalar('w');
  const qPt = edMul(w, gens.uIpa);

  const yInvPows = powersOf(scalarInvL(y), nTot);
  const hPrime = yInvPows.map((yi, i) => edMul(yi, gens.hVec[i]));
  const ipaBytes = proveIpa(tr, gens.gVec.slice(0, nTot), hPrime, qPt, lEval, rEval);

  const proof = concatBytes(
    edEncode(aComm),
    edEncode(sComm),
    edEncode(t1Comm),
    edEncode(t2Comm),
    scalarToLeBytes32(tauX),
    scalarToLeBytes32(mu),
    scalarToLeBytes32(tHat),
    ipaBytes
  );
  return { commits, proof };
}

export function bpVerifyRangeU64Batch(commits, bitWidth, ctx, proofInput) {
  const m = commits.length;
  const nTot = m * bitWidth;
  if (m === 0 || (m & (m - 1)) !== 0 || ![8, 16, 24, 32, 64].includes(bitWidth) || nTot > 256) {
    return false;
  }
  const k = Math.log2(nTot) | 0;
  const proof = asBytes(proofInput);
  if (proof.length !== (9 + 2 * k) * 32) return false;

  const vPts = [];
  for (const c of commits) {
    const pt = edDecode(asBytes(c));
    if (!pt) return false;
    vPts.push(pt);
  }
  const aComm = edDecode(proof.slice(0, 32));
  const sComm = edDecode(proof.slice(32, 64));
  const t1Comm = edDecode(proof.slice(64, 96));
  const t2Comm = edDecode(proof.slice(96, 128));
  if (!aComm || !sComm || !t1Comm || !t2Comm) return false;

  const tauX = readCanonicalScalar32(proof, 128);
  const mu = readCanonicalScalar32(proof, 160);
  const tHat = readCanonicalScalar32(proof, 192);
  if (tauX === null || mu === null || tHat === null) return false;

  let cur = 224;
  const lPts = [];
  const rPts = [];
  for (let j = 0; j < k; j++) {
    const lp = edDecode(proof.slice(cur, cur + 32));
    const rp = edDecode(proof.slice(cur + 32, cur + 64));
    if (!lp || !rp) return false;
    lPts.push(lp);
    rPts.push(rp);
    cur += 64;
  }
  const aFin = readCanonicalScalar32(proof, cur);
  const bFin = readCanonicalScalar32(proof, cur + 32);
  if (aFin === null || bFin === null) return false;

  const gens = bpGenerators(nTot);
  const tr = new BpTranscript('SLX_BP_RANGE_U64_V1');
  tr.appendU64('m', m);
  tr.appendU64('n', bitWidth);
  tr.appendBytes('ctx', ctx);
  for (const c of commits) tr.appendBytes('V', asBytes(c));
  tr.appendPoint('A', aComm);
  tr.appendPoint('S', sComm);

  const y = tr.challengeScalar('y');
  const z = tr.challengeScalar('z');
  tr.appendPoint('T1', t1Comm);
  tr.appendPoint('T2', t2Comm);
  const x = tr.challengeScalar('x');

  tr.appendScalar('tau_x', tauX);
  tr.appendScalar('mu', mu);
  tr.appendScalar('t_hat', tHat);
  const w = tr.challengeScalar('w');

  const delta = rangeDelta(bitWidth, m, y, z);
  const polySc = [modL(delta - tHat), modL(-tauX), x, (x * x) % ED25519_L];
  const polyPt = [gens.bVal, gens.hBlind, t1Comm, t2Comm];
  let zPow = (z * z) % ED25519_L;
  for (const vp of vPts) {
    polySc.push(zPow);
    polyPt.push(vp);
    zPow = (zPow * z) % ED25519_L;
  }
  if (!edIsIdentity(edMultiScalarMul(polySc, polyPt))) return false;

  const { s: sVec, sInv: sInvVec, uSq, uInvSq } = ipaVerificationScalars(tr, nTot, lPts, rPts);
  const yInvPows = powersOf(scalarInvL(y), nTot);
  const twoPows = powersOf(2n, bitWidth);
  const z2 = (z * z) % ED25519_L;

  const msmSc = [];
  const msmPt = [];
  for (let i = 0; i < nTot; i++) {
    msmSc.push(modL(aFin * sVec[i] + z));
    msmPt.push(gens.gVec[i]);
  }
  let zJ = z2;
  for (let j = 0; j < m; j++) {
    for (let bit = 0; bit < bitWidth; bit++) {
      const i = j * bitWidth + bit;
      msmSc.push(modL(yInvPows[i] * modL(bFin * sInvVec[i] - zJ * twoPows[bit]) - z));
      msmPt.push(gens.hVec[i]);
    }
    zJ = (zJ * z) % ED25519_L;
  }
  msmSc.push(modL((aFin * bFin - tHat) * w), mu, modL(-1n), modL(-x));
  msmPt.push(gens.uIpa, gens.hBlind, aComm, sComm);
  for (let j = 0; j < k; j++) {
    msmSc.push(modL(-uSq[j]), modL(-uInvSq[j]));
    msmPt.push(lPts[j], rPts[j]);
  }
  return edIsIdentity(edMultiScalarMul(msmSc, msmPt));
}

// ============================================================================
// 2. General Sparse R1CS Builder, Prover & Verifier
// ============================================================================

export class BpCsBuilder {
  constructor(numGates, numVars) {
    this.numGates = numGates;
    this.numVars = numVars;
    this.constraints = [];
  }

  addConstraint(constantScalar, terms) {
    this.constraints.push({
      constant: modL(constantScalar),
      terms: terms.map(([wk, idx, w]) => [wk, idx, modL(w)]),
    });
    return this;
  }

  encode() {
    const parts = [u16BEBytes(this.numGates), u16BEBytes(this.numVars), u16BEBytes(this.constraints.length)];
    for (const c of this.constraints) {
      parts.push(scalarToLeBytes32(c.constant), u16BEBytes(c.terms.length));
      for (const [wk, idx, w] of c.terms) {
        parts.push(new Uint8Array([wk]), u16BEBytes(idx), scalarToLeBytes32(w));
      }
    }
    return concatBytes(...parts);
  }
}

function decodeCsBytes(csBytes) {
  if (!csBytes || csBytes.length < 6) return null;
  const numGates = readU16BE(csBytes, 0);
  const numVars = readU16BE(csBytes, 2);
  const numConstraints = readU16BE(csBytes, 4);
  if (numGates === 0 || (numGates & (numGates - 1)) !== 0 || numGates > 256 || numVars > 32) {
    return null;
  }
  let cur = 6;
  const constraints = [];
  for (let q = 0; q < numConstraints; q++) {
    const constant = readCanonicalScalar32(csBytes, cur);
    if (constant === null || cur + 34 > csBytes.length) return null;
    cur += 32;
    const tCnt = readU16BE(csBytes, cur);
    cur += 2;
    if (cur + tCnt * 35 > csBytes.length) return null;
    const terms = [];
    for (let t = 0; t < tCnt; t++) {
      const wk = csBytes[cur];
      const idx = readU16BE(csBytes, cur + 1);
      const weight = readCanonicalScalar32(csBytes, cur + 3);
      if (weight === null) return null;
      cur += 35;
      terms.push([wk, idx, weight]);
    }
    constraints.push({ constant, terms });
  }
  if (cur !== csBytes.length) return null;
  return { numGates, numVars, constraints };
}

function flattenCsWeights(numGates, numVars, constraints, z) {
  const wL = new Array(numGates).fill(0n);
  const wR = new Array(numGates).fill(0n);
  const wO = new Array(numGates).fill(0n);
  const wV = new Array(numVars).fill(0n);
  let cAcc = 0n;
  let zPow = z;
  for (const c of constraints) {
    cAcc = modL(cAcc + zPow * c.constant);
    for (const [wk, idx, weight] of c.terms) {
      const wt = (zPow * weight) % ED25519_L;
      if (wk === BP_WIRE_A_L) wL[idx] = (wL[idx] + wt) % ED25519_L;
      else if (wk === BP_WIRE_A_R) wR[idx] = (wR[idx] + wt) % ED25519_L;
      else if (wk === BP_WIRE_A_O) wO[idx] = (wO[idx] + wt) % ED25519_L;
      else if (wk === BP_WIRE_VAR) wV[idx] = (wV[idx] + wt) % ED25519_L;
    }
    zPow = (zPow * z) % ED25519_L;
  }
  return { wL, wR, wO, wV, cAcc };
}

export function bpProveR1cs(csInput, varValues, varBlindings, aLIn, aRIn, aOIn, ctx = '', entropy32 = null) {
  const csBytes = csInput instanceof BpCsBuilder ? csInput.encode() : asBytes(csInput);
  const parsed = decodeCsBytes(csBytes);
  if (!parsed) throw new Error('Invalid R1CS constraint system');
  const { numGates: n, numVars: kVars, constraints } = parsed;

  const vVals = varValues.map(modL);
  const vBlinds = varBlindings.map(modL);
  const aL = aLIn.map(modL);
  const aR = aRIn.map(modL);
  const aO = aOIn.map(modL);

  for (let i = 0; i < n; i++) {
    if ((aL[i] * aR[i]) % ED25519_L !== aO[i]) {
      throw new Error(`R1CS multiplication gate ${i} violated`);
    }
  }
  for (let q = 0; q < constraints.length; q++) {
    let lhs = 0n;
    for (const [wk, idx, wt] of constraints[q].terms) {
      const val =
        wk === BP_WIRE_A_L ? aL[idx] : wk === BP_WIRE_A_R ? aR[idx] : wk === BP_WIRE_A_O ? aO[idx] : vVals[idx];
      lhs = modL(lhs + wt * val);
    }
    if (lhs !== constraints[q].constant) {
      throw new Error(`R1CS linear constraint ${q} violated`);
    }
  }

  const ent = entropy32 ? asBytes(entropy32).slice(0, 32) : randomBytes(32);
  const gens = bpGenerators(n);
  const commits = vVals.map((v, j) => bpPedersenCommit(v, vBlinds[j]));

  const alphaI = deriveBlindingScalar(ent, 'r1cs-alphaI', 0);
  const alphaO = deriveBlindingScalar(ent, 'r1cs-alphaO', 1);
  const rho = deriveBlindingScalar(ent, 'r1cs-rho', 2);
  const tau1 = deriveBlindingScalar(ent, 'r1cs-tau1', 3);
  const tau3 = deriveBlindingScalar(ent, 'r1cs-tau3', 4);
  const tau4 = deriveBlindingScalar(ent, 'r1cs-tau4', 5);
  const tau5 = deriveBlindingScalar(ent, 'r1cs-tau5', 6);
  const tau6 = deriveBlindingScalar(ent, 'r1cs-tau6', 7);
  const sL = Array.from({ length: n }, (_, i) => deriveBlindingScalar(ent, 'r1cs-sL', i));
  const sR = Array.from({ length: n }, (_, i) => deriveBlindingScalar(ent, 'r1cs-sR', i));

  const aIComm = edMultiScalarMul(
    [alphaI, ...aL, ...aR],
    [gens.hBlind, ...gens.gVec.slice(0, n), ...gens.hVec.slice(0, n)]
  );
  const aOComm = edMultiScalarMul([alphaO, ...aO], [gens.hBlind, ...gens.gVec.slice(0, n)]);
  const sComm = edMultiScalarMul(
    [rho, ...sL, ...sR],
    [gens.hBlind, ...gens.gVec.slice(0, n), ...gens.hVec.slice(0, n)]
  );

  const tr = new BpTranscript('SLX_BP_R1CS_V1');
  tr.appendBytes('cs', csBytes);
  tr.appendBytes('ctx', ctx);
  for (const c of commits) tr.appendBytes('V', c);
  tr.appendPoint('A_I', aIComm);
  tr.appendPoint('A_O', aOComm);
  tr.appendPoint('S', sComm);

  const y = tr.challengeScalar('y');
  const z = tr.challengeScalar('z');
  const yPows = powersOf(y, n);
  const yInvPows = powersOf(scalarInvL(y), n);
  const { wL, wR, wO, wV } = flattenCsWeights(n, kVars, constraints, z);

  const l1 = aL.map((v, i) => modL(v + yInvPows[i] * wR[i]));
  const r0 = wO.map((v, i) => modL(v - yPows[i]));
  const r1 = aR.map((v, i) => modL(yPows[i] * v + wL[i]));
  const r3 = sR.map((v, i) => (yPows[i] * v) % ED25519_L);

  const t1 = innerProduct(l1, r0);
  const t3 = modL(innerProduct(aO, r1) + innerProduct(sL, r0));
  const t4 = modL(innerProduct(l1, r3) + innerProduct(sL, r1));
  const t5 = innerProduct(aO, r3);
  const t6 = innerProduct(sL, r3);

  const commitT = (v, b) => edAdd(edMul(v, gens.bVal), edMul(b, gens.hBlind));
  const t1Comm = commitT(t1, tau1);
  const t3Comm = commitT(t3, tau3);
  const t4Comm = commitT(t4, tau4);
  const t5Comm = commitT(t5, tau5);
  const t6Comm = commitT(t6, tau6);

  tr.appendPoint('T1', t1Comm);
  tr.appendPoint('T3', t3Comm);
  tr.appendPoint('T4', t4Comm);
  tr.appendPoint('T5', t5Comm);
  tr.appendPoint('T6', t6Comm);
  const x = tr.challengeScalar('x');

  const x2 = (x * x) % ED25519_L;
  const x3 = (x2 * x) % ED25519_L;
  const x4 = (x2 * x2) % ED25519_L;
  const x5 = (x4 * x) % ED25519_L;
  const x6 = (x3 * x3) % ED25519_L;

  const lEval = l1.map((v, i) => modL(v * x + aO[i] * x2 + sL[i] * x3));
  const rEval = r0.map((v, i) => modL(v + r1[i] * x + r3[i] * x3));
  const tHat = innerProduct(lEval, rEval);

  const wVGamma = innerProduct(wV, vBlinds);
  const tauX = modL(tau1 * x - wVGamma * x2 + tau3 * x3 + tau4 * x4 + tau5 * x5 + tau6 * x6);
  const mu = modL(alphaI * x + alphaO * x2 + rho * x3);

  tr.appendScalar('tau_x', tauX);
  tr.appendScalar('mu', mu);
  tr.appendScalar('t_hat', tHat);
  const w = tr.challengeScalar('w');
  const qPt = edMul(w, gens.uIpa);

  const hPrime = yInvPows.map((yi, i) => edMul(yi, gens.hVec[i]));
  const ipaBytes = proveIpa(tr, gens.gVec.slice(0, n), hPrime, qPt, lEval, rEval);

  const proof = concatBytes(
    edEncode(aIComm),
    edEncode(aOComm),
    edEncode(sComm),
    edEncode(t1Comm),
    edEncode(t3Comm),
    edEncode(t4Comm),
    edEncode(t5Comm),
    edEncode(t6Comm),
    scalarToLeBytes32(tauX),
    scalarToLeBytes32(mu),
    scalarToLeBytes32(tHat),
    ipaBytes
  );
  return { commits, proof };
}

export function bpVerifyR1cs(csInput, commits, ctx, proofInput) {
  const csBytes = csInput instanceof BpCsBuilder ? csInput.encode() : asBytes(csInput);
  const parsed = decodeCsBytes(csBytes);
  if (!parsed) return false;
  const { numGates: n, numVars: kVars, constraints } = parsed;
  const kIpa = Math.log2(n) | 0;
  const proof = asBytes(proofInput);
  if (commits.length !== kVars || proof.length !== (13 + 2 * kIpa) * 32) return false;

  const vPts = [];
  for (const c of commits) {
    const pt = edDecode(asBytes(c));
    if (!pt) return false;
    vPts.push(pt);
  }

  const pts8 = [];
  for (let i = 0; i < 8; i++) {
    const pt = edDecode(proof.slice(i * 32, (i + 1) * 32));
    if (!pt) return false;
    pts8.push(pt);
  }
  const [aIComm, aOComm, sComm, t1Comm, t3Comm, t4Comm, t5Comm, t6Comm] = pts8;

  const tauX = readCanonicalScalar32(proof, 256);
  const mu = readCanonicalScalar32(proof, 288);
  const tHat = readCanonicalScalar32(proof, 320);
  if (tauX === null || mu === null || tHat === null) return false;

  let cur = 352;
  const lPts = [];
  const rPts = [];
  for (let j = 0; j < kIpa; j++) {
    const lp = edDecode(proof.slice(cur, cur + 32));
    const rp = edDecode(proof.slice(cur + 32, cur + 64));
    if (!lp || !rp) return false;
    lPts.push(lp);
    rPts.push(rp);
    cur += 64;
  }
  const aFin = readCanonicalScalar32(proof, cur);
  const bFin = readCanonicalScalar32(proof, cur + 32);
  if (aFin === null || bFin === null) return false;

  const gens = bpGenerators(n);
  const tr = new BpTranscript('SLX_BP_R1CS_V1');
  tr.appendBytes('cs', csBytes);
  tr.appendBytes('ctx', ctx);
  for (const c of commits) tr.appendBytes('V', asBytes(c));
  tr.appendPoint('A_I', aIComm);
  tr.appendPoint('A_O', aOComm);
  tr.appendPoint('S', sComm);

  const y = tr.challengeScalar('y');
  const z = tr.challengeScalar('z');
  tr.appendPoint('T1', t1Comm);
  tr.appendPoint('T3', t3Comm);
  tr.appendPoint('T4', t4Comm);
  tr.appendPoint('T5', t5Comm);
  tr.appendPoint('T6', t6Comm);
  const x = tr.challengeScalar('x');

  tr.appendScalar('tau_x', tauX);
  tr.appendScalar('mu', mu);
  tr.appendScalar('t_hat', tHat);
  const w = tr.challengeScalar('w');

  const yInvPows = powersOf(scalarInvL(y), n);
  const { wL, wR, wO, wV, cAcc } = flattenCsWeights(n, kVars, constraints, z);

  let deltaR1cs = 0n;
  for (let i = 0; i < n; i++) {
    deltaR1cs = modL(deltaR1cs + yInvPows[i] * wR[i] * wL[i]);
  }

  const x2 = (x * x) % ED25519_L;
  const x3 = (x2 * x) % ED25519_L;
  const x4 = (x2 * x2) % ED25519_L;
  const x5 = (x4 * x) % ED25519_L;
  const x6 = (x3 * x3) % ED25519_L;

  const polySc = [modL(x2 * modL(cAcc + deltaR1cs) - tHat), modL(-tauX), x, x3, x4, x5, x6];
  const polyPt = [gens.bVal, gens.hBlind, t1Comm, t3Comm, t4Comm, t5Comm, t6Comm];
  for (let j = 0; j < kVars; j++) {
    polySc.push(modL(-x2 * wV[j]));
    polyPt.push(vPts[j]);
  }
  if (!edIsIdentity(edMultiScalarMul(polySc, polyPt))) return false;

  const { s: sVec, sInv: sInvVec, uSq, uInvSq } = ipaVerificationScalars(tr, n, lPts, rPts);
  const msmSc = [];
  const msmPt = [];
  for (let i = 0; i < n; i++) {
    msmSc.push(modL(aFin * sVec[i] - x * ((yInvPows[i] * wR[i]) % ED25519_L)));
    msmPt.push(gens.gVec[i]);
  }
  for (let i = 0; i < n; i++) {
    msmSc.push(modL(yInvPows[i] * modL(bFin * sInvVec[i] - x * wL[i] - wO[i]) + 1n));
    msmPt.push(gens.hVec[i]);
  }
  msmSc.push(modL((aFin * bFin - tHat) * w), mu, modL(-x), modL(-x2), modL(-x3));
  msmPt.push(gens.uIpa, gens.hBlind, aIComm, aOComm, sComm);
  for (let j = 0; j < kIpa; j++) {
    msmSc.push(modL(-uSq[j]), modL(-uInvSq[j]));
    msmPt.push(lPts[j], rPts[j]);
  }
  return edIsIdentity(edMultiScalarMul(msmSc, msmPt));
}

// ============================================================================
// 3. Cipher Noir Arbiter-Free Zero-Knowledge & Threshold Suite
// ============================================================================

export const NOIR_PHASES = Object.freeze({
  LOBBY: 1,
  SHUFFLING: 2,
  DEALING: 3,
  ACTIVE: 4,
  PROBE_PENDING: 5,
  INDICTMENT_SHIELDING: 6,
  INDICTMENT_DECRYPTING: 7,
  UNVEILING_VAULT: 8,
  SOLVED: 9,
});

const _noirCardPts = Array.from({ length: 18 }, (_, i) => edEncode(edMul(BigInt(i), ED_BASE_PT)));

export function noirScalarFromHashNonzero(hash32Bytes) {
  const sc = leBytesToBigInt(hash32Bytes) % ED25519_L;
  return sc === 0n ? 1n : sc;
}

export function canonicalNoirInitialDeck() {
  const parts = [];
  for (let i = 0; i < 18; i++) {
    parts.push(IDENTITY_POINT_BYTES, _noirCardPts[i]);
  }
  return concatBytes(...parts);
}

/**
 * Deterministically derives `(edSk, edPkBytes, uSk[0..2], wSk[0..2], seatKeyBlob512)`
 * from `(walletPrivateKeyHex, caseIdHex, seatEoaHex, epochPkBytes)` so browser refreshes
 * never lose a player's DDH/Pedersen blinding secrets!
 */
export function deriveNoirSeatSecrets(walletPrivateKeyHex, caseIdHex, seatEoaHex, epochPkInput) {
  const privBytes = hexToBytes(walletPrivateKeyHex).slice(-32);
  const cidBytes = hexToBytes(caseIdHex).slice(0, 32);
  const eoaBytes = hexToBytes(seatEoaHex).slice(-20);
  const epochPkBytes = asBytes(epochPkInput);
  const epkPt = edDecode(epochPkBytes);
  if (!epkPt || edIsIdentity(epkPt)) {
    throw new Error('Invalid VRF Beacon epoch_pk');
  }
  const hPt = bpGenerators(0).hBlind;

  const deriveSub = (tagByte) => {
    const d = sha512Bytes(
      concatBytes(utf8ToBytes('SLX_NOIR_SEAT_KEYS_V2'), privBytes, cidBytes, new Uint8Array([tagByte]))
    );
    const s = leBytesToBigInt(d) % ED25519_L;
    return s === 0n ? 1n : s;
  };

  const edSk = deriveSub(0);
  const edPkBytes = edEncode(edMul(edSk, ED_BASE_PT));
  const uSk = [deriveSub(10), deriveSub(11), deriveSub(12)];
  const wSk = [deriveSub(20), deriveSub(21), deriveSub(22)];

  const chunks = [edPkBytes];
  for (let k = 0; k < 3; k++) {
    const uPt = edMul(uSk[k], ED_BASE_PT);
    const tPt = edAdd(edMul(uSk[k], epkPt), edMul(wSk[k], hPt));
    const uBytes = edEncode(uPt);
    const tBytes = edEncode(tPt);

    const ku = deriveSub(30 + k);
    const kw = deriveSub(40 + k);
    const rU = edEncode(edMul(ku, ED_BASE_PT));
    const rT = edEncode(edAdd(edMul(ku, epkPt), edMul(kw, hPt)));

    const c = noirScalarFromHashNonzero(
      keccak256Bytes(
        concatBytes(
          utf8ToBytes('NOIR_SLOT_POK_V1'),
          cidBytes,
          eoaBytes,
          new Uint8Array([k]),
          epochPkBytes,
          edPkBytes,
          uBytes,
          tBytes,
          rU,
          rT
        )
      )
    );
    const zu = modL(ku + c * uSk[k]);
    const zw = modL(kw + c * wSk[k]);
    chunks.push(uBytes, tBytes, scalarToLeBytes32(c), scalarToLeBytes32(zu), scalarToLeBytes32(zw));
  }

  return {
    edSk,
    edPkBytes,
    uSk,
    wSk,
    seatKeyBlob: concatBytes(...chunks),
  };
}

/**
 * Recovers a seat's 3 private Dossier IDs (`0..17`) from on-chain DDH-blinded points `M'_{s,0..2}`:
 * `M'_{s,k} + u_{s,k} * epoch_pk == c_{s,k} * B`.
 */
export function decryptNoirHandCards(blindedDecrypts3, uSk3, epochPkInput) {
  const epkPt = edDecode(asBytes(epochPkInput));
  if (!epkPt) return [];
  const out = [];
  for (let k = 0; k < 3; k++) {
    const mPrime = edDecode(asBytes(blindedDecrypts3[k]));
    if (!mPrime) continue;
    const cBytes = edEncode(edAdd(mPrime, edMul(uSk3[k], epkPt)));
    const hex = bytesToHex(cBytes);
    for (let id = 0; id < 18; id++) {
      if (bytesToHex(_noirCardPts[id]) === hex) {
        out.push({ slot: k, dossierId: id });
        break;
      }
    }
  }
  return out;
}

export function randomSubdeckPermutation(subdecks) {
  const total = subdecks.reduce((s, [, len]) => s + len, 0);
  const perm = Array.from({ length: total }, (_, i) => i);
  const rnd = randomBytes(total * 4);
  let rPos = 0;
  for (const [start, len] of subdecks) {
    for (let i = len - 1; i > 0; i--) {
      const u32 = readU32BE(rnd, rPos);
      rPos += 4;
      const j = u32 % (i + 1);
      const tmp = perm[start + i];
      perm[start + i] = perm[start + j];
      perm[start + j] = tmp;
    }
  }
  return perm;
}

/**
 * Generates a 16-gate Grand-Product Bulletproofs R1CS + Schwartz-Zippel ElGamal shuffle proof blob.
 */
export function proveNoirShuffleStep({
  caseId,
  stepTag,
  epochPk,
  subdecks,
  inCts,
  perm = null,
  seedBytes = null,
}) {
  const cidBytes = hexToBytes(caseId).slice(0, 32);
  const epochPkBytes = asBytes(epochPk);
  const epkPt = edDecode(epochPkBytes);
  const inBuf = asBytes(inCts);
  const totalCards = subdecks.reduce((s, [, len]) => s + len, 0);
  const chosenPerm = perm || randomSubdeckPermutation(subdecks);
  const seed = seedBytes ? asBytes(seedBytes).slice(0, 32) : randomBytes(32);

  const sc = (tag, idx) => {
    const d = sha512Bytes(concatBytes(seed, new Uint8Array([tag]), u32BE(idx)));
    const s = leBytesToBigInt(d) % ED25519_L;
    return s === 0n ? 1n : s;
  };

  const rVec = new Array(totalCards);
  const outParts = [];
  for (let j = 0; j < totalCards; j++) {
    const src = chosenPerm[j];
    const in1 = edDecode(inBuf.slice(src * 64, src * 64 + 32));
    const in2 = edDecode(inBuf.slice(src * 64 + 32, (src + 1) * 64));
    const rj = sc(1, j);
    rVec[j] = rj;
    const o1 = edAdd(in1, edMul(rj, ED_BASE_PT));
    const o2 = edAdd(in2, edMul(rj, epkPt));
    outParts.push(edEncode(o1), edEncode(o2));
  }
  const outCts = concatBytes(...outParts);

  const alpha = noirScalarFromHashNonzero(
    keccak256Bytes(
      concatBytes(
        utf8ToBytes('NOIR_SHUF_ALPHA_V1'),
        cidBytes,
        new Uint8Array([stepTag]),
        epochPkBytes,
        inBuf,
        outCts
      )
    )
  );
  const alphaPows = new Array(totalCards);
  let curA = alpha;
  for (let j = 0; j < totalCards; j++) {
    alphaPows[j] = curA;
    curA = (curA * alpha) % ED25519_L;
  }

  const sVals = new Array(totalCards).fill(0n);
  for (let j = 0; j < totalCards; j++) {
    sVals[chosenPerm[j]] = alphaPows[j];
  }
  const sBlinds = Array.from({ length: totalCards }, (_, i) => sc(2, i));
  const sCommitsPre = sVals.map((v, i) => bpPedersenCommit(v, sBlinds[i]));
  const sCommRaw = concatBytes(...sCommitsPre);

  const beta = noirScalarFromHashNonzero(
    keccak256Bytes(
      concatBytes(
        utf8ToBytes('NOIR_SHUF_BETA_V1'),
        cidBytes,
        new Uint8Array([stepTag]),
        scalarToLeBytes32(alpha),
        sCommRaw
      )
    )
  );

  const N_GATES = 16;
  const cs = new BpCsBuilder(N_GATES, totalCards);
  const aL = new Array(N_GATES).fill(0n);
  const aR = new Array(N_GATES).fill(0n);
  const aO = new Array(N_GATES).fill(0n);
  const negBeta = modL(-beta);

  let gateCursor = 0;
  for (const [startIdx, len] of subdecks) {
    let kProd = modL(alphaPows[startIdx] - beta);
    for (let r = 1; r < len; r++) {
      kProd = (kProd * modL(alphaPows[startIdx + r] - beta)) % ED25519_L;
    }

    aL[gateCursor] = modL(sVals[startIdx] - beta);
    aR[gateCursor] = modL(sVals[startIdx + 1] - beta);
    aO[gateCursor] = (aL[gateCursor] * aR[gateCursor]) % ED25519_L;

    cs.addConstraint(negBeta, [
      [BP_WIRE_A_L, gateCursor, 1n],
      [BP_WIRE_VAR, startIdx, -1n],
    ]);
    cs.addConstraint(negBeta, [
      [BP_WIRE_A_R, gateCursor, 1n],
      [BP_WIRE_VAR, startIdx + 1, -1n],
    ]);

    for (let step = 1; step < len - 1; step++) {
      const g = gateCursor + step;
      aL[g] = aO[g - 1];
      aR[g] = modL(sVals[startIdx + step + 1] - beta);
      aO[g] = (aL[g] * aR[g]) % ED25519_L;

      cs.addConstraint(0n, [
        [BP_WIRE_A_L, g, 1n],
        [BP_WIRE_A_O, g - 1, -1n],
      ]);
      cs.addConstraint(negBeta, [
        [BP_WIRE_A_R, g, 1n],
        [BP_WIRE_VAR, startIdx + step + 1, -1n],
      ]);
    }

    cs.addConstraint(kProd, [[BP_WIRE_A_O, gateCursor + len - 2, 1n]]);
    gateCursor += len - 1;
  }

  const r1csCtx = concatBytes(
    utf8ToBytes('NOIR_SHUF_R1CS_V1'),
    cidBytes,
    new Uint8Array([stepTag]),
    scalarToLeBytes32(alpha),
    scalarToLeBytes32(beta)
  );
  const { proof: r1csProof } = bpProveR1cs(cs, sVals, sBlinds, aL, aR, aO, r1csCtx, seed);

  let rTot = 0n;
  let l1Pt = ED_IDENTITY_PT;
  let l2Pt = ED_IDENTITY_PT;
  for (let j = 0; j < totalCards; j++) {
    rTot = modL(rTot + alphaPows[j] * rVec[j]);
    const o1 = edDecode(outCts.slice(j * 64, j * 64 + 32));
    const o2 = edDecode(outCts.slice(j * 64 + 32, (j + 1) * 64));
    l1Pt = edAdd(l1Pt, edMul(alphaPows[j], o1));
    l2Pt = edAdd(l2Pt, edMul(alphaPows[j], o2));
  }

  const kS = Array.from({ length: totalCards }, (_, i) => sc(3, i));
  const kG = Array.from({ length: totalCards }, (_, i) => sc(4, i));
  const kR = sc(5, 0);
  const hBp = bpGenerators(0).hBlind;

  const rSParts = [];
  let r1Pt = edMul(kR, ED_BASE_PT);
  let r2Pt = edMul(kR, epkPt);
  for (let i = 0; i < totalCards; i++) {
    rSParts.push(edEncode(edAdd(edMul(kS[i], ED_BASE_PT), edMul(kG[i], hBp))));
    const in1 = edDecode(inBuf.slice(i * 64, i * 64 + 32));
    const in2 = edDecode(inBuf.slice(i * 64 + 32, (i + 1) * 64));
    r1Pt = edAdd(r1Pt, edMul(kS[i], in1));
    r2Pt = edAdd(r2Pt, edMul(kS[i], in2));
  }

  const c = noirScalarFromHashNonzero(
    keccak256Bytes(
      concatBytes(
        utf8ToBytes('NOIR_SHUF_LIN_V1'),
        cidBytes,
        new Uint8Array([stepTag]),
        scalarToLeBytes32(alpha),
        edEncode(l1Pt),
        edEncode(l2Pt),
        sCommRaw,
        ...rSParts,
        edEncode(r1Pt),
        edEncode(r2Pt)
      )
    )
  );

  const linParts = [scalarToLeBytes32(c)];
  for (let i = 0; i < totalCards; i++) linParts.push(scalarToLeBytes32(modL(kS[i] + c * sVals[i])));
  for (let i = 0; i < totalCards; i++) linParts.push(scalarToLeBytes32(modL(kG[i] + c * sBlinds[i])));
  linParts.push(scalarToLeBytes32(modL(kR + c * rTot)));

  return concatBytes(outCts, sCommRaw, r1csProof, ...linParts);
}

export function proveNoirInitialShuffle(caseIdHex, epochPkInput) {
  return proveNoirShuffleStep({
    caseId: caseIdHex,
    stepTag: 1,
    epochPk: epochPkInput,
    subdecks: [
      [0, 5],
      [5, 5],
      [10, 8],
    ],
    inCts: canonicalNoirInitialDeck(),
  });
}

/**
 * Builds `passAlibiCheck`'s 672-byte Bulletproofs R1CS proof (`16` gates) proving none of
 * `cards3` equals any of `probes3`.
 */
export function proveNoirPassAlibi({ caseId, probeIdx, responderSeat, cards3, wSk3, probes3 }) {
  const cidBytes = hexToBytes(caseId).slice(0, 32);
  const cs = new BpCsBuilder(16, 3);
  cs.addConstraint(-BigInt(probes3[0]), [
    [BP_WIRE_A_L, 0, 1n],
    [BP_WIRE_VAR, 0, -1n],
  ]);
  cs.addConstraint(-BigInt(probes3[1]), [
    [BP_WIRE_A_R, 0, 1n],
    [BP_WIRE_VAR, 0, -1n],
  ]);
  for (let t = 1; t <= 7; t++) {
    const fIdx = t + 1;
    const k = Math.floor(fIdx / 3);
    const m = fIdx % 3;
    cs.addConstraint(0n, [
      [BP_WIRE_A_L, t, 1n],
      [BP_WIRE_A_O, t - 1, -1n],
    ]);
    cs.addConstraint(-BigInt(probes3[m]), [
      [BP_WIRE_A_R, t, 1n],
      [BP_WIRE_VAR, k, -1n],
    ]);
  }
  cs.addConstraint(0n, [
    [BP_WIRE_A_L, 8, 1n],
    [BP_WIRE_A_O, 7, -1n],
  ]);
  cs.addConstraint(1n, [[BP_WIRE_A_O, 8, 1n]]);

  const diffs = [];
  for (const c of cards3) {
    for (const p of probes3) {
      const d = modL(BigInt(c) - BigInt(p));
      if (d === 0n) {
        throw new Error('Cannot prove passAlibiCheck while holding a probed vector!');
      }
      diffs.push(d);
    }
  }

  const aL = new Array(16).fill(0n);
  const aR = new Array(16).fill(0n);
  const aO = new Array(16).fill(0n);
  aL[0] = diffs[0];
  aR[0] = diffs[1];
  aO[0] = (aL[0] * aR[0]) % ED25519_L;
  for (let t = 1; t <= 7; t++) {
    aL[t] = aO[t - 1];
    aR[t] = diffs[t + 1];
    aO[t] = (aL[t] * aR[t]) % ED25519_L;
  }
  aL[8] = aO[7];
  aR[8] = scalarInvL(aO[7]);
  aO[8] = 1n;

  const ctx = concatBytes(
    utf8ToBytes('NOIR_PASS_R1CS_1'),
    cidBytes,
    u16BEBytes(probeIdx),
    new Uint8Array([responderSeat, probes3[0], probes3[1], probes3[2]])
  );
  return bpProveR1cs(
    cs,
    cards3.map((c) => BigInt(c)),
    wSk3,
    aL,
    aR,
    aO,
    ctx
  ).proof;
}

/**
 * Builds `transmitAlibiProof`'s 352-byte 1-of-3 Disjunctive Schnorr + ElGamal whisper proof.
 */
export function proveNoirWhisperOr3({
  caseId,
  probeIdx,
  responderSeat,
  proberSeat,
  slotIdx,
  card,
  wBlind,
  proberEdPk,
  probes3,
}) {
  const trueM = probes3.findIndex((p) => Number(p) === Number(card));
  if (trueM < 0) throw new Error('Card does not match any probed vector');
  const cidBytes = hexToBytes(caseId).slice(0, 32);
  const pkPBytes = asBytes(proberEdPk);
  const pkP = edDecode(pkPBytes);
  const hBp = bpGenerators(0).hBlind;
  const vPt = edAdd(edMul(BigInt(card), ED_BASE_PT), edMul(modL(wBlind), hBp));
  const vBytes = edEncode(vPt);

  const rEnc = randomEdScalar();
  const e1Pt = edMul(rEnc, ED_BASE_PT);
  const e2Pt = edAdd(edMul(BigInt(card), ED_BASE_PT), edMul(rEnc, pkP));
  const e1Bytes = edEncode(e1Pt);
  const e2Bytes = edEncode(e2Pt);

  const cArr = [0n, 0n, 0n];
  const zwArr = [0n, 0n, 0n];
  const zrArr = [0n, 0n, 0n];
  const kw = randomEdScalar();
  const kr = randomEdScalar();

  const branchCommits = [];
  for (let m = 0; m < 3; m++) {
    if (m === trueM) {
      branchCommits.push(
        edEncode(edMul(kw, hBp)),
        edEncode(edMul(kr, ED_BASE_PT)),
        edEncode(edMul(kr, pkP))
      );
    } else {
      cArr[m] = randomEdScalar();
      zwArr[m] = randomEdScalar();
      zrArr[m] = randomEdScalar();
      const negC = modL(-cArr[m]);
      const negPm = edNeg(edMul(BigInt(probes3[m]), ED_BASE_PT));
      const vMinusPm = edAdd(vPt, negPm);
      const e2MinusPm = edAdd(e2Pt, negPm);
      branchCommits.push(
        edEncode(edAdd(edMul(zwArr[m], hBp), edMul(negC, vMinusPm))),
        edEncode(edAdd(edMul(zrArr[m], ED_BASE_PT), edMul(negC, e1Pt))),
        edEncode(edAdd(edMul(zrArr[m], pkP), edMul(negC, e2MinusPm)))
      );
    }
  }

  const cTot = noirScalarFromHashNonzero(
    keccak256Bytes(
      concatBytes(
        utf8ToBytes('NOIR_WHISPER_OR3_V1'),
        cidBytes,
        u16BEBytes(probeIdx),
        new Uint8Array([responderSeat, proberSeat, slotIdx]),
        vBytes,
        pkPBytes,
        e1Bytes,
        e2Bytes,
        new Uint8Array([probes3[0], probes3[1], probes3[2]]),
        ...branchCommits
      )
    )
  );

  let fakeSum = 0n;
  for (let m = 0; m < 3; m++) {
    if (m !== trueM) fakeSum = modL(fakeSum + cArr[m]);
  }
  cArr[trueM] = modL(cTot - fakeSum);
  zwArr[trueM] = modL(kw + cArr[trueM] * modL(wBlind));
  zrArr[trueM] = modL(kr + cArr[trueM] * rEnc);

  const parts = [e1Bytes, e2Bytes];
  for (let m = 0; m < 3; m++) {
    parts.push(scalarToLeBytes32(cArr[m]), scalarToLeBytes32(zwArr[m]), scalarToLeBytes32(zrArr[m]));
  }
  return concatBytes(...parts);
}

/**
 * Decrypts a 64-byte `(E_1, E_2)` ElGamal whisper ciphertext using `myEdSk` -> `dossierId` (`0..17`).
 */
export function decryptNoirWhisper(whisperCt64Input, myEdSk) {
  const ct = asBytes(whisperCt64Input);
  if (ct.length < 64) return null;
  const e1 = edDecode(ct.slice(0, 32));
  const e2 = edDecode(ct.slice(32, 64));
  if (!e1 || !e2) return null;
  const cBytes = edEncode(edAdd(e2, edNeg(edMul(modL(myEdSk), e1))));
  const hex = bytesToHex(cBytes);
  for (let id = 0; id < 18; id++) {
    if (bytesToHex(_noirCardPts[id]) === hex) return id;
  }
  return null;
}

export function computeNoirIndictmentDelta0(caseIdHex, vaultCiphertexts192Input, guesses3) {
  const cidBytes = hexToBytes(caseIdHex).slice(0, 32);
  const vCts = asBytes(vaultCiphertexts192Input);
  const gBytes = new Uint8Array([guesses3[0], guesses3[1], guesses3[2]]);

  const lam1 = noirScalarFromHashNonzero(
    keccak256Bytes(concatBytes(utf8ToBytes('NOIR_INDICT_MIX1_V1'), cidBytes, gBytes, vCts))
  );
  const lam2 = noirScalarFromHashNonzero(
    keccak256Bytes(concatBytes(utf8ToBytes('NOIR_INDICT_MIX2_V1'), cidBytes, gBytes, vCts))
  );
  const weights = [1n, lam1, lam2];

  let acc1 = ED_IDENTITY_PT;
  let acc2 = ED_IDENTITY_PT;
  for (let m = 0; m < 3; m++) {
    const c1 = edDecode(vCts.slice(m * 64, m * 64 + 32));
    const c2 = edDecode(vCts.slice(m * 64 + 32, (m + 1) * 64));
    const gmPt = edMul(BigInt(guesses3[m]), ED_BASE_PT);
    const d2 = edAdd(c2, edNeg(gmPt));
    acc1 = edAdd(acc1, edMul(weights[m], c1));
    acc2 = edAdd(acc2, edMul(weights[m], d2));
  }
  return concatBytes(edEncode(acc1), edEncode(acc2));
}

export function proveNoirIndictmentBlind({ caseId, stepTag, epochPk, deltaIn64 }) {
  const cidBytes = hexToBytes(caseId).slice(0, 32);
  const epochPkBytes = asBytes(epochPk);
  const epkPt = edDecode(epochPkBytes);
  const dIn = asBytes(deltaIn64);
  const in1 = edDecode(dIn.slice(0, 32));
  const in2 = edDecode(dIn.slice(32, 64));

  const rho = randomEdScalar();
  const r = randomEdScalar();
  const pRho = edEncode(edMul(rho, ED_BASE_PT));
  const out1 = edEncode(edAdd(edMul(rho, in1), edMul(r, ED_BASE_PT)));
  const out2 = edEncode(edAdd(edMul(rho, in2), edMul(r, epkPt)));

  const kRho = randomEdScalar();
  const kR = randomEdScalar();
  const rP = edEncode(edMul(kRho, ED_BASE_PT));
  const r1 = edEncode(edAdd(edMul(kRho, in1), edMul(kR, ED_BASE_PT)));
  const r2 = edEncode(edAdd(edMul(kRho, in2), edMul(kR, epkPt)));

  const c = noirScalarFromHashNonzero(
    keccak256Bytes(
      concatBytes(
        utf8ToBytes('NOIR_INDICT_BLIND_V1'),
        cidBytes,
        new Uint8Array([stepTag]),
        epochPkBytes,
        dIn,
        out1,
        out2,
        pRho,
        rP,
        r1,
        r2
      )
    )
  );

  return concatBytes(
    out1,
    out2,
    pRho,
    scalarToLeBytes32(c),
    scalarToLeBytes32(modL(kRho + c * rho)),
    scalarToLeBytes32(modL(kR + c * r))
  );
}

/**
 * Decodes `getCaseState(bytes32)` (`HDR_LEN = 320`, `SEAT_LEN = 368`, `LOG_ENTRY_LEN = 74`).
 */
export function decodeNoirCaseState(rawHexOrBytes) {
  const b = asBytes(rawHexOrBytes);
  if (b.length < 320 + 5 * 368) return null;

  const hdr = {
    phase: b[0],
    turnSeat: b[1],
    responderSeat: b[2],
    proberSeat: b[3],
    probeOperative: b[4],
    probeExploit: b[5],
    probeSector: b[6],
    indictSeat: b[7],
    indictOperative: b[8],
    indictExploit: b[9],
    indictSector: b[10],
    winnerSeat: b[11],
    solOperative: b[12],
    solExploit: b[13],
    solSector: b[14],
    dealRequested: b[15],
    probeCount: readU16BE(b, 16),
    logCount: readU16BE(b, 18),
    deadlineBlock: Number(readU64BE(b, 20)),
    createdBlock: readU32BE(b, 28),
    epochId: Number(readU64BE(b, 32)),
    epochPk: b.slice(40, 72),
    epochPkHex: bytesToHex(b.slice(40, 72)),
    firstShuffler: bytesToHex(b.slice(72, 92)).toLowerCase(),
    indictEoa: bytesToHex(b.slice(92, 112)).toLowerCase(),
    shuffleCount: b[112],
    dealFulfilledMask: b[113],
    vaultCiphertexts: b.slice(128, 320),
    vaultHashHex: bytesToHex(keccak256Bytes(b.slice(128, 320))),
  };

  let pos = 320;
  const seats = [];
  for (let s = 0; s < 5; s++) {
    const sb = b.slice(pos, pos + 368);
    pos += 368;
    seats.push({
      seat: s,
      occupied: sb[0],
      revoked: sb[1] !== 0,
      sectorId: sb[2],
      pulled: (sb[3] & 1) !== 0,
      eoa: bytesToHex(sb.slice(4, 24)).toLowerCase(),
      identityAddr: bytesToHex(sb.slice(24, 44)).toLowerCase(),
      edPk: sb.slice(44, 76),
      edPkHex: bytesToHex(sb.slice(44, 76)),
      uBlinds: [sb.slice(76, 108), sb.slice(108, 140), sb.slice(140, 172)],
      handCommits: [sb.slice(172, 204), sb.slice(204, 236), sb.slice(236, 268)],
      blindedDecrypts: [sb.slice(268, 300), sb.slice(300, 332), sb.slice(332, 364)],
    });
  }

  const logs = [];
  for (let i = 0; i < hdr.logCount && pos + 74 <= b.length; i++) {
    const lb = b.slice(pos, pos + 74);
    pos += 74;
    logs.push({
      probeIdx: readU16BE(lb, 0),
      proberSeat: lb[2],
      operative: lb[3],
      exploit: lb[4],
      sector: lb[5],
      passMask: lb[6],
      disproverSeat: lb[7],
      disproverSlot: lb[8],
      status: lb[9],
      whisperCt: lb.slice(10, 74),
    });
  }

  return { hdr, seats, logs };
}
