/**
 * Human-Readable General Ledger & Double-Entry Translator (`ifrs-human-gl.js`)
 *
 * Translates codified Wasmtime Chart-of-Accounts (`CoA`) postings into calm, plain-English
 * explanations so anyone can see at a glance:
 *   1. What happened in plain business terms.
 *   2. Why each account was Debited (`Dr`) vs Credited (`Cr`).
 *   3. How Cash, Profit, and Corporate Valuation (`V*`) changed.
 */

import { fmtNum, escapeHtml } from './inst-suite.js';

// Friendly names & economic nature of each of the 32 CoA slots (`0..31`)
export const FRIENDLY_COA = [
  { code: '1010', short: 'Cash in Bank', kind: 'cash', normal: 0 },
  { code: '1100', short: 'Customer Invoices Due (AR)', kind: 'ar', normal: 0 },
  { code: '1190', short: 'Credit-Loss Reserve', kind: 'contra-asset', normal: 1 },
  { code: '1200', short: 'Warehouse Inventory', kind: 'inventory', normal: 0 },
  { code: '1800', short: 'Signed Contract Backlog', kind: 'backlog', normal: 0 },
  { code: '1500', short: 'Equipment & Labs (PPE)', kind: 'asset', normal: 0 },
  { code: '1590', short: 'Accum. Equipment Depr.', kind: 'contra-asset', normal: 1 },
  { code: '1600', short: 'Facility Lease Asset', kind: 'asset', normal: 0 },
  { code: '1690', short: 'Accum. Lease Amort.', kind: 'contra-asset', normal: 1 },
  { code: '1700', short: 'Protocol & Chip IP', kind: 'asset', normal: 0 },
  { code: '1790', short: 'Accum. IP Amort.', kind: 'contra-asset', normal: 1 },
  { code: '2010', short: 'Supplier Bills Owed (AP)', kind: 'liability', normal: 1 },
  { code: '2100', short: 'Unpaid Payroll', kind: 'liability', normal: 1 },
  { code: '2200', short: 'Income Tax Owed', kind: 'liability', normal: 1 },
  { code: '2300', short: 'Unearned Work / Deferred Rev.', kind: 'liability', normal: 1 },
  { code: '2400', short: 'Dividends Owed', kind: 'liability', normal: 1 },
  { code: '2500', short: 'Facility Lease Debt', kind: 'liability', normal: 1 },
  { code: '2600', short: 'Term Loan Principal', kind: 'liability', normal: 1 },
  { code: '2900', short: 'Unverified Cash Quarantine', kind: 'liability', normal: 1 },
  { code: '3000', short: 'Share Capital (Par)', kind: 'equity', normal: 1 },
  { code: '3010', short: 'Share Premium (Paid-In)', kind: 'equity', normal: 1 },
  { code: '3200', short: 'Treasury Buyback Shares', kind: 'contra-equity', normal: 0 },
  { code: '3300', short: 'Employee Option Reserve', kind: 'equity', normal: 1 },
  { code: '3400', short: 'Retained Earnings', kind: 'equity', normal: 1 },
  { code: '4000', short: 'Sales & Service Revenue', kind: 'revenue', normal: 1 },
  { code: '4050', short: 'Related-Party Revenue', kind: 'revenue', normal: 1 },
  { code: '4090', short: 'Customer Refunds', kind: 'contra-revenue', normal: 0 },
  { code: '5010', short: 'Cost of Goods Sold', kind: 'expense', normal: 0 },
  { code: '6100', short: 'Engineering Payroll', kind: 'expense', normal: 0 },
  { code: '6300', short: 'Depreciation & Amort.', kind: 'expense', normal: 0 },
  { code: '6400', short: 'Operating & Bad-Debt Cost', kind: 'expense', normal: 0 },
  { code: '7000', short: 'Interest & Tax Cost', kind: 'expense', normal: 0 },
];

/**
 * Describe a single `(accountIdx, side)` line in 2 plain words (`side`: 0 = Debit, 1 = Credit).
 */
