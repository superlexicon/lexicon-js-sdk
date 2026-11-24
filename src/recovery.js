/**
 * @superlexicon/sdk/recovery
 *
 * `Identity` v4 Multi-Device Owner Key Ring, `N`-Capped `GuardianKeychain` Blast-Radius Sharding,
 * Unhackable Pedersen-VSS Shamir Secret Sharing (`256`-bit lossless dual-`128`-bit limbs over ` Edwards25519`),
 * Stateless Biometric Oracle Blinded Share Prover, Passphrase Share AEAD, & Local Lagrange Recovery.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  randomBytes,
  keccak256Bytes,
  deriveKeypairInfo,
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
} from './abi.js';
import { slxNodeRpc } from './rpc.js';
import {
  ED25519_L,
  ED_BASE_PT,
  edAdd,
  edMul,
  edEncode,
  edDecode,
  leBytesToBigInt,
  scalarToLeBytes32,
  randomEdScalar,
  deriveEd25519Keypair,
  deriveIdentityEncryptionKeys,
  wrapSecretForRecipientSecp,
  unwrapSecretWithPrivKey,
} from './confidential.js';
import { BP_H_BLIND_HEX, scalarInvL } from './bulletproofs.js';

export const DEV_STATUS_ACTIVE = 1;
export const DEV_STATUS_REVOKED = 2;

export const SLOT_STATUS_ACTIVE = 1;
export const SLOT_STATUS_SEALED_FULL = 2;
export const SLOT_STATUS_RETIRED = 3;

export const SHARE_KIND_GUARDIAN_SLOT = 1;
export const SHARE_KIND_DIRECT_EOA = 2;
export const SHARE_KIND_SELF_PASSPHRASE = 3;

export const REC_STATUS_NONE = 0;
export const REC_STATUS_COLLECTING = 1;
export const REC_STATUS_TIMELOCKED = 2;
export const REC_STATUS_FINALIZED = 3;
export const REC_STATUS_CANCELLED = 4;

export const DEVICE_SEED_WRAP_TAG = 'SLX_ID_DEV_SEED_V1';
export const GUARDIAN_SHARE_WRAP_TAG = 'SLX_SHAMIR_SHARE_V1';

const BP_H_BLIND_PT = edDecode(BP_H_BLIND_HEX);

function modL(x) {
  const r = BigInt(x) % ED25519_L;
  return r < 0n ? r + ED25519_L : r;
}

function asBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return v.startsWith('0x') ? hexToBytes(v) : utf8ToBytes(v);
  return new Uint8Array(v || []);
}

export function scalarFromHashNonzero(hash32Bytes) {
  const red = leBytesToBigInt(hash32Bytes.slice(0, 32)) % ED25519_L;
  return red === 0n ? 1n : red;
}

// ============================================================================
// 1. Multi-Device Master Encryption Seed Derivation, Wrapping & Resolution
// ============================================================================

/**
 * Derives a domain-separated 32-byte Identity Master Encryption Seed (`idEncSeed`)
 * from an initial creator's `privateKeyHex` + `identityAddrHex`.
 * Keeping `idEncSeed` distinct from `privateKeyHex` ensures pairing secondary devices
 * shares ONLY the Identity's encryption keys, NEVER any device's EOA signing key!
 */
export function deriveIdentityMasterSeedBytes32(creatorPrivateKeyHex, identityAddrHex) {
  const kp = deriveKeypairInfo(creatorPrivateKeyHex);
  const id20 = hexToBytes(identityAddrHex).slice(-20);
  let seed = keccak256Bytes(
    concatBytes(utf8ToBytes('SLX_ID_MASTER_ENC_SEED_V1:'), hexToBytes(kp.privateKey), id20)
  );
  // Ensure valid non-zero secp256k1 scalar (virtually guaranteed, loop guard for rigor)
  try {
    deriveKeypairInfo(bytesToHex(seed, true));
  } catch {
    seed = keccak256Bytes(concatBytes(seed, new Uint8Array([1])));
  }
  return seed;
}

export function wrapMasterSeedForDevice(masterSeedBytes32, deviceSecpPub64) {
  const seed = asBytes(masterSeedBytes32).slice(0, 32);
  if (seed.length !== 32) throw new Error('masterSeedBytes32 must be 32 bytes');
  return wrapSecretForRecipientSecp(seed, deviceSecpPub64, DEVICE_SEED_WRAP_TAG);
}

export function unwrapMasterSeedWithDeviceKey(wrappedSeedEnvelope, devicePrivateKeyHex) {
  const out = unwrapSecretWithPrivKey(wrappedSeedEnvelope, devicePrivateKeyHex, DEVICE_SEED_WRAP_TAG);
  return out && out.length === 32 ? out : null;
}

