/**
 * Shared Realtime Triangulated Corporate Valuation Engine (`ifrs-valuation.js`)
 *
 * Consumes live event-sourced IAS / IFRS financial statement snapshots from
 * `accounting_ledger.wasm` + share counts from `corporate_charter.wasm` + live
 * clearing prices (`P*`) from `dex_clob.wasm` to compute continuous, manipulation-resistant
 * corporate valuations across 5 institutional lenses:
 *
 *  1. Net Tangible Asset Floor (`NAV`, IAS 1 / IAS 38 — excludes intangibles & 2900 Suspense)
 *  2. Clean-Surplus Residual Income (`Edwards-Bell-Ohlson / EBO` — anchored to IFRS Book Equity)
 *  3. Maintenance-Adjusted `FCFF` Discounted Cash Flow (`Live Rolling DCF` — 17% SG tax + D&A MaintCapEx)
 *  4. `IAS 24`-Clean Run-Rate Multiples (`EV / Arm's-Length ARR` & `EV / Clean EBITDA` — strips 4050 wash sales)
 *  5. Live On-Chain Market Capitalization (`DexClob` uniform clearing price `P*` × diluted common shares)
 */

import { hexToBytes, bytesToHex, utf8ToBytes, keccak256Hex } from './index.js';
import { readU64BE } from './inst-suite.js';

export const IFRS_VALUATION_TOPICS = {
  JOURNAL_POSTED: keccak256Hex(
    utf8ToBytes('IfrsJournalPosted(uint64,address,bytes32,bytes)')
  ).toLowerCase(),
  SUBLEDGER_UPDATED: keccak256Hex(
    utf8ToBytes('IfrsSubledgerUpdated(uint64,bytes32,bytes)')
  ).toLowerCase(),
  PERIOD_CLOSED: keccak256Hex(
    utf8ToBytes('IfrsFiscalPeriodClosed(uint64,int64,uint64,address)')
  ).toLowerCase(),
};

export const DEFAULT_VALUATION_PARAMS = {
  waccPct: 10.0, // Weighted Average Cost of Capital (%)
  terminalGrowthPct: 3.0, // Perpetual Gordon / Residual terminal growth g (%)
  blocksPerYear: 4800, // Simulated fiscal year horizon in Subnet 1 blocks
  horizonYears: 5, // Explicit Stage-1 forecast window (years)
  sgTaxRate: 0.17, // Singapore statutory corporate income tax rate (17%)
};