export function describePostingLineEffect(accountIdx, side) {
  const meta = FRIENDLY_COA[accountIdx] || {
    code: '????',
    short: `Account #${accountIdx}`,
    kind: 'asset',
    normal: 0,
  };
  const up = side === meta.normal;

  switch (meta.kind) {
    case 'cash':
      return up
        ? { pill: 'Cash ↑', tone: 'emerald', verb: 'Adds cash to bank' }
        : { pill: 'Cash ↓', tone: 'amber', verb: 'Pays cash from bank' };
    case 'ar':
      return up
        ? { pill: 'Invoice Due ↑', tone: 'cyan', verb: 'Client now owes this invoice' }
        : { pill: 'Invoice Paid ↓', tone: 'emerald', verb: 'Client paid off this invoice' };
    case 'inventory':
      return up
        ? { pill: 'Stock ↑', tone: 'cyan', verb: 'Adds stock to warehouse' }
        : { pill: 'Stock ↓', tone: 'amber', verb: 'Ships stock out of warehouse' };
    case 'backlog':
      return up
        ? { pill: 'Backlog ↑', tone: 'cyan', verb: 'Adds signed future contract value' }
        : { pill: 'Billed ↓', tone: 'emerald', verb: 'Moves 1 month from backlog to invoice' };
    case 'asset':
      return up
        ? { pill: 'Asset ↑', tone: 'cyan', verb: `Increases ${meta.short}` }
        : { pill: 'Asset ↓', tone: 'amber', verb: `Reduces ${meta.short}` };
    case 'contra-asset':
      return up
        ? { pill: 'Book Value ↓', tone: 'amber', verb: 'Records wear-and-tear or credit reserve' }
        : { pill: 'Reserve ↓', tone: 'emerald', verb: 'Releases prior reserve' };
    case 'liability':
      return up
        ? { pill: 'Obligation ↑', tone: 'amber', verb: 'Records work or bill we owe' }
        : { pill: 'Obligation ↓', tone: 'emerald', verb: 'Fulfills work or pays down bill' };
    case 'equity':
      return up
        ? { pill: 'Equity ↑', tone: 'cyan', verb: 'Increases shareholder equity' }
        : { pill: 'Equity ↓', tone: 'rose', verb: 'Distributes equity' };
    case 'contra-equity':
      return up
        ? { pill: 'Equity ↓', tone: 'amber', verb: 'Buys back shares into treasury' }
        : { pill: 'Equity ↑', tone: 'cyan', verb: 'Retires treasury shares' };
    case 'revenue':
      return up
        ? { pill: 'Revenue ↑', tone: 'emerald', verb: 'Counts as earned sales revenue' }
        : { pill: 'Period Close', tone: 'cyan', verb: 'Moves revenue to Retained Earnings' };
    case 'contra-revenue':
      return up
        ? { pill: 'Refund ↓', tone: 'rose', verb: 'Deducts refund from revenue' }
        : { pill: 'Period Close', tone: 'cyan', verb: 'Closes refund account' };
    case 'expense':
      return up
        ? { pill: 'Cost ↑', tone: 'rose', verb: 'Counts as an expense (reduces profit)' }
        : { pill: 'Cost Reversed', tone: 'emerald', verb: 'Reverses prior expense' };
    default:
      return { pill: side === 0 ? 'Debit' : 'Credit', tone: 'cyan', verb: meta.short };
  }
}

/**
 * 7 Clean Scenarios showing what happens on the books when products & services are bought.
 */