/**
 * Resolves the canonical `(secpPrivHex, secpPub64Hex, edSecretScalar, edPub32Hex)` encryption keys
 * for `identityAddrHex` on ANY authorized device (`devicePrivateKeyHex`):
 *  1. Checks on-chain `getOwnerDevices()` for an ECIES-wrapped `masterSeedBytes32` addressed to this device's EOA.
 *  2. Falls back cleanly to `deriveIdentityEncryptionKeys(devicePrivateKeyHex, identityAddrHex)` for
 *     single-device Identities initialized without `wrappedEncSeed`.
 */
export async function resolveIdentityEncryptionKeys(rpcUrl, devicePrivateKeyHex, identityAddrHex) {
  const devKp = deriveKeypairInfo(devicePrivateKeyHex);
  const devEoa = devKp.address.toLowerCase();
  try {
    const rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: identityAddrHex, data: IdentityV4RecoveryAbi.getOwnerDevices() },
      'latest',
    ]);
    const devices = decodeOwnerDevicesHex(rawHex);
    const match = devices.find(
      (d) => d.status === DEV_STATUS_ACTIVE && d.eoa.toLowerCase() === devEoa && d.wrappedSeedBytes.length > 80
    );
    if (match) {
      const seed32 = unwrapMasterSeedWithDeviceKey(match.wrappedSeedBytes, devKp.privateKey);
      if (seed32) {
        const derived = deriveIdentityEncryptionKeys(bytesToHex(seed32, true), identityAddrHex);
        return {
          ...derived,
          masterSeedBytes32: seed32,
          masterSeedHex: bytesToHex(seed32, true),
          deviceEoa: devEoa,
          deviceSecpPub64Bytes: hexToBytes(devKp.uncompressedPubKey).slice(1, 65),
          unwrappedFromDeviceRing: true,
        };
      }
    }
  } catch {
    // Fallback below if offline or pre-v4 Identity
  }
  const legacySeed = hexToBytes(devKp.privateKey);
  const derived = deriveIdentityEncryptionKeys(devKp.privateKey, identityAddrHex);
  return {
    ...derived,
    masterSeedBytes32: legacySeed,
    masterSeedHex: bytesToHex(legacySeed, true),
    deviceEoa: devEoa,
    deviceSecpPub64Bytes: hexToBytes(devKp.uncompressedPubKey).slice(1, 65),
    unwrappedFromDeviceRing: false,
  };
}

export function packRewrappedDeviceSeeds(entries = []) {
  const chunks = [u16BEBytes(entries.length)];
  for (const item of entries) {
    const eoa20 = hexToBytes(item.deviceEoa).slice(-20);
    const wrap = asBytes(item.wrappedSeed);
    chunks.push(eoa20, u16BEBytes(wrap.length), wrap);
  }
  return concatBytes(...chunks);
}

// ============================================================================
// 2. WebCrypto PBKDF2 + AES-256-GCM Passphrase Share Envelope
// ============================================================================

