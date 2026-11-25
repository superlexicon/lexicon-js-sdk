/**
 * @superlexicon/sdk/reward-voucher
 *
 * Client & Cryptographic Voucher SDK for SuperLexicon's Hardware-Gated `SLXR` Reward,
 * 3-Month (`90-Day`) Active Validator Maturity & Audited Cash-Back Redemption HFS
 * (`reward_voucher.wasm`, HPS #25) + Banking & Payments Oracle helpers.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  keccak256Bytes,
  generatePrivateKeyHex,
} from './crypto.js';
import {
  ZERO_ADDR,
  readU64BE,
  encodeAbi,
} from './abi.js';
import {
  ED25519_BASEPOINT_BYTES,
  deriveEd25519Keypair,
  proveEd25519Schnorr,
  verifyEd25519Schnorr,
  leBytesToBigInt,
} from './confidential.js';
import { slxNodeRpc, getDefaultNodeWsUrl } from './rpc.js';

export const VOUCHER_STATUS = Object.freeze({
  NONE: 0,
  ISSUED_AWAITING_VALIDATOR: 1,
  CLAIMED: 2,
  REVOKED_REFUNDED: 3,
});

export const HARDWARE_SKU = Object.freeze({
  DONGLE: 1, // $178 -> KS 20% = 35,600,000 SLXR | Retail 5% = 8,900,000 SLXR
  WATCH: 2,  // $688 -> KS 20% = 137,600,000 SLXR | Retail 5% = 34,400,000 SLXR
  SLATE: 3,  // $1,198 -> KS 20% = 239,600,000 SLXR | Retail 5% = 59,900,000 SLXR
});

export const REWARD_TIER_BPS = Object.freeze({
  KICKSTARTER: 2_000, // 20.00%
  RETAIL: 500,        // 5.00%
});

export const DEFAULT_MIN_ACTIVE_VALIDATOR_DAYS = 90; // 3 months (90 daily epochs)
export const DEFAULT_BLOCKS_PER_VALIDATOR_DAY = 20_000; // ~86,000s (~24h) at ~4.3s/block => 1,800,000 blocks

const DOMAIN_COMMITMENT = utf8ToBytes('SLXR_VOUCHER_V1');
const DOMAIN_CLAIM = utf8ToBytes('SLXR_CLAIM_V1');
const DOMAIN_FOREIGN_EPOCH = utf8ToBytes('SLX_FOREIGN_EPOCH_V1');

/**
 * Compute expected `SLXR` entitlement for a hardware SKU & purchase tier (`1 USD = 1,000,000 SLXR` face base).
 */
export function computeExpectedSlxrEntitlement(skuCode, tierBps = REWARD_TIER_BPS.RETAIL, customPriceUsd = 0) {
  const defaultPricesUsd = {
    [HARDWARE_SKU.DONGLE]: 178,
    [HARDWARE_SKU.WATCH]: 688,
    [HARDWARE_SKU.SLATE]: 1198,
  };
  const usd = Number(customPriceUsd || defaultPricesUsd[Number(skuCode)] || 0);
  if (usd <= 0) return 0;
  const micros = BigInt(Math.round(usd * 1_000_000));
  return Number((micros * BigInt(Math.round(Number(tierBps || 0)))) / 10_000n);
}

/**
 * Compute `voucherCommitment = keccak256("SLXR_VOUCHER_V1" || voucherPk32)` matching `reward_voucher.wasm`.
 */
export function computeVoucherCommitment(voucherPk32Input) {
  const pk32 = voucherPk32Input instanceof Uint8Array ? voucherPk32Input : hexToBytes(voucherPk32Input);
  if (pk32.length !== 32) throw new Error('voucherPk32 must be 32 bytes');
  return bytesToHex(keccak256Bytes(concatBytes(DOMAIN_COMMITMENT, pk32)), true);
}

/**
 * Generate a privacy-preserving Checkout Voucher Bundle in the buyer's browser:
 * - Only `voucherCommitment` is sent in checkout metadata (Stripe / Bank Wire / Kickstarter).
 * - `seedHex` / `secretLeHex` stays strictly with the buyer to sign `claimValidatedReward` after 90 days!
 */
export function generateCheckoutVoucherBundle(seedHex = '', contextTag = 'slx-checkout-voucher-v1') {
  const seed = seedHex ? seedHex : generatePrivateKeyHex();
  const kp = deriveEd25519Keypair(seed, contextTag);
  const voucherCommitment = computeVoucherCommitment(kp.pub32Bytes);
  return {
    seedHex: seed.startsWith('0x') ? seed : `0x${seed}`,
    contextTag,
    secretLeHex: kp.secretHex32,
    voucherPkHex: kp.pub32Hex,
    voucherCommitment,
  };
}

/**
 * Build & sign a front-run-proof 64-byte `Edwards25519` Schnorr signature authorizing `claimValidatedReward`.
 * Binds `(rewardVoucherAddr, paymentRefHash, validatorPubKey, recipientIdentity, ethRecipient)` so no
 * mempool searcher can swap the destination address.
 */
