/**
 * Shared Institutional HFS Client, ABI Codecs & Live Subnet 1 WebSocket Session
 * (`wss://node1.superlexicon.com/rpc` / `ws://<node>:8545` — Strictly Live, Zero VM Fallback)
 *
 * Powers:
 *  - `/dex.html`      (`dex_clob.wasm` + `asset_ledger.wasm` SGD-FIAT & SLX-EQ)
 *  - `/charter.html`  (`corporate_charter.wasm` + `authorization.wasm` + `asset_ledger.wasm`)
 *  - `/commerce.html` (`product_ledger.wasm` + `accounting_ledger.wasm` + `asset_ledger.wasm`)
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Hex,
  selectorBytes,
  computeAddress,
  generatePrivateKeyHex,
  signLexiconTx,
  SlxWalletManager,
  SlxIdentityDirectory,
  SlxCallCache,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  PUBLIC_SUBNET1_WSS_RPC,
  truncAddr4,
  readOnChainIdentityNickname,
  readOnChainIdentityEncryptionKeys,
  deriveIdentityEncryptionKeys,
  createSingleFlightRefresh,
  slxWaitForReceipt,
} from './index.js';
import { mountSlxUnifiedHeader, mountSlxBootLoader } from './ui/index.js';
import { mountHfsRegistryDropdown } from './hfs-deployers.js';

export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const kHash = (s) => keccak256Hex(utf8ToBytes(s));

const STORAGE_DYNAMIC_IDS_KEY = 'slx_dynamic_inst_identities_v1';

export const GOV_CONSTANTS = {
  ACTION_ISSUE: kHash('ISSUE'),
  ACTION_CANCEL: kHash('CANCEL'),
  ACTION_TRANSFER: kHash('TRANSFER'),
  ACTION_APPROVE: kHash('APPROVE'),
  ACTION_SUPER: kHash('SUPER'),
  ACTION_ROTATE_AUDIT_KEY: kHash('ROTATE_AUDIT_KEY'),
  ACTION_GRANT_AUDITOR_KEY: kHash('GRANT_AUDITOR_KEY'),
  ACTION_CONFIDENTIAL_BATCH: kHash('CONFIDENTIAL_BATCH'),
  ACTION_CONFIDENTIAL_RECEIVABLE: kHash('CONFIDENTIAL_RECEIVABLE'),
  ROLE_SHAREHOLDER: kHash('ROLE_SHAREHOLDER'),
  ROLE_DIRECTOR: kHash('ROLE_DIRECTOR'),
  ROLE_CEO: kHash('ROLE_CEO'),
  ROLE_COO: kHash('ROLE_COO'),
  ROLE_CTO: kHash('ROLE_CTO'),
  ROLE_PRODUCT_MANAGER: kHash('ROLE_PRODUCT_MANAGER'),
  ROLE_TREASURY_MANAGER: kHash('ROLE_TREASURY_MANAGER'),
  ROLE_CHIEF_ACCOUNTANT: kHash('ROLE_CHIEF_ACCOUNTANT'),
  ROLE_BANK_ORACLE: kHash('ROLE_BANK_ORACLE'),
  POLICY_SUPER_GOVERNANCE: kHash('SUPER_GOVERNANCE'),
  POLICY_SHAREHOLDER_SUPERMAJORITY: kHash('SHAREHOLDER_SUPERMAJORITY'),
  POLICY_FIRST_SHAREHOLDER_RESOLUTION: kHash('FIRST_SHAREHOLDER_RESOLUTION'),
  POLICY_BOARD_RESOLUTION: kHash('BOARD_RESOLUTION'),
  POLICY_PRODUCT_MANAGEMENT: kHash('PRODUCT_MANAGEMENT'),
  POLICY_SHARE_TRANSFER_AUCTION: kHash('SHARE_TRANSFER_AUCTION'),
  POLICY_SHARE_ISSUANCE_AUCTION: kHash('SHARE_ISSUANCE_AUCTION'),
  POLICY_FUTURES_UNDERWRITING: kHash('FUTURES_UNDERWRITING'),
  POLICY_BANK_ORACLE: kHash('BANK_ORACLE'),
  POLICY_HOLDER_SELF: kHash('HOLDER_SELF'),
  CAP_MERCHANT_PAYMENT: kHash('CAP_MERCHANT_PAYMENT'),
  CAP_EQUITY_SETTLEMENT: kHash('CAP_EQUITY_SETTLEMENT'),
  CAP_IFRS_RECORDER: kHash('CAP_IFRS_RECORDER'),
  CAP_CONFIDENTIAL_LEDGER: kHash('CAP_CONFIDENTIAL_LEDGER'),
  TOPIC_ORDER_PLACED: kHash('OrderPlaced(uint64,address,uint8,uint64,uint64,uint64)'),
  TOPIC_BLOCK_MATCHED: kHash('BlockMatched(uint64,uint64,uint64,uint64,uint64,uint64)'),
  TOPIC_ORDER_CANCELLED: kHash('OrderCancelled(uint64,address,uint64)'),
  TOPIC_PRODUCT_PURCHASED: '0x336492c0694dc5511a4594acc0f3bb4c3860f2a671bcdfc67ca6966811494b59',
  TOPIC_SALE_RECORDED: '0x3ed4f81dc998bbb12f84db0a07c90864923b489d25d5ec4f4615df4462c690f8',
};

export const HFS_EVENT_TOPICS = {
  CHARTER_INITIALIZED: kHash('CharterInitialized(address,uint64)'),
  CHARTER_ACTIVATED: kHash('CharterActivated(address,address,uint64)'),
  POLICY_SET: kHash('PolicySet(address,bytes32,uint64,uint64)'),
  DIRECTOR_ADDED: kHash('DirectorAdded(address,uint64,address)'),
  DIRECTOR_REMOVED: kHash('DirectorRemoved(address,uint64,address)'),
  DIRECTOR_CONSENTED: kHash('DirectorConsented(address,uint64)'),
  DIRECTOR_PENDING_CONSENT: kHash('DirectorPendingConsent(address,address,uint64)'),
  ROLE_DEFINED: kHash('RoleDefined(bytes32,address,uint64)'),
  ROLE_GRANTED: kHash('RoleGranted(bytes32,address,address,uint64)'),
  ROLE_REVOKED: kHash('RoleRevoked(bytes32,address,address,uint64)'),
  MODULE_AUTHORIZED: kHash('ModuleAuthorized(address,bytes32,bool,address)'),
  SHARE_CLASS_REGISTERED: kHash('ShareClassRegistered(address,uint64,uint64,uint64)'),

  AUTH_INITIALIZED: kHash('AuthorizationInitialized(address,address,bytes32,bytes32)'),
  STAGE_APPROVED: kHash('StageApproved(address,uint64,uint64,uint64)'),
  STAGE_THRESHOLD_REACHED: kHash('StageThresholdReached(uint64,uint64,uint64)'),
  STAGE_ADVANCED: kHash('StageAdvanced(uint64,uint64)'),
  AUTH_FINALIZED: kHash('AuthorizationFinalized(address,uint64)'),
  AUTH_CONSUMED: kHash('AuthorizationConsumed(address,address,bytes32)'),
  AUCTION_STEP1_STARTED: kHash('AuctionStep1Started(address,uint64,uint64,uint64,uint64,uint64)'),
  BUY_ORDER_PLACED: kHash('BuyOrderPlaced(address,uint64,uint64,uint64)'),
  BUY_ORDER_CANCELLED: kHash('BuyOrderCancelled(address,uint64,uint64,uint64)'),
  SELL_ORDER_PLACED: kHash('SellOrderPlaced(address,uint64,uint64,uint64)'),

  SHARE_CAPITAL_INITIALIZED: kHash('ShareCapitalInitialized(address,address,address,address)'),
  SHARE_ESCROW_SET: kHash('ShareEscrowAccountSet(address,address,address)'),
  FUTURES_AUTHORIZED: kHash('FuturesUnderwritingAuthorized(address,uint64,uint64,address)'),
  FUTURES_UNDERWRITTEN: kHash('FuturesUnderwritten(address,address,uint64,uint64,uint64)'),
  FUTURES_CLOSED: kHash('FuturesClosed(address,address,uint64,uint64)'),
  AUCTION_BUY_CLEARED: kHash('AuctionBuyOrderCleared(address,address,uint64)'),
  AUCTION_BUY_REFUNDED: kHash('AuctionBuyOrderRefunded(address,address,uint64)'),
  AUCTION_CASH_SETTLED: kHash('AuctionCashSettled(address,address,uint64,bool)'),
  SHARE_BUYBACK_EXECUTED: kHash('ShareBuybackExecuted(address,address,uint64,uint64,uint64)'),
  ESOP_PROGRAM_CREATED: kHash('EsopProgramCreated(uint64,address,address,uint64,uint64)'),
  ESOP_GRANT_AWARDED: kHash('EsopGrantAwarded(uint64,uint64,address,uint64,uint64)'),
  ESOP_OPTIONS_ISSUED: kHash('EsopOptionsIssued(uint64,uint64,address,uint64,uint64)'),
  ESOP_OPTIONS_EXERCISED: kHash('EsopOptionsExercised(uint64,uint64,address,uint64,bool)'),
  ISSUANCE_ALLOCATION_DETERMINED: kHash(
    'IssuanceAllocationDetermined(address,address,uint64,uint64,uint64,uint64,uint64)'
  ),
  ISSUANCE_SHARES_CLAIMED: kHash(
    'IssuanceSharesClaimed(address,address,address,uint64,uint64)'
  ),

  CREDITED: kHash('Credited(address,uint64,uint64)'),
  DEBITED: kHash('Debited(address,uint64,uint64)'),
  ASSET_ISSUED: kHash('AssetIssued(address,uint64,uint64,address)'),
  ASSET_CANCELLED: kHash('AssetCancelled(address,uint64,uint64,address)'),
  TRANSFER: kHash('Transfer(address,address,uint64)'),
  DEX_ATTACHED: kHash('DexAttached(address,address)'),
  AUCTION_SETTLED: kHash('AuctionTransferSettled(address,uint64,uint64,uint64,uint64,uint64,uint64)'),
  AUCTION_BUYER_FILLED: kHash('AuctionBuyerFilled(address,uint64,uint64,uint64)'),
  AUCTION_SELLER_FILLED: kHash('AuctionSellerFilled(address,uint64,uint64,uint64,uint64)'),
  SHARE_SPLIT_APPLIED: kHash('ShareSplitApplied(uint64,uint64,uint64)'),
  SHARE_REVERSE_SPLIT_APPLIED: kHash('ShareReverseSplitApplied(uint64,uint64,uint64)'),
  AUDIT_EPOCH_ROTATED: kHash('AuditEpochRotated(uint64,bytes32,address)'),
  AUDIT_KEY_WRAPPED: kHash('AuditKeyWrapped(uint64,address,address)'),
  AUDITOR_KEY_GRANTED: kHash('AuditorCategoryKeyGranted(uint64,uint64,bytes32,bytes32,address)'),
  AUDITOR_KEY_REVOKED: kHash('AuditorCategoryKeyRevoked(uint64,address)'),
  SHIELDED_NOTE_MINTED: kHash('ShieldedNoteMinted(uint64,bytes32,bytes32,bytes16)'),
  SHIELDED_NOTE_SPENT: kHash('ShieldedNoteSpent(bytes32,uint64,uint64,address)'),
};

export const AI_CORPORATE_PERSONAS = [
  { idx: 0, fallbackNick: 'Elonn Muskk [SIM-BOT]', avatar: '⚓', roleBio: 'Orbital Logistics & Sovereign Strategy', defaultExec: 'CEO' },
  { idx: 1, fallbackNick: 'Jeff Bezoz [SIM-BOT]', avatar: '🧭', roleBio: 'Global Fulfillment & Risk Governance', defaultExec: 'COO' },
  { idx: 2, fallbackNick: 'Samm Altmann [SIM-BOT]', avatar: '🛡️', roleBio: 'Frontier AI & Mesh Architecture', defaultExec: 'CTO' },
  { idx: 3, fallbackNick: 'Markk Zuker [SIM-BOT]', avatar: '⚡', roleBio: 'Spatial Mesh & Secondary Markets', defaultExec: 'CFO' },
  { idx: 4, fallbackNick: 'Sundarr Pichai [SIM-BOT]', avatar: '🛰️', roleBio: 'Cloud Compute & Treasury Systems', defaultExec: 'CPO' },
  { idx: 5, fallbackNick: 'Bill Gatez [SIM-BOT]', avatar: '💎', roleBio: 'Special Situations & Enterprise Systems', defaultExec: 'Board' },
];

// ---------------------------------------------------------------------------
// ABI Encoding & Binary Decoders
// ---------------------------------------------------------------------------

export function u16BEBytes(n) {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

export function u64BEBytes(n) {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

export function readU64BE(bytes, offset) {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(bytes[offset + i] || 0);
  }
  return Number(v);
}

export function readU32LE(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

export function readU64LE(bytes, offset) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[offset + i] || 0);
  }
  return Number(v);
}

function wordU64(v) {
  const b = new Uint8Array(32);
  b.set(u64BEBytes(v), 24);
  return b;
}

function wordBool(flag) {
  return wordU64(flag ? 1 : 0);
}

function wordAddr(addrHex) {
  const b = new Uint8Array(32);
  if (addrHex && addrHex !== '0x') {
    b.set(hexToBytes(addrHex).slice(-20), 12);
  }
  return b;
}

function wordB4(b4) {
  const b = new Uint8Array(32);
  const raw = typeof b4 === 'string' ? hexToBytes(b4) : b4;
  b.set(raw.slice(0, 4), 0);
  return b;
}

function wordB32(b32Hex) {
  const b = new Uint8Array(32);
  if (b32Hex && b32Hex !== '0x') {
    b.set(hexToBytes(b32Hex).slice(0, 32), 0);
  }
  return b;
}

export function encodeAbi(sig, typedArgs = []) {
  const sel = selectorBytes(sig);
  const headLen = typedArgs.length * 32;
  const heads = [];
  const tails = [];
  let curTailLen = 0;
  for (const [ty, val] of typedArgs) {
    if (ty === 'uint64' || ty === 'uint256' || ty === 'uint8') heads.push(wordU64(val));
    else if (ty === 'bool') heads.push(wordBool(val));
    else if (ty === 'address') heads.push(wordAddr(val));
    else if (ty === 'bytes4') heads.push(wordB4(val));
    else if (ty === 'bytes32') heads.push(wordB32(val));
    else if (ty === 'bytes' || ty === 'string') {
      const raw = typeof val === 'string' ? utf8ToBytes(val) : val;
      heads.push(wordU64(headLen + curTailLen));
      const pad = (32 - (raw.length % 32)) % 32;
      const chunk = concatBytes(wordU64(raw.length), raw, new Uint8Array(pad));
      tails.push(chunk);
      curTailLen += chunk.length;
    } else {
      throw new Error(`Unsupported ABI type: ${ty}`);
    }
  }
  return bytesToHex(concatBytes(sel, ...heads, ...tails));
}

function execWrap(target, innerHex) {
  return encodeAbi('execute(address,bytes)', [
    ['address', target],
    ['bytes', hexToBytes(innerHex)],
  ]);
}

export function decodeUintWord(hex) {
  if (!hex || hex === '0x') return 0;
  const clean = hex.replace(/^0x/, '');
  if (clean.length < 16) return Number(BigInt('0x' + (clean || '0')));
  return Number(BigInt('0x' + clean.slice(-16)));
}

export function decodeAddrWord(hex) {
  if (!hex || hex.length < 42) return ZERO_ADDR;
  return '0x' + hex.slice(-40).toLowerCase();
}

export function encodeClassLabelBytes32(labelStr) {
  const raw = utf8ToBytes(String(labelStr || '').trim()).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(raw, 0);
  return bytesToHex(out);
}

export function decodeBytes32LabelHex(hex, fallback = '') {
  if (!hex || hex === '0x') return fallback;
  const b = hexToBytes(hex);
  if (!b.length) return fallback;
  let end = Math.min(32, b.length);
  while (end > 0 && b[end - 1] === 0) end--;
  if (end === 0) return fallback;
  const s = bytesToUtf8(b.slice(0, end)).trim();
  return s || fallback;
}

export function decodeDexOrderHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 256) return null;
  return {
    orderId: readU64BE(b, 24),
    trader: bytesToHex(b.slice(44, 64)).toLowerCase(),
    side: b[95], // 1 = BID, 2 = ASK
    status: b[127], // 0 = PENDING, 1 = ACTIVE, 2 = FILLED, 3 = CANCELLED
    price: readU64BE(b, 152),
    origQty: readU64BE(b, 184),
    remQty: readU64BE(b, 216),
    blockNumber: readU64BE(b, 248),
  };
}

export function decodeBookDepthHex(hex) {
  if (!hex || hex === '0x') return { pendingCount: 0, bidCount: 0, askCount: 0 };
  const b = hexToBytes(hex);
  if (b.length < 96) return { pendingCount: 0, bidCount: 0, askCount: 0 };
  return {
    pendingCount: readU64BE(b, 24),
    bidCount: readU64BE(b, 56),
    askCount: readU64BE(b, 88),
  };
}

export function decodeBestBidAskHex(hex) {
  if (!hex || hex === '0x') return { bestBid: 0, bestAsk: 0 };
  const b = hexToBytes(hex);
  if (b.length < 64) return { bestBid: 0, bestAsk: 0 };
  return {
    bestBid: readU64BE(b, 24),
    bestAsk: readU64BE(b, 56),
  };
}

export function decodeLastMatchSummaryHex(hex) {
  if (!hex || hex === '0x') {
    return { lastMatchBlock: 0, clearingPrice: 0, matchedVolume: 0, ingestedCount: 0, filledBids: 0, filledAsks: 0 };
  }
  const b = hexToBytes(hex);
  if (b.length < 192) {
    return { lastMatchBlock: 0, clearingPrice: 0, matchedVolume: 0, ingestedCount: 0, filledBids: 0, filledAsks: 0 };
  }
  return {
    lastMatchBlock: readU64BE(b, 24),
    clearingPrice: readU64BE(b, 56),
    matchedVolume: readU64BE(b, 88),
    ingestedCount: readU64BE(b, 120),
    filledBids: readU64BE(b, 152),
    filledAsks: readU64BE(b, 184),
  };
}

export function decodeBlockMatchedLog(logObj) {
  if (!logObj || !Array.isArray(logObj.topics) || logObj.topics.length < 2) return null;
  const blkTopic = logObj.topics[1];
  const block = decodeUintWord(blkTopic);
  const b = hexToBytes(logObj.data || '0x');
  if (b.length < 40) return null;
  return {
    block,
    price: readU64BE(b, 0),
    volume: readU64BE(b, 8),
    ingested: readU64BE(b, 16),
    filledBids: readU64BE(b, 24),
    filledAsks: readU64BE(b, 32),
  };
}

export function decodeCatalogSnapshotHex(hex) {
  if (!hex || hex === '0x') return { ownerIdentity: ZERO_ADDR, skus: [] };
  const b = hexToBytes(hex);
  if (b.length < 24) return { ownerIdentity: ZERO_ADDR, skus: [] };
  const count = readU32LE(b, 0);
  const ownerIdentity = bytesToHex(b.slice(4, 24)).toLowerCase();
  let pos = 24;
  const skus = [];
  for (let i = 0; i < count && pos + 90 <= b.length; i++) {
    const productId = bytesToHex(b.slice(pos, pos + 32)).toLowerCase();
    const unitsAvailable = readU64LE(b, pos + 32);
    const latestPrice = readU64LE(b, pos + 40);
    const totalUnitsSold = readU64LE(b, pos + 58 - 10);
    const active = b[pos + 56] !== 0;
    const nlen = Math.min(32, b[pos + 57]);
    const name = bytesToUtf8(b.slice(pos + 58, pos + 58 + nlen));
    pos += 90;
    skus.push({ productId, unitsAvailable, latestPrice, totalUnitsSold, active, name });
  }
  return { ownerIdentity, skus };
}

export function decodeSaleRecordHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 224) return null;
  return {
    productId: bytesToHex(b.slice(0, 32)).toLowerCase(),
    buyer: bytesToHex(b.slice(44, 64)).toLowerCase(),
    quantity: readU64BE(b, 88),
    unitPrice: readU64BE(b, 120),
    totalAmount: readU64BE(b, 152),
    blockNumber: readU64BE(b, 184),
    productLedger: bytesToHex(b.slice(204, 224)).toLowerCase(),
  };
}

export function decodeVotingPowerHex(hex) {
  if (!hex || hex === '0x') return { voterPower: 0, totalPower: 0, requiredSuperPower: 0, voterCommon: 0 };
  const b = hexToBytes(hex);
  if (b.length < 96) return { voterPower: 0, totalPower: 0, requiredSuperPower: 0, voterCommon: 0 };
  return {
    voterPower: readU64BE(b, 24),
    totalPower: readU64BE(b, 56),
    requiredSuperPower: readU64BE(b, 88),
    voterCommon: b.length >= 128 ? readU64BE(b, 120) : readU64BE(b, 24),
  };
}

// ---------------------------------------------------------------------------
// CorporateCharter, ShareCapital & 3-Step Call-Auction Binary Codecs
// ---------------------------------------------------------------------------

export function encodeRolesBlob(roles) {
  const chunks = [u16BEBytes(roles.length)];
  for (const r of roles) {
    const members = (r.members || []).filter(Boolean);
    chunks.push(hexToBytes(r.roleId).slice(0, 32));
    chunks.push(u16BEBytes(members.length));
    for (const m of members) {
      chunks.push(hexToBytes(m).slice(-20));
    }
  }
  return concatBytes(...chunks);
}

export function encodeStageSpec({ requiredWeight, expiryBlocks, members = [], roles = [] }) {
  const hdr = concatBytes(
    u64BEBytes(requiredWeight),
    u64BEBytes(expiryBlocks),
    new Uint8Array([members.length & 0xff, roles.length & 0xff, 0, 0, 0, 0, 0, 0])
  );
  const memChunks = members.map((m) =>
    concatBytes(hexToBytes(m.identity).slice(-20), u64BEBytes(m.weight ?? 1))
  );
  const roleChunks = roles.map((rl) =>
    concatBytes(hexToBytes(rl.roleId).slice(0, 32), u64BEBytes(rl.weight ?? 1))
  );
  return concatBytes(hdr, ...memChunks, ...roleChunks);
}

export function encodePolicySpec({ overallExpiryBlocks, stages }) {
  const hdr = concatBytes(
    new Uint8Array([1, 1, stages.length & 0xff, 0]),
    u64BEBytes(overallExpiryBlocks)
  );
  return concatBytes(hdr, ...stages.map(encodeStageSpec));
}

export function encodePoliciesBlob(entries) {
  const chunks = [u16BEBytes(entries.length)];
  for (const e of entries) {
    const rawSpec = e.rawSpec instanceof Uint8Array ? e.rawSpec : encodePolicySpec(e.spec);
    chunks.push(hexToBytes(e.targetHps || ZERO_ADDR).slice(-20));
    chunks.push(hexToBytes(e.policyId).slice(0, 32));
    chunks.push(u16BEBytes(rawSpec.length));
    chunks.push(rawSpec);
  }
  return concatBytes(...chunks);
}

export function encodeShareClassesBlob(classes) {
  if (!classes || !classes.length) return new Uint8Array(0);
  const chunks = [u16BEBytes(classes.length)];
  for (const c of classes) {
    chunks.push(hexToBytes(c.ledger).slice(-20));
    chunks.push(u64BEBytes(c.votesPerShare ?? 1));
    chunks.push(u64BEBytes(c.conversionNumer ?? 1));
    chunks.push(u64BEBytes(c.conversionDenom ?? 1));
  }
  return concatBytes(...chunks);
}

export function encodeModulesBlob(modules) {
  if (!modules || !modules.length) return new Uint8Array(0);
  const chunks = [u16BEBytes(modules.length)];
  for (const m of modules) {
    chunks.push(hexToBytes(m.moduleHps).slice(-20));
    chunks.push(hexToBytes(m.capability).slice(0, 32));
  }
  return concatBytes(...chunks);
}

export function decodeAuctionDeadlinesHex(hex) {
  if (!hex || hex === '0x') {
    return { step1Dl: 0, step2Dl: 0, step3Dl: 0, overallDl: 0 };
  }
  const b = hexToBytes(hex);
  if (b.length < 128) {
    return { step1Dl: 0, step2Dl: 0, step3Dl: 0, overallDl: 0 };
  }
  const readCap = (off) => {
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[off + i] || 0);
    return v > 9_000_000_000_000n ? 0 : Number(v);
  };
  return {
    step1Dl: readCap(24),
    step2Dl: readCap(56),
    step3Dl: readCap(88),
    overallDl: readCap(120),
  };
}

export function decodeAuctionOrdersRawHex(hex) {
  if (!hex || hex === '0x') return [];
  const full = hexToBytes(hex);
  let raw = full;
  if (full.length >= 64) {
    const dynLen = readU64BE(full, 56);
    if (dynLen === 0) return [];
    if (64 + dynLen <= full.length) {
      raw = full.slice(64, 64 + dynLen);
    }
  }
  if (raw.length < 4 || raw[0] !== 1) return [];
  const count = (raw[2] << 8) | raw[3];
  const out = [];
  let pos = 4;
  for (let i = 0; i < count && pos + 37 <= raw.length; i++) {
    const side = raw[pos];
    const trader = bytesToHex(raw.slice(pos + 1, pos + 21)).toLowerCase();
    const price = readU64BE(raw, pos + 21);
    const quantity = readU64BE(raw, pos + 29);
    pos += 37;
    const sideLabel =
      side === 1
        ? 'Window 1 • Buyer Bid'
        : side === 2
          ? 'Window 2 • Shareholder Sell'
          : side === 3
            ? 'Window 3 • ROFR Pre-Emptive Bid'
            : 'Cancelled';
    out.push({ index: i, side, sideLabel, trader, price, quantity });
  }
  return out;
}

export function decodeFuturesAllowanceHex(hex) {
  if (!hex || hex === '0x') {
    return {
      convertedCommon: 0,
      maxAllowance: 0,
      alreadyUnderwritten: 0,
      remainingAllowance: 0,
      companyCap: 0,
    };
  }
  const b = hexToBytes(hex);
  if (b.length < 160) {
    return {
      convertedCommon: 0,
      maxAllowance: 0,
      alreadyUnderwritten: 0,
      remainingAllowance: 0,
      companyCap: 0,
    };
  }
  return {
    convertedCommon: readU64BE(b, 24),
    maxAllowance: readU64BE(b, 56),
    alreadyUnderwritten: readU64BE(b, 88),
    remainingAllowance: readU64BE(b, 120),
    companyCap: readU64BE(b, 152),
  };
}

export function decodeLastAuctionSettlementHex(hex) {
  if (!hex || hex === '0x') {
    return { clearingPrice: 0, matchedQty: 0, buyDemand: 0, sellSupply: 0 };
  }
  const b = hexToBytes(hex);
  if (b.length < 128) {
    return { clearingPrice: 0, matchedQty: 0, buyDemand: 0, sellSupply: 0 };
  }
  return {
    clearingPrice: readU64BE(b, 24),
    matchedQty: readU64BE(b, 56),
    buyDemand: readU64BE(b, 88),
    sellSupply: readU64BE(b, 120),
  };
}

export function roleDisplayName(roleIdHex) {
  const low = (roleIdHex || '').toLowerCase();
  if (low === GOV_CONSTANTS.ROLE_CEO.toLowerCase()) return 'CEO (Chief Executive Officer)';
  if (low === GOV_CONSTANTS.ROLE_COO.toLowerCase()) return 'COO (Chief Operating Officer)';
  if (low === GOV_CONSTANTS.ROLE_CTO.toLowerCase()) return 'CTO (Chief Technology Officer)';
  if (low === GOV_CONSTANTS.ROLE_TREASURY_MANAGER.toLowerCase()) return 'CFO (Treasury Manager)';
  if (low === GOV_CONSTANTS.ROLE_PRODUCT_MANAGER.toLowerCase()) return 'CPO (Head of Product)';
  if (low === GOV_CONSTANTS.ROLE_DIRECTOR.toLowerCase()) return 'Board Director';
  if (low === GOV_CONSTANTS.ROLE_SHAREHOLDER.toLowerCase()) return 'Shareholder';
  if (low === GOV_CONSTANTS.ROLE_BANK_ORACLE.toLowerCase()) return 'Bank Oracle';
  return `Role ${shortAddr(low)}`;
}

export function decodeHfsEventLog(logObj, labelFn = shortAddr) {
  if (!logObj || !Array.isArray(logObj.topics) || !logObj.topics.length) return null;
  const t0 = (logObj.topics[0] || '').toLowerCase();
  const t1 = logObj.topics[1] || '';
  const t2 = logObj.topics[2] || '';
  const t3 = logObj.topics[3] || '';
  const data = hexToBytes(logObj.data || '0x');
  const blk = Number(BigInt(logObj.blockNumber || '0x0'));
  const txHash = (logObj.transactionHash || '').toLowerCase();
  const logIdx = Number(BigInt(logObj.logIndex || '0x0'));
  const uid = `${txHash}:${logIdx}`;
  const emitter = (logObj.address || '').toLowerCase();

  const topicAddr = (t) => (t && t.length >= 42 ? '0x' + t.slice(-40).toLowerCase() : ZERO_ADDR);
  const who = (t) => labelFn(topicAddr(t));

  if (t0 === HFS_EVENT_TOPICS.CHARTER_INITIALIZED.toLowerCase()) {
    const polCnt = data.length >= 8 ? readU64BE(data, 0) : 0;
    return {
      uid, blk, txHash, emitter, category: 'charter', kind: 'CharterInitialized', badge: 'cyan', icon: '🏛️',
      title: 'CorporateCharter Initialized (Pending Ratification)',
      detail: `${polCnt} constitutional bylaw policies registered • Awaiting First Shareholder Resolution.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.CHARTER_ACTIVATED.toLowerCase()) {
    return {
      uid, blk, txHash, emitter, category: 'charter', kind: 'CharterActivated', badge: 'green', icon: '⚖️',
      title: 'CorporateCharter RATIFIED & ENACTED → ACTIVE!',
      detail: `Enacted by ${who(t2)} consuming First Shareholder Resolution (${shortAddr(topicAddr(t1))}).`,
      subjectAddr: topicAddr(t2),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.DIRECTOR_ADDED.toLowerCase()) {
    const cnt = data.length >= 8 ? readU64BE(data, 0) : 0;
    return {
      uid, blk, txHash, emitter, category: 'org', kind: 'DirectorAdded', badge: 'green', icon: '👔',
      title: `Director Appointed: ${who(t1)}`,
      detail: `Board expanded to ${cnt} active Director(s) via Auth ${shortAddr(topicAddr(t2))}.`,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.DIRECTOR_REMOVED.toLowerCase()) {
    const cnt = data.length >= 8 ? readU64BE(data, 0) : 0;
    return {
      uid, blk, txHash, emitter, category: 'org', kind: 'DirectorRemoved', badge: 'red', icon: '🔥',
      title: `Director Removed from Board: ${who(t1)}`,
      detail: `Board updated to ${cnt} active Director(s) via Auth ${shortAddr(topicAddr(t2))}.`,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.DIRECTOR_CONSENTED.toLowerCase()) {
    return {
      uid, blk, txHash, emitter, category: 'org', kind: 'DirectorConsented', badge: 'green', icon: '✍️',
      title: `Director Consent Signed: ${who(t1)}`,
      detail: `${who(t1)} signed personal Consent to Act as Director on CorporateCharter ${shortAddr(emitter)}.`,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.DIRECTOR_PENDING_CONSENT.toLowerCase()) {
    const viaAuth = topicAddr(t2);
    return {
      uid, blk, txHash, emitter, category: 'org', kind: 'DirectorPendingConsent', badge: 'amber', icon: '⏳',
      title: `Awaiting Director Consent: ${who(t1)}`,
      detail:
        viaAuth !== ZERO_ADDR
          ? `Shareholder appointment (${shortAddr(viaAuth)}) enacted — Board seat pending ${who(t1)}'s signature.`
          : `Named as Initial Director at incorporation — Charter activation blocked until ${who(t1)} consents.`,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ROLE_GRANTED.toLowerCase()) {
    const roleLabel = roleDisplayName(t1);
    return {
      uid, blk, txHash, emitter, category: 'org', kind: 'RoleGranted', badge: 'green', icon: '🎖️',
      title: `Executive Appointed: ${who(t2)} → ${roleLabel}`,
      detail: `Board Resolution (${shortAddr(topicAddr(t3))}) enacted on CorporateCharter.`,
      subjectAddr: topicAddr(t2),
      roleId: t1.toLowerCase(),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ROLE_REVOKED.toLowerCase()) {
    const roleLabel = roleDisplayName(t1);
    return {
      uid, blk, txHash, emitter, category: 'org', kind: 'RoleRevoked', badge: 'amber', icon: '📤',
      title: `Executive Role Revoked: ${who(t2)} (${roleLabel})`,
      detail: `Revoked via Resolution (${shortAddr(topicAddr(t3))}).`,
      subjectAddr: topicAddr(t2),
      roleId: t1.toLowerCase(),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.STAGE_APPROVED.toLowerCase()) {
    const stg = data.length >= 8 ? readU64BE(data, 0) : 0;
    const w = data.length >= 16 ? readU64BE(data, 8) : 0;
    const accum = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'resolution', kind: 'StageApproved', badge: 'cyan', icon: '✍️',
      title: `Resolution Signed by ${who(t1)} (+${fmtNum(w)} weight)`,
      detail: `Stage #${stg} accumulated weight → ${fmtNum(accum)} on Auth ${shortAddr(emitter)}.`,
      subjectAddr: topicAddr(t1),
      authAddr: emitter,
      weight: w,
      accum,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.STAGE_THRESHOLD_REACHED.toLowerCase()) {
    const accum = data.length >= 16 ? readU64BE(data, 8) : 0;
    const req = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'resolution', kind: 'StageThresholdReached', badge: 'green', icon: '🎯',
      title: `Quorum Threshold Reached (${fmtNum(accum)} / ${fmtNum(req)})!`,
      detail: `Authorization ${shortAddr(emitter)} passed required approval weight.`,
      authAddr: emitter,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUTH_FINALIZED.toLowerCase()) {
    return {
      uid, blk, txHash, emitter, category: 'resolution', kind: 'AuthorizationFinalized', badge: 'green', icon: '✅',
      title: `Authorization Finalized by ${who(t1)}`,
      detail: `One-time Authorization HFS ${shortAddr(emitter)} ready for target consumption.`,
      authAddr: emitter,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUTH_CONSUMED.toLowerCase()) {
    return {
      uid, blk, txHash, emitter, category: 'resolution', kind: 'AuthorizationConsumed', badge: 'green', icon: '🔒',
      title: `One-Time Authorization Consumed`,
      detail: `Consumed by target HFS ${shortAddr(topicAddr(t1))} (invoker: ${who(t2)}).`,
      authAddr: emitter,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ASSET_ISSUED.toLowerCase()) {
    const amt = data.length >= 8 ? readU64BE(data, 0) : 0;
    const newSup = data.length >= 16 ? readU64BE(data, 8) : 0;
    const newBal = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'captable', kind: 'AssetIssued', badge: 'green', icon: '🪙',
      title: `New Capital Issued: +${fmtNum(amt)} shares → ${who(t1)}`,
      detail: `Holder balance: ${fmtNum(newBal)} • Post-money supply: ${fmtNum(newSup)}.`,
      subjectAddr: topicAddr(t1),
      delta: amt,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUCTION_STEP1_STARTED.toLowerCase()) {
    const px = data.length >= 8 ? readU64BE(data, 0) : 0;
    const qty = data.length >= 16 ? readU64BE(data, 8) : 0;
    const d1 = data.length >= 24 ? readU64BE(data, 16) : 0;
    const d2 = data.length >= 32 ? readU64BE(data, 24) : 0;
    const d3 = data.length >= 40 ? readU64BE(data, 32) : 0;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: 1, kind: 'AuctionStep1Started', badge: 'cyan', icon: '🚀',
      title: `Window 1 Clock Started by ${who(t1)} (${fmtNum(qty)} @ ${fmtNum(px)} SGD)`,
      detail: `Deadlines locked: Win1 ≤ #${fmtNum(d1)} • Win2 ≤ #${fmtNum(d2)} • Win3 (ROFR) ≤ #${fmtNum(d3)}.`,
      authAddr: emitter,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUCTION_BUY_CLEARED.toLowerCase()) {
    const px = data.length >= 8 ? readU64BE(data, 0) : 0;
    const qty = data.length >= 16 ? readU64BE(data, 8) : 0;
    const esc = data.length >= 24 ? readU64BE(data, 16) : px * qty;
    return {
      uid, blk, txHash, emitter, category: 'auction', kind: 'AuctionBuyOrderCleared', badge: 'amber', icon: '🏦',
      title: `ShareEscrow Locked: ${fmtNum(esc)} SGD from ${who(t2)}`,
      detail: `Segregated ShareCapital escrow received ${fmtNum(qty)} × ${fmtNum(px)} SGD for Auth ${shortAddr(topicAddr(t1))}.`,
      authAddr: topicAddr(t1),
      subjectAddr: topicAddr(t2),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.BUY_ORDER_PLACED.toLowerCase()) {
    const side = data.length >= 8 ? readU64BE(data, 0) : 1;
    const px = data.length >= 16 ? readU64BE(data, 8) : 0;
    const qty = data.length >= 24 ? readU64BE(data, 16) : 0;
    const isRofr = side === 3;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: isRofr ? 3 : 1, kind: 'BuyOrderPlaced',
      badge: isRofr ? 'green' : 'cyan', icon: isRofr ? '🛡️' : '💵',
      title: `${isRofr ? 'Window 3 ROFR Pre-Emptive Bid' : 'Window 1 Buyer Bid'}: ${who(t1)}`,
      detail: `Bid ${fmtNum(qty)} shares @ ${fmtNum(px)} SGD (${fmtNum(px * qty)} SGD escrowed).`,
      authAddr: emitter,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.BUY_ORDER_CANCELLED.toLowerCase()) {
    const px = data.length >= 16 ? readU64BE(data, 8) : 0;
    const qty = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'auction', kind: 'BuyOrderCancelled', badge: 'red', icon: '↩️',
      title: `Buy Bid Cancelled & Refunded: ${who(t1)}`,
      detail: `Refunded ${fmtNum(px * qty)} SGD (${fmtNum(qty)} @ ${fmtNum(px)} SGD) from ShareEscrow.`,
      authAddr: emitter,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.SELL_ORDER_PLACED.toLowerCase()) {
    const px = data.length >= 8 ? readU64BE(data, 0) : 0;
    const qty = data.length >= 16 ? readU64BE(data, 8) : 0;
    const hold = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: 2, kind: 'SellOrderPlaced', badge: 'amber', icon: '🏷️',
      title: `Window 2 Shareholder Sell Offer: ${who(t1)}`,
      detail: `Offered ${fmtNum(qty)} shares @ min ${fmtNum(px)} SGD (existing holding: ${fmtNum(hold)} shares).`,
      authAddr: emitter,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUCTION_SELLER_FILLED.toLowerCase()) {
    const px = data.length >= 8 ? readU64BE(data, 0) : 0;
    const offered = data.length >= 16 ? readU64BE(data, 8) : 0;
    const hold = data.length >= 24 ? readU64BE(data, 16) : 0;
    const fill = data.length >= 32 ? readU64BE(data, 24) : 0;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: 4, kind: 'AuctionSellerFilled', badge: 'amber', icon: '📤',
      title: `Seller Pro-Rata Fill: ${who(t1)} sold -${fmtNum(fill)} shares @ ${fmtNum(px)} SGD`,
      detail: `Offered ${fmtNum(offered)} (pre-holding ${fmtNum(hold)}) → Proceeds: +${fmtNum(px * fill)} SGD.`,
      authAddr: topicAddr(t2),
      subjectAddr: topicAddr(t1),
      delta: -fill,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUCTION_BUYER_FILLED.toLowerCase()) {
    const px = data.length >= 8 ? readU64BE(data, 0) : 0;
    const bidQty = data.length >= 16 ? readU64BE(data, 8) : 0;
    const fill = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: 4, kind: 'AuctionBuyerFilled', badge: 'green', icon: '📥',
      title: `Buyer Pro-Rata Fill: ${who(t1)} acquired +${fmtNum(fill)} shares @ ${fmtNum(px)} SGD`,
      detail: `Bid ${fmtNum(bidQty)} shares → Cleared ${fmtNum(fill)} shares (${fmtNum(px * fill)} SGD).`,
      authAddr: topicAddr(t2),
      subjectAddr: topicAddr(t1),
      delta: fill,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUCTION_CASH_SETTLED.toLowerCase()) {
    const amt = data.length >= 8 ? readU64BE(data, 0) : 0;
    const isProceeds = data.length >= 16 ? data[15] === 1 : true;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: 4, kind: 'AuctionCashSettled',
      badge: isProceeds ? 'green' : 'cyan', icon: isProceeds ? '💰' : '🔄',
      title: `${isProceeds ? 'Seller Cash Disbursed' : 'Buyer Surplus Refunded'}: ${fmtNum(amt)} SGD → ${who(t2)}`,
      detail: `Disbursed atomically from ShareCapital segregated escrow (${shortAddr(topicAddr(t1))}).`,
      authAddr: topicAddr(t1),
      subjectAddr: topicAddr(t2),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUCTION_SETTLED.toLowerCase()) {
    const px = data.length >= 8 ? readU64BE(data, 0) : 0;
    const vol = data.length >= 16 ? readU64BE(data, 8) : 0;
    const dem = data.length >= 24 ? readU64BE(data, 16) : 0;
    const sup = data.length >= 32 ? readU64BE(data, 24) : 0;
    const bCnt = data.length >= 40 ? readU64BE(data, 32) : 0;
    const sCnt = data.length >= 48 ? readU64BE(data, 40) : 0;
    return {
      uid, blk, txHash, emitter, category: 'auction', step: 4, kind: 'AuctionTransferSettled', badge: 'green', icon: '🏆',
      title: `3-Step Call Auction Settled! P* = ${fmtNum(px)} SGD × ${fmtNum(vol)} Shares`,
      detail: `Crossing Demand ${fmtNum(dem)} vs Supply ${fmtNum(sup)} • ${bCnt} buyer(s) & ${sCnt} seller(s) settled on Cap Table!`,
      authAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ISSUANCE_ALLOCATION_DETERMINED.toLowerCase()) {
    const tot = data.length >= 8 ? readU64BE(data, 0) : 0;
    const px = data.length >= 16 ? readU64BE(data, 8) : 0;
    const rofr = data.length >= 24 ? readU64BE(data, 16) : 0;
    const bidAlloc = data.length >= 32 ? readU64BE(data, 24) : 0;
    const pendSha = data.length >= 40 ? readU64BE(data, 32) : 0;
    return {
      uid, blk, txHash, emitter, category: 'issuance', step: 4, kind: 'IssuanceAllocationDetermined', badge: 'cyan', icon: '⚖️',
      title: `Step 4 Allocation Determined! ${fmtNum(tot)} sh @ P* = ${fmtNum(px)} SGD`,
      detail: `ROFR Priority: ${fmtNum(rofr)} sh • Step 2 Bidders: ${fmtNum(bidAlloc)} sh • ${pendSha} New Shareholder(s) awaiting Step 5 SHA signature.`,
      authAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ISSUANCE_SHARES_CLAIMED.toLowerCase()) {
    const sh = data.length >= 8 ? readU64BE(data, 0) : 0;
    const px = data.length >= 16 ? readU64BE(data, 8) : 0;
    return {
      uid, blk, txHash, emitter, category: 'issuance', step: 5, kind: 'IssuanceSharesClaimed', badge: 'green', icon: '✍️',
      title: `Step 5 SHA Signed & Shares Minted: +${fmtNum(sh)} sh → ${who(t3)}`,
      detail: `${who(t3)} signed the Shareholders' Agreement & paid ${fmtNum(sh * px)} SGD (${fmtNum(px)} SGD/sh) → Cap Table updated automatically!`,
      authAddr: topicAddr(t1),
      subjectAddr: topicAddr(t3),
      delta: sh,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.FUTURES_AUTHORIZED.toLowerCase()) {
    const pct = data.length >= 8 ? readU64BE(data, 0) : 0;
    const cap = data.length >= 16 ? readU64BE(data, 8) : 0;
    return {
      uid, blk, txHash, emitter, category: 'futures', kind: 'FuturesUnderwritingAuthorized', badge: 'cyan', icon: '📊',
      title: `Futures Underwriting Facility Authorized (${pct}% Cap = ${fmtNum(cap)} units)`,
      detail: `Futures Ledger ${shortAddr(topicAddr(t1))} authorized via Resolution ${shortAddr(topicAddr(t2))}.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.FUTURES_UNDERWRITTEN.toLowerCase()) {
    const amt = data.length >= 8 ? readU64BE(data, 0) : 0;
    const tot = data.length >= 16 ? readU64BE(data, 8) : 0;
    const maxA = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'futures', kind: 'FuturesUnderwritten', badge: 'green', icon: '⚡',
      title: `Shareholder Underwrote +${fmtNum(amt)} Futures (${who(t2)})`,
      detail: `Open position: ${fmtNum(tot)} / ${fmtNum(maxA)} allowance on ${shortAddr(topicAddr(t1))}.`,
      subjectAddr: topicAddr(t2),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.DEX_ATTACHED.toLowerCase()) {
    return {
      uid, blk, txHash, emitter, category: 'futures', kind: 'DexAttached', badge: 'green', icon: '📈',
      title: `MEV-Proof DEX CLOB (${shortAddr(topicAddr(t1))}) Attached to Ledger!`,
      detail: `Attached by ${who(t2)} onto AssetLedger ${shortAddr(emitter)}.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.SHARE_CLASS_REGISTERED.toLowerCase()) {
    const vps = data.length >= 8 ? readU64BE(data, 0) : 1;
    const num = data.length >= 16 ? readU64BE(data, 8) : 1;
    const den = data.length >= 24 ? readU64BE(data, 16) : 1;
    const mult = den > 0 ? Math.round((vps * num) / den) : 1;
    return {
      uid, blk, txHash, emitter, category: 'captable', kind: 'ShareClassRegistered', badge: 'cyan', icon: '💎',
      title: `Share Class Registered: ${shortAddr(topicAddr(t1))} (${mult}x Common & Votes/sh)`,
      detail: `Conversion ${num}:${den} to Common • Voting multiplier ${mult}x registered on CorporateCharter.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.SHARE_BUYBACK_EXECUTED.toLowerCase()) {
    const sh = data.length >= 8 ? readU64BE(data, 0) : 0;
    const px = data.length >= 16 ? readU64BE(data, 8) : 0;
    const tot = data.length >= 24 ? readU64BE(data, 16) : sh * px;
    return {
      uid, blk, txHash, emitter, category: 'captable', kind: 'ShareBuybackExecuted', badge: 'amber', icon: '🔄',
      title: `Share Buyback Retired -${fmtNum(sh)} Shares from ${who(t2)}`,
      detail: `Repurchased @ ${fmtNum(px)} SGD/sh (${fmtNum(tot)} SGD paid) & retired on ${shortAddr(topicAddr(t1))}.`,
      subjectAddr: topicAddr(t2),
      delta: -sh,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.SHARE_SPLIT_APPLIED.toLowerCase()) {
    const mult = data.length >= 8 ? readU64BE(data, 0) : 2;
    const pre = data.length >= 16 ? readU64BE(data, 8) : 0;
    const post = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'captable', kind: 'ShareSplitApplied', badge: 'green', icon: '✂️',
      title: `Forward Share Split Executed (${mult}-for-1)!`,
      detail: `Supply expanded ${fmtNum(pre)} → ${fmtNum(post)} shares across all holders on ${shortAddr(emitter)}.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.SHARE_REVERSE_SPLIT_APPLIED.toLowerCase()) {
    const div = data.length >= 8 ? readU64BE(data, 0) : 2;
    const pre = data.length >= 16 ? readU64BE(data, 8) : 0;
    const post = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'captable', kind: 'ShareReverseSplitApplied', badge: 'cyan', icon: '📐',
      title: `Reverse Share Split Executed (1-for-${div})!`,
      detail: `Supply consolidated ${fmtNum(pre)} → ${fmtNum(post)} shares on ${shortAddr(emitter)}.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ESOP_PROGRAM_CREATED.toLowerCase()) {
    const pid = data.length >= 8 ? readU64BE(data, 0) : 0;
    const authSh = data.length >= 16 ? readU64BE(data, 8) : 0;
    const exPx = data.length >= 24 ? readU64BE(data, 16) : 0;
    return {
      uid, blk, txHash, emitter, category: 'esop', kind: 'EsopProgramCreated', badge: 'cyan', icon: '🎓',
      title: `Master ESOP Programme #${pid} Enacted (${fmtNum(authSh)} Options @ ${fmtNum(exPx)} SGD)`,
      detail: `Option Ledger ${shortAddr(topicAddr(t1))} → Underlying ${shortAddr(topicAddr(t2))}.`,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ESOP_GRANT_AWARDED.toLowerCase()) {
    const pid = data.length >= 8 ? readU64BE(data, 0) : 0;
    const gid = data.length >= 16 ? readU64BE(data, 8) : 0;
    const tot = data.length >= 24 ? readU64BE(data, 16) : 0;
    const clf = data.length >= 32 ? readU64BE(data, 24) : 0;
    return {
      uid, blk, txHash, emitter, category: 'esop', kind: 'EsopGrantAwarded', badge: 'amber', icon: '🎖️',
      title: `Board Option Award #${gid}: ${fmtNum(tot)} Options → ${who(t1)}`,
      detail: `ESOP #${pid} • Exercise cliff at Block #${fmtNum(clf)}.`,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ESOP_OPTIONS_ISSUED.toLowerCase()) {
    const pid = data.length >= 8 ? readU64BE(data, 0) : 0;
    const gid = data.length >= 16 ? readU64BE(data, 8) : 0;
    const amt = data.length >= 24 ? readU64BE(data, 16) : 0;
    const cum = data.length >= 32 ? readU64BE(data, 24) : amt;
    return {
      uid, blk, txHash, emitter, category: 'esop', kind: 'EsopOptionsIssued', badge: 'green', icon: '⏱️',
      title: `Periodic ESOP Issuance: +${fmtNum(amt)} Options → ${who(t1)}`,
      detail: `Grant #${gid} (ESOP #${pid}) • Cumulative issued options: ${fmtNum(cum)}.`,
      subjectAddr: topicAddr(t1),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.ESOP_OPTIONS_EXERCISED.toLowerCase()) {
    const pid = data.length >= 8 ? readU64BE(data, 0) : 0;
    const gid = data.length >= 16 ? readU64BE(data, 8) : 0;
    const amt = data.length >= 24 ? readU64BE(data, 16) : 0;
    const signedSha = data.length >= 32 ? data[31] === 1 : false;
    return {
      uid, blk, txHash, emitter, category: 'captable', kind: 'EsopOptionsExercised', badge: 'green', icon: '🚀',
      title: `Employee Exercised ${fmtNum(amt)} Options → Shares (${who(t1)})`,
      detail: `Grant #${gid} (ESOP #${pid})${signedSha ? ' • Signed First-Time Shareholders\' Agreement ✓' : ' • Existing Shareholder ✓'}.`,
      subjectAddr: topicAddr(t1),
      delta: amt,
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUDIT_EPOCH_ROTATED.toLowerCase()) {
    const ep = t1 ? decodeUintWord(t1) : 1;
    return {
      uid, blk, txHash, emitter, category: 'governance', kind: 'AuditEpochRotated', badge: 'cyan', icon: '🔐',
      title: `CompanyAuditKey Rotated → Epoch #${ep}`,
      detail: `Rotated by ${who(t2)} • Forward secrecy active for all subsequent confidential category roll-ups.`,
      subjectAddr: topicAddr(t2),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUDIT_KEY_WRAPPED.toLowerCase()) {
    const ep = t1 ? decodeUintWord(t1) : 1;
    return {
      uid, blk, txHash, emitter, category: 'governance', kind: 'AuditKeyWrapped', badge: 'green', icon: '🔑',
      title: `Officer Audit Envelope Sealed (Epoch #${ep}): ${who(t2)}`,
      detail: `ECDH CompanyAuditKey envelope provisioned for ${who(t2)} by ${who(t3)}.`,
      subjectAddr: topicAddr(t2),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUDITOR_KEY_GRANTED.toLowerCase()) {
    const gid = t1 ? decodeUintWord(t1) : 0;
    const ep = data.length >= 8 ? readU64BE(data, 0) : 1;
    const perStr = data.length >= 72 ? decodeBytes32LabelHex(bytesToHex(data.slice(40, 72)), 'Period') : 'Period';
    return {
      uid, blk, txHash, emitter, category: 'governance', kind: 'AuditorCategoryKeyGranted', badge: 'amber', icon: '🔍',
      title: `Scoped External Auditor Viewing Key #${gid} Granted → ${who(t3)}`,
      detail: `Authorized for Epoch #${ep} • Period ${perStr} (single category KDF subkey only).`,
      subjectAddr: topicAddr(t3),
    };
  }
  if (t0 === HFS_EVENT_TOPICS.AUDITOR_KEY_REVOKED.toLowerCase()) {
    const gid = t1 ? decodeUintWord(t1) : 0;
    return {
      uid, blk, txHash, emitter, category: 'governance', kind: 'AuditorCategoryKeyRevoked', badge: 'red', icon: '🚫',
      title: `External Auditor Viewing Key #${gid} Revoked`,
      detail: `Revoked by ${who(t2)} on CorporateCharter.`,
      subjectAddr: topicAddr(t2),
    };
  }
  return null;
}

export function shortAddr(a) {
  if (!a || a.length < 10) return a || '—';
  return `${a.slice(0, 6)}..${a.slice(-4)}`;
}

export function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Shared Top Navigation Header
// ---------------------------------------------------------------------------

export function mountInstHeader({ activePage, title, subtitle, appTitle }) {
  const headerEl = typeof document !== 'undefined' ? document.getElementById('instHeaderMount') : null;
  const navItems = [
    { id: 'dex', label: '📈 DEX CLOB', href: '/dex.html' },
    { id: 'charter', label: '🏛️ CorporateCharter', href: '/charter.html' },
    { id: 'ballot', label: '🗳️ CipherVote', href: '/ballot.html' },
    { id: 'commerce', label: '🛒 E-Commerce', href: '/commerce.html' },
    { id: 'social', label: '📡 CommonsRF', href: '/social.html' },
    { id: 'battleship', label: '⚓ Phantom Fleet', href: '/battleship.html' },
    { id: 'hegemony', label: '⬢ Hegemony', href: '/hegemony.html' },
    { id: 'noir', label: '🔐 Cipher Noir', href: '/cipher-noir.html' },
    { id: 'lottery', label: '🎰 4D Lottery', href: '/lottery.html' },
  ];

  if (headerEl) {
    headerEl.innerHTML = `
      <div class="slx-sticky-top-stack">
        <div id="slxChainBarMount"></div>
        <header class="inst-topbar">
          <div class="inst-brand">
            <a class="inst-back" href="/index.html#slide-4">← Deck</a>
            <div class="inst-title-wrap">
              <div class="inst-title">${escapeHtml(title)}</div>
              <div class="inst-subtitle">${escapeHtml(subtitle)}</div>
            </div>
          </div>
          <nav class="inst-nav-pills">
            ${navItems
              .map(
                (n) =>
                  `<a class="inst-nav-pill ${n.id === activePage ? 'active' : ''}" href="${n.href}">${n.label}</a>`
              )
              .join('')}
          </nav>
          <div class="inst-topbar-right">
            <div id="slxWalletMount"></div>
          </div>
        </header>
      </div>
    `;
  }

  return { appTitle };
}

// ---------------------------------------------------------------------------
// Shared Live Institutional Session (`SlxInstSession` — Strictly Live RPC)
// ---------------------------------------------------------------------------

export class SlxInstSession {
  constructor({
    activePage,
    title,
    subtitle,
    appTitle,
    onRefresh,
    onIdentityLabelsUpdated,
    onBootStage,
    onSelectHfsEntry,
    onCustomDeployClick,
    onTxReceipt,
    bootLoaderElement = null,
    autoCompleteBootLoader = true,
  }) {
    this.wallet = new SlxWalletManager();
    this.activePage = activePage;
    this.backend = 'rpc';
    this.rpcUrl = getDefaultNodeWsUrl();
    this.baseInst = null;
    this.inst = null;
    this.manifest = null;
    this.activeHfsEntry = null;
    this.codeHashes = {};
    this.aiPersonas = [];
    this.dexDesks = [];
    this.mevBots = [];
    this.mevBotAddrs = new Set();
    this.online = false;
    this.blockNumber = 0;
    this.appTitle = appTitle || title;
    this.myIdentityAddr = '';
    this.myIdentityHandle = '';
    this.myIdentityVerified = false;
    this.myIdentityVerifiedEoa = '';
    this._verifiedBindingCache = new Map();
    this._bootUrlRefreshed = false;
    this.autoCompleteBootLoader = autoCompleteBootLoader !== false;
    this.onRefresh = onRefresh ? createSingleFlightRefresh(onRefresh) : null;
    this.onIdentityLabelsUpdated = onIdentityLabelsUpdated || null;
    this.onBootStage = onBootStage || null;
    this.onSelectHfsEntry = onSelectHfsEntry || null;
    this.onCustomDeployClick = onCustomDeployClick || null;
    this.onTxReceipt = onTxReceipt || null;
    this._bootPromise = null;

    this.callCache = new SlxCallCache({
      rpcUrlFn: () => this.rpcUrl,
      callFn: (to, data) => this.ethCall(to, data),
    });

    this.identityDir = new SlxIdentityDirectory({
      rpcUrlFn: () => this.rpcUrl,
      wallet: this.wallet,
      onlineFn: () => this.online,
      debounceMs: 150,
      onLabelsUpdated: () => {
        const cb = this.onIdentityLabelsUpdated || this.onRefresh;
        if (cb) cb();
      },
    });
    this.identityLabels = this.identityDir.labels;

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('slx_inst_wasm_vm_snap_v2');
      } catch (_) {}
    }

    const headerHost =
      typeof document !== 'undefined' ? document.getElementById('instHeaderMount') : null;
    this.unifiedHeader = mountSlxUnifiedHeader({
      mountContainer: headerHost,
      wallet: this.wallet,
      activeAppId: activePage || 'dex',
      title,
      subtitle,
      rpcUrlFn: () => this.rpcUrl,
      getContractLabel: () => {
        if (activePage === 'dex') return 'DEX';
        if (activePage === 'charter') return 'Charter';
        if (activePage === 'commerce') return 'Storefront';
        if (activePage === 'accounting' || activePage === 'crowdfunding') return 'IFRS Ledger';
        return 'HFS';
      },
      getContractAddr: () => {
        if (!this.inst) return '';
        if (activePage === 'dex') return this.inst.dexClob || '';
        if (activePage === 'charter') return this.inst.corporateCharter || '';
        if (activePage === 'commerce') return this.inst.productLedger || '';
        if (activePage === 'accounting' || activePage === 'crowdfunding') return this.inst.accountingLedger || '';
        return '';
      },
      onWalletSwitch: async () => {
        this.myIdentityAddr = '';
        this.myIdentityHandle = '';
        this.myIdentityVerified = false;
        this.myIdentityVerifiedEoa = '';
        this._verifiedBindingCache.clear();
        await this.verifyMyIdentityBinding({ force: true });
        if (this.onRefresh) await this.onRefresh();
      },
      getAppPeers: () =>
        (this.aiPersonas || [])
          .filter((p) => p?.identityAddr || p?.identity)
          .map((p) => ({
            identityAddr: p.identityAddr || p.identity,
            label: p.nickname || p.name || '',
            role: p.role || 'Institutional Desk',
          })),
    });
    this.chainBar = this.unifiedHeader?.chainBar || null;
    this.walletUi = this.unifiedHeader?.walletUi || null;
    this.socialUi = this.unifiedHeader?.socialUi || null;

    const pageTypeMap = {
      dex: 'DEX_CLOB',
      charter: 'CORPORATE_CHARTER',
      commerce: 'PRODUCT_LEDGER',
      accounting: 'IFRS_LEDGER',
      crowdfunding: 'IFRS_LEDGER',
    };
    const hfsType = pageTypeMap[activePage];
    if (hfsType && this.unifiedHeader?.contextSlot) {
      this.hfsDropdown = mountHfsRegistryDropdown({
        mountContainer: this.unifiedHeader.contextSlot,
        wallet: this.wallet,
        typeName: hfsType,
        rpcUrlFn: () => this.rpcUrl,
        getCurrentPrimaryAddr: () => {
          if (!this.inst) return '';
          if (activePage === 'dex') return this.inst.dexClob || '';
          if (activePage === 'charter') return this.inst.corporateCharter || '';
          if (activePage === 'commerce') return this.inst.productLedger || '';
          if (activePage === 'accounting' || activePage === 'crowdfunding') return this.inst.accountingLedger || '';
          return '';
        },
        onSelectInstance: async (entry) => {
          await this.applySelectedHfsEntry(entry, { fromSelector: true });
        },
        onCustomDeployClick: this.onCustomDeployClick,
      });
    }

    if (typeof document !== 'undefined') {
      const mainShell = document.querySelector('main.inst-shell') || document.querySelector('main');
      const firstBanner = mainShell?.querySelector(':scope > .inst-banner');
      this.bootLoader = mountSlxBootLoader({
        existingElement: bootLoaderElement,
        mountContainer: mainShell,
        insertAfterElement: !bootLoaderElement && firstBanner ? firstBanner : null,
        initialPct: 16,
        initialTitle: `Connecting to Subnet 1 & loading ${this.appTitle || 'HFS'} state…`,
        initialSub: 'Opening parallel WebSocket channels & syncing smart contracts',
      });
    } else {
      this.bootLoader = null;
    }
  }

  async applySelectedHfsEntry(entry, { fromSelector = false, skipRefresh = false } = {}) {
    if (!entry || !this.baseInst) return;
    this.activeHfsEntry = entry;
    const next = { ...this.baseInst };
    const m = entry.meta || {};
    if (this.activePage === 'dex') {
      next.dexClob = entry.primaryAddr;
      if (m.shareLedger) next.shareLedger = m.shareLedger;
      if (m.fiatLedger) next.fiatLedger = m.fiatLedger;
      if (m.dexEscrowIdentity) next.dexEscrowIdentity = m.dexEscrowIdentity;
      if ((!m.shareLedger || !m.fiatLedger) && this.online) {
        try {
          const [aHex, qHex, eHex] = await Promise.all([
            this.ethCall(entry.primaryAddr, encodeAbi('assetLedger()')),
            this.ethCall(entry.primaryAddr, encodeAbi('quoteLedger()')),
            this.ethCall(entry.primaryAddr, encodeAbi('escrowIdentity()')).catch(() => '0x'),
          ]);
          const aAddr = decodeAddrWord(aHex);
          const qAddr = decodeAddrWord(qHex);
          const eAddr = decodeAddrWord(eHex);
          if (aAddr && aAddr !== ZERO_ADDR) next.shareLedger = aAddr;
          if (qAddr && qAddr !== ZERO_ADDR) next.fiatLedger = qAddr;
          if (eAddr && eAddr !== ZERO_ADDR) next.dexEscrowIdentity = eAddr;
        } catch (_) {}
      }
      if (entry.primaryAddr.toLowerCase() !== (this.baseInst.dexClob || '').toLowerCase()) {
        next.seededMatchHistory = [];
      }
    } else if (this.activePage === 'charter') {
      const isBase =
        entry.primaryAddr.toLowerCase() === (this.baseInst.corporateCharter || '').toLowerCase();
      next.corporateCharter = entry.primaryAddr;
      next.companyName = entry.label || m.companyName || 'Nvidya Systems Pte. Ltd. [SIM-BOT]';
      next.shareTicker = m.sym || m.ticker || (isBase ? 'NVDAX-EQ' : 'CORP-EQ');
      if (m.sh || m.shareLedger) next.shareLedger = m.sh || m.shareLedger;
      if (m.bk || m.bankLedger || m.fiatLedger) {
        next.fiatLedger = m.bk || m.bankLedger || m.fiatLedger;
      }
      next.shareCapital = m.sc || m.shareCapital || (isBase ? this.baseInst.shareCapital || '' : '');
      next.shareEscrowIdentity =
        m.esc || m.shareEscrowIdentity || this.baseInst.merchantRevenueIdentity || '';
      next.firstResolutionAuth = m.fr || m.firstResolutionAuth || '';
      next.auctionWindowBlocks = Number(m.aw || m.auctionWindowBlocks || 4);
      if (m.accountingLedger || m.ac) next.accountingLedger = m.accountingLedger || m.ac;
      else if (!isBase) next.accountingLedger = '';
      if (m.confidentialLedger || m.cf) next.confidentialLedger = m.confidentialLedger || m.cf;
      else if (!isBase) next.confidentialLedger = '';
      if (m.treasuryIdentity || m.tr) next.treasuryIdentity = m.treasuryIdentity || m.tr;
      if (m.productLedger || m.pl) next.productLedger = m.productLedger || m.pl;
      if (!isBase) {
        next.sampleResolutions = [];
      }
    } else if (this.activePage === 'commerce') {
      next.productLedger = entry.primaryAddr;
      if (m.accountingLedger || m.ac) next.accountingLedger = m.accountingLedger || m.ac;
      if (m.confidentialLedger || m.cf) next.confidentialLedger = m.confidentialLedger || m.cf;
      if (m.fiatLedger || m.bk) next.fiatLedger = m.fiatLedger || m.bk;
      if (m.treasuryIdentity || m.tr) next.treasuryIdentity = m.treasuryIdentity || m.tr;
      if (m.merchantRevenueIdentity) next.merchantRevenueIdentity = m.merchantRevenueIdentity;
    } else if (this.activePage === 'accounting' || this.activePage === 'crowdfunding') {
      const isBase =
        entry.primaryAddr.toLowerCase() === (this.baseInst.accountingLedger || '').toLowerCase();
      next.accountingLedger = entry.primaryAddr;
      next.companyName = entry.label || m.companyName || 'Nvidya Systems Pte. Ltd. [SIM-BOT]';
      if (m.corporateCharter || m.chr) next.corporateCharter = m.corporateCharter || m.chr;
      if (m.fiatLedger || m.bk) next.fiatLedger = m.fiatLedger || m.bk;
      if (m.treasuryIdentity || m.tr) next.treasuryIdentity = m.treasuryIdentity || m.tr;
      if (m.merchantRevenueIdentity) next.merchantRevenueIdentity = m.merchantRevenueIdentity;
      if (m.productLedger || m.pl) next.productLedger = m.productLedger || m.pl;
      if (m.shareCapital || m.sc) next.shareCapital = m.shareCapital || m.sc;
      if (m.shareLedger || m.sh) next.shareLedger = m.shareLedger || m.sh;
      if (m.confidentialLedger || m.cf) {
        next.confidentialLedger = m.confidentialLedger || m.cf;
      } else if (!isBase) {
        next.confidentialLedger = '';
      }
      if (!next.confidentialLedger && next.accountingLedger && this.online) {
        try {
          const cfHex = await this.ethCall(next.accountingLedger, encodeAbi('confidentialLedger()'));
          const cfAddr = decodeAddrWord(cfHex);
          if (cfAddr && cfAddr !== ZERO_ADDR) next.confidentialLedger = cfAddr;
        } catch (_) {}
      }
    }
    this.inst = next;
    this.callCache.clearEphemeral();
    this.chainBar?.refresh?.();
    if (fromSelector && this.bootLoader) {
      this.bootLoader.reset(
        28,
        `Switching to ${entry.label || shortAddr(entry.primaryAddr)}…`,
        `Syncing on-chain state for ${shortAddr(entry.primaryAddr)}`
      );
    }
    if (fromSelector && this.onSelectHfsEntry) {
      await this.onSelectHfsEntry(entry);
    }
    if (!skipRefresh && this.onRefresh) {
      if (this._bootPromise) this._bootUrlRefreshed = true;
      await this.onRefresh();
    }
    if (fromSelector && this.autoCompleteBootLoader && this.bootLoader) {
      this.bootLoader.complete(`✓ ${entry.label || 'HFS Instance'} Synchronized`);
    }
  }

  setNetStatus(text, isLive = true) {
    this.chainBar?.refresh?.();
    const elTxt = document.getElementById('instNetText');
    const badge = document.getElementById('instNetBadge');
    if (elTxt) elTxt.textContent = text;
    if (badge) {
      badge.style.borderColor = isLive ? 'rgba(16,185,129,0.4)' : 'rgba(248,113,113,0.5)';
      badge.style.color = isLive ? '#6ee7b7' : '#fca5a5';
    }
  }

  _loadDynamicIdentities() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_DYNAMIC_IDS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      return map[`rpc:${(this.inst?.registry || '').toLowerCase()}`] || [];
    } catch (_) {
      return [];
    }
  }

  _saveDynamicIdentity(idAddr, handle) {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_DYNAMIC_IDS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const key = `rpc:${(this.inst?.registry || '').toLowerCase()}`;
      const list = map[key] || [];
      if (!list.some((x) => x.addr.toLowerCase() === idAddr.toLowerCase())) {
        list.push({ addr: idAddr, handle });
      }
      map[key] = list;
      localStorage.setItem(STORAGE_DYNAMIC_IDS_KEY, JSON.stringify(map));
    } catch (_) {}
    this.identityLabels.set(idAddr.toLowerCase(), handle);
  }

  async boot() {
    if (this._bootPromise) return this._bootPromise;
    this._bootPromise = (async () => {
      const { cache, manifest } = await SlxHfsCache.hydrateWithManifest();
      this.manifest = manifest || cache || {};
      this.baseInst = manifest?.institutional || cache.institutional || null;
      this.inst = this.baseInst ? { ...this.baseInst } : null;
      this.codeHashes = manifest?.codeHashes || cache.codeHashes || {};

      // Hydrate public metadata for cross-app Subnet 1 AI Identities (`Elonn Muskk [SIM-BOT]`, etc. — signed strictly on the backend by `tx-load-sim`)
      const bs = manifest?.battleship || cache?.battleship || {};
      const aiIds = Array.isArray(bs.aiIdentities) ? bs.aiIdentities : [];
      this.aiPersonas = AI_CORPORATE_PERSONAS.map((p, idx) => {
        const identityAddr = (aiIds[idx] || '').toLowerCase();
        const nickname = p.fallbackNick;
        const t4 = identityAddr ? truncAddr4(identityAddr) : '0000';
        if (identityAddr) {
          this.identityLabels.set(identityAddr, `${nickname} · ${t4}`);
        }
        return {
          ...p,
          trunc4: t4,
          identityAddr,
          nickname,
          displayLabel: `${nickname} · ${t4}`,
        };
      }).filter((p) => p.identityAddr);

      if (this.inst?.dexDeskIdentities) {
        this.dexDesks = this.inst.dexDeskIdentities
          .filter((d) => d && d.identityAddr)
          .map((d) => {
            const addr = d.identityAddr.toLowerCase();
            const tag = `${d.nickname || 'Inst. Desk [SIM-BOT]'} · ${d.eoaTrunc4 || truncAddr4(addr)}`;
            this.identityLabels.set(addr, tag);
            return { ...d, identityAddr: addr, displayLabel: tag };
          });
      }

      this.mevBotAddrs = new Set();
      if (this.inst?.mevBotIdentities) {
        this.mevBots = this.inst.mevBotIdentities
          .filter((b) => b && b.identityAddr)
          .map((b) => {
            const addr = b.identityAddr.toLowerCase();
            const roleTag = b.role === 'sandwich' ? 'Sandwich Bot' : 'Front-Run Bot';
            const tag = `🤖 ${b.nickname || 'MEV Bot [SIM-BOT]'} [${roleTag}]`;
            this.identityLabels.set(addr, tag);
            this.mevBotAddrs.add(addr);
            return { ...b, identityAddr: addr, displayLabel: tag };
          });
      }

      if (this.inst?.actors) {
        for (const a of this.inst.actors) {
          if (a.identityAddr) {
            this.identityLabels.set(a.identityAddr.toLowerCase(), a.name || a.handle);
          }
        }
      }
      if (this.inst?.userOnboardingPool) {
        this.inst.userOnboardingPool.forEach((addr, idx) => {
          const low = addr.toLowerCase();
          if (!this.identityLabels.has(low)) {
            this.identityLabels.set(low, `Investor #${idx + 1} [SIM-BOT]`);
          }
        });
      }

      const wsCandidates = [];
      const defWs = getDefaultNodeWsUrl();
      wsCandidates.push(defWs);
      if (!wsCandidates.includes(PUBLIC_SUBNET1_WSS_RPC)) {
        wsCandidates.push(PUBLIC_SUBNET1_WSS_RPC);
      }
      if (cache.rpcUrl && !wsCandidates.includes(cache.rpcUrl)) wsCandidates.push(cache.rpcUrl);
      if (
        typeof window !== 'undefined' &&
        window.location?.protocol === 'http:' &&
        !wsCandidates.includes('ws://127.0.0.1:8545')
      ) {
        wsCandidates.push('ws://127.0.0.1:8545');
      }

      let connectedWs = '';
      for (const cand of wsCandidates) {
        try {
          const blkHex = await slxNodeRpc(cand, 'eth_blockNumber', [], 12000);
          if (blkHex && this.inst?.fiatLedger) {
            this.blockNumber = Number(BigInt(blkHex));
            connectedWs = cand;
            break;
          }
        } catch (_) {}
      }

      if (connectedWs) {
        this.rpcUrl = connectedWs;
        SlxHfsCache.save({ rpcUrl: connectedWs });
        this.online = true;
        this._bootUrlRefreshed = false;
        this.setNetStatus(`Subnet 1 Live • Block #${fmtNum(this.blockNumber)}`, true);
        if (this.bootLoader && !this.onBootStage) {
          this.bootLoader.setStage(
            48,
            `Connected to Subnet 1 (Block #${fmtNum(this.blockNumber)}) — Hydrating HFS State…`,
            'Reading live smart contract ledgers & snapshots in parallel'
          );
        }
        if (this.onBootStage) {
          try {
            this.onBootStage({ stage: 'connected', blockNumber: this.blockNumber });
          } catch (_) {}
        }
        for (const d of this._loadDynamicIdentities()) {
          this.identityDir.seed(d.addr.toLowerCase(), d.handle, { persist: true });
        }
        const hasUrlHfs =
          typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('hfs');
        if (hasUrlHfs) {
          await Promise.all([
            this.verifyMyIdentityBinding(),
            this.hfsDropdown?.refreshList({ triggerCallbackIfUrlMatched: true }),
          ]);
        } else {
          await this.verifyMyIdentityBinding();
        }
        this.walletUi?.refresh();

        // Spectator-first boot: do NOT force Identity HFS deployment on page load.
        // Action handlers call `ensureMyIdentity()` lazily when the user initiates a write action.
        if (this.onRefresh && !this._bootUrlRefreshed) await this.onRefresh();
        if (this.autoCompleteBootLoader && this.bootLoader) {
          this.bootLoader.complete(
            `✓ ${this.appTitle || 'HFS App'} Synchronized with Subnet 1`,
            `Live WebSocket stream active • Block #${fmtNum(this.blockNumber)}`
          );
        }
        if (!hasUrlHfs) {
          this.hfsDropdown?.refreshList({ triggerCallbackIfUrlMatched: false });
        }
      } else {
        this.online = false;
        this.setNetStatus(`Reconnecting ${PUBLIC_SUBNET1_WSS_RPC}…`, false);
        if (this.bootLoader && !this.onBootStage) {
          this.bootLoader.setStage(
            14,
            'Reconnecting to Subnet 1 WebSocket validator…',
            'Retrying live connection automatically'
          );
        }
        if (this.onBootStage) {
          try {
            this.onBootStage({ stage: 'reconnecting' });
          } catch (_) {}
        }
        if (typeof window !== 'undefined') {
          setTimeout(() => {
            if (!this.online) this.boot();
          }, 3000);
        }
        if (this.onRefresh) await this.onRefresh();
      }

      return this.online;
    })();

    try {
      return await this._bootPromise;
    } finally {
      this._bootPromise = null;
    }
  }

  labelForIdentity(addrHex) {
    return this.identityDir.labelFor(addrHex);
  }

  allExtraTargets(extra = []) {
    const s = new Set();
    if (this.inst) {
      for (const k of [
        'registry',
        'fiatLedger',
        'shareLedger',
        'corporateCharter',
        'shareCapital',
        'shareEscrowIdentity',
        'dexClob',
        'accountingLedger',
        'confidentialLedger',
        'productLedger',
        'treasuryIdentity',
        'dexEscrowIdentity',
        'merchantRevenueIdentity',
        'faucetIdentity',
        'keeperIdentity',
        'director2Identity',
        'firstResolutionAuth',
      ]) {
        if (this.inst[k]) s.add(this.inst[k].toLowerCase());
      }
      for (const a of this.inst.actors || []) {
        if (a.identityAddr) s.add(a.identityAddr.toLowerCase());
      }
    }
    if (this.manifest?.hfsRegistry) {
      s.add(this.manifest.hfsRegistry.toLowerCase());
    }
    for (const p of this.aiPersonas || []) {
      if (p.identityAddr) s.add(p.identityAddr.toLowerCase());
    }
    for (const d of this.dexDesks || []) {
      if (d.identityAddr) s.add(d.identityAddr.toLowerCase());
    }
    for (const b of this.mevBots || []) {
      if (b.identityAddr) s.add(b.identityAddr.toLowerCase());
    }
    if (this.myIdentityAddr) s.add(this.myIdentityAddr.toLowerCase());
    for (const x of extra) {
      if (x) s.add(x.toLowerCase());
    }
    return Array.from(s);
  }

  async rpcCall(method, params = []) {
    if (!this.online) {
      await this.boot();
      if (!this.online) {
        throw new Error(`Live Subnet 1 node unreachable (${this.rpcUrl})`);
      }
    }
    return slxNodeRpc(this.rpcUrl, method, params);
  }

  async ethCall(to, dataHex) {
    return this.rpcCall('eth_call', [{ to, data: dataHex }, 'latest']);
  }

  async queryIdentityOwner(idAddr) {
    try {
      const hex = await this.ethCall(idAddr, bytesToHex(selectorBytes('owner()')));
      return decodeAddrWord(hex);
    } catch (_) {
      return ZERO_ADDR;
    }
  }

  async queryIdentityIsAuthorized(idAddr, eoaAddr) {
    if (!idAddr || idAddr === ZERO_ADDR || !eoaAddr) return false;
    const eoaLow = eoaAddr.toLowerCase();
    try {
      const [ownerAddr, authHex] = await Promise.all([
        this.queryIdentityOwner(idAddr),
        this.ethCall(idAddr, encodeAbi('isAuthorized(address)', [['address', eoaLow]])).catch(
          () => '0x0'
        ),
      ]);
      return ownerAddr === eoaLow || decodeUintWord(authHex) === 1;
    } catch (_) {
      return false;
    }
  }

  getVerifiedIdentityAddr() {
    const curEoa = (this.wallet?.keypair?.address || '').toLowerCase();
    if (
      !curEoa ||
      !this.myIdentityAddr ||
      !this.myIdentityVerified ||
      this.myIdentityVerifiedEoa !== curEoa
    ) {
      return '';
    }
    return this.myIdentityAddr.toLowerCase();
  }

  async verifyMyIdentityBinding({ force = false } = {}) {
    const curEoa = (this.wallet?.keypair?.address || '').toLowerCase();
    if (!curEoa || !this.inst || !this.online) {
      this.myIdentityVerified = false;
      this.myIdentityVerifiedEoa = '';
      return '';
    }
    if (force || this.myIdentityVerifiedEoa !== curEoa || !this.myIdentityAddr) {
      await this.resolveMyIdentity();
    }
    const idLow = (this.myIdentityAddr || '').toLowerCase();
    if (!idLow || idLow === ZERO_ADDR) {
      this.myIdentityVerified = false;
      this.myIdentityVerifiedEoa = curEoa;
      return '';
    }
    const bindKey = `${curEoa}:${idLow}`;
    const cached = !force ? this._verifiedBindingCache.get(bindKey) : null;
    if (cached && Date.now() - cached.at < 15_000) {
      this.myIdentityVerified = cached.ok;
      this.myIdentityVerifiedEoa = curEoa;
      return cached.ok ? idLow : '';
    }
    const ok = await this.queryIdentityIsAuthorized(idLow, curEoa);
    this._verifiedBindingCache.set(bindKey, { ok, at: Date.now() });
    if (ok) {
      this.myIdentityVerified = true;
      this.myIdentityVerifiedEoa = curEoa;
      return idLow;
    }
    this.myIdentityAddr = '';
    this.myIdentityHandle = '';
    this.myIdentityVerified = false;
    this.myIdentityVerifiedEoa = curEoa;
    this.identityDir.setMyIdentity('', '');
    return '';
  }

  async queryIdentityHandle(idAddr) {
    try {
      const hex = await this.ethCall(idAddr, bytesToHex(selectorBytes('handle()')));
      const b = hexToBytes(hex);
      if (b.length >= 64) {
        const len = readU64BE(b, 56);
        if (len > 0 && 64 + len <= b.length) {
          return bytesToUtf8(b.slice(64, 64 + len));
        }
      }
    } catch (_) {}
    return '';
  }

  async resolveMyIdentity() {
    if (!this.inst || !this.online) return '';
    // 1. Check unified cross-app Identity record first (shared with Phantom Fleet, etc.)!
    const unified = await this.wallet.resolveVerifiedIdentity(this.rpcUrl);
    if (unified && unified.identityAddr) {
      this.myIdentityAddr = unified.identityAddr;
      this.myIdentityHandle = unified.nickname || unified.handle;
      this.identityDir.setMyIdentity(this.myIdentityAddr, this.myIdentityHandle);
      return this.myIdentityAddr;
    }

    // 2. Check institutional actors / dynamic identities (only possible if keypair was imported or saved dynamically)
    const myEoa = this.wallet.keypair.address.toLowerCase();
    const dynEntries = this._loadDynamicIdentities();
    const dynIds = dynEntries.map((d) => d.addr);
    const includePresetPool = this.wallet.keypair.source === 'imported';
    const candidates = [
      ...dynIds,
      ...(includePresetPool ? this.inst.userOnboardingPool || [] : []),
      ...(includePresetPool ? (this.inst.actors || []).map((a) => a.identityAddr) : []),
    ];
    const owners = candidates.length
      ? await Promise.all(candidates.map((c) => this.queryIdentityOwner(c)))
      : [];
    if (dynEntries.length && typeof localStorage !== 'undefined') {
      const liveDyn = dynEntries.filter((_, i) => Boolean(owners[i]));
      if (liveDyn.length !== dynEntries.length) {
        try {
          const raw = localStorage.getItem(STORAGE_DYNAMIC_IDS_KEY);
          const map = raw ? JSON.parse(raw) : {};
          map[`rpc:${(this.inst?.registry || '').toLowerCase()}`] = liveDyn;
          localStorage.setItem(STORAGE_DYNAMIC_IDS_KEY, JSON.stringify(map));
        } catch (_) {}
      }
    }
    const idx = owners.findIndex((o) => o === myEoa);
    if (idx >= 0) {
      this.myIdentityAddr = candidates[idx];
      const nick =
        (await readOnChainIdentityNickname(this.rpcUrl, this.myIdentityAddr)) ||
        (await this.queryIdentityHandle(this.myIdentityAddr)) ||
        this.identityLabels.get(this.myIdentityAddr.toLowerCase()) ||
        shortAddr(this.myIdentityAddr);
      this.myIdentityHandle = nick;
      this.identityDir.setMyIdentity(this.myIdentityAddr, this.myIdentityHandle);
      this.wallet.saveIdentityRecord(
        {
          identityAddr: this.myIdentityAddr,
          nickname: nick,
          handle: nick,
          registryAddr: this.inst.registry,
        },
        myEoa
      );
      return this.myIdentityAddr;
    }
    this.myIdentityAddr = '';
    this.myIdentityHandle = '';
    this.identityDir.setMyIdentity('', '');
    return '';
  }

  async sendRawSigned({
    privateKey,
    to,
    dataHex,
    label,
    contractLabel = 'HFS',
    extraTargets = [],
    gasLimit = 4_500_000n,
  }) {
    const senderEoa = computeAddress(privateKey);
    const nonceHex = await this.rpcCall('eth_getTransactionCount', [senderEoa, 'latest']);
    const chainIdHex = await this.rpcCall('eth_chainId').catch(() => '0x539');
    const rawTx = signLexiconTx({
      privateKey,
      nonce: BigInt(nonceHex),
      to,
      data: dataHex,
      gasLimit: gasLimit > 9_500_000n ? 9_500_000n : gasLimit,
      gasPrice: 50_000_000_000n,
      chainId: BigInt(chainIdHex),
      extraTargets: this.allExtraTargets(extraTargets),
    });
    const txHash = await this.rpcCall('eth_sendRawTransaction', [rawTx]);
    this.wallet.recordExternalRpcTx({
      txHash,
      rawTx,
      from: senderEoa,
      to: to || '(instantiate)',
      contractLabel,
      fnLabel: label,
      dataHex,
      blockNumber: this.blockNumber || 0,
    });

    const rcpt = await slxWaitForReceipt((m, p) => this.rpcCall(m, p), txHash, {
      timeoutMs: 55_000,
      fallbackPollMs: 850,
    });
    if (rcpt) {
      this.blockNumber = Number(BigInt(rcpt.blockNumber || '0x0')) || this.blockNumber;
      this.setNetStatus(`Subnet 1 Live • Block #${fmtNum(this.blockNumber)}`, true);
      if (rcpt.status !== '0x1') {
        throw new Error(`HFS reverted on-chain during ${label} (tx ${txHash.slice(0, 10)}..)`);
      }
      if (this.onTxReceipt) {
        try {
          this.onTxReceipt(rcpt, label);
        } catch (_) {}
      }
      return rcpt;
    }
    throw new Error(`Timeout waiting for block confirmation of ${label}`);
  }

  async ensureMyIdentity(onStatus) {
    if (!this.online || !this.inst) {
      await this.boot();
    }
    if (!this.online || !this.inst) {
      throw new Error(`Cannot reach live Subnet 1 RPC (${this.rpcUrl})`);
    }
    const verified = await this.verifyMyIdentityBinding();
    if (verified) return verified;

    // Prompt user for Nickname & deploy single shared Identity HFS registered on Subnet 1!
    if (onStatus) onStatus('Opening Identity & Nickname setup…');
    const created = await this.wallet.ensureIdentityWithPrompt({
      rpcUrl: this.rpcUrl,
      appName: this.appTitle || 'SuperLexicon',
    });
    const curEoa = (this.wallet?.keypair?.address || '').toLowerCase();
    const createdLow = (created.identityAddr || '').toLowerCase();
    this._saveDynamicIdentity(createdLow, created.nickname);
    this.myIdentityAddr = createdLow;
    this.myIdentityHandle = created.nickname;
    this.myIdentityVerified = true;
    this.myIdentityVerifiedEoa = curEoa;
    if (curEoa && createdLow) {
      this._verifiedBindingCache.set(`${curEoa}:${createdLow}`, { ok: true, at: Date.now() });
    }
    this.walletUi?.refresh();
    return this.myIdentityAddr;
  }

  async getLedgerBalance(ledgerAddr, identityAddr) {
    if (!ledgerAddr || !identityAddr) return 0;
    const hex = await this.ethCall(
      ledgerAddr,
      encodeAbi('balanceOf(address)', [['address', identityAddr]])
    );
    return decodeUintWord(hex);
  }

  async requestFiatTopUp(amount = 25000, onStatus, symbolLabel = '') {
    const qSym = symbolLabel || this.activeHfsEntry?.meta?.quoteSymbol || 'SGD-FIAT';
    const myId = await this.ensureMyIdentity(onStatus);
    await this.wallet.awaitRegistrySeal?.(myId);
    if (onStatus) onStatus(`Crediting +${fmtNum(amount)} ${qSym} from Subnet 1 Bank Reserve…`);
    await this.sendRawSigned({
      privateKey: this.inst.faucetPriv,
      to: this.inst.faucetIdentity,
      dataHex: encodeAbi('transferBankBalance(address,address,uint64)', [
        ['address', this.inst.fiatLedger],
        ['address', myId],
        ['uint64', amount],
      ]),
      label: `faucetTopUp(+${amount} ${qSym})`,
      contractLabel: `AssetLedger(${qSym})`,
      extraTargets: [myId],
    });
    return myId;
  }

  async requestShareGrant(amount = 10000, onStatus, symbolLabel = '') {
    const bSym = symbolLabel || this.activeHfsEntry?.meta?.baseSymbol || 'NVDAX-EQ';
    const myId = await this.ensureMyIdentity(onStatus);
    await this.wallet.awaitRegistrySeal?.(myId);
    if (onStatus) onStatus(`Transferring +${fmtNum(amount)} ${bSym} units from Subnet 1 Reserve…`);
    await this.sendRawSigned({
      privateKey: this.inst.faucetPriv,
      to: this.inst.faucetIdentity,
      dataHex: encodeAbi('transferBankBalance(address,address,uint64)', [
        ['address', this.inst.shareLedger],
        ['address', myId],
        ['uint64', amount],
      ]),
      label: `grantAsset(+${amount} ${bSym})`,
      contractLabel: `AssetLedger(${bSym})`,
      extraTargets: [myId],
    });
    return myId;
  }

  async sendAsMyIdentity(calldataHex, label, contractLabel = 'Identity(You)', extraTargets = [], gasLimit = 8_500_000n) {
    const myId = await this.ensureMyIdentity();
    await this.wallet.awaitRegistrySeal?.(myId);
    return this.sendRawSigned({
      privateKey: this.wallet.keypair.privateKey,
      to: myId,
      dataHex: calldataHex,
      label,
      contractLabel,
      extraTargets: [myId, ...extraTargets],
      gasLimit,
    });
  }

  async ensureMyIdentityEncryptionKeys() {
    const myId = await this.ensureMyIdentity();
    await this.wallet.awaitRegistrySeal?.(myId);
    const existing = await readOnChainIdentityEncryptionKeys(this.rpcUrl, myId);
    const derived = deriveIdentityEncryptionKeys(this.wallet.keypair.privateKey, myId);
    if (
      existing &&
      existing.secpPub64Hex.toLowerCase() === derived.secpPub64Hex.toLowerCase() &&
      existing.edPub32Hex.toLowerCase() === derived.edPub32Hex.toLowerCase()
    ) {
      return derived;
    }
    await this.sendRawSigned({
      privateKey: this.wallet.keypair.privateKey,
      to: myId,
      dataHex: encodeAbi('setEncryptionKeys(bytes,bytes32)', [
        ['bytes', derived.secpPub64Bytes],
        ['bytes32', derived.edPub32Hex],
      ]),
      label: 'Identity.setEncryptionKeys()',
      contractLabel: 'Identity(You)',
      extraTargets: [myId],
      gasLimit: 4_500_000n,
    });
    return derived;
  }

  /**
   * Broadcasts a `$0`-gas transaction from a brand-new disposable random EOA (`nonce = 0n`),
   * intentionally excluding `this.myIdentityAddr` from `extraTargets` unless explicitly passed
   * (e.g. for public bank redemption) so stealth co-signs & shielded splits leak zero EOA/Identity metadata.
   */
  async sendEphemeralZeroGasTx({
    to,
    dataHex,
    label,
    contractLabel = 'Shielded / Stealth Relay',
    extraTargets = [],
    gasLimit = 9_500_000n,
  }) {
    const ephemPriv = generatePrivateKeyHex();
    const ephemEoa = computeAddress(ephemPriv);
    const chainIdHex = await this.rpcCall('eth_chainId').catch(() => '0x539');
    const neutralSet = new Set();
    if (to) neutralSet.add(to.toLowerCase());
    if (this.inst) {
      for (const k of [
        'registry',
        'fiatLedger',
        'shareLedger',
        'corporateCharter',
        'accountingLedger',
        'confidentialLedger',
        'treasuryIdentity',
      ]) {
        if (this.inst[k]) neutralSet.add(this.inst[k].toLowerCase());
      }
      for (const a of this.inst.actors || []) {
        if (a.identityAddr) neutralSet.add(a.identityAddr.toLowerCase());
      }
    }
    for (const p of this.aiPersonas || []) {
      if (p.identityAddr) neutralSet.add(p.identityAddr.toLowerCase());
    }
    if (this.manifest?.hfsRegistry) neutralSet.add(this.manifest.hfsRegistry.toLowerCase());
    for (const x of extraTargets) {
      if (x) neutralSet.add(x.toLowerCase());
    }

    const rawTx = signLexiconTx({
      privateKey: ephemPriv,
      nonce: 0n,
      to,
      data: dataHex,
      gasLimit: gasLimit > 9_500_000n ? 9_500_000n : gasLimit,
      gasPrice: 50_000_000_000n,
      chainId: BigInt(chainIdHex),
      extraTargets: Array.from(neutralSet),
    });
    const txHash = await this.rpcCall('eth_sendRawTransaction', [rawTx]);
    this.wallet.recordExternalRpcTx({
      txHash,
      rawTx,
      from: ephemEoa,
      to,
      contractLabel,
      fnLabel: `🕵️ ${label} ($0-Gas Ephemeral EOA)`,
      dataHex,
      blockNumber: this.blockNumber || 0,
    });
    const rcpt = await slxWaitForReceipt((m, p) => this.rpcCall(m, p), txHash, {
      timeoutMs: 55_000,
      fallbackPollMs: 850,
    });
    if (rcpt) {
      this.blockNumber = Number(BigInt(rcpt.blockNumber || '0x0')) || this.blockNumber;
      this.setNetStatus(`Subnet 1 Live • Block #${fmtNum(this.blockNumber)}`, true);
      if (rcpt.status !== '0x1') {
        throw new Error(`HFS reverted on-chain during ${label} (tx ${txHash.slice(0, 10)}..)`);
      }
      if (this.onTxReceipt) {
        try {
          this.onTxReceipt(rcpt, label);
        } catch (_) {}
      }
      return rcpt;
    }
    throw new Error(`Timeout waiting for block confirmation of ${label}`);
  }
}