async function derivePassphraseAesKey(passphrase, salt16, identityAddrHex) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle API required for passphrase encryption');
  const id20 = hexToBytes(identityAddrHex).slice(-20);
  const baseKey = await subtle.importKey(
    'raw',
    utf8ToBytes(`SLX_SHAMIR_PASS_V1:${String(passphrase)}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: concatBytes(salt16, id20),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a 128-byte Pedersen-VSS share `[s_0 || g_0 || s_1 || g_1]` under a user passphrase.
 * Format: `[ver=1 (1B) || salt (16B) || iv (12B) || aesGcmCipherAndTag (144B)]` = `173` bytes.
 */
export async function encryptShareWithPassphrase(plainShare128, passphrase, identityAddrHex) {
  const plain = asBytes(plainShare128);
  if (plain.length !== 128) throw new Error('plainShare128 must be 128 bytes');
  const salt16 = randomBytes(16);
  const iv12 = randomBytes(12);
  const key = await derivePassphraseAesKey(passphrase, salt16, identityAddrHex);
  const aad = concatBytes(utf8ToBytes('SLX_PASS_SHARE_AAD_V1:'), hexToBytes(identityAddrHex).slice(-20));
  const ctBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv12, additionalData: aad },
    key,
    plain
  );
  return concatBytes(new Uint8Array([1]), salt16, iv12, new Uint8Array(ctBuf));
}

export async function decryptShareWithPassphrase(envelopeInput, passphrase, identityAddrHex) {
  const env = asBytes(envelopeInput);
  if (env.length < 30 || env[0] !== 1) throw new Error('Invalid passphrase share envelope');
  const salt16 = env.slice(1, 17);
  const iv12 = env.slice(17, 29);
  const ct = env.slice(29);
  const key = await derivePassphraseAesKey(passphrase, salt16, identityAddrHex);
  const aad = concatBytes(utf8ToBytes('SLX_PASS_SHARE_AAD_V1:'), hexToBytes(identityAddrHex).slice(-20));
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv12, additionalData: aad },
    key,
    ct
  );
  const out = new Uint8Array(plainBuf);
  if (out.length !== 128) throw new Error('Decrypted passphrase share length mismatch');
  return out;
}

// ============================================================================
// 3. Lossless 256-Bit Pedersen-VSS Shamir Split, Blinded Prover & Lagrange Recovery
// ============================================================================

function evalPolyScalar(coeffs, xBig) {
  let acc = 0n;
  for (let k = coeffs.length - 1; k >= 0; k--) {
    acc = modL(acc * xBig + coeffs[k]);
  }
  return acc;
}

/**
 * Splits ANY 32-byte (`256`-bit) `secretBytes32` into `shareCount` (`t`-of-`M`) Pedersen-VSS shares
 * via two parallel `128`-bit limbs `(L_0, L_1) ∈ [0, 2^128)^2 ⊂ ℤ_ℓ^2`.
 */
export function splitSecretPedersenVss(secretBytes32, threshold = 2, shareCount = 3) {
  const secret = asBytes(secretBytes32);
  if (secret.length !== 32) throw new Error('secretBytes32 must be exactly 32 bytes');
  if (threshold < 2 || threshold > 6 || shareCount < threshold || shareCount > 8) {
    throw new Error('Invalid Shamir (threshold, shareCount)');
  }

  const l0 = leBytesToBigInt(secret.slice(0, 16));
  const l1 = leBytesToBigInt(secret.slice(16, 32));

  const f0 = [l0];
  const g0 = [randomEdScalar()];
  const f1 = [l1];
  const g1 = [randomEdScalar()];
  for (let k = 1; k < threshold; k++) {
    f0.push(randomEdScalar());
    g0.push(randomEdScalar());
    f1.push(randomEdScalar());
    g1.push(randomEdScalar());
  }

  const commits0 = [];
  const commits1 = [];
  for (let k = 0; k < threshold; k++) {
    commits0.push(edEncode(edAdd(edMul(f0[k], ED_BASE_PT), edMul(g0[k], BP_H_BLIND_PT))));
    commits1.push(edEncode(edAdd(edMul(f1[k], ED_BASE_PT), edMul(g1[k], BP_H_BLIND_PT))));
  }
  const vssCommitsPacked = concatBytes(...commits0, ...commits1);

  const shares = [];
  for (let idx = 0; idx < shareCount; idx++) {
    const x = BigInt(idx + 1);
    const s0 = evalPolyScalar(f0, x);
    const gm0 = evalPolyScalar(g0, x);
    const s1 = evalPolyScalar(f1, x);
    const gm1 = evalPolyScalar(g1, x);
    const p0Bytes = edEncode(edAdd(edMul(s0, ED_BASE_PT), edMul(gm0, BP_H_BLIND_PT)));
    const p1Bytes = edEncode(edAdd(edMul(s1, ED_BASE_PT), edMul(gm1, BP_H_BLIND_PT)));
    const plainShare128 = concatBytes(
      scalarToLeBytes32(s0),
      scalarToLeBytes32(gm0),
      scalarToLeBytes32(s1),
      scalarToLeBytes32(gm1)
    );
    shares.push({
      shareIdx: idx,
      x: Number(x),
      s0,
      gm0,
      s1,
      gm1,
      p0Bytes,
      p1Bytes,
      plainShare128,
    });
  }

  return {
    threshold,
    shareCount,
    vssCommitsPacked,
    vssCommitsHex: bytesToHex(vssCommitsPacked, true),
    shares,
  };
}

export function packConfiguredShamirShares(shareSpecs = []) {
  if (!shareSpecs.length || shareSpecs.length > 8) {
    throw new Error('Expected 2..8 Shamir share specs');
  }
  const chunks = [new Uint8Array([shareSpecs.length])];
  for (const sp of shareSpecs) {
    const kind = Number(sp.shareKind);
    const gid20 = sp.guardianIdentity ? hexToBytes(sp.guardianIdentity).slice(-20) : new Uint8Array(20);
    const slot8 = u64BEBytes(sp.slotId || 0);
    const op20 = sp.operatorEoa ? hexToBytes(sp.operatorEoa).slice(-20) : new Uint8Array(20);
    const secp64 = sp.recipientSecpPub64
      ? asBytes(sp.recipientSecpPub64).slice(0, 64)
      : new Uint8Array(64);
    if (secp64.length !== 64) throw new Error('recipientSecpPub64 must be 64 bytes');
    const lbl = utf8ToBytes(String(sp.label || 'Guardian').slice(0, 32));
    const env = asBytes(sp.encryptedEnvelope);
    if (!env.length || env.length > 320) throw new Error(`Invalid share envelope length: ${env.length}`);
    chunks.push(
      new Uint8Array([kind]),
      gid20,
      slot8,
      op20,
      secp64,
      new Uint8Array([lbl.length]),
      lbl,
      u16BEBytes(env.length),
      env
    );
  }
  return concatBytes(...chunks);
}

export function deriveBlindedShareMasks(identityAddrHex, sessionId, shareIdx, rPtBytes32, yNewBytes32, kSharedBytes32) {
  const id20 = hexToBytes(identityAddrHex).slice(-20);
  const s8 = u64BEBytes(sessionId);
  const i8 = u64BEBytes(shareIdx);
  const r32 = asBytes(rPtBytes32).slice(0, 32);
  const y32 = asBytes(yNewBytes32).slice(0, 32);
  const k32 = asBytes(kSharedBytes32).slice(0, 32);
  const m0 = scalarFromHashNonzero(
    keccak256Bytes(concatBytes(utf8ToBytes('SLX_SHAMIR_MASK_M0V1'), id20, s8, i8, r32, y32, k32))
  );
  const m1 = scalarFromHashNonzero(
    keccak256Bytes(concatBytes(utf8ToBytes('SLX_SHAMIR_MASK_M1V1'), id20, s8, i8, r32, y32, k32))
  );
  return { m0, m1 };
}

/**
 * Generates the `416`-byte zero-leakage blinded share proof verified on-chain by
 * `Identity.submitRecoveryShare(sessionId, shareIdx, blindedShareProof)`.
 * Neither validators, observers, nor other guardians learn `s_0` or `s_1`!
 */
export function proveBlindedRecoveryShare({
  identityAddr,
  sessionId,
  shareIdx,
  newOwnerEoa,
  newDeviceEdPub32,
  p0Bytes,
  p1Bytes,
  plainShare128,
}) {
  const raw = asBytes(plainShare128);
  if (raw.length !== 128) throw new Error('plainShare128 must be 128 bytes');
  const s0 = leBytesToBigInt(raw.slice(0, 32)) % ED25519_L;
  const gm0 = leBytesToBigInt(raw.slice(32, 64)) % ED25519_L;
  const s1 = leBytesToBigInt(raw.slice(64, 96)) % ED25519_L;
  const gm1 = leBytesToBigInt(raw.slice(96, 128)) % ED25519_L;

  const yNewBytes = asBytes(newDeviceEdPub32).slice(0, 32);
  const yNewPt = edDecode(yNewBytes);
  if (!yNewPt) throw new Error('Invalid newDeviceEdPub32 point');

  const r = randomEdScalar();
  const rPtBytes = edEncode(edMul(r, ED_BASE_PT));
  const kPtBytes = edEncode(edMul(r, yNewPt));
  const { m0, m1 } = deriveBlindedShareMasks(identityAddr, sessionId, shareIdx, rPtBytes, yNewBytes, kPtBytes);
  const mu0 = randomEdScalar();
  const mu1 = randomEdScalar();

  const mPt0 = edEncode(edAdd(edMul(m0, ED_BASE_PT), edMul(mu0, BP_H_BLIND_PT)));
  const mPt1 = edEncode(edAdd(edMul(m1, ED_BASE_PT), edMul(mu1, BP_H_BLIND_PT)));
  const z0 = modL(s0 + m0);
  const w0 = modL(gm0 + mu0);
  const z1 = modL(s1 + m1);
  const w1 = modL(gm1 + mu1);

  const kr = randomEdScalar();
  const km0 = randomEdScalar();
  const kmu0 = randomEdScalar();
  const km1 = randomEdScalar();
  const kmu1 = randomEdScalar();

  const tR = edEncode(edMul(kr, ED_BASE_PT));
  const tM0 = edEncode(edAdd(edMul(km0, ED_BASE_PT), edMul(kmu0, BP_H_BLIND_PT)));
  const tM1 = edEncode(edAdd(edMul(km1, ED_BASE_PT), edMul(kmu1, BP_H_BLIND_PT)));

  const body224 = concatBytes(
    rPtBytes,
    mPt0,
    scalarToLeBytes32(z0),
    scalarToLeBytes32(w0),
    mPt1,
    scalarToLeBytes32(z1),
    scalarToLeBytes32(w1)
  );

  const pre495 = concatBytes(
    utf8ToBytes('SLX_SHAMIR_BLIND_POK_V1'),
    hexToBytes(identityAddr).slice(-20),
    u64BEBytes(sessionId),
    u64BEBytes(shareIdx),
    hexToBytes(newOwnerEoa).slice(-20),
    yNewBytes,
    asBytes(p0Bytes).slice(0, 32),
    asBytes(p1Bytes).slice(0, 32),
    body224,
    tR,
    tM0,
    tM1
  );
  const c = scalarFromHashNonzero(keccak256Bytes(pre495));

  const ur = modL(kr + c * r);
  const um0 = modL(km0 + c * m0);
  const umu0 = modL(kmu0 + c * mu0);
  const um1 = modL(km1 + c * m1);
  const umu1 = modL(kmu1 + c * mu1);

  const proofBytes = concatBytes(
    body224,
    scalarToLeBytes32(c),
    scalarToLeBytes32(ur),
    scalarToLeBytes32(um0),
    scalarToLeBytes32(umu0),
    scalarToLeBytes32(um1),
    scalarToLeBytes32(umu1)
  );
  return {
    proofBytes,
    proofHex: bytesToHex(proofBytes, true),
  };
}

/**
 * Runs strictly inside `Device_New`'s local RAM: unblinds `>= threshold` submitted shares using
 * `newDeviceEdSecretScalar` (`y_new`) and Lagrange-interpolates the 32-byte `masterSeedBytes32`!
 */
export function unblindAndRecoverMasterSeed({
  identityAddr,
  sessionId,
  newDeviceEdSecretScalar,
  newDeviceEdPub32,
  threshold,
  submittedShares,
}) {
  const valid = (submittedShares || []).filter((s) => s.hasBlinded && s.blinded96Bytes?.length === 96);
  if (valid.length < threshold) {
    throw new Error(`Need at least ${threshold} submitted shares to recover (have ${valid.length})`);
  }
  const chosen = valid.slice(0, threshold);
  const yNewBytes = asBytes(newDeviceEdPub32).slice(0, 32);
  const yNewScalar = BigInt(newDeviceEdSecretScalar);

  const unblinded = chosen.map((sh) => {
    const rBytes = sh.blinded96Bytes.slice(0, 32);
    const z0 = leBytesToBigInt(sh.blinded96Bytes.slice(32, 64)) % ED25519_L;
    const z1 = leBytesToBigInt(sh.blinded96Bytes.slice(64, 96)) % ED25519_L;
    const rPt = edDecode(rBytes);
    if (!rPt) throw new Error(`Invalid R_i point on share #${sh.shareIdx}`);
    const kBytes = edEncode(edMul(yNewScalar, rPt));
    const { m0, m1 } = deriveBlindedShareMasks(identityAddr, sessionId, sh.shareIdx, rBytes, yNewBytes, kBytes);
    return {
      x: BigInt(sh.shareIdx + 1),
      s0: modL(z0 - m0),
      s1: modL(z1 - m1),
    };
  });

  // Lagrange interpolation at x = 0 over `ℤ_ℓ`
  let l0 = 0n;
  let l1 = 0n;
  for (let i = 0; i < unblinded.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < unblinded.length; j++) {
      if (i === j) continue;
      num = modL(num * unblinded[j].x);
      den = modL(den * (unblinded[j].x - unblinded[i].x));
    }
    const lam = modL(num * scalarInvL(den));
    l0 = modL(l0 + lam * unblinded[i].s0);
    l1 = modL(l1 + lam * unblinded[i].s1);
  }

  const limb0Bytes = scalarToLeBytes32(l0);
  const limb1Bytes = scalarToLeBytes32(l1);
  for (let b = 16; b < 32; b++) {
    if (limb0Bytes[b] !== 0 || limb1Bytes[b] !== 0) {
      throw new Error('Recovered Shamir limbs out of 128-bit range (invalid share or wrong passphrase)');
    }
  }
  const masterSeedBytes32 = new Uint8Array(32);
  masterSeedBytes32.set(limb0Bytes.slice(0, 16), 0);
  masterSeedBytes32.set(limb1Bytes.slice(0, 16), 16);
  return {
    masterSeedBytes32,
    masterSeedHex: bytesToHex(masterSeedBytes32, true),
  };
}