export const GL_SCENARIO_BLUEPRINTS = [
  {
    id: 'b2b_bulk',
    tabLabel: '📦 B2B Bulk Order',
    title: 'B2B Bulk Hardware Order — 4 Crates of Multi-Radio Slates (134,000 SGD)',
    plainStory:
      'An enterprise buyer pays 134,000 SGD upfront for 4 bulk crates. Cash and Revenue go up by 134,000 SGD, while 62,000 SGD of warehouse inventory moves into Cost of Goods Sold — leaving +72,000 SGD net profit.',
    debits: [
      {
        accountIdx: 0,
        code: '1010',
        name: 'Cash in Bank',
        amount: 134000,
        why: 'Buyer pays 134,000 SGD directly into company treasury.',
      },
      {
        accountIdx: 27,
        code: '5010',
        name: 'Cost of Goods Sold',
        amount: 62000,
        why: 'Manufacturing cost of the 4 shipped crates (4 × 15,500 SGD).',
      },
    ],
    credits: [
      {
        accountIdx: 24,
        code: '4000',
        name: 'Sales Revenue',
        amount: 134000,
        why: 'Hardware is delivered immediately, so full revenue is earned now.',
      },
      {
        accountIdx: 3,
        code: '1200',
        name: 'Warehouse Inventory',
        amount: 62000,
        why: '4 crates leave warehouse stock.',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'emerald', value: '+134,000 SGD' },
      { label: 'Net Profit', tone: 'emerald', value: '+72,000 SGD (53.7% margin)' },
      { label: 'Company Valuation (V*)', tone: 'cyan', value: 'Jumps immediately (higher cash & run-rate)' },
    ],
  },
  {
    id: 'b2c_hw',
    tabLabel: '🛍️ B2C Retail Device',
    title: 'Retail Purchase — 2× Watch Ultra Mesh Nodes (1,840 SGD)',
    plainStory:
      'A retail shopper buys 2 watches for 1,840 SGD. The exact same 4-line accounting rule applies as B2B, just at a smaller retail dollar amount (+1,060 SGD gross profit).',
    debits: [
      {
        accountIdx: 0,
        code: '1010',
        name: 'Cash in Bank',
        amount: 1840,
        why: 'Customer payment lands in treasury.',
      },
      {
        accountIdx: 27,
        code: '5010',
        name: 'Cost of Goods Sold',
        amount: 780,
        why: 'Unit cost of 2 watches (2 × 390 SGD).',
      },
    ],
    credits: [
      {
        accountIdx: 24,
        code: '4000',
        name: 'Sales Revenue',
        amount: 1840,
        why: 'Earned immediately on delivery.',
      },
      {
        accountIdx: 3,
        code: '1200',
        name: 'Warehouse Inventory',
        amount: 780,
        why: '2 watches deducted from warehouse stock.',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'emerald', value: '+1,840 SGD' },
      { label: 'Net Profit', tone: 'emerald', value: '+1,060 SGD (57.6% margin)' },
      { label: 'Company Valuation (V*)', tone: 'cyan', value: 'Small incremental tick' },
    ],
  },
  {
    id: 'svc_stage1',
    tabLabel: '🛡️ Defense ① Sign',
    title: 'Defense Contract Stage 1 — Signing a 12-Month Deal (2,160,000 SGD)',
    plainStory:
      'Board and Defence client co-sign a 12-month, 180k/month engineering contract. No work is delivered yet, so Profit is 0 SGD today — instead, 2.16M SGD is recorded as Signed Backlog matched by an equal Obligation to deliver.',
    debits: [
      {
        accountIdx: 4,
        code: '1800',
        name: 'Signed Contract Backlog',
        amount: 2160000,
        why: 'Legally binding 12-month future customer payments.',
      },
    ],
    credits: [
      {
        accountIdx: 14,
        code: '2300',
        name: 'Unearned Work Obligation',
        amount: 2160000,
        why: 'Matching promise to deliver 12 months of engineering.',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'amber', value: '0 SGD today (paid monthly later)' },
      { label: 'Net Profit', tone: 'amber', value: '0 SGD today (no front-loaded fake profit)' },
      { label: 'Company Valuation (V*)', tone: 'cyan', value: 'Jumps +1.2M+ SGD from discounted backlog!' },
    ],
  },
  {
    id: 'svc_stage2',
    tabLabel: '🧾 Defense ② Invoice',
    title: 'Defense Contract Stage 2 — Month #1 Delivered & Billed (180,000 SGD)',
    plainStory:
      'One month of engineering finishes. 180,000 SGD moves out of long-term Backlog into a current Customer Invoice Due, and counts as +180,000 SGD of earned Revenue.',
    debits: [
      {
        accountIdx: 1,
        code: '1100',
        name: 'Customer Invoices Due (AR)',
        amount: 180000,
        why: 'Client is billed 180,000 SGD for Month #1.',
      },
      {
        accountIdx: 14,
        code: '2300',
        name: 'Unearned Work Obligation',
        amount: 180000,
        why: '1 month of our delivery obligation is now complete.',
      },
    ],
    credits: [
      {
        accountIdx: 24,
        code: '4000',
        name: 'Service Revenue',
        amount: 180000,
        why: '180,000 SGD is now earned on the Profit & Loss statement.',
      },
      {
        accountIdx: 4,
        code: '1800',
        name: 'Signed Contract Backlog',
        amount: 180000,
        why: '11 months (1.98M SGD) remain in unbilled backlog.',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'amber', value: '0 SGD yet (awaiting client wire)' },
      { label: 'Net Profit', tone: 'emerald', value: '+180,000 SGD earned revenue' },
      { label: 'Company Valuation (V*)', tone: 'cyan', value: 'Backlog converts into realized ARR' },
    ],
  },
  {
    id: 'svc_stage3',
    tabLabel: '🏦 Defense ③ Paid',
    title: 'Defense Contract Stage 3 — Client Pays Invoice in Cash (180,000 SGD)',
    plainStory:
      'The client wires 180,000 SGD to pay Invoice #1. Because Revenue was already counted in Stage 2, this simply swaps the unpaid Invoice into spendable Cash in Bank.',
    debits: [
      {
        accountIdx: 0,
        code: '1010',
        name: 'Cash in Bank',
        amount: 180000,
        why: '180,000 SGD arrives in verified bank custody.',
      },
    ],
    credits: [
      {
        accountIdx: 1,
        code: '1100',
        name: 'Customer Invoices Due (AR)',
        amount: 180000,
        why: 'Clears the customer’s open invoice to zero.',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'emerald', value: '+180,000 SGD liquid cash' },
      { label: 'Net Profit', tone: 'cyan', value: '0 new revenue (no double-counting)' },
      { label: 'Company Valuation (V*)', tone: 'emerald', value: 'Net Cash rises +180,000 SGD' },
    ],
  },
  {
    id: 'saas_upfront',
    tabLabel: '☁️ Upfront SaaS',
    title: 'Annual Software Subscription Paid Upfront (48,000 SGD)',
    plainStory:
      'Customer pays 48,000 SGD cash upfront for a 120-block software license. Cash rises today, but the money sits in Deferred Revenue and drips into Profit gradually each block.',
    debits: [
      {
        accountIdx: 0,
        code: '1010',
        name: 'Cash in Bank',
        amount: 48000,
        why: 'Full 48,000 SGD cash received upfront.',
      },
    ],
    credits: [
      {
        accountIdx: 14,
        code: '2300',
        name: 'Deferred Revenue (Unearned)',
        amount: 48000,
        why: 'Software access still owed over 120 blocks (400 SGD/blk).',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'emerald', value: '+48,000 SGD immediately' },
      { label: 'Net Profit', tone: 'cyan', value: 'Earns +400 SGD per block over term' },
      { label: 'Company Valuation (V*)', tone: 'emerald', value: 'Lifts Net Cash +48,000 SGD' },
    ],
  },
  {
    id: 'b2b_restock',
    tabLabel: '🏭 Restock Inventory',
    title: 'Factory Restock — 25 Dongle Crates on Supplier Credit (220,000 SGD)',
    plainStory:
      'Warehouse receives 25 new crates from the factory on net supplier terms. Inventory goes up and Supplier Bills Owed goes up — zero expense hits Profit until a customer buys them.',
    debits: [
      {
        accountIdx: 3,
        code: '1200',
        name: 'Warehouse Inventory',
        amount: 220000,
        why: '25 new crates added to warehouse stock.',
      },
    ],
    credits: [
      {
        accountIdx: 11,
        code: '2010',
        name: 'Supplier Bills Owed (AP)',
        amount: 220000,
        why: 'Invoice owed to contract manufacturer.',
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'amber', value: '0 SGD until supplier bill is paid' },
      { label: 'Net Profit', tone: 'amber', value: '0 SGD cost until crates are sold' },
      { label: 'Company Valuation (V*)', tone: 'cyan', value: 'Working-capital neutral' },
    ],
  },
];

