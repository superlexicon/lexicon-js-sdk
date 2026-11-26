/**
 * @superlexicon/sdk/crowdfunding
 *
 * Client & Binary Wire Codec for SuperLexicon's Board-Resolution-Activated Pre-Order
 * Crowdfunding & Stretch-Goal Corporate Growth Budget HFS (`crowdfunding.wasm`, HPS #26),
 * linked directly to `AccountingLedger` -> `CorporateCharter` -> `Authorization` (`BOARD_RESOLUTION`).
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Bytes,
  keccak256Hex,
} from './crypto.js';
import {
  ZERO_ADDR,
  ZERO_BYTES32,
  u64BEBytes,
  readU64BE,
  encodeAbi,
} from './abi.js';

export const ACTION_LAUNCH_CROWDFUNDING = keccak256Hex(utf8ToBytes('LAUNCH_CROWDFUNDING'));

export const CROWDFUNDING_MODE = Object.freeze({
  SINGLE_HARD_CAP: 1,
  SINGLE_ALL_OR_NOTHING: 2,
  MULTI_TIER_GROWTH_BUDGET: 3,
});

export const CROWDFUNDING_STATE = Object.freeze({
  UNINITIALIZED: 0,
  PENDING_BOARD_RESOLUTION: 1,
  LIVE: 2,
  SETTLED_SUCCEEDED: 3,
  FAILED_REFUNDABLE: 4,
  // Backwards-compatible aliases
  ACTIVE: 2,
  SUCCEEDED: 3,
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
  1: { code: '1200-MOQ', ifrsAccount: '1200 Inventory (IAS 2)', label: 'Base Manufacturing & Mold Tooling MOQ' },
  2: { code: '6400-RND', ifrsAccount: '6400 R&D Expense (IAS 38)', label: 'R&D Firmware / Silicon / RF Engineering' },
  3: { code: '1500-CAPEX', ifrsAccount: '1500 PPE Machinery (IAS 16)', label: 'Automated SMT & RF Test Equipment' },
  4: { code: '6400-CERT', ifrsAccount: '6400 G&A Compliance (IAS 1)', label: 'FCC / CE / TELEC Global RF Certifications' },
  5: { code: '6400-GROWTH', ifrsAccount: '6400 S&M Growth (IAS 1)', label: 'Global Repeater Seed & Channel Growth' },
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

function resolveAmount(primary, legacyMicros) {
  if (primary !== undefined && primary !== null) return Math.round(Number(primary));
  if (legacyMicros !== undefined && legacyMicros !== null) return Math.round(Number(legacyMicros));
  return 0;
}

/**
 * Pack a list of Reward SKU definitions (`64 bytes` each) for `Crowdfunding.proposeCampaign(...)`.
 */
export function packCrowdfundingRewardSkus(skus = []) {
  const chunks = skus.map((s) => {
    const out = new Uint8Array(64);
    const price = resolveAmount(s.unitPrice ?? s.unitPriceUsd, s.unitPriceMicros);
    out.set(u64BEBytes(Number(s.skuCode || 1)), 0);
    out.set(u64BEBytes(price), 8);
    out.set(u64BEBytes(Number(s.maxUnits || 0)), 16);
    out.set(u64BEBytes(Number(s.voucherTierBps || 0)), 24);
    out.set(padUtf8Fixed32(s.name || 'Reward Tier'), 32);
    return out;
  });
  return chunks.length ? concatBytes(...chunks) : new Uint8Array(0);
}

/**
 * Pack a list of ascending Corporate Growth Budget Tiers (`88 bytes` each) for `Crowdfunding.proposeCampaign(...)`.
 */