/**
 * Generates a dedicated replacement-device `Edwards25519` blinding keypair `(y_new, Y_new)`
 * from the new device's private key + target `identityAddr`.
 */
export function deriveRecoverySessionKeypair(newDevicePrivateKeyHex, identityAddrHex) {
  const kp = deriveKeypairInfo(newDevicePrivateKeyHex);
  const ctx = concatBytes(utf8ToBytes('SLX_REC_SESSION_ED_V1:'), hexToBytes(identityAddrHex).slice(-20));
  const ed = deriveEd25519Keypair(hexToBytes(kp.privateKey), ctx);
  return {
    eoa: kp.address.toLowerCase(),
    secpPrivHex: kp.privateKey,
    secpPub64Bytes: hexToBytes(kp.uncompressedPubKey).slice(1, 65),
    edSecretScalar: ed.secretScalar,
    edPub32Bytes: ed.pub32Bytes,
    edPub32Hex: ed.pub32Hex,
  };
}

/**
 * Stateless Biometric Key-Recovery Oracle helper:
 * Holds ZERO local database — reads `wardIdentity.getRecoveryState()` directly from Subnet 1,
 * locates the share assigned to `oracleSlotPrivateKeyHex`, unwraps ONLY its 1-of-`t` share in RAM,
 * and returns the `416`-byte blinded proof bound to `session.newDeviceEdPub32`.
 */