/**
 * Build a clean plain-English preview for any catalog SKU & quantity on `/commerce.html`.
 */
export function buildLiveProductCheckoutPreview(sku, meta, qty) {
  const safeQty = Math.max(1, Math.round(Number(qty) || 1));
  const unitPrice = Number(sku?.latestPrice || meta?.price || 0);
  const unitCost = Number(meta?.unitCost || Math.round(unitPrice * 0.44));
  const rev = safeQty * unitPrice;
  const cogs = safeQty * unitCost;
  const grossProfit = rev - cogs;
  const gmPct = rev > 0 ? ((grossProfit / rev) * 100).toFixed(1) : '0.0';
  const isB2b = (meta?.tier || (unitPrice >= 10000 ? 'b2b' : 'b2c')) === 'b2b';
  const prodLabel = meta?.name || sku?.name || meta?.fullName || 'Catalog Item';

  return {
    id: 'live_sku',
    title: `Buying ${safeQty}× ${prodLabel} (${fmtNum(rev)} SGD)`,
    plainStory: `Your ${fmtNum(rev)} SGD payment goes straight into Cash in Bank and Sales Revenue, while ${fmtNum(cogs)} SGD of warehouse stock moves into Cost of Goods Sold — leaving +${fmtNum(grossProfit)} SGD net profit.`,
    debits: [
      {
        accountIdx: 0,
        code: '1010',
        name: 'Cash in Bank',
        amount: rev,
        why: `${safeQty} × ${fmtNum(unitPrice)} SGD paid into company treasury.`,
      },
      {
        accountIdx: 27,
        code: '5010',
        name: 'Cost of Goods Sold',
        amount: cogs,
        why: `Warehouse manufacturing cost (${safeQty} × ${fmtNum(unitCost)} SGD).`,
      },
    ],
    credits: [
      {
        accountIdx: 24,
        code: '4000',
        name: 'Sales Revenue',
        amount: rev,
        why: `Delivered immediately — +${fmtNum(rev)} SGD earned revenue.`,
      },
      {
        accountIdx: 3,
        code: '1200',
        name: 'Warehouse Inventory',
        amount: cogs,
        why: `${safeQty} ${isB2b ? 'crate(s)' : 'unit(s)'} deducted from stock.`,
      },
    ],
    summary: [
      { label: 'Cash in Bank', tone: 'emerald', value: `+${fmtNum(rev)} SGD` },
      { label: 'Net Profit', tone: 'emerald', value: `+${fmtNum(grossProfit)} SGD (${gmPct}% margin)` },
      {
        label: 'Company Valuation (V*)',
        tone: isB2b ? 'cyan' : 'emerald',
        value: isB2b ? 'Visible jump in Cash & ARR' : 'Small retail tick upward',
      },
    ],
  };
}