export function signVoucherClaimIntent({
  secretLeHexOrScalar,
  rewardVoucherAddr,
  paymentRefHash,
  validatorPubKey,
  recipientIdentity,
  ethRecipient = ZERO_ADDR,
}) {
  const scalar =
    typeof secretLeHexOrScalar === 'bigint'
      ? secretLeHexOrScalar
      : leBytesToBigInt(hexToBytes(secretLeHexOrScalar));
  const rv20 = hexToBytes(rewardVoucherAddr);
  const pref32 = hexToBytes(paymentRefHash);
  const val32 = hexToBytes(validatorPubKey);
  const rec20 = hexToBytes(recipientIdentity);
  const eth20 = hexToBytes(ethRecipient || ZERO_ADDR);

  if (rv20.length !== 20 || pref32.length !== 32 || val32.length !== 32 || rec20.length !== 20 || eth20.length !== 20) {
    throw new Error('Invalid address or bytes32 length in signVoucherClaimIntent');
  }

  const claimCtx = concatBytes(DOMAIN_CLAIM, rv20, pref32, val32, rec20, eth20); // 137 bytes
  const sig64 = proveEd25519Schnorr(scalar, ED25519_BASEPOINT_BYTES, claimCtx);
  return {
    claimCtx,
    signatureBytes: sig64,
    signatureHex: bytesToHex(sig64, true),
  };
}

export function verifyVoucherClaimIntent({
  voucherPkHex,
  rewardVoucherAddr,
  paymentRefHash,
  validatorPubKey,
  recipientIdentity,
  ethRecipient = ZERO_ADDR,
  signatureHex,
}) {
  const claimCtx = concatBytes(
    DOMAIN_CLAIM,
    hexToBytes(rewardVoucherAddr),
    hexToBytes(paymentRefHash),
    hexToBytes(validatorPubKey),
    hexToBytes(recipientIdentity),
    hexToBytes(ethRecipient || ZERO_ADDR)
  );
  return verifyEd25519Schnorr(
    ED25519_BASEPOINT_BYTES,
    hexToBytes(voucherPkHex),
    claimCtx,
    hexToBytes(signatureHex)
  );
}

/**
 * Compute privacy-preserving `paymentRefHash = keccak256("SLX_PAYMENT_REF_V1|" || salt || "|" || rail || "|" || extId)`
 * matching Rust `oracle::compute_payment_ref_hash`.
 */
export function computeOraclePaymentRefHash(domainSalt, rail, externalPaymentId) {
  const msg = concatBytes(
    utf8ToBytes('SLX_PAYMENT_REF_V1|'),
    typeof domainSalt === 'string' ? utf8ToBytes(domainSalt) : domainSalt,
    utf8ToBytes(`|${String(rail || '').trim().toLowerCase()}|${String(externalPaymentId || '').trim()}`)
  );
  return bytesToHex(keccak256Bytes(msg), true);
}

export const RewardVoucherAbi = {
  initialize({
    adminAddr,
    bankingOracleAddr,
    slxrLedgerAddr = ZERO_ADDR,
    cashLedgerAddr = ZERO_ADDR,
    vaultAccountAddr = ZERO_ADDR,
    minActiveEpochs = DEFAULT_MIN_ACTIVE_VALIDATOR_DAYS,
    minEpochSpacingBlocks = DEFAULT_BLOCKS_PER_VALIDATOR_DAY,
  }) {
    return encodeAbi('initialize(address,address,address,address,address,uint64,uint64)', [
      ['address', adminAddr],
      ['address', bankingOracleAddr],
      ['address', slxrLedgerAddr || ZERO_ADDR],
      ['address', cashLedgerAddr || ZERO_ADDR],
      ['address', vaultAccountAddr || ZERO_ADDR],
      ['uint64', BigInt(minActiveEpochs)],
      ['uint64', BigInt(minEpochSpacingBlocks)],
    ]);
  },

  issuePaidVoucher({
    paymentRefHash,
    skuCode = HARDWARE_SKU.DONGLE,
    tierBps = REWARD_TIER_BPS.RETAIL,
    priceUsdMicros = 0,
    voucherCommitment,
  }) {
    return encodeAbi('issuePaidVoucher(bytes32,uint64,uint64,uint64,bytes32)', [
      ['bytes32', paymentRefHash],
      ['uint64', BigInt(skuCode)],
      ['uint64', BigInt(tierBps)],
      ['uint64', BigInt(priceUsdMicros)],
      ['bytes32', voucherCommitment],
    ]);
  },

  revokeRefundedVoucher(paymentRefHash) {
    return encodeAbi('revokeRefundedVoucher(bytes32)', [['bytes32', paymentRefHash]]);
  },

  recordLocalValidatorEpoch(validatorPubKey) {
    return encodeAbi('recordLocalValidatorEpoch(bytes32)', [['bytes32', validatorPubKey]]);
  },

  recordForeignSubnetEpoch({ subnetIdBytes32, validatorPubKey, epochBlocksValidated, quorumBlob }) {
    const blob = quorumBlob instanceof Uint8Array ? quorumBlob : hexToBytes(quorumBlob);
    return encodeAbi('recordForeignSubnetEpoch(bytes32,bytes32,uint64,bytes)', [
      ['bytes32', subnetIdBytes32],
      ['bytes32', validatorPubKey],
      ['uint64', BigInt(epochBlocksValidated)],
      ['bytes', blob],
    ]);
  },

  claimValidatedReward({
    paymentRefHash,
    voucherPkHex,
    validatorPubKey,
    recipientIdentity,
    ethRecipient = ZERO_ADDR,
    signatureHex,
  }) {
    return encodeAbi('claimValidatedReward(bytes32,bytes32,bytes32,address,address,bytes)', [
      ['bytes32', paymentRefHash],
      ['bytes32', voucherPkHex],
      ['bytes32', validatorPubKey],
      ['address', recipientIdentity],
      ['address', ethRecipient || ZERO_ADDR],
      ['bytes', signatureHex instanceof Uint8Array ? signatureHex : hexToBytes(signatureHex)],
    ]);
  },

  depositRealizedBufferSavings(cashMicros) {
    return encodeAbi('depositRealizedBufferSavings(uint64)', [['uint64', BigInt(cashMicros)]]);
  },

  redeemSlxrForCashBack(slxrAmount) {
    return encodeAbi('redeemSlxrForCashBack(uint64)', [['uint64', BigInt(slxrAmount)]]);
  },

  getVoucher(paymentRefHash) {
    return encodeAbi('getVoucher(bytes32)', [['bytes32', paymentRefHash]]);
  },

  getValidatorMaturity(validatorPubKey) {
    return encodeAbi('getValidatorMaturity(bytes32)', [['bytes32', validatorPubKey]]);
  },

  getPoolStats() {
    return encodeAbi('getPoolStats()');
  },
};