export async function buildStatelessOracleRecoverySubmission(rpcUrl, oracleSlotPrivateKeyHex, wardIdentityAddr) {
  const slotKp = deriveKeypairInfo(oracleSlotPrivateKeyHex);
  const slotEoa = slotKp.address.toLowerCase();
  const rawHex = await slxNodeRpc(rpcUrl, 'eth_call', [
    { to: wardIdentityAddr, data: IdentityV4RecoveryAbi.getRecoveryState() },
    'latest',
  ]);
  const state = decodeRecoveryStateHex(rawHex);
  if (!state.session || (state.session.status !== REC_STATUS_COLLECTING && state.session.status !== REC_STATUS_TIMELOCKED)) {
    throw new Error('No active recovery session awaiting shares on ward Identity');
  }
  const share = state.shares.find(
    (s) =>
      (s.shareKind === SHARE_KIND_GUARDIAN_SLOT || s.shareKind === SHARE_KIND_DIRECT_EOA) &&
      s.operatorEoa.toLowerCase() === slotEoa
  );
  if (!share) {
    throw new Error(`No Shamir share assigned to oracle/guardian slot ${slotEoa}`);
  }
  const plainShare128 = unwrapSecretWithPrivKey(share.envelopeBytes, slotKp.privateKey, GUARDIAN_SHARE_WRAP_TAG);
  if (!plainShare128 || plainShare128.length !== 128) {
    throw new Error('Failed to unwrap guardian Shamir share envelope');
  }
  const { proofBytes, proofHex } = proveBlindedRecoveryShare({
    identityAddr: wardIdentityAddr,
    sessionId: state.session.sessionId,
    shareIdx: share.shareIdx,
    newOwnerEoa: state.session.newOwnerEoa,
    newDeviceEdPub32: state.session.newDeviceEdPub32Bytes,
    p0Bytes: share.p0Bytes,
    p1Bytes: share.p1Bytes,
    plainShare128,
  });
  return {
    sessionId: state.session.sessionId,
    shareIdx: share.shareIdx,
    slotId: share.slotId,
    operatorEoa: slotEoa,
    proofBytes,
    proofHex,
    calldataHex: IdentityV4RecoveryAbi.submitRecoveryShare(state.session.sessionId, share.shareIdx, proofBytes),
  };
}