/**
 * Render a clean, low-clutter, high-legibility T-Account card.
 */
export function renderHumanBlueprintHtml(bp) {
  const sumDr = bp.debits.reduce((s, l) => s + l.amount, 0);

  const renderSideLine = (ln, side) => {
    const eff = describePostingLineEffect(ln.accountIdx, side);
    return `
      <div class="hgl-line-card">
        <div class="hgl-line-top">
          <div class="hgl-acct-wrap">
            <span class="hgl-acct-title">${escapeHtml(ln.name)}</span>
            <code class="hgl-acct-code">${escapeHtml(ln.code)}</code>
            <span class="hgl-eff-pill ${eff.tone}">${escapeHtml(eff.pill)}</span>
          </div>
          <span class="hgl-amt">${fmtNum(ln.amount)} SGD</span>
        </div>
        <div class="hgl-why">${escapeHtml(ln.why)}</div>
      </div>
    `;
  };

  return `
    <div class="hgl-blueprint-wrap">
      <div class="hgl-story-box">
        <div class="hgl-story-head">
          <h4 class="hgl-story-title">${escapeHtml(bp.title)}</h4>
          <span class="hgl-bal-pill">✓ Balanced • ${fmtNum(sumDr)} SGD Dr = Cr</span>
        </div>
        <p class="hgl-story-p">${escapeHtml(bp.plainStory)}</p>
      </div>

      <div class="hgl-taccount-grid">
        <div class="hgl-tcol dr">
          <div class="hgl-tcol-head">
            <span>DEBITS (<code>Dr</code>) — Value In &amp; Costs</span>
            <strong>${fmtNum(sumDr)} SGD</strong>
          </div>
          ${bp.debits.map((l) => renderSideLine(l, 0)).join('')}
        </div>

        <div class="hgl-tcol cr">
          <div class="hgl-tcol-head">
            <span>CREDITS (<code>Cr</code>) — Revenue, Stock Out &amp; Obligations</span>
            <strong>${fmtNum(sumDr)} SGD</strong>
          </div>
          ${bp.credits.map((l) => renderSideLine(l, 1)).join('')}
        </div>
      </div>

      <div class="hgl-summary-strip">
        ${(bp.summary || [])
          .map(
            (s) => `
          <div class="hgl-sum-item ${s.tone}">
            <span class="hgl-sum-lbl">${escapeHtml(s.label)}</span>
            <strong class="hgl-sum-val">${escapeHtml(s.value)}</strong>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

/**
 * Translate live on-chain `IfrsJournalPosted` batches into concise plain-English titles.
 */
export function translateLiveJournalEntry(j, partyLabel = '') {
  const memo = (j.memo || '').trim().toUpperCase();
  const findAmt = (accIdx, side = null) =>
    j.lines
      .filter((l) => l.account === accIdx && (side === null || l.side === side))
      .reduce((s, l) => s + l.amount, 0);

  const cashDr = findAmt(0, 0);
  const cashCr = findAmt(0, 1);
  const arDr = findAmt(1, 0);
  const invDr = findAmt(3, 0);
  const futDr = findAmt(4, 0);
  const futCr = findAmt(4, 1);
  const apCr = findAmt(11, 1);
  const defDr = findAmt(14, 0);
  const revCr = findAmt(24, 1) + findAmt(25, 1);
  const cogsDr = findAmt(27, 0);
  const who = partyLabel || 'Counterparty';

  let icon = '📒';
  let title = `Ledger Entry (${memo || 'IFRS'})`;
  let explanation = `Balanced entry with ${who}.`;

  if (memo === 'SALE') {
    const gp = revCr - cogsDr;
    const isB2b = revCr >= 15000;
    icon = isB2b ? '📦' : '🛍️';
    title = isB2b ? `B2B Bulk Hardware Sale` : `Retail Hardware Sale`;
    explanation = `Received +${fmtNum(revCr)} SGD cash, shipped ${fmtNum(cogsDr)} SGD stock → +${fmtNum(gp)} SGD profit.`;
  } else if (memo === 'SVCS') {
    icon = '🛡️';
    title = `Defense / B2B Contract Signed`;
    explanation = `Added +${fmtNum(futDr)} SGD to Signed Backlog (0 SGD profit until monthly delivery).`;
  } else if (memo === 'SVCB') {
    icon = '🧾';
    title = `Monthly Contract Milestone Billed`;
    explanation = `Billed ${fmtNum(futCr)} SGD from Backlog → Invoice Due & earned Revenue.`;
  } else if (memo === 'ARCL') {
    icon = '🏦';
    title = `Customer Invoice Paid in Cash`;
    explanation = `Collected +${fmtNum(cashDr)} SGD into Cash in Bank, clearing open invoice.`;
  } else if (memo === 'INVP') {
    icon = '🏭';
    title = `Warehouse Inventory Restocked`;
    explanation =
      cashCr > 0
        ? `Added +${fmtNum(invDr)} SGD stock, paid in cash.`
        : `Added +${fmtNum(invDr)} SGD stock on supplier credit (${fmtNum(apCr)} SGD AP).`;
  } else if (memo === 'SUBS') {
    icon = '☁️';
    title = `Upfront SaaS Subscription Paid`;
    explanation = `Collected +${fmtNum(cashDr)} SGD cash; held as Deferred Revenue over license term.`;
  } else if (memo === 'DFRV' || memo === 'RPRV') {
    icon = '⏱️';
    title = `SaaS Subscription Revenue Earned`;
    explanation = `Moved ${fmtNum(defDr)} SGD from Deferred Revenue into earned Revenue.`;
  } else if (memo === 'DEPR') {
    const da = findAmt(29, 0);
    icon = '⚙️';
    title = `Scheduled Depreciation & Amortization`;
    explanation = `Booked ${fmtNum(da)} SGD non-cash wear-and-tear on equipment, IP & leases.`;
  } else if (memo === 'ECL9') {
    const eclExp = findAmt(30, 0);
    const eclRel = findAmt(30, 1);
    icon = '🛡️';
    title = eclExp > 0 ? `Invoice Credit-Loss Reserve` : `Credit-Loss Reserve Released`;
    explanation =
      eclExp > 0
        ? `Set aside ${fmtNum(eclExp)} SGD aging reserve on open invoices.`
        : `Invoices paid — released +${fmtNum(eclRel)} SGD reserve back to income.`;
  } else if (memo === 'CAPX') {
    icon = '🏗️';
    title = `Equipment / IP Purchased`;
    explanation = `Capitalized ${fmtNum(j.totalDebit)} SGD long-term asset onto Balance Sheet.`;
  } else if (memo === 'LSEC') {
    icon = '🏢';
    title = `Facility Lease Signed`;
    explanation = `Recorded ${fmtNum(j.totalDebit)} SGD Lease Asset & matching Lease Debt.`;
  } else if (memo === 'LSEP') {
    icon = '🏢';
    title = `Lease Rent Paid`;
    explanation = `Paid ${fmtNum(cashCr)} SGD lease installment from Cash in Bank.`;
  } else if (memo === 'PAYR') {
    icon = '👥';
    title = `Engineering Payroll`;
    explanation = `Booked ${fmtNum(j.totalDebit)} SGD team compensation.`;
  } else if (memo === 'CPAY') {
    icon = '🔒';
    title = `Confidential Payroll Roll-Up`;
    explanation =
      cashCr > 0
        ? `Funded ${fmtNum(j.totalDebit)} SGD into Shielded Note Pool across 4+ ZK-verified slots (individual salaries hidden).`
        : `Accrued ${fmtNum(j.totalDebit)} SGD confidential payroll roll-up (individual breakdown encrypted).`;
  } else if (memo === 'COPX') {
    icon = '🔒';
    title = `Confidential Vendor & R&D OpEx Roll-Up`;
    explanation = `Booked ${fmtNum(j.totalDebit)} SGD aggregate vendor expense across ZK-verified shielded slots.`;
  } else if (memo === 'CSET') {
    icon = '🔒';
    title = `Shielded Accrued Payable Settlement`;
    explanation = `Disbursed ${fmtNum(cashCr)} SGD lump sum into Shielded Note Pool to clear accrued confidential payables.`;
  } else if (memo === 'CEPK') {
    icon = '🛡️';
    title = `Confidential Defense / B2B Epoch Backlog Roll-Up`;
    explanation = `Rolled up +${fmtNum(futDr)} SGD verified arm's-length backlog across 4+ shielded slots (clients & individual sizes hidden).`;
  } else if (memo === 'CSVC') {
    icon = '🛡️';
    title = `Counterparty-Shielded Defense Contract Signed`;
    explanation = `Added +${fmtNum(futDr)} SGD Signed Backlog with ZK IAS 24 non-insider proof (client identity encrypted).`;
  } else if (memo === 'CBIL') {
    icon = '🧾';
    title = `Confidential Defense Milestone Billing Roll-Up`;
    explanation = `Billed ${fmtNum(futCr)} SGD aggregate earned revenue from shielded contract portfolio.`;
  } else if (memo === 'CAR') {
    icon = '🔒';
    title = `Confidential Enterprise AR Roll-Up`;
    explanation = `Booked +${fmtNum(arDr)} SGD aggregate arm's-length receivables with shielded counterparties.`;
  } else if (memo === 'CSWP') {
    icon = '🏦';
    title = `Shielded Receivable Pool Cash Sweep`;
    explanation = `Swept +${fmtNum(cashDr)} SGD lump sum from Shielded Note Pool into verified bank custody.`;
  } else if (memo === 'OPEX') {
    icon = '🧾';
    title = `Operating Expense Paid`;
    explanation = `Paid ${fmtNum(j.totalDebit)} SGD vendor expense.`;
  } else if (memo === 'PICP' || memo === 'EQIS') {
    icon = '💎';
    title = `Shareholder Capital Invested`;
    explanation = `Added +${fmtNum(cashDr)} SGD cash and Share Equity.`;
  } else if (memo === 'DIVD') {
    icon = '💎';
    title = `Shareholder Cash Dividend`;
    explanation = `Paid ${fmtNum(cashCr)} SGD realized-profit dividend.`;
  } else if (memo === 'ARIN') {
    icon = '📄';
    title = `Credit Invoice Accepted`;
    explanation = `Booked +${fmtNum(arDr)} SGD Customer Invoice Due & earned Revenue.`;
  } else if (memo === 'RETN') {
    icon = '↩️';
    title = `Customer Refund`;
    explanation = `Refunded ${fmtNum(cashCr)} SGD cash and returned items to stock.`;
  } else if (memo === 'STAP' || memo === 'SPAY') {
    icon = '🏦';
    title = `Supplier Bill Paid`;
    explanation = `Paid ${fmtNum(cashCr)} SGD cash to clear Supplier Bills Owed.`;
  } else if (memo === 'SUSP') {
    icon = '⚠️';
    title = `Unverified Deposit Quarantined`;
    explanation = `Held ${fmtNum(cashDr)} SGD in Quarantine (not counted as revenue).`;
  } else if (memo === 'CLOS') {
    icon = '🔒';
    title = `Fiscal Period Closed`;
    explanation = `Rolled period profit into Retained Earnings.`;
  } else if (memo === 'INIT') {
    icon = '🏛️';
    title = `Opening Treasury Capitalization`;
    explanation = `Initialized corporate ledger & bank custody.`;
  }

  return { icon, title, explanation };
}