export function decodeVoucherRecordHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 160) return null;
  const status = b[0];
  return {
    status,
    skuCode: readU64BE(b, 1),
    tierBps: readU64BE(b, 9),
    priceUsdMicros: readU64BE(b, 17),
    slxrAmount: readU64BE(b, 25),
    issuedBlock: readU64BE(b, 33),
    settledBlock: readU64BE(b, 41),
    voucherCommitment: bytesToHex(b.slice(49, 81), true),
    claimedValidatorPubKey: bytesToHex(b.slice(81, 113), true),
    claimedRecipientIdentity: bytesToHex(b.slice(113, 133), true),
    claimedEthRecipient: bytesToHex(b.slice(133, 153), true),
  };
}

export function decodeValidatorMaturityHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 80) return null;
  const activeEpochsCompleted = readU64BE(b, 0);
  const cumulativeBlocksValidated = readU64BE(b, 8);
  const lastCreditedAnchorBlock = readU64BE(b, 16);
  const lastSubnetId = bytesToHex(b.slice(24, 56), true);
  const claimedVoucher = b[56] !== 0;
  const minActiveEpochs = readU64BE(b, 64) || DEFAULT_MIN_ACTIVE_VALIDATOR_DAYS;
  const minEpochSpacingBlocks = readU64BE(b, 72) || DEFAULT_BLOCKS_PER_VALIDATOR_DAY;
  return {
    activeEpochsCompleted,
    cumulativeBlocksValidated,
    lastCreditedAnchorBlock,
    lastSubnetId,
    claimedVoucher,
    minActiveEpochs,
    minEpochSpacingBlocks,
    eligibleToClaim: !claimedVoucher && activeEpochsCompleted >= minActiveEpochs,
    progressPct: Math.min(100, Math.round((activeEpochsCompleted / Math.max(1, minActiveEpochs)) * 100)),
  };
}

export function decodeRewardPoolStatsHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 80) return null;
  const unredeemedSlxr = readU64BE(b, 40);
  const vaultCashMicros = readU64BE(b, 56);
  const rateE12 = readU64BE(b, 72);
  // USD cash-back per 1,000,000 SLXR (`1.00 USD = 1.0` when 100% face value is backed)
  const usdPerMillionSlxr = unredeemedSlxr > 0 ? vaultCashMicros / unredeemedSlxr : 0;
  return {
    minActiveEpochs: readU64BE(b, 0),
    minEpochSpacingBlocks: readU64BE(b, 8),
    totalIssuedVouchers: readU64BE(b, 16),
    totalClaimedVouchers: readU64BE(b, 24),
    totalRevokedVouchers: readU64BE(b, 32),
    unredeemedSlxr,
    redeemedSlxr: readU64BE(b, 48),
    vaultCashMicros,
    totalCashPaidMicros: readU64BE(b, 64),
    prevailingRateE12: rateE12,
    usdPerMillionSlxr,
  };
}

export async function fetchLocalNodeValidatorMaturity(rpcUrl = getDefaultNodeWsUrl()) {
  try {
    return await slxNodeRpc(rpcUrl, 'slx_validatorMaturity', [], 3000);
  } catch (_) {
    return null;
  }
}

export { DOMAIN_FOREIGN_EPOCH };