// ============================================================================
// 4. `Identity` v4 ABI Calldata Builders & Binary View Decoders
// ============================================================================

export const IdentityV4RecoveryAbi = {
  initializeWithKeysAndSeed(ownerAddr, handleStr, nickStr, idSecp64, idEd32Hex, devSecp64, wrappedSeed) {
    return encodeAbi('initializeWithKeysAndSeed(address,string,string,bytes,bytes32,bytes,bytes)', [
      ['address', ownerAddr],
      ['string', String(handleStr)],
      ['string', String(nickStr)],
      ['bytes', asBytes(idSecp64)],
      ['bytes32', idEd32Hex],
      ['bytes', asBytes(devSecp64)],
      ['bytes', asBytes(wrappedSeed)],
    ]);
  },
  addOwnerDevice(deviceEoa, deviceSecp64, labelStr, wrappedSeed) {
    return encodeAbi('addOwnerDevice(address,bytes,string,bytes)', [
      ['address', deviceEoa],
      ['bytes', asBytes(deviceSecp64)],
      ['string', String(labelStr || 'Device').slice(0, 32)],
      ['bytes', asBytes(wrappedSeed)],
    ]);
  },
  updateDeviceWrappedSeed(deviceEoa, deviceSecp64, wrappedSeed) {
    return encodeAbi('updateDeviceWrappedSeed(address,bytes,bytes)', [
      ['address', deviceEoa],
      ['bytes', asBytes(deviceSecp64)],
      ['bytes', asBytes(wrappedSeed)],
    ]);
  },
  removeOwnerDevice(deviceEoa, newIdSecp64 = new Uint8Array(0), newIdEd32Hex = '0x' + '00'.repeat(32), rewrappedPacked = new Uint8Array(0)) {
    return encodeAbi('removeOwnerDevice(address,bytes,bytes32,bytes)', [
      ['address', deviceEoa],
      ['bytes', asBytes(newIdSecp64)],
      ['bytes32', newIdEd32Hex],
      ['bytes', asBytes(rewrappedPacked)],
    ]);
  },
  isOwnerDevice(actorAddr) {
    return encodeAbi('isOwnerDevice(address)', [['address', actorAddr]]);
  },
  getOwnerDevices() {
    return encodeAbi('getOwnerDevices()');
  },
  addGuardianKeySlot(operatorEoa, edPub32Hex, secpPub64, maxCapacity, labelStr) {
    return encodeAbi('addGuardianKeySlot(address,bytes32,bytes,uint64,string)', [
      ['address', operatorEoa],
      ['bytes32', edPub32Hex],
      ['bytes', asBytes(secpPub64)],
      ['uint64', maxCapacity],
      ['string', String(labelStr || 'Enclave Slot').slice(0, 32)],
    ]);
  },
  retireGuardianKeySlot(slotId) {
    return encodeAbi('retireGuardianKeySlot(uint64)', [['uint64', slotId]]);
  },
  allocateGuardianSlot(wardIdentityAddr) {
    return encodeAbi('allocateGuardianSlot(address)', [['address', wardIdentityAddr]]);
  },
  previewAvailableGuardianSlot(wardIdentityAddr) {
    return encodeAbi('previewAvailableGuardianSlot(address)', [['address', wardIdentityAddr]]);
  },
  getGuardianKeychain() {
    return encodeAbi('getGuardianKeychain()');
  },
  configureShamirRecovery(threshold, timelockBlocks, vssCommitsPacked, sharesPacked) {
    return encodeAbi('configureShamirRecovery(uint64,uint64,bytes,bytes)', [
      ['uint64', threshold],
      ['uint64', timelockBlocks],
      ['bytes', asBytes(vssCommitsPacked)],
      ['bytes', asBytes(sharesPacked)],
    ]);
  },
  initiateRecovery(newOwnerEoa, newDeviceSecp64, newDeviceEd32Hex, deviceLabelStr) {
    return encodeAbi('initiateRecovery(address,bytes,bytes32,string)', [
      ['address', newOwnerEoa],
      ['bytes', asBytes(newDeviceSecp64)],
      ['bytes32', newDeviceEd32Hex],
      ['string', String(deviceLabelStr || 'Recovered Device').slice(0, 32)],
    ]);
  },
  submitRecoveryShare(sessionId, shareIdx, blindedProofBytes) {
    return encodeAbi('submitRecoveryShare(uint64,uint64,bytes)', [
      ['uint64', sessionId],
      ['uint64', shareIdx],
      ['bytes', asBytes(blindedProofBytes)],
    ]);
  },
  cancelRecovery() {
    return encodeAbi('cancelRecovery()');
  },
  finalizeRecovery(sessionId, revokeExistingDevices, wrappedSeedForNewDevice) {
    return encodeAbi('finalizeRecovery(uint64,bool,bytes)', [
      ['uint64', sessionId],
      ['bool', Boolean(revokeExistingDevices)],
      ['bytes', asBytes(wrappedSeedForNewDevice)],
    ]);
  },
  getRecoveryState() {
    return encodeAbi('getRecoveryState()');
  },
};

