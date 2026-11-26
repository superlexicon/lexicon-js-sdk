/**
 * @superlexicon/sdk/crowdfunding
 *
 * Client & Binary Wire Codec for SuperLexicon's Milestone Crowdfunding & Stretch-Goal Corporate
 * Growth Budget HFS (`crowdfunding.wasm`, HPS #26).
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Bytes,
} from './crypto.js';
import {
  ZERO_ADDR,
  ZERO_BYTES32,
  u64BEBytes,
  readU64BE,
  encodeAbi,
} from './abi.js';

export const CROWDFUNDING_MODE = Object.freeze({
  SINGLE_HARD_CAP: 1,
  SINGLE_ALL_OR_NOTHING: 2,
  MULTI_TIER_GROWTH_BUDGET: 3,
});

export const CROWDFUNDING_STATE = Object.freeze({
  UNINITIALIZED: 0,
  ACTIVE: 1,
  SUCCEEDED: 2,
  FAILED_REFUNDABLE: 3,
});

export const PLEDGE_STATUS = Object.freeze({
  NONE: 0,
  ESCROWED_ONCHAIN: 1,
  PREAUTH_HOLD_ORACLE: 2,
  FINALIZED_CAPTURED: 3,
  REFUNDED_OR_VOIDED: 4,
});

export const GROWTH_BUDGET_CATEGORY = Object.freeze({
  BASE_MANUFACTURING_MOQ: 1,
  RND_ENGINEERING: 2,
  CAPEX_EQUIPMENT: 3,
  CERTIFICATION_COMPLIANCE: 4,
  GROWTH_DISTRIBUTION: 5,
});

export const GROWTH_BUDGET_CATEGORY_META = Object.freeze({
  1: { code: '1020-MOQ', label: 'Base Manufacturing & Mold Tooling MOQ' },
  2: { code: '6100-RND', label: 'R&D Firmware / Silicon / RF Engineering' },
  3: { code: '1600-CAPEX', label: 'IAS 16 Automated SMT & RF Test Equipment' },
  4: { code: '6300-CERT', label: 'FCC / CE / TELEC Global RF Certifications' },
  5: { code: '6200-GROWTH', label: 'Global Repeater Seed & Channel Growth' },
});

function padUtf8Fixed32(str) {
  const out = new Uint8Array(32);
  const raw = utf8ToBytes(String(str || ''));
  out.set(raw.subarray(0, 32), 0);
  return out;
}

function trimFixedUtf8(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytesToUtf8(bytes.subarray(0, end));
}

/**
 * Pack a list of Reward SKU definitions (`64 bytes` each) for `Crowdfunding.initialize(...)`.
 */
export function packCrowdfundingRewardSkus(skus = []) {
  const chunks = skus.map((s) => {
    const out = new Uint8Array(64);
    out.set(u64BEBytes(Number(s.skuCode || 1)), 0);
    out.set(u64BEBytes(Math.round(Number(s.unitPriceMicros || 0))), 8);
    out.set(u64BEBytes(Number(s.maxUnits || 0)), 16);
    out.set(u64BEBytes(Number(s.voucherTierBps || 0)), 24);
    out.set(padUtf8Fixed32(s.name || 'Reward Tier'), 32);
    return out;
  });
  return chunks.length ? concatBytes(...chunks) : new Uint8Array(0);
}

/**
 * Pack a list of ascending Corporate Growth Budget Tiers (`88 bytes` each) for `Crowdfunding.initialize(...)`.
 */
export function packCrowdfundingBudgetTiers(tiers = []) {
  const chunks = tiers.map((t, idx) => {
    const out = new Uint8Array(88);
    out.set(u64BEBytes(Math.round(Number(t.thresholdMicros || 0))), 0);
    out.set(u64BEBytes(Math.round(Number(t.budgetAllocationMicros || 0))), 8);
    out.set(u64BEBytes(Number(t.ifrsCategory || 1)), 16);
    const codeBytes = t.lineItemCodeHex
      ? hexToBytes(t.lineItemCodeHex)
      : keccak256Bytes(utf8ToBytes(`BUDGET_TIER_${idx}_${t.title || ''}`));
    out.set(codeBytes.subarray(0, 32), 24);
    out.set(padUtf8Fixed32(t.title || `Stretch Tier ${idx}`), 56);
    return out;
  });
  return chunks.length ? concatBytes(...chunks) : new Uint8Array(0);
}