function readI64BE(b, off) {
  const hi = (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
  const lo = ((b[off + 4] << 24) | (b[off + 5] << 16) | (b[off + 6] << 8) | b[off + 7]) >>> 0;
  return Number((BigInt(hi) << 32n) | BigInt(lo));
}

/**
 * Decodes the 640-byte `AccountingLedger.getFinancialStatements()` binary frame.
 * Used by `/dex.html` (and parity checks on `/accounting.html`) to hydrate live IFRS fundamentals.
 */
export function decodeIfrsStatementsHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 640) return null;
  const balances = [];
  for (let i = 0; i < 32; i++) balances.push(readI64BE(b, 296 + i * 8));
  const cfoNet = readI64BE(b, 80);
  const cfiNet = readI64BE(b, 88);
  const cffNet = readI64BE(b, 96);
  return {
    fiscalPeriod: readU64BE(b, 0),
    periodStartBlock: readU64BE(b, 8),
    lastClosedBlock: readU64BE(b, 16),
    asOfBlock: readU64BE(b, 24),
    journalCount: readU64BE(b, 32),
    actualBankBalance: readU64BE(b, 40),
    bookedCash1010: readU64BE(b, 48),
    unattributedBankInflow: readU64BE(b, 56),
    bankCustodyShortfall: readU64BE(b, 64),
    flags: readU64BE(b, 72),
    cfoNet,
    cfiNet,
    cffNet,
    cfoIn: Math.max(0, cfoNet),
    cfoOut: Math.max(0, -cfoNet),
    cfiIn: Math.max(0, cfiNet),
    cfiOut: Math.max(0, -cfiNet),
    cffIn: Math.max(0, cffNet),
    cffOut: Math.max(0, -cffNet),
    rpTxCount: readU64BE(b, 104),
    rpInflow: readU64BE(b, 112),
    rpOutflow: readU64BE(b, 120),
    opexRnd: readU64BE(b, 128),
    opexSm: readU64BE(b, 136),
    opexGa: readU64BE(b, 144),
    unpostedDa: readU64BE(b, 152),
    unpostedDef: readU64BE(b, 160),
    targetEcl: readU64BE(b, 168),
    skuSaleCount: readU64BE(b, 176),
    totalCurrentAssets: readI64BE(b, 184),
    totalNonCurrentAssets: readI64BE(b, 192),
    totalAssets: readI64BE(b, 200),
    totalCurrentLiabilities: readI64BE(b, 208),
    totalNonCurrentLiabilities: readI64BE(b, 216),
    totalLiabilities: readI64BE(b, 224),
    totalEquity: readI64BE(b, 232),
    grossRevArmsLength: readI64BE(b, 240),
    grossRevRelatedParty: readI64BE(b, 248),
    netRevenue: readI64BE(b, 256),
    grossProfit: readI64BE(b, 264),
    ebit: readI64BE(b, 272),
    netIncome: readI64BE(b, 280),
    distributableProfit: readI64BE(b, 288),
    balances,
    corporateCharter: bytesToHex(b.slice(552, 572)).toLowerCase(),
    operatingBankLedger: bytesToHex(b.slice(572, 592)).toLowerCase(),
    treasuryIdentity: bytesToHex(b.slice(592, 612)).toLowerCase(),
  };
}

/**
 * Computes the 5-Lens Triangulated Corporate Valuation + Confidence-Weighted Composite Fair Value.
 *
 * @param {object} stmt      Compiled IFRS statement snapshot (`balances[0..31]`, totals, cash flows)
 * @param {object} marketCtx `{ totalShares, dexPrice, dexBestBid, dexBestAsk, dexAddress, shareTicker }`
 * @param {object} rawParams `{ waccPct, terminalGrowthPct, blocksPerYear, horizonYears }`
 */