export function decodeOwnerDevicesHex(hex) {
  if (!hex || hex === '0x') return [];
  const b = hexToBytes(hex);
  if (b.length < 2) return [];
  const cnt = readU16BE(b, 0);
  let pos = 2;
  const out = [];
  for (let i = 0; i < cnt && pos + 96 <= b.length; i++) {
    const status = b[pos];
    const eoa = bytesToHex(b.slice(pos + 1, pos + 21), true).toLowerCase();
    const addedBlock = readU64BE(b, pos + 21);
    const secpPub64Bytes = b.slice(pos + 29, pos + 93);
    const ll = b[pos + 93];
    pos += 94;
    if (pos + ll + 2 > b.length) break;
    const label = bytesToUtf8(b.slice(pos, pos + ll));
    pos += ll;
    const wl = readU16BE(b, pos);
    pos += 2;
    if (pos + wl > b.length) break;
    const wrappedSeedBytes = b.slice(pos, pos + wl);
    pos += wl;
    out.push({
      index: i,
      status,
      eoa,
      addedBlock,
      secpPub64Bytes,
      secpPub64Hex: bytesToHex(secpPub64Bytes, true),
      label,
      wrappedSeedBytes,
      wrappedSeedHex: bytesToHex(wrappedSeedBytes, true),
    });
  }
  return out;
}

export function decodeGuardianSlotDescriptorHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 132) return null;
  return {
    slotId: readU64BE(b, 0),
    assignedCount: readU32BE(b, 8),
    maxCapacity: readU32BE(b, 12),
    operatorEoa: bytesToHex(b.slice(16, 36), true).toLowerCase(),
    edPub32Bytes: b.slice(36, 68),
    edPub32Hex: bytesToHex(b.slice(36, 68), true),
    secpPub64Bytes: b.slice(68, 132),
    secpPub64Hex: bytesToHex(b.slice(68, 132), true),
  };
}