export const CrowdfundingAbi = Object.freeze({
  initialize({
    admin = ZERO_ADDR,
    charterHps = ZERO_ADDR,
    operatingBankLedger = ZERO_ADDR,
    accountingLedger = ZERO_ADDR,
    rewardVoucherHfs = ZERO_ADDR,
    bankingOracle = ZERO_ADDR,
    campaignMode = CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET,
    baseTargetMicros = 150_000_000_000,
    deadlineBlock = 100_000,
    title = 'SuperLexicon Wave 1 Hardware Launch',
    rewardSkus = [],
    budgetTiers = [],
  }) {
    const titleBytes = padUtf8Fixed32(title);
    const skusBytes = packCrowdfundingRewardSkus(rewardSkus);
    const tiersBytes = packCrowdfundingBudgetTiers(budgetTiers);
    return encodeAbi(
      'initialize(address,address,address,address,address,address,uint64,uint64,uint64,bytes,bytes,bytes)',
      [
        ['address', admin],
        ['address', charterHps],
        ['address', operatingBankLedger],
        ['address', accountingLedger],
        ['address', rewardVoucherHfs],
        ['address', bankingOracle],
        ['uint64', campaignMode],
        ['uint64', baseTargetMicros],
        ['uint64', deadlineBlock],
        ['bytes', titleBytes],
        ['bytes', skusBytes],
        ['bytes', tiersBytes],
      ]
    );
  },

  pledgeOnChain({ skuIndex = 0, quantity = 1, voucherCommitment = ZERO_BYTES32 }) {
    return encodeAbi('pledgeOnChain(uint64,uint64,bytes32)', [
      ['uint64', skuIndex],
      ['uint64', quantity],
      ['bytes32', voucherCommitment],
    ]);
  },

  recordOraclePreorderHold({
    paymentRefHash,
    skuIndex = 0,
    quantity = 1,
    voucherCommitment = ZERO_BYTES32,
  }) {
    return encodeAbi('recordOraclePreorderHold(bytes32,uint64,uint64,bytes32)', [
      ['bytes32', paymentRefHash],
      ['uint64', skuIndex],
      ['uint64', quantity],
      ['bytes32', voucherCommitment],
    ]);
  },

  confirmOracleHoldCaptured(pledgeId) {
    return encodeAbi('confirmOracleHoldCaptured(uint64)', [['uint64', pledgeId]]);
  },

  finalizeCampaign() {
    return encodeAbi('finalizeCampaign()', []);
  },

  claimFullRefund(pledgeId) {
    return encodeAbi('claimFullRefund(uint64)', [['uint64', pledgeId]]);
  },

  issueBackerVoucher(pledgeId) {
    return encodeAbi('issueBackerVoucher(uint64)', [['uint64', pledgeId]]);
  },

  disburseUnlockedBudgetLine({
    tierIndex = 0,
    vendorIdentity = ZERO_ADDR,
    amountMicros = 0,
    expenseRefHash = ZERO_BYTES32,
    authHps = ZERO_ADDR,
  }) {
    return encodeAbi(
      'disburseUnlockedBudgetLine(uint64,address,uint64,bytes32,address)',
      [
        ['uint64', tierIndex],
        ['address', vendorIdentity],
        ['uint64', amountMicros],
        ['bytes32', expenseRefHash],
        ['address', authHps],
      ]
    );
  },

  getCampaignSummary() {
    return encodeAbi('getCampaignSummary()', []);
  },

  getBudgetTiers() {
    return encodeAbi('getBudgetTiers()', []);
  },

  getRewardSkus() {
    return encodeAbi('getRewardSkus()', []);
  },

  getPledge(pledgeId) {
    return encodeAbi('getPledge(uint64)', [['uint64', pledgeId]]);
  },
});