export function computeTriangulatedValuation(stmt, marketCtx = {}, rawParams = {}) {
  if (!stmt || !Array.isArray(stmt.balances)) return null;

  const p = { ...DEFAULT_VALUATION_PARAMS, ...rawParams };
  const waccPct = Math.min(35, Math.max(4, Number(p.waccPct) || 10.0));
  const maxAllowedG = Math.max(0, waccPct - 2.0);
  const terminalGrowthPct = Math.min(maxAllowedG, Math.max(0, Number(p.terminalGrowthPct) ?? 3.0));
  const blocksPerYear = Math.min(100_000, Math.max(250, Math.round(Number(p.blocksPerYear) || 4800)));
  const horizonYears = Math.min(10, Math.max(3, Math.round(Number(p.horizonYears) || 5)));
  const sgTaxRate = Number.isFinite(p.sgTaxRate) ? p.sgTaxRate : 0.17;

  const wacc = waccPct / 100;
  const gTerm = terminalGrowthPct / 100;

  const b = stmt.balances;
  const totalShares = Math.max(0, Number(marketCtx.totalShares) || 0);
  const dexPrice = Math.max(0, Number(marketCtx.dexPrice) || 0);
  const dexBestBid = Math.max(0, Number(marketCtx.dexBestBid) || 0);
  const dexBestAsk = Math.max(0, Number(marketCtx.dexBestAsk) || 0);
  const shareTicker = marketCtx.shareTicker || 'CORP-EQ';

  // -------------------------------------------------------------------------
  // 0. Clean-Surplus & Anti-Manipulation Normalization (IAS 7 + IAS 24)
  // -------------------------------------------------------------------------
  // IAS 7: Exclude 2900 Unattributed Cash Suspense from usable Net Cash
  const bookedCash = Math.max(0, Number(stmt.bookedCash1010 ?? b[0]) || 0);
  const quarantinedSuspense = Math.max(0, Number(stmt.unattributedBankInflow ?? b[18]) || 0);
  const leaseDebt2500 = Math.max(0, b[16] || 0);
  const termDebt2600 = Math.max(0, b[17] || 0);
  const financialDebt = leaseDebt2500 + termDebt2600;
  const netCash = bookedCash - financialDebt;

  // Cost of Equity rises modestly with financial leverage (Modigliani-Miller levered spread)
  const bookEquityRaw = Number(stmt.totalEquity) || 0;
  const bookEquityPos = Math.max(0, bookEquityRaw);
  const debtToEquity = bookEquityPos > 0 ? Math.min(2.0, financialDebt / bookEquityPos) : 0;
  const rEquity = Math.min(0.4, wacc + 0.015 + 0.025 * debtToEquity);

  // IAS 24: Strip 100% of 4050 Related-Party Revenue from operating velocity & earnings
  const salesReturns = Math.max(0, b[26] || 0);
  const armsLengthRev = Math.max(0, (Number(stmt.grossRevArmsLength) || 0) - salesReturns);
  const relatedPartyRev = Math.max(0, Number(stmt.grossRevRelatedParty) || 0);
  const cogs5010 = Math.max(0, b[27] || 0);
  const da6300 = Math.max(0, b[29] || 0);
  const deferredRev2300 = Math.max(0, b[14] || 0);
  const futureContractAr1800 = Math.max(0, b[4] || 0);
  const cashPrepaidDeferred = Math.max(0, deferredRev2300 - futureContractAr1800);

  // Discounted after-tax PV of bilaterally signed, IAS 24-verified unbilled B2B / Defense backlog (`1800`):
  // Assumes 75% engineering contribution margin and 17% SG corporate tax over ~0.65yr weighted duration.
  const pvSignedBacklog =
    futureContractAr1800 > 0
      ? (futureContractAr1800 * 0.75 * (1 - sgTaxRate)) / Math.pow(1 + wacc, 0.65)
      : 0;

  const cleanGrossProfit = armsLengthRev - cogs5010;
  const cleanEbit = (Number(stmt.ebit) || 0) - relatedPartyRev;
  const cleanEbitda = cleanEbit + da6300;
  const cleanNetIncome = (Number(stmt.netIncome) || 0) - relatedPartyRev;

  // Elapsed fiscal window with 80-block Bayesian warm-up damper to prevent 1-block division spikes
  const rawElapsedBlocks = Math.max(0, (stmt.asOfBlock || 0) - (stmt.periodStartBlock || 0));
  const effectiveElapsedBlocks = Math.max(80, rawElapsedBlocks);
  const annualScale = blocksPerYear / effectiveElapsedBlocks;

  const annualizedArmsRev = armsLengthRev * annualScale;
  const annualizedCleanEbit = cleanEbit * annualScale;
  const annualizedCleanEbitda = cleanEbitda * annualScale;
  const annualizedCleanNI = cleanNetIncome * annualScale;
  const annualizedDa = da6300 * annualScale;
  const annualizedCfo = (Number(stmt.cfoNet) || 0) * annualScale;

  const isRevenueGenerating = armsLengthRev > 0;
  const grossMargin =
    armsLengthRev > 0 ? Math.max(0, Math.min(0.98, cleanGrossProfit / armsLengthRev)) : 0;
  const ebitdaMargin =
    armsLengthRev > 0 ? Math.max(-1, Math.min(0.95, cleanEbitda / armsLengthRev)) : 0;

  // -------------------------------------------------------------------------
  // LENS 1: Net Tangible Book Floor (`NAV`, IAS 1 / IAS 38)
  // -------------------------------------------------------------------------
  const netPpeAndRou =
    Math.max(0, (b[5] || 0) - (b[6] || 0)) + Math.max(0, (b[7] || 0) - (b[8] || 0));
  const netIntangibles = Math.max(0, (b[9] || 0) - (b[10] || 0));
  const navEquity = Math.max(0, bookEquityRaw - netIntangibles);
  const navRangeLow = Math.round(
    Math.max(
      0,
      bookedCash +
        0.85 * Math.max(0, (b[1] || 0) - (b[2] || 0)) +
        0.75 * Math.max(0, b[3] || 0) +
        0.7 * netPpeAndRou -
        Math.max(0, stmt.totalLiabilities - quarantinedSuspense)
    )
  );
  const navRangeHigh = Math.round(Math.max(navEquity, bookEquityPos));

  // -------------------------------------------------------------------------
  // LENS 2: Clean-Surplus Residual Income (`Edwards-Bell-Ohlson / EBO`)
  // -------------------------------------------------------------------------
  let eboEquity = 0;
  let eboPvStage1 = 0;
  let eboPvTerminal = 0;

  if (isRevenueGenerating) {
    // Operating enterprise: project 5-year abnormal earnings with competitive moat fade
    const ae1 = annualizedCleanNI - rEquity * bookEquityPos;
    // Stage-1 growth tapers from margin-supported growth (up to 14%) down to terminal g
    const stage1StartGrowth = Math.max(gTerm, Math.min(0.14, gTerm + 0.09 * grossMargin));
    let curAe = ae1;
    for (let t = 1; t <= horizonYears; t++) {
      if (t > 1) {
        const blend = (t - 1) / Math.max(1, horizonYears - 1);
        const gt = stage1StartGrowth * (1 - blend) + gTerm * blend;
        // Competitive RoE fade factor (0.95/yr) prevents infinite abnormal rent extrapolation
        curAe = curAe >= 0 ? curAe * (1 + gt) * 0.95 : curAe * 0.75;
      }
      eboPvStage1 += curAe / Math.pow(1 + rEquity, t);
    }
    const terminalCapRate = Math.max(0.025, rEquity - gTerm + 0.015);
    const tvAe = curAe >= 0 ? (curAe * (1 + gTerm)) / terminalCapRate : 0;
    eboPvTerminal = tvAe / Math.pow(1 + rEquity, horizonYears);
    eboEquity = Math.max(
      0,
      Math.round(bookEquityPos + eboPvStage1 + eboPvTerminal + pvSignedBacklog)
    );
  } else {
    // Pre-revenue / asset-rich R&D enterprise (e.g., Meridian Autonomous Robotics):
    // Distinguish true cash OpEx burn from finite non-cash IAS 16 depreciation; enforce Berger-Ofek
    // real-option redeployment floor so cash-rich unlevered firms aren't valued below tangible salvage.
    const periodCashOpExBurn = Math.max(0, -(cleanEbit + da6300));
    const annualCashBurn = periodCashOpExBurn * annualScale;
    let pvBurnAndCapitalDrag = 0;
    const capitalChargeOnIdleFixed = netPpeAndRou * (rEquity * 0.45);
    for (let t = 1; t <= 3; t++) {
      const fadeBurn = (annualCashBurn * Math.pow(0.65, t - 1)) + capitalChargeOnIdleFixed;
      pvBurnAndCapitalDrag += fadeBurn / Math.pow(1 + rEquity, t);
    }
    const abandonmentOptionFloor = Math.max(0, netCash + 0.65 * netPpeAndRou + pvSignedBacklog);
    eboEquity = Math.round(
      Math.max(abandonmentOptionFloor, bookEquityPos + pvSignedBacklog - pvBurnAndCapitalDrag)
    );
    eboPvStage1 = Math.round(pvSignedBacklog - pvBurnAndCapitalDrag);
    eboPvTerminal = 0;
  }

  // -------------------------------------------------------------------------
  // LENS 3: Maintenance-Adjusted `FCFF` Discounted Cash Flow (`Live Rolling DCF`)
  // -------------------------------------------------------------------------
  // Stabilize operating cash flow against lumpy inventory/CapEx batches:
  //   Accrual FCFF = NOPAT (after 17% SG tax) + Live D&A - Steady-State MaintCapEx (= Live D&A) = NOPAT
  //   Observed FCFF = Annualized Direct CFO - Steady-State MaintCapEx (= Annualized D&A)
  const nopatAnnual =
    annualizedCleanEbit > 0
      ? annualizedCleanEbit * (1 - sgTaxRate)
      : annualizedCleanEbit;
  const directMaintFcffAnnual = annualizedCfo - annualizedDa;
  const normalizedFcffAnnual = isRevenueGenerating
    ? 0.7 * nopatAnnual + 0.3 * directMaintFcffAnnual
    : Math.min(0, nopatAnnual);

  let dcfPvStage1 = 0;
  let dcfPvTerminal = 0;
  let dcfEnterpriseValue = 0;

  if (normalizedFcffAnnual > 0) {
    const startGrowth = Math.max(gTerm, Math.min(0.15, gTerm + 0.11 * grossMargin));
    let fcffT = normalizedFcffAnnual;
    for (let t = 1; t <= horizonYears; t++) {
      const blend = (t - 1) / Math.max(1, horizonYears - 1);
      const gt = startGrowth * (1 - blend) + gTerm * blend;
      fcffT = t === 1 ? fcffT * (1 + gt * 0.5) : fcffT * (1 + gt);
      dcfPvStage1 += fcffT / Math.pow(1 + wacc, t);
    }
    const denom = Math.max(0.02, wacc - gTerm);
    const tvFcff = (fcffT * (1 + gTerm)) / denom;
    dcfPvTerminal = tvFcff / Math.pow(1 + wacc, horizonYears);
    // Cash-prepaid 2300 SaaS cash is already in 1010 Cash; subtract ~15% fulfillment cost PV, and add PV of signed 1800 Unbilled Backlog!
    const backlogFulfillmentCost = cashPrepaidDeferred * 0.15;
    dcfEnterpriseValue = Math.max(
      0,
      dcfPvStage1 + dcfPvTerminal + pvSignedBacklog - backlogFulfillmentCost
    );
  } else if (!isRevenueGenerating) {
    // Pre-revenue firm: operating EV reflects PV of signed 1800 backlog & PPE salvage minus cash burn
    const periodCashBurn = Math.max(0, -(cleanEbit + da6300)) * annualScale;
    const pvBurn = periodCashBurn > 0 ? (periodCashBurn * 2.1) / (1 + wacc) : 0;
    dcfEnterpriseValue = Math.max(0, pvSignedBacklog + 0.5 * netPpeAndRou - pvBurn);
  } else if (pvSignedBacklog > 0) {
    dcfEnterpriseValue = Math.round(pvSignedBacklog);
  }

  const dcfEquity = Math.max(0, Math.round(dcfEnterpriseValue + netCash));

  // -------------------------------------------------------------------------
  // LENS 4: `IAS 24`-Clean Run-Rate Multiples (`EV / ARR` & `EV / Clean EBITDA`)
  // -------------------------------------------------------------------------
  const arrMultiple = Number((2.5 + 6.5 * grossMargin).toFixed(2));
  const ebitdaMultiple = Number((9.0 + 5.0 * grossMargin).toFixed(2));

  let evFromArr = 0;
  let evFromEbitda = 0;
  let multiplesEnterpriseValue = 0;
  if (isRevenueGenerating) {
    evFromArr = annualizedArmsRev * arrMultiple;
    evFromEbitda = annualizedCleanEbitda > 0 ? annualizedCleanEbitda * ebitdaMultiple : 0;
    multiplesEnterpriseValue =
      annualizedCleanEbitda > 0 ? 0.5 * evFromArr + 0.5 * evFromEbitda : evFromArr;
  }
  const multiplesEquity = Math.max(0, Math.round(multiplesEnterpriseValue + netCash));

  // -------------------------------------------------------------------------
  // COMPOSITE INTRINSIC FAIR VALUE (Dynamic Maturity & Confidence Weighting)
  // -------------------------------------------------------------------------
  // Pre-revenue / newly incorporated firms weight Clean-Surplus EBO (65%) + Tangible NAV (35%)
  // so zero current revenue never causes a nonsensical 0x multiple collapse.
  // Operating revenue-generating firms weight EBO (40%) + Rolling DCF (35%) + Clean Multiples (25%).
  let weights;
  if (!isRevenueGenerating) {
    weights = { nav: 0.35, ebo: 0.65, dcf: 0.0, multiples: 0.0, regime: 'ASSET / R&D STAGE' };
  } else if (rawElapsedBlocks < 60) {
    weights = { nav: 0.15, ebo: 0.45, dcf: 0.25, multiples: 0.15, regime: 'EARLY OPERATING' };
  } else {
    weights = { nav: 0.0, ebo: 0.4, dcf: 0.35, multiples: 0.25, regime: 'OPERATING CONTINUOUS' };
  }

  const compositeEquity = Math.max(
    navEquity > 0 && !isRevenueGenerating ? Math.round(navEquity * 0.8) : 0,
    Math.round(
      weights.nav * navEquity +
        weights.ebo * eboEquity +
        weights.dcf * dcfEquity +
        weights.multiples * multiplesEquity
    )
  );
  const compositeEnterpriseValue = Math.max(0, compositeEquity - netCash);

  const perShare = (eqVal) => (totalShares > 0 ? eqVal / totalShares : null);
  const intrinsicSharePrice = perShare(compositeEquity);

  // Build +/- 12% Football-Field institutional valuation bands per lens
  const lenses = [
    {
      id: 'nav',
      shortLabel: '1. Net Tangible NAV',
      title: 'Liquidation / Tangible Book Floor (IAS 1 / IAS 38)',
      equity: navEquity,
      low: Math.min(navRangeLow, navEquity),
      high: Math.max(navRangeHigh, Math.round(navEquity * 1.04)),
      sharePrice: perShare(navEquity),
      weightPct: Math.round(weights.nav * 100),
      color: '#34d399',
      formulaNote: `Book Equity (${Math.round(bookEquityPos).toLocaleString()}) − Intangibles (${Math.round(netIntangibles).toLocaleString()}); excludes 2900 Suspense`,
    },
    {
      id: 'ebo',
      shortLabel: '2. Residual Income (EBO)',
      title: 'Edwards-Bell-Ohlson Clean-Surplus Model',
      equity: eboEquity,
      low: Math.round(eboEquity * 0.88),
      high: Math.round(eboEquity * 1.13),
      sharePrice: perShare(eboEquity),
      weightPct: Math.round(weights.ebo * 100),
      color: '#a78bfa',
      formulaNote: isRevenueGenerating
        ? `B₀ + PV(Abnormal Earnings @ rₑ=${(rEquity * 100).toFixed(1)}%)${futureContractAr1800 > 0 ? ` + PV(1800 Backlog +${Math.round(pvSignedBacklog).toLocaleString()})` : ''}`
        : `B₀ − PV(3yr Capital/R&D Drag)${futureContractAr1800 > 0 ? ` + PV(1800 Backlog +${Math.round(pvSignedBacklog).toLocaleString()})` : ''}, floored at Redeployment Option`,
    },
    {
      id: 'dcf',
      shortLabel: '3. Rolling FCFF DCF',
      title: 'Maintenance-Adjusted Free Cash Flow to Firm (DCF)',
      equity: dcfEquity,
      low: Math.round(dcfEquity * 0.86),
      high: Math.round(dcfEquity * 1.16),
      sharePrice: perShare(dcfEquity),
      weightPct: Math.round(weights.dcf * 100),
      color: '#38bdf8',
      formulaNote: `5yr Stage + Gordon TV (WACC=${waccPct.toFixed(1)}%, g=${terminalGrowthPct.toFixed(1)}%)${futureContractAr1800 > 0 ? ` + PV(Signed Backlog +${Math.round(pvSignedBacklog).toLocaleString()})` : ''} + Net Cash`,
    },
    {
      id: 'multiples',
      shortLabel: '4. Clean ARR / EBITDA',
      title: "IAS 24-Filtered EV/ARR & EV/EBITDA Run-Rate",
      equity: multiplesEquity,
      low: isRevenueGenerating
        ? Math.round(Math.max(0, Math.min(evFromArr, evFromEbitda || evFromArr) * 0.9 + netCash))
        : multiplesEquity,
      high: isRevenueGenerating
        ? Math.round(Math.max(evFromArr, evFromEbitda) * 1.1 + netCash)
        : multiplesEquity,
      sharePrice: perShare(multiplesEquity),
      weightPct: Math.round(weights.multiples * 100),
      color: '#fbbf24',
      formulaNote: isRevenueGenerating
        ? `${arrMultiple.toFixed(1)}× Clean ARR (${Math.round( grossMargin * 100 )}% GM) & ${ebitdaMultiple.toFixed(1)}× EBITDA + Net Cash`
        : `Pre-revenue (0× ARR) → Valued at Net Cash (${Math.round(netCash).toLocaleString()} SGD)`,
    },
  ];

  // -------------------------------------------------------------------------
  // LENS 5: Live On-Chain Market Implied Valuation (`DexClob` Clearing P*)
  // -------------------------------------------------------------------------
  const hasMarketPrice = dexPrice > 0 && totalShares > 0;
  const marketCap = hasMarketPrice ? Math.round(dexPrice * totalShares) : null;
  const marketEnterpriseValue =
    marketCap !== null ? Math.max(0, marketCap - netCash) : null;

  if (hasMarketPrice) {
    const pxCands = [dexPrice, dexBestBid, dexBestAsk].filter((x) => x > 0);
    const loPx = Math.min(...pxCands, dexPrice * 0.97);
    const hiPx = Math.max(...pxCands, dexPrice * 1.03);
    lenses.push({
      id: 'market',
      shortLabel: '5. Live DEX Market Cap',
      title: `On-Chain DexClob Clearing Price (P* × ${totalShares.toLocaleString()} ${shareTicker})`,
      equity: marketCap,
      low: Math.round(loPx * totalShares),
      high: Math.round(hiPx * totalShares),
      sharePrice: dexPrice,
      weightPct: null,
      color: '#fb7185',
      formulaNote: `P* = ${dexPrice.toLocaleString()} SGD × ${totalShares.toLocaleString()} diluted shares (Bid ${dexBestBid || '—'} × Ask ${dexBestAsk || '—'})`,
    });
  }

  // Market vs Intrinsic Signal & Implied Multiples
  let premiumDiscountPct = null;
  let valuationSignal = 'PRIVATE CHARTER';
  let signalClass = 'cyan';
  if (hasMarketPrice && intrinsicSharePrice && intrinsicSharePrice > 0) {
    premiumDiscountPct = ((dexPrice - intrinsicSharePrice) / intrinsicSharePrice) * 100;
    if (premiumDiscountPct <= -10) {
      valuationSignal = 'UNDERVALUED vs IFRS';
      signalClass = 'emerald';
    } else if (premiumDiscountPct >= 12) {
      valuationSignal = 'GROWTH PREMIUM';
      signalClass = 'amber';
    } else {
      valuationSignal = 'FAIR VALUE BAND';
      signalClass = 'green';
    }
  }

  const refEquity = marketCap !== null ? marketCap : compositeEquity;
  const refEv = marketEnterpriseValue !== null ? marketEnterpriseValue : compositeEnterpriseValue;

  const impliedPB = bookEquityPos > 0 ? refEquity / bookEquityPos : null;
  const impliedPE = annualizedCleanNI > 0 ? refEquity / annualizedCleanNI : null;
  const impliedEvArr = annualizedArmsRev > 0 ? refEv / annualizedArmsRev : null;
  const impliedEvEbitda = annualizedCleanEbitda > 0 ? refEv / annualizedCleanEbitda : null;
  const annualizedRoePct =
    bookEquityPos > 0 ? (annualizedCleanNI / bookEquityPos) * 100 : 0;

  return {
    params: {
      waccPct,
      costOfEquityPct: Number((rEquity * 100).toFixed(2)),
      terminalGrowthPct,
      blocksPerYear,
      horizonYears,
    },
    fundamentals: {
      bookEquity: bookEquityRaw,
      tangibleBookEquity: navEquity,
      bookedCash,
      quarantinedSuspense,
      financialDebt,
      netCash,
      futureContractBacklog: futureContractAr1800,
      pvSignedBacklog: Math.round(pvSignedBacklog),
      armsLengthRev,
      relatedPartyRevStripped: relatedPartyRev,
      annualizedArmsRev: Math.round(annualizedArmsRev),
      annualizedCleanEbitda: Math.round(annualizedCleanEbitda),
      annualizedCleanNI: Math.round(annualizedCleanNI),
      annualizedFcff: Math.round(normalizedFcffAnnual),
      grossMarginPct: Number((grossMargin * 100).toFixed(1)),
      ebitdaMarginPct: Number((ebitdaMargin * 100).toFixed(1)),
      annualizedRoePct: Number(annualizedRoePct.toFixed(1)),
      rawElapsedBlocks,
      effectiveElapsedBlocks,
      isRevenueGenerating,
      arrMultiple,
      ebitdaMultiple,
    },
    composite: {
      equityValue: compositeEquity,
      enterpriseValue: compositeEnterpriseValue,
      sharePrice: intrinsicSharePrice,
      regime: weights.regime,
      weights,
    },
    market: {
      hasMarketPrice,
      totalShares,
      shareTicker,
      dexAddress: marketCtx.dexAddress || '',
      dexPrice: hasMarketPrice ? dexPrice : null,
      dexBestBid: dexBestBid || null,
      dexBestAsk: dexBestAsk || null,
      marketCap,
      enterpriseValue: marketEnterpriseValue,
      premiumDiscountPct,
      valuationSignal,
      signalClass,
    },
    ratios: {
      impliedPB,
      impliedPE,
      impliedEvArr,
      impliedEvEbitda,
    },
    lenses,
  };
}