export function decodeGuardianKeychainHex(hex) {
  if (!hex || hex === '0x') return [];
  const b = hexToBytes(hex);
  if (b.length < 2) return [];
  const cnt = readU16BE(b, 0);
  let pos = 2;
  const out = [];
  for (let i = 0; i < cnt && pos + 138 <= b.length; i++) {
    const slotId = readU32BE(b, pos);
    const status = b[pos + 4];
    const assignedCount = readU32BE(b, pos + 5);
    const maxCapacity = readU32BE(b, pos + 9);
    const createdBlock = readU64BE(b, pos + 13);
    const operatorEoa = bytesToHex(b.slice(pos + 21, pos + 41), true).toLowerCase();
    const edPub32Bytes = b.slice(pos + 41, pos + 73);
    const secpPub64Bytes = b.slice(pos + 73, pos + 137);
    const ll = b[pos + 137];
    pos += 138;
    if (pos + ll > b.length) break;
    const label = bytesToUtf8(b.slice(pos, pos + ll));
    pos += ll;
    out.push({
      slotId,
      status,
      assignedCount,
      maxCapacity,
      createdBlock,
      operatorEoa,
      edPub32Bytes,
      edPub32Hex: bytesToHex(edPub32Bytes, true),
      secpPub64Bytes,
      secpPub64Hex: bytesToHex(secpPub64Bytes, true),
      label,
    });
  }
  return out;
}

export function decodeRecoveryStateHex(hex) {
  if (!hex || hex === '0x') {
    return { configEpoch: 0, threshold: 0, shareCount: 0, timelockBlocks: 0, session: null, shares: [] };
  }
  const b = hexToBytes(hex);
  if (b.length < 52) {
    return { configEpoch: 0, threshold: 0, shareCount: 0, timelockBlocks: 0, session: null, shares: [] };
  }
  const configEpoch = readU64BE(b, 0);
  const threshold = b[8];
  const shareCount = b[9];
  const sessStatus = b[10];
  const submittedCount = b[11];
  const timelockBlocks = readU64BE(b, 12);
  const sessionId = readU64BE(b, 20);
  const initiatedBlock = readU64BE(b, 28);
  const unlockBlock = readU64BE(b, 36);
  const submittedMask = readU64BE(b, 44);
  let pos = 52;

  let session = null;
  if (sessionId > 0 && pos + 117 <= b.length) {
    const newOwnerEoa = bytesToHex(b.slice(pos, pos + 20), true).toLowerCase();
    const newDeviceEdPub32Bytes = b.slice(pos + 20, pos + 52);
    const newDeviceSecp64Bytes = b.slice(pos + 52, pos + 116);
    const ll = b[pos + 116];
    pos += 117;
    const label = pos + ll <= b.length ? bytesToUtf8(b.slice(pos, pos + ll)) : '';
    pos += ll;
    session = {
      sessionId,
      status: sessStatus,
      submittedCount,
      initiatedBlock,
      unlockBlock,
      submittedMask,
      newOwnerEoa,
      newDeviceEdPub32Bytes,
      newDeviceEdPub32Hex: bytesToHex(newDeviceEdPub32Bytes, true),
      newDeviceSecp64Bytes,
      newDeviceSecp64Hex: bytesToHex(newDeviceSecp64Bytes, true),
      label,
    };
  }

  const shares = [];
  for (let i = 0; i < shareCount && pos + 181 <= b.length; i++) {
    const shareIdx = b[pos];
    const shareKind = b[pos + 1];
    const guardianIdentity = bytesToHex(b.slice(pos + 2, pos + 22), true).toLowerCase();
    const slotId = readU64BE(b, pos + 22);
    const operatorEoa = bytesToHex(b.slice(pos + 30, pos + 50), true).toLowerCase();
    const recipientSecp64Bytes = b.slice(pos + 50, pos + 114);
    const p0Bytes = b.slice(pos + 114, pos + 146);
    const p1Bytes = b.slice(pos + 146, pos + 178);
    const ll = b[pos + 178];
    pos += 179;
    if (pos + ll + 3 > b.length) break;
    const label = bytesToUtf8(b.slice(pos, pos + ll));
    pos += ll;
    const el = readU16BE(b, pos);
    pos += 2;
    if (pos + el + 1 > b.length) break;
    const envelopeBytes = b.slice(pos, pos + el);
    pos += el;
    const hasBlinded = b[pos] === 1;
    pos += 1;
    let blinded96Bytes = null;
    if (hasBlinded && pos + 96 <= b.length) {
      blinded96Bytes = b.slice(pos, pos + 96);
      pos += 96;
    }
    shares.push({
      shareIdx,
      shareKind,
      guardianIdentity: guardianIdentity === ZERO_ADDR ? '' : guardianIdentity,
      slotId,
      operatorEoa: operatorEoa === ZERO_ADDR ? '' : operatorEoa,
      recipientSecp64Bytes,
      recipientSecp64Hex: bytesToHex(recipientSecp64Bytes, true),
      p0Bytes,
      p0Hex: bytesToHex(p0Bytes, true),
      p1Bytes,
      p1Hex: bytesToHex(p1Bytes, true),
      label,
      envelopeBytes,
      envelopeHex: bytesToHex(envelopeBytes, true),
      hasBlinded,
      blinded96Bytes,
    });
  }

  return {
    configEpoch,
    threshold,
    shareCount,
    timelockBlocks,
    session,
    shares,
    decodeUintWord,
  };
}