/**
 * Decode the 224-byte `getCampaignSummary()` frame returned by `crowdfunding.wasm`.
 */
export function decodeCampaignSummaryHex(hexStr) {
  const b = hexToBytes(hexStr);
  if (b.length < 224) throw new Error(`Expected 224-byte campaign summary, got ${b.length}`);
  const baseTargetMicros = readU64BE(b, 16);
  const totalCommittedMicros = readU64BE(b, 32);
  return {
    state: b[0],
    mode: readU64BE(b, 8),
    baseTargetMicros,
    baseTargetUsd: baseTargetMicros / 1_000_000,
    deadlineBlock: readU64BE(b, 24),
    totalCommittedMicros,
    totalCommittedUsd: totalCommittedMicros / 1_000_000,
    progressPct: baseTargetMicros > 0 ? (totalCommittedMicros / baseTargetMicros) * 100 : 0,
    totalEscrowedOnChainMicros: readU64BE(b, 40),
    totalPreauthOracleMicros: readU64BE(b, 48),
    totalCapturedOracleMicros: readU64BE(b, 56),
    totalRefundedMicros: readU64BE(b, 64),
    totalBudgetUnlockedMicros: readU64BE(b, 72),
    totalBudgetSpentMicros: readU64BE(b, 80),
    pledgeCount: readU64BE(b, 88),
    skuCount: readU64BE(b, 96),
    tierCount: readU64BE(b, 104),
    unlockedTierCount: readU64BE(b, 112),
    title: trimFixedUtf8(b.subarray(120, 152)),
    admin: bytesToHex(b.subarray(152, 172), true),
    charterHps: bytesToHex(b.subarray(172, 192), true),
    operatingBankLedger: bytesToHex(b.subarray(192, 212), true),
  };
}

/**
 * Decode `N * 112` bytes returned by `getBudgetTiers()`.
 */
export function decodeBudgetTiersHex(hexStr) {
  const b = hexToBytes(hexStr);
  const count = Math.floor(b.length / 112);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = i * 112;
    const thresholdMicros = readU64BE(b, off);
    const budgetAllocationMicros = readU64BE(b, off + 8);
    const ifrsCategory = readU64BE(b, off + 16);
    const spentMicros = readU64BE(b, off + 88);
    const unlocked = b[off + 96] === 1;
    out.push({
      tierIndex: i,
      thresholdMicros,
      thresholdUsd: thresholdMicros / 1_000_000,
      budgetAllocationMicros,
      budgetAllocationUsd: budgetAllocationMicros / 1_000_000,
      ifrsCategory,
      ifrsMeta: GROWTH_BUDGET_CATEGORY_META[ifrsCategory] || GROWTH_BUDGET_CATEGORY_META[1],
      lineItemCodeHex: bytesToHex(b.subarray(off + 24, off + 56), true),
      title: trimFixedUtf8(b.subarray(off + 56, off + 88)),
      spentMicros,
      spentUsd: spentMicros / 1_000_000,
      remainingMicros: unlocked ? Math.max(0, budgetAllocationMicros - spentMicros) : 0,
      unlocked,
      unlockedAtBlock: readU64BE(b, off + 104),
    });
  }
  return out;
}

/**
 * Decode `M * 72` bytes returned by `getRewardSkus()`.
 */
export function decodeRewardSkusHex(hexStr) {
  const b = hexToBytes(hexStr);
  const count = Math.floor(b.length / 72);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = i * 72;
    const unitPriceMicros = readU64BE(b, off + 8);
    out.push({
      skuIndex: i,
      skuCode: readU64BE(b, off),
      unitPriceMicros,
      unitPriceUsd: unitPriceMicros / 1_000_000,
      maxUnits: readU64BE(b, off + 16),
      voucherTierBps: readU64BE(b, off + 24),
      name: trimFixedUtf8(b.subarray(off + 32, off + 64)),
      soldUnits: readU64BE(b, off + 64),
    });
  }
  return out;
}