/**
 * Builds a 3×3 WACC × Terminal-Growth `g` sensitivity grid of Implied Intrinsic Share Price
 * (or Total Intrinsic Equity Value if `totalShares === 0`).
 */
export function buildValuationSensitivityGrid(stmt, marketCtx = {}, baseParams = {}) {
  const baseWacc = Number(baseParams.waccPct) || DEFAULT_VALUATION_PARAMS.waccPct;
  const baseG = Number(baseParams.terminalGrowthPct) ?? DEFAULT_VALUATION_PARAMS.terminalGrowthPct;
  const waccSteps = [
    Math.max(4.5, baseWacc - 1.5),
    baseWacc,
    Math.min(34, baseWacc + 1.5),
  ];
  const gSteps = [
    Math.max(0, baseG - 1.0),
    baseG,
    Math.min(Math.max(0.5, baseWacc - 2.0), baseG + 1.0),
  ];

  const rows = waccSteps.map((w, rIdx) => ({
    waccPct: Number(w.toFixed(1)),
    isCenterRow: rIdx === 1,
    cells: gSteps.map((g, cIdx) => {
      const res = computeTriangulatedValuation(stmt, marketCtx, {
        ...baseParams,
        waccPct: w,
        terminalGrowthPct: Math.min(g, w - 2.0),
      });
      return {
        gPct: Number(Math.min(g, w - 2.0).toFixed(1)),
        isCenter: rIdx === 1 && cIdx === 1,
        equityValue: res?.composite.equityValue || 0,
        sharePrice: res?.composite.sharePrice ?? null,
      };
    }),
  }));

  return { waccSteps, gSteps, rows };
}