export function packCrowdfundingBudgetTiers(tiers = []) {
  const chunks = tiers.map((t, idx) => {
    const out = new Uint8Array(88);
    const threshold = resolveAmount(t.threshold ?? t.thresholdUsd, t.thresholdMicros);
    const alloc = resolveAmount(t.budgetAllocation ?? t.budgetAllocationUsd, t.budgetAllocationMicros);
    out.set(u64BEBytes(threshold), 0);
    out.set(u64BEBytes(alloc), 8);
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
  proposeCampaign({
    accountingLedger = ZERO_ADDR,
    escrowIdentity = ZERO_ADDR,
    rewardVoucherHfs = ZERO_ADDR,
    bankingOracle = ZERO_ADDR,
    campaignMode = CROWDFUNDING_MODE.MULTI_TIER_GROWTH_BUDGET,
    baseTarget = undefined,
    baseTargetMicros = undefined,
    durationBlocks = 400,
    title = 'SuperLexicon Wave 1 Hardware',
    rewardSkus = [],
    budgetTiers = [],
  }) {
    const targetAmt = resolveAmount(baseTarget, baseTargetMicros) || 150_000;
    const titleBytes = padUtf8Fixed32(title);
    const skusBytes = packCrowdfundingRewardSkus(rewardSkus);
    const tiersBytes = packCrowdfundingBudgetTiers(budgetTiers);
    return encodeAbi(
      'proposeCampaign(address,address,address,address,uint64,uint64,uint64,bytes,bytes,bytes)',
      [
        ['address', accountingLedger],
        ['address', escrowIdentity],
        ['address', rewardVoucherHfs],
        ['address', bankingOracle],
        ['uint64', campaignMode],
        ['uint64', targetAmt],
        ['uint64', durationBlocks],
        ['bytes', titleBytes],
        ['bytes', skusBytes],
        ['bytes', tiersBytes],
      ]
    );
  },

  initialize(opts) {
    return this.proposeCampaign(opts);
  },

  bindBoardResolution(authObjAddr) {
    return encodeAbi('bindBoardResolution(address)', [['address', authObjAddr]]);
  },

  activateCampaign(authObjAddr) {
    return encodeAbi('activateCampaign(address)', [['address', authObjAddr]]);
  },

  hashActivateCampaign() {
    return encodeAbi('hashActivateCampaign()', []);
  },

  specHash() {
    return encodeAbi('specHash()', []);
  },

  accountingLedger() {
    return encodeAbi('accountingLedger()', []);
  },

  associatedCharter() {
    return encodeAbi('associatedCharter()', []);
  },

  boardResolutionAuth() {
    return encodeAbi('boardResolutionAuth()', []);
  },

  escrowIdentity() {
    return encodeAbi('escrowIdentity()', []);
  },

  state() {
    return encodeAbi('state()', []);
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
    amount = undefined,
    amountMicros = undefined,
    expenseRefHash = ZERO_BYTES32,
    authHps = ZERO_ADDR,
  }) {
    const amt = resolveAmount(amount, amountMicros);
    return encodeAbi(
      'disburseUnlockedBudgetLine(uint64,address,uint64,bytes32,address)',
      [
        ['uint64', tierIndex],
        ['address', vendorIdentity],
        ['uint64', amt],
        ['bytes32', expenseRefHash],
        ['address', authHps],
      ]
    );
  },

  hashDisburseBudgetLine({
    tierIndex = 0,
    vendorIdentity = ZERO_ADDR,
    amount = 0,
    expenseRefHash = ZERO_BYTES32,
  }) {
    return encodeAbi('hashDisburseBudgetLine(uint64,address,uint64,bytes32)', [
      ['uint64', tierIndex],
      ['address', vendorIdentity],
      ['uint64', amount],
      ['bytes32', expenseRefHash],
    ]);
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

export const AccountingCrowdfundingAbi = Object.freeze({
  hashActivateCrowdfundingCampaign(crowdfundingHps, specHash) {
    return encodeAbi('hashActivateCrowdfundingCampaign(address,bytes32)', [
      ['address', crowdfundingHps],
      ['bytes32', specHash],
    ]);
  },
  activateCrowdfundingCampaign(crowdfundingHps, authObj) {
    return encodeAbi('activateCrowdfundingCampaign(address,address)', [
      ['address', crowdfundingHps],
      ['address', authObj],
    ]);
  },
  crowdfundingCampaignCount() {
    return encodeAbi('crowdfundingCampaignCount()', []);
  },
  getCrowdfundingCampaign(index) {
    return encodeAbi('getCrowdfundingCampaign(uint64)', [['uint64', index]]);
  },
  isRatifiedCrowdfundingCampaign(crowdfundingHps) {
    return encodeAbi('isRatifiedCrowdfundingCampaign(address)', [['address', crowdfundingHps]]);
  },
});

/**
 * Decode the 320-byte `getCampaignSummary()` frame returned by `crowdfunding.wasm`.
 */
export function decodeCampaignSummaryHex(hexStr) {
  const b = hexToBytes(hexStr);
  if (b.length < 320) throw new Error(`Expected 320-byte campaign summary, got ${b.length}`);
  const baseTarget = readU64BE(b, 16);
  const totalCommitted = readU64BE(b, 48);
  return {
    state: readU64BE(b, 0),
    mode: readU64BE(b, 8),
    baseTarget,
    baseTargetUsd: baseTarget,
    durationBlocks: readU64BE(b, 24),
    activatedAtBlock: readU64BE(b, 32),
    deadlineBlock: readU64BE(b, 40),
    totalCommitted,
    totalCommittedUsd: totalCommitted,
    progressPct: baseTarget > 0 ? (totalCommitted / baseTarget) * 100 : 0,
    totalEscrowedOnChain: readU64BE(b, 56),
    totalPreauthOracle: readU64BE(b, 64),
    totalCapturedOracle: readU64BE(b, 72),
    totalRefunded: readU64BE(b, 80),
    totalBudgetUnlocked: readU64BE(b, 88),
    totalBudgetSpent: readU64BE(b, 96),
    pledgeCount: readU64BE(b, 104),
    skuCount: readU64BE(b, 112),
    tierCount: readU64BE(b, 120),
    unlockedTierCount: readU64BE(b, 128),
    title: trimFixedUtf8(b.subarray(136, 168)),
    accountingLedger: bytesToHex(b.subarray(168, 188), true).toLowerCase(),
    corporateCharter: bytesToHex(b.subarray(188, 208), true).toLowerCase(),
    boardResolutionAuth: bytesToHex(b.subarray(208, 228), true).toLowerCase(),
    escrowIdentity: bytesToHex(b.subarray(228, 248), true).toLowerCase(),
    specHash: bytesToHex(b.subarray(248, 280), true).toLowerCase(),
    activateActionHash: bytesToHex(b.subarray(280, 312), true).toLowerCase(),
    sweptToTreasury: readU64BE(b, 312) === 1,
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
    const threshold = readU64BE(b, off);
    const budgetAllocation = readU64BE(b, off + 8);
    const spent = readU64BE(b, off + 16);
    const ifrsCategory = readU64BE(b, off + 24);
    const unlocked = readU64BE(b, off + 32) === 1;
    out.push({
      tierIndex: i,
      threshold,
      thresholdUsd: threshold,
      budgetAllocation,
      budgetAllocationUsd: budgetAllocation,
      spent,
      spentUsd: spent,
      ifrsCategory,
      ifrsMeta: GROWTH_BUDGET_CATEGORY_META[ifrsCategory] || GROWTH_BUDGET_CATEGORY_META[1],
      unlocked,
      unlockedAtBlock: readU64BE(b, off + 40),
      lineItemCodeHex: bytesToHex(b.subarray(off + 48, off + 80), true),
      title: trimFixedUtf8(b.subarray(off + 80, off + 112)),
      remaining: unlocked ? Math.max(0, budgetAllocation - spent) : 0,
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
    const unitPrice = readU64BE(b, off + 8);
    out.push({
      skuIndex: i,
      skuCode: readU64BE(b, off),
      unitPrice,
      unitPriceUsd: unitPrice,
      maxUnits: readU64BE(b, off + 16),
      voucherTierBps: readU64BE(b, off + 24),
      soldUnits: readU64BE(b, off + 32),
      name: trimFixedUtf8(b.subarray(off + 40, off + 72)),
    });
  }
  return out;
}
