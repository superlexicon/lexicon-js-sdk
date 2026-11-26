/**
 * SuperLexicon Use-Case Architecture Descriptions & Interactive Instructions Suite
 * (`@superlexicon/sdk/ui/usecase-docs`)
 *
 * Provides two companion 4-tab modals across all 10 live Subnet 1 Halt-Free Subroutine (HFS) apps:
 *  1. `🏛️ Description` (`openSlxUseCaseDescription(appId)`):
 *     - Tab 1: 🛡️ API → HFS Codification (How mission-critical logic moved out of vulnerable Web2 APIs into Halt-Free Subroutines)
 *     - Tab 2: 🔐 Crypto & L1 Primitives (Bulletproofs, Homomorphic ElGamal, Quorum Threshold ECVRF RNG, Stealth Keys, LR2021 RF, etc.)
 *     - Tab 3: 🧩 HFS Subroutine Topology (Composable `.wasm` contracts, `code_hash` pinning, Virgin custody & atomic subcalls)
 *     - Tab 4: 🔬 Live Audit & Invariants (Mathematical guarantees enforced per block & how to verify client-side)
 *  2. `📖 Instructions` (`openSlxUseCaseInstructions(appId)`):
 *     - 4-tab step-by-step user guide for the 7 institutional/civic/VRF apps (`dex`, `charter`, `ballot`,
 *       `commerce`, `accounting`, `social`, `lottery`), seamlessly paired with `game-guide.js` on the 3 games
 *       (`battleship`, `hegemony`, `cipher-noir`).
 */

const DOC_APP_ALIASES = {
  'commons-rf': 'social',
  commonsrf: 'social',
  'phantom-fleet': 'battleship',
  fleet: 'battleship',
  noir: 'cipher-noir',
  'quantum-lottery': 'lottery',
  'secret-ballot': 'ballot',
  ciphervote: 'ballot',
  'ifrs-ledger': 'accounting',
  ifrs: 'accounting',
  'app-store': 'apps',
  appstore: 'apps',
  directory: 'apps',
};

const GAME_GUIDE_IDS = new Set(['battleship', 'hegemony', 'cipher-noir']);

export function normalizeUseCaseId(appId) {
  if (!appId) return '';
  const clean = String(appId).trim().toLowerCase();
  return DOC_APP_ALIASES[clean] || clean;
}

// ---------------------------------------------------------------------------
// 1. Complete 4-Tab HFS Architecture & Cryptographic Descriptions (All 10 Apps)
// ---------------------------------------------------------------------------

export const USECASE_DESCRIPTIONS = {
  dex: {
    id: 'dex',
    icon: '📈',
    title: 'DEX Central Limit Order Book — HFS Architecture & Primitives',
    href: '/dex.html',
    tagline:
      'How price-time order matching, multi-asset custody, and HFT settlement moved out of opaque exchange APIs into deterministic Halt-Free Subroutines across 16 parallel markets.',
    featurePills: [
      { label: 'Bounded-Loop Halt-Free WASM', tone: 'cyan' },
      { label: 'Virgin Escrow Custody (0 Admin Keys)', tone: 'emerald' },
      { label: '16-Market Parallel State Sharding', tone: 'violet' },
      { label: 'Atomic Cross-HFS Settlement', tone: 'amber' },
      { label: '$0.00-Gas Order Placement & Cancel', tone: 'emerald' },
      { label: 'v2 Identity Spam Filtering', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Eliminating the Vulnerable Centralized Exchange (CEX) API Layer</div>
          <p>
            Conventional exchanges run matching engines inside private off-chain C++/Java microservices backed by mutable SQL/memory ledgers. Users deposit real assets into omnibus hot wallets and receive unverified database IOUs—exposing traders to <strong>operator front-running, phantom liquidity, withdrawal freezes, API rate-limit manipulation, and silent insolvency</strong>.
            SuperLexicon moves the <strong>entire price-time priority Central Limit Order Book (` +
        '`dex_clob.wasm`' +
        `) and asset custody (` +
        '`asset_ledger.wasm`' +
        `) directly into Layer-1 Halt-Free Subroutines</strong>.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Mission-Critical Function</th>
              <th>Vulnerable Conventional API Layer</th>
              <th>SuperLexicon Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Order Matching &amp; Priority</strong></td>
              <td>Private matching server can reorder, peek, or insert house-desk orders ahead of retail API calls.</td>
              <td>Deterministic price-time priority matching inside <code>dex_clob.wasm</code> verified by every BFT validator in consensus.</td>
            </tr>
            <tr>
              <td><strong>Asset Custody &amp; Solvency</strong></td>
              <td>Omnibus hot wallets controlled by exchange executives; fractional-reserve rehypothecation goes undetected.</td>
              <td>Resting orders lock assets inside a <strong>Virgin Escrow <code>Identity</code></strong> (<code>owner == dex_clob.wasm</code>) with zero human private keys.</td>
            </tr>
            <tr>
              <td><strong>Settlement Atomicity</strong></td>
              <td>Async settlement queues &amp; clearinghouse cron jobs leave T+1/T+2 counterparty default windows.</td>
              <td>Synchronous <code>host_call_contract</code> settles base &amp; quote <code>AssetLedger</code> transfers atomically in the same ~4s block.</td>
            </tr>
            <tr>
              <td><strong>Market-Making &amp; Cancellations</strong></td>
              <td>EVM L1s charge punitive gas on every quote update/cancel, forcing DEXs onto centralized L2 sequencers.</td>
              <td><code>$0.00</code>-gas L1 execution lets market makers quote &amp; cancel continuously on Layer 1 with zero sequencer risk.</td>
            </tr>
          </tbody>
        </table>
        <div class="slx-ucd-callout">
          <strong>⏱️ Why It Is Guaranteed Halt-Free:</strong> Every bid/ask scan and match loop in <code>dex_clob.wasm</code> is strictly bounded by compile-time capacity constants (<code>MAX_RESTING_ORDERS</code> &amp; per-call fill caps), guaranteeing worst-case Wasmtime fuel execution in milliseconds and making infinite loops or DoS book-stuffing mathematically impossible.
        </div>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🔒 Virgin Escrow Identity Custody</h4>
            <p>Each DEX market binds an unowned <code>identity.wasm</code> vault whose <code>owner()</code> is permanently set to the <code>dex_clob.wasm</code> contract address. Neither founders, validators, nor market operators possess a private key capable of moving escrowed quote cash or base shares outside valid order fills or trader cancellations.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>⚡ 16-Market Parallel DAG Execution (<code>extraTargets</code>)</h4>
            <p>Signed SuperLexicon transactions declare their touched contract footprint (<code>extraTargets</code>) and optional <code>lowerBoundHash</code> causal ordering. Consensus schedules disjoint CLOB markets (<code>NVDAX-EQ</code>, <code>TSLAX-EQ</code>, <code>GSX-GOLD</code>, <code>SPACX-FUT</code>, etc.) concurrently without global EVM lock contention.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🧬 Single-<code>code_hash</code> Bytecode Deduplication</h4>
            <p>All 16 Equity, Commodity, FX, and Compute orderbooks instantiate the exact same verified <code>dex_clob.wasm</code> bytecode stored once at <code>0x0100</code>. Auditors verify one deterministic binary hash to trust every market in the registry.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🪪 v2 <code>Identity</code> Cryptographic Attribution</h4>
            <p>Traders execute via sovereign <code>identity.wasm</code> accounts rather than raw anonymous EOAs, enabling clean separation of verified institutional desks, autonomous HFT/MEV bots, and human traders while maintaining <code>secp256k1</code> signature non-repudiation.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Domain Responsibility &amp; Invariant</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>dex_clob.wasm</code></td>
              <td>Maintains bounded bid/ask price-time queues, computes partial/full fills, refunds price-improvement surplus on marketable limit buys, and emits <code>OrderPlaced</code>, <code>BlockMatched</code>, and <code>OrderCancelled</code> logs.</td>
            </tr>
            <tr>
              <td><code>asset_ledger.wasm</code> (×2 per market)</td>
              <td>Enforces conservation of supply for Base Asset (e.g. <code>NVDAX-EQ</code>) and Quote Currency (<code>SGD-FIAT</code>), authorizing escrow transfers strictly from verified <code>Identity</code> owners/delegates.</td>
            </tr>
            <tr>
              <td><code>identity.wasm</code> (Trader &amp; Virgin Escrow)</td>
              <td>Authenticates trader <code>execute()</code> calls via <code>secp256k1</code> EOA ownership/delegation and isolates market escrow inside a keyless Virgin contract account.</td>
            </tr>
            <tr>
              <td><code>hfs_registry.wasm</code></td>
              <td>Enforces on-chain <code>code_hash</code> allowlisting (<code>DEX_CLOB</code>) so UIs and counterparties never interact with spoofed orderbook bytecode.</td>
            </tr>
          </tbody>
        </table>
        <div class="slx-ucd-callout">
          <strong>🔄 Atomic Single-Block Fill Pipeline:</strong> <code>Trader EOA</code> → <code>Identity.execute()</code> → <code>DexClob.placeOrder()</code> → synchronous <code>AssetLedger.transfer()</code> into Virgin Escrow → bounded price-time cross against resting book → atomic delivery of Base shares to Buyer &amp; Quote <code>SGD-FIAT</code> to Seller (or full rollback if any check fails).
        </div>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Per-Block Mathematical Guarantees</h4>
            <ul>
              <li><strong>Zero Fractional Reserve:</strong> Every resting bid is 100% backed by locked Quote <code>SGD-FIAT</code> and every resting ask by locked Base units in Virgin Escrow.</li>
              <li><strong>Best-Execution Surplus Refund:</strong> Crossing a resting ask below your limit bid price automatically refunds the exact price improvement in the same call frame.</li>
              <li><strong>No L2 Sequencer / No Cloud Indexer:</strong> Depth charts, spreads, and trade tape stream directly from your validator WebSocket RPC.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Switch across all 16 live markets in the top-left <strong>HFS Instance Dropdown</strong> and watch live HFT &amp; MEV desk orderflow settle every ~4s block.</li>
              <li>Place a Limit Bid or Ask, inspect the raw signed tx &amp; receipt in <strong>📜 Txs</strong>, then cancel for <code>$0.00</code> gas and confirm instant 100% escrow return.</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  charter: {
    id: 'charter',
    icon: '🏛️',
    title: 'CorporateCharter & Cap-Table — HFS Architecture & Primitives',
    href: '/charter.html',
    tagline:
      'How corporate constitutions, multi-stage board/shareholder quorums, ROFR share auctions, and audit key governance moved out of mutable legal/SaaS portals into Halt-Free Subroutines.',
    featurePills: [
      { label: 'Constitutional HFS State Machine', tone: 'indigo' },
      { label: 'ActionHasher Quorum Binding', tone: 'cyan' },
      { label: 'code_hash Peer Module Pinning', tone: 'emerald' },
      { label: 'Uniform-Price Share Auctions', tone: 'amber' },
      { label: 'Edwards25519 Audit Key Rotation', tone: 'violet' },
      { label: 'IAS 24 Insider PK Registry', tone: 'rose' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Replacing Mutable Cap-Table SaaS &amp; Backdated PDF Resolutions</div>
          <p>
            In conventional corporate infrastructure (Carta, DocuSign, ERP admin panels), share registries and board approvals live in vendor databases disconnected from actual bank and equity movement. An insider, rogue administrator, or compromised API key can <strong>mint unauthorized shares, bypass Right-of-First-Refusal (ROFR), backdate resolutions, or execute ultra-vires treasury transfers</strong>, leaving shareholders with slow after-the-fact litigation.
            SuperLexicon codifies the company’s constitution directly into <code>corporate_charter.wasm</code>, <code>authorization.wasm</code>, and <code>share_capital.wasm</code>—making unauthorized dilution or unapproved governance actions <strong>cryptographically unexecutable</strong>.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Corporate Pillar</th>
              <th>Vulnerable Conventional API / Legal Workflow</th>
              <th>SuperLexicon Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Incorporation &amp; Activation</strong></td>
              <td>PDF articles filed offline; SaaS admin manually types cap table rows with zero cryptographic link.</td>
              <td><code>CorporateCharter</code> stays inert until ratified on-chain via a <code>FIRST_SHAREHOLDER_RESOLUTION</code> quorum contract.</td>
            </tr>
            <tr>
              <td><strong>Board &amp; Shareholder Approvals</strong></td>
              <td>Generic e-signatures detached from execution; executives can alter transaction parameters after approval.</td>
              <td><code>ActionHasher</code> binds each <code>authorization.wasm</code> instance to the exact target contract, selector, and ABI parameters—single-use and replay-proof.</td>
            </tr>
            <tr>
              <td><strong>Equity Issuance &amp; ROFR Sales</strong></td>
              <td>Opaque insider pricing and manual broker spreadsheets prone to selective allocation.</td>
              <td><code>share_capital.wasm</code> runs deterministic 5-step Primary Issuance &amp; 3-step ROFR Secondary uniform-price clearing auctions settled atomically in <code>SGD-FIAT</code>.</td>
            </tr>
            <tr>
              <td><strong>Privacy Audit Key Governance</strong></td>
              <td>Single CFO/IT admin holds raw decryption passwords indefinitely with no rotation trail.</td>
              <td>Board-ratified <code>Edwards25519</code> Audit Epoch key rotation + scoped <code>(epoch, category, period)</code> external auditor subkeys wrapped via <code>secp256k1</code> ECDH.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🔏 Parameter-Bound <code>ActionHasher</code> Quorums</h4>
            <p>Every sensitive corporate action (issuing shares, appointing directors, authorizing defense contracts, rotating audit keys) hashes its exact 32-byte action digest. Directors/shareholders vote on a dedicated <code>authorization.wasm</code> HFS; the target contract consumes the finalized authorization atomically via <code>verify_and_consume_auth</code>.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🧬 Cross-HFS <code>context::code_hash_of</code> Pinning</h4>
            <p>Before trusting a sibling ledger, authorization, or identity contract, <code>CorporateCharter</code> queries Wasmtime’s native <code>host_get_code_hash</code> syscall to verify the peer’s exact immutable WASM hash—blocking malicious proxy or counterfeit contract injection.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔑 Dual-Curve Encryption &amp; Audit Key Hierarchy</h4>
            <p>Officer and Auditor <code>Identity</code> contracts publish both 64-byte <code>secp256k1</code> ECDH public keys (for wrapped key envelopes) and 32-byte <code>Edwards25519</code> public keys (for <code>IAS 24</code> insider ring non-membership checks in <code>ConfidentialLedger</code>).</p>
          </div>
          <div class="slx-ucd-card">
            <h4>⚖️ Bounded Uniform-Price Auction Clearing</h4>
            <p><code>ShareCapital</code> clears primary fundraising and secondary ROFR orderbooks in bounded deterministic loops, guaranteeing existing shareholders statutory pro-rata / ROFR priority before external bidders fill remaining shares.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Constitutional Role</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>corporate_charter.wasm</code></td>
              <td>Root corporate constitution: stores director roster (with bilateral director consent), executive role grants, per-selector governance policies, Audit Epoch public keys, and the <code>IAS 24</code> insider roster.</td>
            </tr>
            <tr>
              <td><code>authorization.wasm</code></td>
              <td>Multi-stage threshold voting state machine (Board majority, Shareholder supermajority, Joint stages) bound to a unique 32-byte <code>ActionHasher</code> payload.</td>
            </tr>
            <tr>
              <td><code>share_capital.wasm</code></td>
              <td>Executes guided 5-step Primary Equity Issuance, 3-step ROFR Secondary Share Auctions, Share Buybacks, Stock Splits, ESOP option vesting/exercise, and Futures underwriting.</td>
            </tr>
            <tr>
              <td><code>asset_ledger.wasm</code></td>
              <td>Canonical on-chain Shareholder Register (<code>NVDAX-EQ</code>) and Corporate Operating Bank Ledger (<code>SGD-FIAT</code>) enforcing Charter-gated transfers.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Constitutional Invariants Enforced</h4>
            <ul>
              <li><strong>No Unilateral Officer Dilution:</strong> <code>AssetLedger.issue()</code> reverts unless invoked through a finalized, Charter-verified resolution or auction.</li>
              <li><strong>Bilateral Director Consent:</strong> Nobody can be added as a corporate director (or <code>IAS 24</code> insider) without their explicit on-chain consent signature.</li>
              <li><strong>Atomic DvP Equity Settlement:</strong> Shares and <code>SGD-FIAT</code> swap simultaneously via Virgin Share Escrow—zero settlement risk.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Inspect the <strong>Corporate Legal Library</strong> folio &amp; live/past <code>Authorization</code> resolutions on this page—every clause maps 1:1 to live on-chain storage.</li>
              <li>Click <strong>🏛️ + Incorporate New Company</strong> in the HFS dropdown to deploy a brand-new 7-contract corporate suite in seconds.</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  ballot: {
    id: 'ballot',
    icon: '🗳️',
    title: 'CipherVote Secret Ballot — HFS Architecture & Primitives',
    href: '/ballot.html',
    tagline:
      'How civic referendums and equity-weighted shareholder votes moved out of trusted e-voting servers into zero-knowledge homomorphic Halt-Free Subroutines with validator-quorum threshold decryption.',
    featurePills: [
      { label: 'Additive Homomorphic ElGamal', tone: 'violet' },
      { label: 'CDS 0/1 Disjunctive ZK Proofs', tone: 'emerald' },
      { label: 'Chaum-Pedersen DLEQ Sum=1 Proof', tone: 'cyan' },
      { label: '>2/3 Validator Threshold DKG', tone: 'amber' },
      { label: 'Homomorphic Share-Weight Scaling', tone: 'sky' },
      { label: 'Permanent Individual Vote Secrecy', tone: 'rose' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Solving Both Web2 Ballot-Box Tampering AND Public-Blockchain Vote Coercion</div>
          <p>
            Web2 e-voting APIs (Snapshot off-chain servers, corporate proxy portals, cloud SQL databases) let server administrators <strong>peek at live tallies, leak how key shareholders voted, censor ballots, or alter results</strong>. Conversely, standard EVM DAO voting publishes every voter’s plaintext choice on-chain—enabling whale coercion, bribery, and bandwagon distortion.
            CipherVote moves ballot validation, equity-weight scaling, and encrypted tallying into <code>secret_ballot.wasm</code> + <code>vrf_beacon.wasm</code> using <strong>Wasmtime native ` +
        '`Edwards25519`' +
        ` additive homomorphic encryption and validator-quorum threshold decryption</strong>.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Voting Requirement</th>
              <th>Vulnerable Web2 API / Plaintext DAO</th>
              <th>CipherVote Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Individual Ballot Privacy</strong></td>
              <td>Web2 DB admin sees every vote; EVM DAOs expose every voter’s choice publicly forever.</td>
              <td>Ballots are encrypted client-side under the validator quorum’s DKG key; <strong>individual ballots are never decrypted</strong>.</td>
            </tr>
            <tr>
              <td><strong>Anti-Stuffing (Invalid Votes)</strong></td>
              <td>Encrypted votes in naive systems could hide negative numbers or <code>+1,000,000</code> fake votes inside ciphertexts.</td>
              <td>Wasmtime verifies <code>640 B</code> of zero-knowledge proofs per ballot (<code>b_s ∈ {0,1}</code> and <code>∑ b_s == 1</code>) before accepting it.</td>
            </tr>
            <tr>
              <td><strong>Share-Weighted Governance</strong></td>
              <td>Requires trusting an off-chain tally script to multiply private votes by shareholdings.</td>
              <td><code>host_he_scale_ciphertext</code> multiplies encrypted ciphertexts by live <code>AssetLedger.balanceOf(voter)</code> directly inside WASM!</td>
            </tr>
            <tr>
              <td><strong>Early Tally Leakage</strong></td>
              <td>Single election authority holds the decryption key and can peek mid-election.</td>
              <td><code>&gt; 2/3</code> BFT consensus validators must submit DLEQ-verified decryption shares <em>only after</em> the poll window closes.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🔐 Exponential ElGamal over Prime-Order <code>Edwards25519</code></h4>
            <p>Each option slot <code>s ∈ {Yes, No, Abstain}</code> encrypts bit <code>b_s ∈ {0, 1}</code> under the validator quorum’s dealerless DKG public key <code>Y = S · B</code> as <code>(C_1, C_2) = (r_s · B, b_s · B + r_s · Y)</code>. No single validator ever knows the epoch secret <code>S</code>.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🛡️ CDS 1-of-2 Disjunctive ZK Proofs + Sum-to-1 DLEQ</h4>
            <p>Host precompile <code>host_he_verify_zero_or_one</code> verifies three 128-byte Cramer-Damgård-Schoenmakers OR-proofs bound to <code>(poll_id, voter, slot)</code> proving each slot encrypts strictly <code>0</code> or <code>1</code>, while <code>host_ec_dleq_verify</code> proves <code>C_yes + C_no + C_abstain</code> encrypts <code>1</code>—preventing double-voting or negative-vote attacks in zero knowledge.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>⚖️ Homomorphic Weight Scaling &amp; Tallying</h4>
            <p>In equity-weighted polls, <code>secret_ballot.wasm</code> queries <code>shareLedger.balanceOf(voter)</code> via <code>host_call_contract</code>, scales each ciphertext via <code>host_he_scale_ciphertext</code> (<code>w · Enc(b_s) = Enc(w · b_s)</code>), and adds it into the running encrypted tally via <code>host_he_add_ciphertexts</code>—all without knowing which option received weight <code>w</code>.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔓 Threshold Lagrange Decryption &amp; BSGS Discrete Log</h4>
            <p>Once closed, validators submit Chaum-Pedersen DLEQ-verified partial decryptions <code>D_{i,s} = s_i · Acc_{s,1}</code> <strong>only</strong> for the 3 aggregate accumulators. <code>host_he_lagrange_decrypt</code> interpolates over <code>ℤ_ℓ</code> and recovers exact integer tallies via a cached Baby-Step Giant-Step table in <code>&lt; 0.3 ms</code>.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Cryptographic &amp; Governance Role</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>secret_ballot.wasm</code></td>
              <td>Manages poll lifecycles, voter eligibility &amp; nullification, ZK proof verification (<code>host_he_verify_zero_or_one</code> + <code>host_ec_dleq_verify</code>), homomorphic share-weight scaling, and aggregate accumulator state.</td>
            </tr>
            <tr>
              <td><code>vrf_beacon.wasm</code></td>
              <td>Coordinates non-interactive dealerless validator DKG epochs and collects BFT <code>&gt; 2/3</code> DLEQ-verified threshold ElGamal decryption shares upon poll closure.</td>
            </tr>
            <tr>
              <td><code>asset_ledger.wasm</code> &amp; <code>identity_registry.wasm</code></td>
              <td>Provide live on-chain shareholder voting weights (Mode 2) and verified citizen/member <code>Identity</code> standing (Mode 1).</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ End-to-End Verifiability + Receipt-Freeness</h4>
            <ul>
              <li><strong>Universal Tally Verifiability:</strong> Anyone can re-sum every published encrypted ballot ciphertext from block 0 and verify it equals the exact aggregate ciphertext decrypted by the validator quorum.</li>
              <li><strong>Zero Individual Decryption:</strong> Because validators never generate decryption shares for individual ballots, individual choices remain information-theoretically protected by threshold DKG.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Click <strong>🔬 Verify Homomorphic Proof</strong> on any active or finalized poll to re-compute the Edwards25519 homomorphic ciphertext sum and verify every validator’s Chaum-Pedersen DLEQ share directly in pure browser JS!</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  commerce: {
    id: 'commerce',
    icon: '🛒',
    title: 'E-Commerce Storefront & Inventory — HFS Architecture & Primitives',
    href: '/commerce.html',
    tagline:
      'How B2C/B2B catalog pricing, physical stock deduction, SGD settlement, and double-entry IFRS revenue/COGS booking moved out of brittle webhook APIs into atomic Halt-Free Subroutines.',
    featurePills: [
      { label: '3-Contract Atomic Checkout', tone: 'emerald' },
      { label: 'IAS 2 Weighted-Average COGS', tone: 'cyan' },
      { label: 'IFRS 15 Instant GL Posting', tone: 'indigo' },
      { label: 'Virgin Treasury Settlement', tone: 'amber' },
      { label: 'Dual Corporate & Citizen Modes', tone: 'violet' },
      { label: 'Bounded SKU State Machine', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Eliminating Async Shopify / Stripe / ERP Webhook Drift</div>
          <p>
            Conventional e-commerce stacks stitch together separate SaaS APIs—a storefront DB, a payment processor webhook, a warehouse inventory service, and an overnight ERP accounting sync. Dropped webhooks, race conditions, or API compromises cause <strong>oversold inventory, unrecorded revenue, mismatched COGS, and custodial payment holds</strong>.
            SuperLexicon unifies catalog management, inventory control, <code>SGD-FIAT</code> payment settlement, and real-time double-entry IFRS journalization inside <code>product_ledger.wasm</code> + <code>accounting_ledger.wasm</code> + <code>asset_ledger.wasm</code>—executing atomically in one ~4s Layer-1 block.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Commerce Stage</th>
              <th>Vulnerable Conventional API Stack</th>
              <th>SuperLexicon Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Catalog &amp; Price Integrity</strong></td>
              <td>Compromised web admin or SQL injection alters SKU prices without board/manager audit trail.</td>
              <td>In Corporate mode, <code>ProductLedger</code> enforces <code>CorporateCharter</code> <code>ROLE_PRODUCT_MANAGER</code> / policy authorization on every SKU mutation.</td>
            </tr>
            <tr>
              <td><strong>Stock vs. Payment Race</strong></td>
              <td>Two buyers capture Stripe payments simultaneously for the last unit, requiring manual refunds.</td>
              <td><code>buyProduct</code> checks &amp; decrements stock synchronously with <code>AssetLedger</code> payment; insufficient stock reverts the payment atomically.</td>
            </tr>
            <tr>
              <td><strong>Revenue &amp; COGS Accounting</strong></td>
              <td>Exported via CSV or nightly middleware into QuickBooks/SAP weeks later, often failing reconciliation.</td>
              <td>Every purchase synchronously calls <code>AccountingLedger.recordCashSale</code>, posting <code>IFRS 15</code> Revenue + <code>IAS 2</code> WAC COGS in the exact same transaction!</td>
            </tr>
            <tr>
              <td><strong>Merchant Revenue Custody</strong></td>
              <td>Payment gateway freezes merchant payouts for days or charges 2.9% + $0.30 interchange fees.</td>
              <td><code>$0.00</code>-gas instant settlement straight into the company’s Virgin Treasury <code>Identity</code> (<code>1010 Operating Bank Cash</code>).</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🔄 Synchronous 3-HFS Atomic Composition</h4>
            <p>A single <code>buyProduct(skuId, qty)</code> call orchestrates <code>ProductLedger</code> → <code>AssetLedger</code> (buyer-to-treasury <code>SGD-FIAT</code> transfer) → <code>AccountingLedger</code> (live Revenue + Weighted-Average-Cost COGS double-entry journal) via Wasmtime’s atomic <code>host_call_contract</code>.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>📦 On-Chain <code>IAS 2</code> Weighted-Average-Cost (WAC) Math</h4>
            <p>When inventory is procured, <code>AccountingLedger</code> tracks exact unit quantities and carrying value in account <code>1200 Inventory</code>. On every storefront sale, exact WAC COGS is computed deterministically in integer arithmetic—zero floating-point rounding drift.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🏛️ Dual Governance Modes (Enterprise vs. Sovereign Citizen)</h4>
            <p>The exact same deduplicated <code>product_ledger.wasm</code> binary powers both Charter-governed institutional catalogs (Nvidya Systems B2B/B2C hardware) and sovereign citizen micro-storefronts on CommonsRF!</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔏 <code>code_hash</code>-Verified Accounting Hook</h4>
            <p><code>AccountingLedger</code> only accepts automated sale postings from an authorized <code>ProductLedger</code> module pinned in <code>CorporateCharter</code>, blocking spoofed storefronts from injecting fake revenue entries.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Retail &amp; Fulfillment Invariant</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>product_ledger.wasm</code></td>
              <td>Maintains bounded SKU catalog, active status, unit prices, available stock counts, and unit-sold counters; orchestrates atomic checkout.</td>
            </tr>
            <tr>
              <td><code>asset_ledger.wasm</code></td>
              <td>Transfers exact <code>qty × unitPrice</code> <code>SGD-FIAT</code> from Buyer <code>Identity</code> to the Virgin Corporate Treasury (or Citizen Merchant <code>Identity</code>).</td>
            </tr>
            <tr>
              <td><code>accounting_ledger.wasm</code></td>
              <td>Books balanced 4-line journal entry: <code>Dr 1010 Cash / Cr 4000 Revenue</code> and <code>Dr 5000 COGS / Cr 1200 Inventory</code> at exact live WAC.</td>
            </tr>
            <tr>
              <td><code>corporate_charter.wasm</code></td>
              <td>Verifies <code>ROLE_PRODUCT_MANAGER</code> permissions and pins the authorized <code>ProductLedger</code> module hash.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Guaranteed Per-Checkout Invariants</h4>
            <ul>
              <li><strong>Zero Negative Stock / Zero Orphan Payments:</strong> Either stock decrements, cash settles, and GL balances update together—or all three revert untouched.</li>
              <li><strong>Instant Cross-App Statement Sync:</strong> Buying any SKU here immediately updates Revenue, Gross Margin, Cash, Inventory, and Intrinsic Valuation (<code>V*</code>) on <code>/accounting.html</code>!</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Click <strong>Buy Now</strong> on any in-stock SKU, expand the plain-English 4-line GL receipt, then open <strong>IFRS Ledger</strong> to see your exact journal entry reflected on the live Balance Sheet &amp; P&amp;L.</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  accounting: {
    id: 'accounting',
    icon: '📒',
    title: 'IFRS & Confidential Ledger — HFS Architecture & Primitives',
    href: '/accounting.html',
    tagline:
      'How IAS/IFRS financial statements, treasury custody, and confidential payroll/defense sub-ledgers moved out of mutable ERP APIs into zero-knowledge homomorphic Halt-Free Subroutines on Layer 1.',
    featurePills: [
      { label: 'IAS/IFRS Double-Entry HFS', tone: 'cyan' },
      { label: 'Homomorphic ElGamal Sub-Ledgers', tone: 'violet' },
      { label: 'u24 ZK Range + DLEQ Sum Proofs', tone: 'emerald' },
      { label: 'IAS 24 ZK Non-Insider Proofs', tone: 'rose' },
      { label: 'Shielded Note Pool + Nullifiers', tone: 'amber' },
      { label: '$0-Gas Stealth Ephemeral EOAs', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Ending Creative Accounting &amp; ERP Fraud—Without Exposing Private Salaries or Contracts</div>
          <p>
            Conventional ERP systems (SAP, Oracle, NetSuite) sit behind corporate APIs where executives can post manual top-side journal overrides, book fictitious related-party revenue (Enron/Wirecard/Luckin-style fraud), or leave bank cash disconnected from ledger balances—yet putting raw accounting in plaintext on a public blockchain would leak every employee’s salary and every defense client’s pricing.
            SuperLexicon solves <strong>both halves simultaneously on Layer 1</strong> (zero Layer-2 sequencers!): <code>accounting_ledger.wasm</code> hard-codes IAS/IFRS conservation laws and Virgin Treasury custody, while <code>confidential_ledger.wasm</code> + <code>asset_ledger.wasm</code> enforce <strong>zero-knowledge homomorphic sub-ledger consolidation, stealth counterparty co-signing, and ` +
        '`IAS 24`' +
        ` insider non-membership proofs</strong>.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Accounting Threat</th>
              <th>Vulnerable Conventional ERP / Plaintext Chain</th>
              <th>SuperLexicon Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Unbalanced / Fake Cash Entries</strong></td>
              <td>ERP admin posts <code>Dr Cash / Cr Revenue</code> without real bank funds existing.</td>
              <td><code>IAS 1</code> (<code>Assets ≡ Liab + Eq</code>) &amp; <code>IAS 7</code> (<code>AssetLedger.balanceOf(VirginTreasury) ≡ 1010 + Suspense</code>) checked on every state transition!</td>
            </tr>
            <tr>
              <td><strong>Related-Party Wash Revenue</strong></td>
              <td>Insiders sign fake B2B contracts with shell affiliates to inflate revenue &amp; valuation.</td>
              <td>Every B2B receivable requires bilateral co-signing; stealth contracts verify an on-chain <code>IAS 24</code> ZK ring/non-insider proof against all Charter directors/officers!</td>
            </tr>
            <tr>
              <td><strong>Salary &amp; Pricing Confidentiality</strong></td>
              <td>Plaintext ledgers expose individual payslips &amp; contract rates to competitors; L2s sacrifice decentralization.</td>
              <td>L1 Homomorphic ElGamal commitments + <code>≥ 4</code>-slot dummy padding + DLEQ sum proofs keep individual lines encrypted while proving the exact public GL total!</td>
            </tr>
            <tr>
              <td><strong>Payout Linkability</strong></td>
              <td>Paying employees directly on-chain links corporate payroll to personal wallets.</td>
              <td><code>AssetLedger</code> Shielded Note Pool lets recipients withdraw or split notes via <code>$0</code>-gas disposable EOAs using ZK nullifiers &amp; <code>u24</code> range proofs.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🔐 Homomorphic ElGamal + <code>u24</code> Range &amp; DLEQ Sum Proofs</h4>
            <p>Each confidential payroll or B2B line is committed on L1 as <code>C_i = Enc(v_i; r_i)</code> over <code>Edwards25519</code> with a native 24-bit ZK range proof (<code>host_he_verify_range_u24</code>, proving <code>0 ≤ v_i &lt; 2^{24}</code>) and padded to <code>≥ 4</code> slots with zero-value commitments so headcount/deal size never leaks. <code>host_he_add_ciphertexts</code> + <code>host_he_verify_sum_dleq</code> prove <code>∑ v_i == PublicGLTotal</code>.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🕵️ Stealth Co-Signing &amp; <code>IAS 24</code> Non-Insider ZK Proofs</h4>
            <p>Enterprise/defense clients co-sign confidential receivables from fresh <code>$0</code>-gas ephemeral EOAs via <code>verify_ed25519_schnorr</code> on a blinded public key while <code>verify_stealth_non_insider</code> proves in zero knowledge that the signer’s identity is disjoint from the company’s <code>CorporateCharter</code> insider public-key set.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>💵 Shielded Note Pool, ZK Nullifiers &amp; Change Notes</h4>
            <p>Settled confidential payroll/vendor batches fund encrypted notes inside <code>asset_ledger.wasm</code>. Recipients redeem full or partial SGD via <code>spendOrRedeemShieldedNote</code>—verifying a deterministic nullifier, ownership Schnorr proof, and <code>u24</code> range proof on any shielded change note.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔍 Scoped HKDF External Auditor Viewing Subkeys</h4>
            <p>By Board Resolution, officers can grant an external auditor a scoped viewing subkey <code>K_{epoch, category, period}</code> wrapped to the auditor’s <code>secp256k1</code> key—unlocking <em>only</em> that exact category &amp; fiscal period without exposing other departments or epochs.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified IFRS &amp; Cryptographic Responsibility</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>accounting_ledger.wasm</code></td>
              <td>Enforces 24-account IFRS Chart of Accounts, <code>IAS 2</code> WAC inventory, <code>IAS 16/38</code> depreciation/amortization, <code>IFRS 15</code> milestones, <code>IFRS 16</code> ROU leases, <code>IFRS 9</code> ECL, dividend profit caps, and Virgin Treasury custody.</td>
            </tr>
            <tr>
              <td><code>confidential_ledger.wasm</code></td>
              <td>Verifies <code>Edwards25519</code> homomorphic commitments, <code>u24</code> range proofs, <code>≥ 4</code>-slot dummy padding, DLEQ sum conservation, stealth Schnorr co-signatures, and <code>IAS 24</code> non-insider proofs before posting aggregate GL totals.</td>
            </tr>
            <tr>
              <td><code>asset_ledger.wasm</code></td>
              <td>Holds Virgin Treasury <code>SGD-FIAT</code> custody AND operates the ZK Shielded Note Pool (mint, nullifier spend, partial-redemption change notes, and lump-sum receivable sweeps).</td>
            </tr>
            <tr>
              <td><code>corporate_charter.wasm</code> &amp; <code>authorization.wasm</code></td>
              <td>Govern officer roles, Audit Epoch public key rotation, scoped auditor subkey grants, and multi-director B2B contract ratifications.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Unbreakable Layer-1 Accounting Laws</h4>
            <ul>
              <li><strong>Zero Creative Overrides:</strong> No raw <code>setBalance</code> or arbitrary unbalanced journal entrypoint exists in <code>accounting_ledger.wasm</code>.</li>
              <li><strong>100% L1 Validity (Zero L2 Rollup Risk):</strong> "Category Roll-Up" here means IFRS sub-ledger consolidation verified synchronously on Layer 1—zero off-chain sequencers or 7-day dispute delays.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Open the <strong>🔒 Confidential</strong> tab: your browser independently re-verifies every batch’s Edwards25519 ElGamal sum &amp; Chaum-Pedersen DLEQ proof client-side!</li>
              <li>Click <strong>🔬 Diagnostics → Verify On-Chain Parity</strong> to cross-check streamed statements against raw contract storage &amp; Virgin Treasury bank cash.</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  social: {
    id: 'social',
    icon: '📡',
    title: 'CommonsRF Social Guild — HFS Architecture & Primitives',
    href: '/social.html',
    tagline:
      'How community identity, Sybil resistance, DMs, feeds, and local storefronts moved out of surveillance ad-tech APIs into radio-range-grounded Halt-Free Subroutines.',
    featurePills: [
      { label: 'Semtech LR2021 Dual-Band RF', tone: 'emerald' },
      { label: 'Physical-Encounter Commits', tone: 'cyan' },
      { label: 'Stake-Free Trust & Voucher Slashing', tone: 'amber' },
      { label: '6-Module code_hash Pinning', tone: 'indigo' },
      { label: 'ECIES + AES-256-GCM Channels', tone: 'emerald' },
      { label: 'Pedersen-VSS Shamir Recovery', tone: 'violet' },
      { label: 'Zero ISP / Zero Cloud Servers', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Replacing Cloud Social APIs, Bot Farms &amp; Plutocratic Token Gates</div>
          <p>
            Web2 social platforms (X, Meta, Discord) trap social graphs inside centralized cloud APIs that harvest private messages, shadowban arbitrarily, and still drown in AI Sybil bot farms—while Web3 social protocols often replace bots with plutocratic "pay-to-post" token fees.
            CommonsRF moves identity standing, friendship handshakes, vouching accountability, lounges, events, and citizen storefronts into a <strong>6-module Halt-Free Subroutine suite anchored to physical Semtech ` +
        '`LR2021`' +
        ` Sub-GHz + 2.4 GHz radio-mesh proximity</strong>—operating at <code>$0.00</code> gas even with zero internet or cellular ISPs!
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Social Mechanism</th>
              <th>Vulnerable Web2 API / Tokenized Social</th>
              <th>CommonsRF Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Sybil &amp; Remote Bot Resistance</strong></td>
              <td>CAPTCHAs &amp; SMS checks are bypassed by AI farms; KYC leaks passports to cloud honeypots.</td>
              <td>Mutual RF encounter commits + stake-free vouching where <code>SocialCharter</code> slashes a voucher <code>-18 Trust</code> if their invitee spams!</td>
            </tr>
            <tr>
              <td><strong>Social Graph Portability</strong></td>
              <td>Platform owns your followers; an API key revocation erases your audience &amp; storefront overnight.</td>
              <td>User-owned <code>identity.wasm</code> &amp; <code>social_relationships.wasm</code> shared natively across CommonsRF, Phantom Fleet, DEX, and Commerce.</td>
            </tr>
            <tr>
              <td><strong>Moderation &amp; Governance</strong></td>
              <td>Opaque trust-and-safety API flags with zero auditability or due process.</td>
              <td>Transparent on-chain <code>SocialCharter</code> presence leases, trust thresholds, and deterministic community rules verified by all nodes.</td>
            </tr>
            <tr>
              <td><strong>Local Messaging &amp; Commerce</strong></td>
              <td>Requires AWS servers, cloud push gateways, and 30% app-store/platform cuts.</td>
              <td>Direct edge-node <code>messaging.wasm</code> channels + <code>0%</code>-fee citizen <code>product_ledger.wasm</code> storefronts over local RF mesh.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>📡 Physical-Proximity RF Encounter Handshakes</h4>
            <p>When two Lexicon devices meet in physical Semtech <code>LR2021</code> radio range (Sub-GHz / 2.4 GHz), they exchange ephemeral encounter nonces and submit deterministic <code>keccak256</code> encounter commits (<code>computeEncounterCommit</code>) to <code>social_relationships.wasm</code>—proving real-world co-presence without GPS tracking.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>⚖️ Stake-Free Trust Physics &amp; Voucher Slashing</h4>
            <p><code>social_charter.wasm</code> replaces financial stake with social accountability: citizens earn Trust through genuine presence leases and mutual encounters, and vouching for a bad actor triggers automatic on-chain <code>-18</code> Trust slashing on the voucher—bounding Sybil amplification mathematically.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔐 ECIES + <code>AES-256-GCM</code> Multi-Topic Channels &amp; Rolling Epoch Keys</h4>
            <p><code>messaging.wasm</code> v2 deduplicates <code>1:1</code> and <code>M:N</code> channels by hashing the sorted concatenated <code>secp256k1</code> public keys (<code>SLX_ECIES_PK_ROSTER_V1</code>), automatically reuses existing channels to add new Sub-Topics, links bidirectionally with <code>identity.wasm</code> for zero-indexer self-discovery, and enforces pre-join/post-leave secrecy via rolling <code>AES-256-GCM</code> epoch keys.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🛡️ Multi-Device <code>Identity</code> v4 &amp; Pedersen-VSS Blinded Shamir Recovery</h4>
            <p>Each citizen’s <code>identity.wasm</code> v4 supports multiple self-managed device keypairs (with ECIES-wrapped encryption seeds), <code>N</code>-capped <code>GuardianKeychain</code> blast-radius sharding, and <code>2-of-3</code> Pedersen-VSS Shamir recovery where a Stateless Biometric Oracle submits a <code>416 B</code> ECDH-blinded Schnorr proof—never seeing or storing your key.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🧬 6-Subroutine <code>code_hash</code> Constitutional Pinning</h4>
            <p><code>SocialCharter</code> pins the exact WASM bytecode hashes of <code>IdentityRegistry</code>, <code>SocialRelationships</code>, <code>SocialFeed</code>, <code>SocialEvents</code>, and <code>Messaging</code> via <code>host_get_code_hash</code> so no module can spoof relationship or trust state.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Guild &amp; Community Invariant</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>social_charter.wasm</code></td>
              <td>Enforces presence leases, Trust score bounds, vouching eligibility, and automatic <code>-18</code> voucher slashing on norm violations.</td>
            </tr>
            <tr>
              <td><code>social_relationships.wasm</code></td>
              <td>Verifies bilateral RF encounter commits, mutual friendship state, and block/mute boundaries.</td>
            </tr>
            <tr>
              <td><code>messaging.wasm</code></td>
              <td>Block-indexed, bounded-payload guild lounges and peer-to-peer direct message channels shared across all Subnet 1 apps.</td>
            </tr>
            <tr>
              <td><code>social_feed.wasm</code> &amp; <code>social_events.wasm</code></td>
              <td>Trust-gated community broadcasts, reactions, and physical neighborhood gathering RSVPs.</td>
            </tr>
            <tr>
              <td><code>product_ledger.wasm</code></td>
              <td>Sovereign citizen micro-storefronts settled directly in <code>SGD-FIAT</code> against <code>AssetLedger</code>.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Sovereign Social Guarantees</h4>
            <ul>
              <li><strong>Zero Cloud Dependency:</strong> Operates identically over local LAN/RF mesh validators with zero external internet connectivity.</li>
              <li><strong>Cross-App Portable Graph:</strong> Friends and DMs established here appear automatically in the top-right <strong>👥 Network</strong> &amp; <strong>💬 Messages</strong> pills of every SuperLexicon app!</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Run the <strong>1-Click Guided Thesis Scenarios</strong> at the top of CommonsRF to watch live RF handshakes, Trust vouching, spam isolation, and citizen storefront purchases confirm on-chain.</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  battleship: {
    id: 'battleship',
    icon: '⚓',
    title: 'Phantom Fleet (100p Naval) — HFS Architecture & Primitives',
    href: '/battleship.html',
    tagline:
      'How a real-time 100-player tactical naval game, spatial hit detection, and upgrade economy moved out of studio game servers into a deterministic Halt-Free Subroutine.',
    featurePills: [
      { label: '100-Player Real-Time L1 WASM', tone: 'cyan' },
      { label: 'Dynamic 16:10 Ocean Scaling', tone: 'sky' },
      { label: 'Bounded Spatial Ballistics', tone: 'amber' },
      { label: 'Anti-Dodge Harbor Tow Timer', tone: 'emerald' },
      { label: '$0.00-Gas Per-Move / Per-Shot', tone: 'emerald' },
      { label: 'On-Chain Squadron Radio (Messaging)', tone: 'violet' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Eliminating Centralized Game Servers, Studio Shutdowns &amp; Aimbot/Admin Exploits</div>
          <p>
            Traditional multiplayer games run physics, cooldowns, and currency ledgers on proprietary AWS game servers—meaning studios can shut the game down forever, server admins can spawn items silently, DDoS attacks freeze matches, and players have zero proof that hit registration or matchmaking is fair.
            Phantom Fleet codifies the <strong>entire 50v50 naval battlefield, 5 ship hull classes, 5 multi-tile AoE weapon patterns, 8-way throttle movement, harbor drydocking, and ` +
        '`CR`' +
        ` combat economy inside ` +
        '`battleship.wasm`' +
        `</strong> on Layer 1.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Game Subsystem</th>
              <th>Vulnerable Web2 Game Server API</th>
              <th>Phantom Fleet Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Movement &amp; Range Validation</strong></td>
              <td>Client-authoritative netcode allows speedhacks/teleports; server netcode hides tick logic.</td>
              <td><code>battleship.wasm</code> enforces exact Euclidean/Chebyshev speed rings, 90° hull rotation collisions, and island/harbor boundaries on every move.</td>
            </tr>
            <tr>
              <td><strong>Hit Registration &amp; Bounties</strong></td>
              <td>Opaque server hitboxes &amp; mutable player currency tables in Redis/Postgres.</td>
              <td>Deterministic multi-square salvos destroy exact hull bitmasks, credit <code>+120 CR</code> per square + kill bounties, and update leaderboards atomically.</td>
            </tr>
            <tr>
              <td><strong>Safe Logout / Combat Logging</strong></td>
              <td>Players pull the plug mid-fight ("combat logging") to avoid losing ships.</td>
              <td><code>Return to Base</code> enforces a 3-block Out-of-Combat Tow state machine that cancels automatically if hit while towing!</td>
            </tr>
            <tr>
              <td><strong>Microtransaction / Gas Friction</strong></td>
              <td>EVM on-chain games fail because paying $0.05–$2.00 per click ruins real-time play.</td>
              <td><code>$0.00</code>-gas L1 transactions + ~4s BFT finality deliver arcade-responsive tactics directly on Layer 1.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🌊 Density-Adaptive Ocean Scaling (<code>40×25</code> → <code>189×118</code>)</h4>
            <p><code>battleship.wasm</code> dynamically scales the 16:10 ocean coordinate bounds as up to 100 Red and Blue captains deploy or drydock—keeping engagement density balanced whether 4 captains or 100 captains are at sea.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🎯 Bounded-Loop Bitmask Hull &amp; AoE Salvo Engine</h4>
            <p>Each warship’s multi-square hull integrity is tracked as a compact bitmask; Railgun line-piercing, Howitzer cross-patterns, Torpedo spreads, and Plasma clusters resolve in fixed-bound integer loops with deterministic fuel cost.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔗 Ordered Multi-Action Turn Chaining (<code>lowerBoundHash</code>)</h4>
            <p>Captains (and autonomous <code>[SIM-BOT]</code> admirals) can chain <code>buyShip → upgradeGun → move → fire</code> in the exact same block window using cryptographically ordered <code>lowerBoundHash</code> transactions.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>📻 Integrated <code>FleetSocial</code> Tactical Comms</h4>
            <p>Composes directly with <code>identity.wasm</code> and <code>messaging.wasm</code> for real-time Bridge Broadcasts, Red/Blue Squadron encrypted-channel coordination, and cross-app captain callsigns.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Naval &amp; Social Role</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>battleship.wasm</code></td>
              <td>Authoritative 100-captain arena state, team auto-balancing, 3-slot squadron spatial map, AoE weapon ballistics, Harbor Tow state machine, and <code>CR</code> upgrade economy.</td>
            </tr>
            <tr>
              <td><code>identity.wasm</code></td>
              <td>Persistent captain callsign (<code>handle</code>/<code>nickname</code>) and cross-arena reputation shared across the entire Subnet 1 ecosystem.</td>
            </tr>
            <tr>
              <td><code>messaging.wasm</code> &amp; <code>social_relationships.wasm</code></td>
              <td>Power live Open Bridge &amp; Team Squadron tactical radio channels plus 1-click friend handshakes with fellow commanders.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Eternal Permissionless Playability</h4>
            <ul>
              <li><strong>Unstoppable Arenas:</strong> Anyone can deploy a fresh naval arena via the top-left HFS dropdown in 2 blocks—no central matchmaker or server binary required.</li>
              <li><strong>100% Auditable Combat Telemetry:</strong> Every <code>ShipMoved</code>, <code>SalvoFired</code>, and <code>ShipSunk</code> event is permanently verifiable in block receipts.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Watch the 14 autonomous <code>[SIM-BOT]</code> commanders maneuver and exchange salvos live on the canvas, or deploy your 3-ship squadron and inspect every move/shot receipt in <strong>📜 Txs</strong>!</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  hegemony: {
    id: 'hegemony',
    icon: '⬢',
    title: 'Fractured Hegemony — HFS Architecture & Primitives',
    href: '/hegemony.html',
    tagline:
      'How simultaneous-epoch grand strategy, 36-sector border clashes, and binding diplomatic treaties moved out of turn-biased game servers into a Halt-Free Subroutine.',
    featurePills: [
      { label: 'Simultaneous-Epoch Resolution', tone: 'cyan' },
      { label: 'Zero First-Mover Turn Bias', tone: 'emerald' },
      { label: 'Binding On-Chain Treaty Oaths', tone: 'amber' },
      { label: 'Deterministic Multi-Front Attrition', tone: 'indigo' },
      { label: 'Permissionless AFK Liveness', tone: 'violet' },
      { label: '$0.00-Gas Grand Strategy', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Eliminating Sequential Turn Bias, Server Manipulation &amp; Unenforceable Diplomacy</div>
          <p>
            Classic digital strategy games (Risk/Diplomacy/4X servers) suffer from two structural flaws: centralized matchmaking servers can stall or manipulate state, and sequential turn order gives Seat #1 a massive mathematical first-strike advantage.
            Fractured Hegemony codifies a <strong>simultaneous-epoch 36-territory world map, 6 Continental Confederations, 3 Aether Warp Relays, multi-front clash resolution, and binding Non-Aggression Compacts inside ` +
        '`hegemony.wasm`' +
        `</strong>.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Strategy Mechanic</th>
              <th>Vulnerable Web2 Turn Server</th>
              <th>Fractured Hegemony Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Turn Fairness</strong></td>
              <td>Sequential turns let early seats snowball before later seats ever act.</td>
              <td><strong>Simultaneous Epoch Window:</strong> all 6 Sovereigns submit reinforcements &amp; Vector Strikes in the same cycle; <code>resolveEpoch</code> executes everyone simultaneously!</td>
            </tr>
            <tr>
              <td><strong>Border Clash &amp; Pincer Math</strong></td>
              <td>Hidden RNG dice rolls on a remote server cause frustrating luck swings &amp; distrust.</td>
              <td>100% deterministic simultaneous attrition &amp; head-to-head border collision formulas over canonical adjacency bitmasks.</td>
            </tr>
            <tr>
              <td><strong>Diplomatic Treaties</strong></td>
              <td>Verbal chat truces carry zero mechanical consequence when broken.</td>
              <td>On-chain bilateral <strong>Non-Aggression Compacts</strong> automatically trigger <code>OathBroken</code> standing penalties &amp; garrison morale shocks upon betrayal!</td>
            </tr>
            <tr>
              <td><strong>AFK / Stall Griefing</strong></td>
              <td>One disconnected player freezes a 6-player lobby indefinitely.</td>
              <td>Block-height epoch deadlines allow <em>any</em> participant to advance the cycle permissionlessly once the window expires.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>⚡ Simultaneous Multi-Sovereign Directive Batching</h4>
            <p>Each Sovereign packs all territory reinforcement allocations and multi-vector invasion orders into a single atomic <code>commitDirectives</code> transaction per epoch—eliminating click-race latency advantages.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🗺️ Constant-Time Bitmask Graph &amp; Warp Topology</h4>
            <p>All 36 global sectors, 6 Continental Confederation bonus masks, and 3 trans-oceanic Aether Relay links are encoded as compile-time 64-bit adjacency bitmasks—guaranteeing <code>O(1)</code> reachability checks and bounded-fuel epoch resolution.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>📜 Cryptographic Bilateral Treaty State Machine</h4>
            <p>Treaty proposals and ratifications require dual Sovereign signatures recorded in <code>hegemony.wasm</code>; attacking a treaty partner during an active compact deterministically executes the codified <code>OathBroken</code> penalty.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🤖 Seamless Human + Autonomous Sovereign Co-Play</h4>
            <p>Open seats can be claimed by humans or filled on-chain by autonomous <code>[SIM-BOT]</code> Sovereigns signing real L1 transactions under the exact same contract rules—zero server-side bot cheats.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Geopolitical Invariant</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>hegemony.wasm</code></td>
              <td>Enforces 6-Sovereign enrollment, continental income calculation, simultaneous reinforcement + multi-front combat resolution, bilateral treaty oaths, and 24-sector / elimination victory conditions.</td>
            </tr>
            <tr>
              <td><code>identity.wasm</code> &amp; <code>hfs_registry.wasm</code></td>
              <td>Bind Sovereign handles/profiles across realms and verify canonical <code>FRACTURED_HEGEMONY</code> bytecode hashes.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Provably Fair Grand Strategy</h4>
            <ul>
              <li><strong>Zero Hidden Dice / Zero Turn Bias:</strong> Given the 6 Sovereigns’ committed epoch directives, every validator computes the exact same post-epoch world map.</li>
              <li><strong>Permissionless Realm Spawning:</strong> Launch a private or public 36-sector world anytime from the top-left HFS dropdown.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Observe live cycle resolutions on <strong>Riskk Europa Command #1</strong> or <strong>Catanz Boreal Blitz #2</strong>, inspect the Battle &amp; Treaty Chronicle, and verify every Sovereign’s <code>commitDirectives</code> tx in <strong>📜 Txs</strong>!</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  'cipher-noir': {
    id: 'cipher-noir',
    icon: '🔐',
    title: 'Cipher Noir — Arbiter-Free Zero-Knowledge HFS Architecture',
    href: '/cipher-noir.html',
    tagline:
      'How a hidden-information deduction game eliminated the trusted dealer/server completely using zero-trusted-setup Bulletproofs R1CS, Threshold ElGamal Co-Shuffles, and DDH-blinded hands.',
    featurePills: [
      { label: 'Bulletproofs Sparse R1CS (0 Setup)', tone: 'rose' },
      { label: '2-Party Threshold ElGamal Co-Shuffle', tone: 'violet' },
      { label: 'DDH-Blinded Quorum Hand Deal', tone: 'cyan' },
      { label: '1-of-3 Disjunctive ZK Whispers', tone: 'emerald' },
      { label: '2-Party Co-Blinded 1-Bit Vault Check', tone: 'amber' },
      { label: '100% Arbiter-Free (0 Trusted Keys)', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Solving "Mental Poker" Without Any Game Server, Dealer, or Trusted Setup</div>
          <p>
            Hidden-information games (Clue/Cluedo, poker, sabotage deduction) are notoriously hard to decentralize: in Web2 (or naive Web3 with an "Arbiter" bot), a server deals the secret solution and sees everyone’s cards, AND a modified client could cheat by claiming <em>"I don’t hold any of those 3 cards!"</em> when probed. Even zkSNARKs (Groth16) require a ceremony with toxic-waste trapdoors.
            Cipher Noir achieves <strong>100% Arbiter-Free, Zero-Trusted-Setup cryptographic perfection inside ` +
        '`cipher-noir.wasm`' +
        ` + ` +
        '`vrf_beacon.wasm`' +
        `</strong>: <strong>nobody on Earth—not any player, bot, or individual validator—knows the 3 Case Vault dossiers</strong>, and lying on an Alibi Check or Whisper is algebraically impossible!
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Deduction Vulnerability</th>
              <th>Vulnerable Server / Trusted-Arbiter Design</th>
              <th>Cipher Noir Zero-Knowledge HFS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Who Knows the 3 Vault Cards?</strong></td>
              <td>Game server or Arbiter EOA deals the deck and knows the secret solution from turn 0.</td>
              <td><strong>Nobody!</strong> Two independent parties co-shuffle <code>5+5+8</code> ElGamal sub-decks under the 5-validator DKG key; 3 Vault ciphertexts stay sealed on-chain.</td>
            </tr>
            <tr>
              <td><strong>Private Hand Delivery</strong></td>
              <td>Server sends plaintext cards over TLS (or validators see decrypted cards if unblinded).</td>
              <td><strong>DDH Blinding:</strong> <code>cipher-noir.wasm</code> adds each seat’s secret <code>U_{s,k}</code> before threshold decryption, then computes Pedersen commitments <code>V_{s,k}</code> on-chain in 0 extra txs!</td>
            </tr>
            <tr>
              <td><strong>False "Pass" Cheating</strong></td>
              <td>A hacked client clicks "Pass" even while holding one of the 3 probed cards.</td>
              <td><code>passAlibiCheck</code> verifies a <code>672 B</code> <strong>16-gate Bulletproofs R1CS proof</strong> (<code>∏(c_k - p_m)·inv = 1</code>) against <code>V_{s,0..2}</code>—if any <code>c_k == p_m</code>, the product is <code>0</code> (non-invertible mod <code>ℓ</code>)!</td>
            </tr>
            <tr>
              <td><strong>Fake Whisper / Partial Indictment Leak</strong></td>
              <td>Whispering a random card, or learning 2-of-3 Vault cards from a failed accusation.</td>
              <td><code>transmitAlibiProof</code> verifies a <code>352 B</code> <strong>1-of-3 Disjunctive ZK proof</strong>; <code>fileIndictment</code> uses <strong>2-party non-zero scalar co-blinding</strong> so wrong guesses leak <code>0 bits</code>!</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>⚡ Zero-Trusted-Setup <code>Bulletproofs</code> Sparse R1CS (<code>host_bp_verify_r1cs</code>)</h4>
            <p>Uses transparent nothing-up-my-sleeve <code>Edwards25519</code> generators and logarithmic Inner-Product Arguments (zero toxic waste!). Both the 2-challenge Grand-Product Deck Permutation proof (<code>∏(s_c - β) = ∏(α^{r+1} - β)</code>) and <code>passAlibiCheck</code> non-membership proof compile to compact <strong>16-gate R1CS circuits (<code>672 B</code> proof, <code>~129.5k</code> gas)</strong>!</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔀 2-Party Verifiable ElGamal Co-Shuffle + 15-Card Pool Shuffle</h4>
            <p>Shuffler #1 and an independent Co-Shuffler #2 permute &amp; re-randomize the <code>5</code> Operatives, <code>5</code> Exploits, and <code>8</code> Sectors (verified via Bulletproofs R1CS + Schwartz-Zippel ElGamal linear-combination Schnorr proofs). After sealing 1 card per category into the Vault, the remaining 15 cards undergo a cross-category <code>15×15</code> ZK shuffle so hand category counts stay hidden.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🕵️ DDH-Blinded Threshold Deal &amp; Homomorphic Pedersen Commitments</h4>
            <p>Each seat registers <code>(ed_pk, U_k = u_k B, T_k = u_k Y + w_k H_bp)</code> with Schnorr PoKs. Validators decrypt blinded <code>C'_1 = C_1 + U_k</code> to <code>M'_k = c_k B - u_k Y</code>; only the seat holder recovers <code>c_k B = M'_k + u_k Y</code>, while <code>cipher-noir.wasm</code> computes <code>V_{s,k} = M'_k + T_k = c_k B + w_k H_bp</code> directly on-chain!</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🤫 1-of-3 ZK Whispers &amp; 2-Party Co-Blinded 1-Bit Zero-Check</h4>
            <p>Whispers prove <code>V_{s,slot} ∈ {p_0, p_1, p_2}</code> and <code>(E_1, E_2)</code> encrypts that exact card to <code>prober.ed_pk</code> without revealing which of the 3 matched. Indictments fold <code>Δ_0 = ∑ z^j(Vault_j - g_j)</code> and multiply by two independent non-zero scalars <code>ρ_A, ρ_B ∈ ℤ_ℓ^*</code> before validator zero-check (<code>M == 𝒪</code>)—leaking strictly 1 bit (exact win vs. refuted).</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine / Host Engine</th>
              <th>Codified Cryptographic Tribunal Role</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>cipher-noir.wasm</code> (<code>51 KB</code>)</td>
              <td>Verifies seat DDH/Pedersen PoKs, 2-party 16-gate Bulletproofs R1CS deck shuffles, homomorphic <code>V_{s,k}</code> derivation, R1CS <code>passAlibiCheck</code>, 1-of-3 OR whispers, and 2-party co-blinded indictments.</td>
            </tr>
            <tr>
              <td><code>vrf_beacon.wasm</code> (<code>49 KB</code>)</td>
              <td>Provides active <code>4-of-5</code> validator DKG epoch public key <code>Y</code>, raw-point DDH-blinded hand decryption batches, and 1-bit identity-point zero-check (<code>max_val == 0</code>) indictment verification.</td>
            </tr>
            <tr>
              <td><code>WasmtimeAdapter</code> Native Precompiles</td>
              <td>Executes <code>host_bp_verify_r1cs</code>, <code>host_bp_verify_range_u64</code>, and <code>host_ec_elgamal_lincomb</code> deterministically in sub-millisecond native Rust.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Zero-Trust Cryptographic Soundness</h4>
            <ul>
              <li><strong>Zero Trusted Setup &amp; Zero Arbiter:</strong> Pure discrete-log hardness on <code>Edwards25519</code> + BFT validator threshold DKG.</li>
              <li><strong>Cheat-Proof by Algebra:</strong> Neither passing with a matching card, whispering an unheld card, self-co-shuffling, nor self-co-blinding an indictment can pass on-chain verification.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Claim a seat in <strong>Bletchley Park Tribunal #1</strong> (or spectate the 5 autonomous ZK bots on <strong>Zurych UBS Vault Case #2</strong>) and watch pure-JS <code>Bulletproofs</code> R1CS proofs generate in your browser in <code>~10 ms</code>!</li>
            </ul>
          </div>
        </div>
      `,
    },
  },

  lottery: {
    id: 'lottery',
    icon: '🎰',
    title: 'Quantum 4D Jackpot — Threshold ECVRF HFS Architecture',
    href: '/lottery.html',
    tagline:
      'How provably-fair random number generation, rolling jackpot custody, and multi-tier prize payouts moved out of opaque lottery servers & oracle subscriptions into Halt-Free Subroutines.',
    featurePills: [
      { label: 'Validator-Quorum Threshold ECVRF', tone: 'amber' },
      { label: 'Dealerless Edwards25519 DKG', tone: 'violet' },
      { label: 'Subset-Invariant Uniqueness', tone: 'emerald' },
      { label: 'Chaum-Pedersen DLEQ Share Proofs', tone: 'cyan' },
      { label: 'Virgin Jackpot Vault Custody', tone: 'indigo' },
      { label: 'Instant Atomic SGD-FIAT Payouts', tone: 'sky' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Eliminating Rigged RNG Servers, Blockhash Grinding &amp; Centralized VRF Oracles</div>
          <p>
            Web2 lotteries and online gaming APIs ask players to trust a private RNG server behind closed doors. On conventional blockchains, <code>block.timestamp</code> / <code>blockhash</code> randomness can be manipulated by block proposers ("last-revealer grinding"), while external VRF oracles (e.g. Chainlink VRF) re-introduce centralized single-operator keys, LINK fee subscriptions, and multi-block callback stalls.
            Quantum 4D Jackpot codifies <strong>consensus-native Validator-Quorum Threshold ECVRF (` +
        '`vrf_beacon.wasm`' +
        `) and rolling jackpot settlement (` +
        '`lottery.wasm`' +
        `) directly on Layer 1</strong>—making the winning <code>0000–9999</code> draw mathematically unpredictable before ticket close and 100% unbiasable afterward!
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Lottery Guarantee</th>
              <th>Vulnerable RNG API / Naive Blockhash</th>
              <th>Quantum 4D Halt-Free Subroutine (HFS)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Randomness Unpredictability</strong></td>
              <td>Server operator or single VRF oracle operator can pre-compute the draw before sales close.</td>
              <td>No single validator ever knows the DKG epoch secret <code>S</code>; <code>&gt; 2/3</code> BFT validators must co-evaluate <code>H(α)</code> <em>after</em> ticket sales freeze.</td>
            </tr>
            <tr>
              <td><strong>Anti-Grinding / Withholding</strong></td>
              <td>Commit-reveal &amp; blockhash schemes let the last revealer withhold their reveal to re-roll a losing draw.</td>
              <td><strong>Subset-Invariant Uniqueness:</strong> <em>every</em> <code>t</code>-of-<code>N</code> subset of validators Lagrange-interpolates to the <strong>exact same curve point <code>Γ = S · H(α)</code></strong>!</td>
            </tr>
            <tr>
              <td><strong>Jackpot Pool Solvency</strong></td>
              <td>House operator can raid jackpot reserves or delay winner withdrawals behind KYC/API tickets.</td>
              <td>100% of jackpot &amp; fixed-odds reserves sit in a keyless <strong>Virgin Vault <code>Identity</code></strong> (<code>owner == lottery.wasm</code>).</td>
            </tr>
            <tr>
              <td><strong>Prize Claim Friction</strong></td>
              <td>Winners must manually submit claim transactions before an expiry deadline or forfeit prizes.</td>
              <td><code>onRandomnessFulfilled</code> scans all round slips in a bounded loop and pushes <code>SGD-FIAT</code> prizes directly to every 4D/3D/2D/1D winner automatically!</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🎲 Dynamic Consensus Validator Quorum (<code>host_active_validators</code>)</h4>
            <p>Wasmtime reads the live <code>Full</code> validator set directly from consensus <code>GlobalAccountState</code> (sorted canonically by 32-byte Ed25519 public key) and enforces the BFT-safe supermajority threshold <code>t = ⌊2N/3⌋ + 1</code> (e.g. <code>4-of-5</code> on Subnet 1).</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🔑 Non-Interactive Dealerless DKG + Objective Fraud Proofs</h4>
            <p>Validators publish degree-<code>(t−1)</code> Feldman-Pedersen polynomial deals encrypted to peers (<code>host_vrf_verify_deal</code>), with objective on-chain Chaum-Pedersen DLEQ dispute verification (<code>host_vrf_verify_dispute</code>) and deterministic epoch key derivation (<code>host_vrf_derive_epoch_keys</code>).</p>
          </div>
          <div class="slx-ucd-card">
            <h4>✨ Chaum-Pedersen DLEQ VRF Shares &amp; Lagrange Combination</h4>
            <p>When <code>closeAndRequestDraw()</code> freezes the round’s <code>tickets_commitment</code> root into VRF input <code>α</code>, each validator submits <code>Γ_i = s_i · H(α)</code> + a 64-byte DLEQ proof verified via <code>host_vrf_verify_share</code>. Once <code>t</code> shares arrive, <code>host_vrf_lagrange_combine</code> computes <code>Γ = ∑ λ_i Γ_i</code> and hashes <code>Γ</code> to the canonical 32-byte random output.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>💰 Multi-Tier Atomic <code>SGD-FIAT</code> Distribution</h4>
            <p>Inside the VRF fulfillment callback, <code>lottery.wasm</code> derives the winning <code>0000–9999</code> number and synchronously transfers Exact 4D (<code>100%</code> Rolling Jackpot split equally among exact winners), 3D (<code>250 SGD</code>), 2D (<code>40 SGD</code>), and 1D (<code>15 SGD</code>) payouts from the Virgin Vault.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Halt-Free Subroutine</th>
              <th>Codified Randomness &amp; Settlement Invariant</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>lottery.wasm</code></td>
              <td>Manages round windows, ticket slip commitments, Virgin Vault reserve accounting, VRF draw requests, and bounded-loop automatic 4-tier prize distribution.</td>
            </tr>
            <tr>
              <td><code>vrf_beacon.wasm</code></td>
              <td>Manages autonomous validator DKG epochs, verifies partial VRF DLEQ shares, performs Lagrange interpolation, and invokes <code>onRandomnessFulfilled</code> atomically.</td>
            </tr>
            <tr>
              <td><code>asset_ledger.wasm</code> &amp; Virgin Vault <code>identity.wasm</code></td>
              <td>Hold 100% of rolling Grand Jackpot + Fixed-Odds Reserve <code>SGD-FIAT</code> under exclusive contract control.</td>
            </tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ Mathematically Provable Fairness</h4>
            <ul>
              <li><strong>Zero Selective Withholding:</strong> Whether validators <code>{1,2,3,4}</code> or <code>{2,3,4,5}</code> submit shares first, polynomial interpolation produces the exact same 4D number.</li>
              <li><strong>Ticket Root Binding:</strong> VRF input <code>α</code> commits to the frozen <code>tickets_commitment</code> hash—no ticket can be inserted after randomness begins.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 How to Verify Live Right Now</h4>
            <ul>
              <li>Click <strong>🔬 Verify VRF Proof</strong> on any settled draw in the right-hand <strong>Provably-Fair Draw History</strong> panel to run full RFC 8032 Edwards25519 DLEQ + Lagrange verification directly in your browser!</li>
            </ul>
          </div>
        </div>
      `,
    },
  },
  apps: {
    id: 'apps',
    icon: '🧩',
    title: 'HFS App Store & Directory — Zero-Backend, Zero-Database, Zero-EC2 Architecture',
    href: '/apps.html',
    tagline:
      'How full-stack applications publish and run directly from Halt-Free Subroutines and on-chain gzipped UI bundles—eliminating backend servers, cloud databases, EC2 instances, and web-client redeploys.',
    featurePills: [
      { label: 'Zero Backend Servers', tone: 'emerald' },
      { label: 'Zero Cloud Databases', tone: 'cyan' },
      { label: 'Zero EC2 / Docker VMs', tone: 'amber' },
      { label: 'keccak256 Gzip UI Bundles', tone: 'violet' },
      { label: 'Opaque Iframe Sandbox', tone: 'sky' },
      { label: '$0.00 Gas & $0/mo Hosting', tone: 'emerald' },
    ],
    tabs: {
      codification: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🛡️ Eliminating EC2 Instances, Cloud Databases, Backend APIs &amp; Frontend Redeploys</div>
          <p>
            Traditional web and Web3 apps still depend on a fragile, expensive cloud stack: AWS EC2 / Docker containers running Node/Go APIs, RDS / Postgres / Supabase databases storing mutable state, Auth0 / OAuth session servers, and Vercel / S3 / CloudFront CDNs that must be rebuilt and redeployed every time a new app ships.
            SuperLexicon’s <strong>HFS App Store &amp; Directory (<code>app_store.wasm</code>, HPS #27)</strong> stores both the <strong>deterministic backend logic (<code>.wasm</code> Halt-Free Subroutine)</strong> and the <strong><code>gzip</code>-compressed, <code>keccak256</code>-verified HTML/CSS/JS frontend bundle</strong> directly on Subnet 1—requiring <strong>no backend server, no database, and no EC2 instance</strong>.
          </p>
        </div>
        <table class="slx-ucd-table">
          <thead>
            <tr>
              <th>Legacy Cloud Layer</th>
              <th>What You Delete Forever</th>
              <th>SuperLexicon Zero-Infrastructure Replacement</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Compute / Backend API</strong></td>
              <td>AWS EC2, ECS, Kubernetes, Lambda, Nginx reverse proxies, API gateways &amp; DevOps on-call.</td>
              <td><strong>Halt-Free Subroutines (<code>.wasm</code>)</strong> executed deterministically by physical <code>LR2021</code> RF validators at <code>$0.00</code> gas (<code>108–169 TPS</code>).</td>
            </tr>
            <tr>
              <td><strong>Database &amp; Cache</strong></td>
              <td>Postgres, MySQL, RDS, MongoDB, Supabase, Redis, ORM migrations &amp; backup crons.</td>
              <td><strong>Rooted HFS WorldState (<code>host_state_get</code> / <code>host_state_set</code>)</strong>—atomic, tamper-proof key-value &amp; table storage replicated automatically across every validator.</td>
            </tr>
            <tr>
              <td><strong>Static Hosting &amp; CDN</strong></td>
              <td>Vercel, Netlify, S3 buckets, CloudFront invalidations, DNS expiry &amp; client redeploys.</td>
              <td><strong>Content-Addressed UI Bundles (<code>app_store.wasm</code>)</strong>—single-file HTML/CSS/JS compressed via <code>gzip</code> (<code>2–40 KiB</code>), verified by <code>keccak256</code>, and cached in browser <code>IndexedDB</code>.</td>
            </tr>
            <tr>
              <td><strong>Auth, Sessions &amp; Billing</strong></td>
              <td>Auth0, Clerk, JWT secrets, password resets &amp; siloed user tables per app.</td>
              <td><strong>Unified <code>Identity</code> HFS + <code>window.slx</code> Bridge</strong>—instant <code>&lt;Nickname&gt; · &lt;4-char&gt;</code> login, ECIES encryption, and native IFRS / <code>AssetLedger</code> settlement.</td>
            </tr>
          </tbody>
        </table>
      `,
      primitives: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>📦 Content-Addressed <code>gzip</code> UI Bundles</h4>
            <p>Because the Host Shell provides shared wallet, RLP, and RPC primitives once, app UIs compress 4×–6× via standard browser <code>CompressionStream('gzip')</code>. On upload, <code>app_store.wasm</code> reassembles up to 8×32 KiB chunks in Wasmtime and enforces <code>keccak256(bytes) == expectedUiHash</code> before sealing.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>📡 Over-the-Air Radio-2 Shard Sync</h4>
            <p>A <code>20 KiB</code> gzipped app bundle transfers across a <code>2.6 Mbps</code> Semtech <code>LR2021</code> FLRC radio link in ~65 milliseconds on Radio 2’s World-State Shard Carousel—meaning users can discover and run new apps even completely off-grid with zero internet.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🛡️ Opaque-Origin <code>&lt;iframe sandbox&gt;</code></h4>
            <p>Community-published apps execute inside <code>&lt;iframe sandbox="allow-scripts allow-forms"&gt;</code> (without <code>allow-same-origin</code>), isolating parent <code>localStorage</code> and <code>secp256k1</code> private keys while bridging RPC reads and user-approved <code>Identity</code> transactions via <code>window.slx</code>.</p>
          </div>
          <div class="slx-ucd-card">
            <h4>🪪 Slug Ownership &amp; firewall Whitelisting</h4>
            <p>Publishing binds each app slug to the creator’s on-chain <code>Identity</code> HFS (<code>ERR_SLUG_OWNED_BY_OTHER = -15</code> prevents hijacking), while users’ <code>Identity</code> Subroutine Firewalls automatically block any <code>State = 3 (Spam)</code> contract.</p>
          </div>
        </div>
      `,
      topology: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Component</th><th>Role in Zero-Server App Execution</th></tr>
          </thead>
          <tbody>
            <tr><td><code>app_store.wasm</code> (HPS #27)</td><td>Stores immutable <code>keccak256</code>-verified gzipped UI chunks, permissionless app listings, release counters, and <code>0x…</code> instance-to-UI bindings.</td></tr>
            <tr><td><code>BYTECODE_STORE</code> (<code>0x0100</code>)</td><td>Content-addressed L1 store holding each app’s compiled <code>.wasm</code> Halt-Free Subroutine bytecode once per subnet.</td></tr>
            <tr><td><code>identity.wasm</code></td><td>Authenticates app publishers on update and guards user transaction signing via the Host Wallet Confirmation Sheet.</td></tr>
            <tr><td><code>app-host-boot.js</code> &amp; <code>/apps.html</code></td><td>Universal Host Shell that resolves <code>uiHash</code>, verifies <code>keccak256</code> client-side, decompresses <code>gzip</code>, caches in <code>IndexedDB</code>, and mounts all 12 core apps + community apps dynamically.</td></tr>
          </tbody>
        </table>
      `,
      verification: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>✅ End-to-End Dual <code>keccak256</code> Verification</h4>
            <ul>
              <li><strong>On-Chain Seal:</strong> <code>uploadBundleChunk</code> reverts with <code>-34</code> unless the assembled chunks hash to <code>expectedUiHash</code>.</li>
              <li><strong>Client-Side Verify:</strong> <code>verifyAndUnpackAppUiBundle</code> recomputes <code>keccak256(bytes)</code> in your browser before decompressing or rendering a single byte of HTML.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 Verify Live on All 12 Core Apps</h4>
            <ul>
              <li>Every SuperLexicon use case (<code>/dex.html</code>, <code>/charter.html</code>, <code>/crowdfunding.html</code>, <code>/accounting.html</code>, etc.) now runs as a verified App Store UI bundle—check the bottom-left <code>🧩 UI 0x…</code> badge on any page!</li>
            </ul>
          </div>
        </div>
      `,
    },
  },
};

// ---------------------------------------------------------------------------
// 2. Standardized 4-Tab User Instructions (7 Non-Game-Guide Use Cases)
// ---------------------------------------------------------------------------

export const USECASE_INSTRUCTIONS = {
  dex: {
    id: 'dex',
    icon: '📈',
    title: 'DEX Central Limit Order Book — User Instructions',
    tagline:
      'Trade across 16 live Equity, Commodity, FX & Compute orderbooks with instant atomic settlement and $0.00 gas.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Trade institutional shares (<code>NVDAX-EQ</code>, <code>TSLAX-EQ</code>), commodities (<code>GSX-GOLD</code>, <code>ARMX-OIL</code>), and compute futures against <code>SGD-FIAT</code> on a live Layer-1 Central Limit Order Book.</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Select a Market &amp; Claim Test Funds</h4><p>Use the top-left <strong>DEX Market Dropdown</strong> to pick any of the 16 live CLOBs, then click the <strong>💧 +SGD</strong> or <strong>+Shares</strong> faucet buttons to fund your sovereign <code>Identity</code>.</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Submit a Limit Bid or Ask</h4><p>Choose <strong>Buy (Bid)</strong> or <strong>Sell (Ask)</strong>, click any resting orderbook level to pre-fill price (or type your own price &amp; quantity), and submit for <code>$0.00</code> gas.</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Watch Instant Fill or Cancel Anytime</h4><p>Crossing the spread settles Base &amp; Quote assets atomically in ~4s; resting orders sit in Virgin Escrow and can be cancelled in 1 click with <code>0</code> cancellation fees.</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🖱️ Orderbook &amp; Ticket Controls</h4>
            <ul>
              <li><strong>Market Switcher (Top-Left):</strong> Switch among all 16 live orderbooks or deploy a brand-new custom DEX pair.</li>
              <li><strong>Click-to-Fill Price:</strong> Click any row in the Asks or Bids ladder to copy its exact price into your order ticket.</li>
              <li><strong>Open Orders Panel:</strong> View your active resting orders and cancel any order instantly for <code>$0</code> gas.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>📊 Live Telemetry Indicators</h4>
            <ul>
              <li><strong>Spread &amp; Mid-Price Bar:</strong> Real-time best bid, best ask, and last matched print streamed via WebSocket.</li>
              <li><strong>HFT &amp; MEV Desk Badges:</strong> Identifies live autonomous institutional market-makers and arbitrage bots trading on-chain.</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Order Scenario</th><th>On-Chain Execution Behavior</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Resting Limit Order</strong></td><td>Locks exact Quote <code>SGD-FIAT</code> (Bid) or Base shares (Ask) in Virgin Escrow ordered by best price, then earliest block/sequence.</td></tr>
            <tr><td><strong>Marketable Limit Buy (<code>Bid ≥ Best Ask</code>)</strong></td><td>Fills immediately at the resting Ask’s better price and automatically refunds your price-improvement <code>SGD-FIAT</code> surplus!</td></tr>
            <tr><td><strong>Partial Fill</strong></td><td>Executes available liquidity immediately and leaves the unfilled remainder resting on the book at your limit price.</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Pro Tip — Cross-App Arbitrage with Live Intrinsic Valuation (<code>V*</code>):</strong> Open <code>/accounting.html</code> to check Nvidya Systems’ live fundamental fair value per share (<code>V*</code>), then trade mispricings against autonomous HFT desks right here on <code>NVDAX-EQ</code>!
        </div>
      `,
    },
  },

  charter: {
    id: 'charter',
    icon: '🏛️',
    title: 'CorporateCharter & Cap-Table — User Instructions',
    tagline:
      'Incorporate on-chain companies, ratify Board & Shareholder resolutions, run guided share auctions, and manage privacy audit keys.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Explore a live constitutional corporation (<strong>Nvidya Systems</strong> or <strong>Bostun Dynamix</strong>) or incorporate your own complete 7-contract company from scratch!</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Inspect or Incorporate a Company</h4><p>Browse the active company’s Cap Table, Board roster, and Legal Library—or click <strong>🏛️ + Incorporate New Company</strong> in the top-left dropdown to become Founder/CEO &amp; Director of your own company!</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Raise Capital or Trade Shares (ROFR)</h4><p>Use <strong>💰 Raise Capital (5-Step Issuance)</strong> or <strong>🔄 Buy &amp; Sell Shares (3-Step ROFR Auction)</strong> in Section 2 to run constitutional share auctions.</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Propose, Vote &amp; Execute Resolutions</h4><p>Open the <strong>Corporate Legal Library</strong> (Section 3) to draft resolutions, cast Director/Shareholder votes on <code>Authorization</code> contracts, and execute ratified actions.</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🧭 4-Section Workspace Layout</h4>
            <ul>
              <li><strong>Section 1 — Constitutional Overview &amp; Asset Classes:</strong> Active Charter status, Directors, Officers, Share Register &amp; ESOP terms.</li>
              <li><strong>Section 2 — Cap-Table &amp; Auction Actions:</strong> Guided Primary Share Issuance, ROFR Secondary Share Sales, Buybacks, Splits &amp; ESOP grants.</li>
              <li><strong>Section 3 — Corporate Legal Library:</strong> Clause-by-clause constitution viewer + live/historical Board &amp; Shareholder resolutions.</li>
              <li><strong>Section 4 — Connected HFS Modules &amp; Privacy Governance:</strong> Linked IFRS/Confidential ledgers, Audit Epoch key rotation, and scoped External Auditor subkey grants.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔑 Role-Gated Controls</h4>
            <ul>
              <li>Governance mutation buttons automatically unlock when your connected wallet owns a verified Director, Officer, or Shareholder <code>Identity</code> on the selected Charter.</li>
              <li>Want instant full Founder/Director authority? Incorporate a new company from the top-left dropdown in ~2 blocks!</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Governance Policy</th><th>On-Chain Quorum &amp; Enforcement</th></tr>
          </thead>
          <tbody>
            <tr><td><code>FIRST_SHAREHOLDER_RESOLUTION</code></td><td>Activates a virgin <code>CorporateCharter</code> and pins its initial Share, Bank, IFRS, and Confidential ledgers.</td></tr>
            <tr><td><code>BOARD_RESOLUTION</code></td><td>Requires threshold approval from consented <code>ROLE_DIRECTOR</code> identities bound to exact <code>ActionHasher</code> parameters.</td></tr>
            <tr><td><code>SHARE_ISSUANCE / TRANSFER_AUCTION</code></td><td>Enforces transparent multi-step bidding windows with statutory shareholder priority &amp; uniform clearing price.</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Pro Tip — Scoped External Auditor Keys:</strong> After incorporating your own company, try granting another Identity a scoped <code>(Epoch, Category, Period)</code> viewing key in the Privacy Audit Governance panel, then switch to <code>/accounting.html#confidential</code> to see selective zero-knowledge audit decryption in action!
        </div>
      `,
    },
  },

  ballot: {
    id: 'ballot',
    icon: '🗳️',
    title: 'CipherVote Secret Ballot — User Instructions',
    tagline:
      'Create civic or share-weighted encrypted polls, cast zero-knowledge 0/1 ballots, and verify validator-quorum tallies in your browser.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Cast an encrypted vote whose individual choice stays secret forever while your exact voting power is tallied homomorphically on Layer 1.</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Pick an Active Poll (or Open One)</h4><p>Select an open resolution from the right-hand poll list—or click <strong>➕ New Encrypted Poll</strong> in the header bar to launch a <code>1-Identity = 1-Vote</code> or <code>NVDAX-EQ Share-Weighted</code> poll.</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Select YES / NO / ABSTAIN &amp; Cast ZK Ballot</h4><p>Click your choice in the <strong>Zero-Knowledge Encrypted Voting Booth</strong> and submit. Your browser generates 3 Edwards25519 ElGamal ciphertexts + <code>640 B</code> of CDS <code>0/1</code> &amp; DLEQ proofs automatically.</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Close Window &amp; Audit Quorum Tally</h4><p>Once the block countdown finishes, click <strong>🔓 Close Poll &amp; Request Quorum Tally</strong>. Watch <code>&gt; 2/3</code> validators decrypt <em>only</em> the final totals, then click <strong>🔬 Verify Homomorphic Proof</strong>!</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🗳️ Voting Booth &amp; Header Actions</h4>
            <ul>
              <li><strong>➕ New Encrypted Poll:</strong> Locks the current validator DKG Epoch Public Key and opens a timed civic or shareholder poll.</li>
              <li><strong>Power Badge:</strong> Shows <code>1 Vote</code> in Civic mode or your live <code>NVDAX-EQ</code> share balance in Equity-Weighted mode.</li>
              <li><strong>🔓 Close Poll &amp; Request Quorum Tally:</strong> Appears automatically as soon as the voting block window expires.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 Live Cryptographic Audit</h4>
            <ul>
              <li><strong>Public Encrypted Ballot Box:</strong> Lists every voter’s compressed ciphertext &amp; verified ZK status without ever revealing how anyone voted.</li>
              <li><strong>🔬 Verify Homomorphic Proof:</strong> Re-sums all voter ciphertexts in pure browser JS and checks every validator’s Chaum-Pedersen DLEQ share!</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Weight Mode</th><th>Who Can Vote &amp; How Weight Is Applied</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>🪪 Mode 1 — Civic Referendum</strong></td><td>Any registered <code>Identity</code> casts weight <code>1</code> (<code>Enc([1,0,0])</code>, <code>Enc([0,1,0])</code>, or <code>Enc([0,0,1])</code>).</td></tr>
            <tr><td><strong>🏛️ Mode 2 — Equity Share-Weighted</strong></td><td>Shareholders holding <code>&gt; 0</code> shares on <code>AssetLedger</code> have their encrypted vector homomorphically scaled by <code>balanceOf(voter)</code> inside WASM!</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Need Shares for an Equity-Weighted Poll?</strong> Hop over to <code>/dex.html</code> (or claim a share grant on <code>NVDAX-EQ</code>) first—your new share balance immediately boosts your encrypted voting weight here on CipherVote!
        </div>
      `,
    },
  },

  commerce: {
    id: 'commerce',
    icon: '🛒',
    title: 'E-Commerce Storefront — User Instructions',
    tagline:
      'Shop live B2C & B2B hardware catalogs, inspect plain-English double-entry GL receipts, or launch your own merchant storefront.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Every purchase settles <code>SGD-FIAT</code>, deducts live warehouse stock, and posts a balanced 4-line IFRS Revenue &amp; COGS journal entry in one ~4s block.</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Top Up Test <code>SGD-FIAT</code></h4><p>Click <strong>💧 +25,000 SGD</strong> in the storefront bar so your sovereign <code>Identity</code> has purchasing power.</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Pick Quantity &amp; Click Buy Now</h4><p>Choose any in-stock hardware or software SKU, set your quantity, and click <strong>Buy Now</strong>.</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Inspect Live Double-Entry Receipt</h4><p>View the plain-English accounting translation (<code>Cash</code>, <code>Revenue</code>, <code>COGS</code>, and <code>WAC Inventory</code>) generated atomically by your checkout!</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🛍️ Storefront &amp; Merchant Controls</h4>
            <ul>
              <li><strong>Storefront Switcher (Top-Left):</strong> Switch between Nvidya Systems’ institutional catalog, citizen storefronts, or deploy your own <code>ProductLedger</code>.</li>
              <li><strong>SKU Manager (Authorized Product Managers / Owners):</strong> Add new SKUs, adjust unit pricing, or restock units directly on-chain.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>📖 Accounting Integration</h4>
            <ul>
              <li>Every completed order links directly to <code>/accounting.html</code> where you can watch Cash, Inventory, Revenue, and Gross Margin update in real time.</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Checkout Leg</th><th>On-Chain Ledger Entry</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>1. Customer Payment</strong></td><td><code>Dr 1010 Operating Bank Cash</code> / <code>Cr 4000 Product &amp; Service Revenue</code> (<code>qty × unitPrice</code> SGD).</td></tr>
            <tr><td><strong>2. Inventory Relief (IAS 2 WAC)</strong></td><td><code>Dr 5000 Cost of Goods Sold</code> / <code>Cr 1200 Merchandise Inventory</code> at live Weighted-Average Cost.</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Watch Live Autonomous Demand:</strong> Autonomous <code>[SIM-BOT]</code> retail &amp; B2B buyers place continuous storefront orders in the background—watch stock counts and company revenue climb block by block!
        </div>
      `,
    },
  },

  accounting: {
    id: 'accounting',
    icon: '📒',
    title: 'IFRS & Confidential Accounting — User Instructions',
    tagline:
      'Navigate live graphical Balance Sheets, P&L, Triangulated Valuation (V*), Plain-English Journals, and Zero-Knowledge Confidential Sub-Ledgers.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Explore real-time event-sourced IAS/IFRS financial statements alongside Layer-1 zero-knowledge confidential payroll &amp; defense contract sub-ledgers.</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Switch Workspace Views</h4><p>Use the workspace tab bar to explore <strong>📊 Financial Statements</strong>, <strong>📒 General Journal &amp; Human GL</strong>, <strong>💎 Valuation (<code>V*</code>)</strong>, <strong>🗂️ Contracts &amp; Ops</strong>, and <strong>🔒 Confidential</strong>.</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Trigger Live Business Events</h4><p>Click <strong>⚡ Crank Accruals</strong> in the top bar (or book a SaaS subscription / milestone in <strong>Contracts &amp; Ops</strong>) and watch kinetic <code>+SGD</code> deltas animate across the Balance Sheet &amp; P&amp;L!</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Inspect &amp; Verify Confidential Sub-Ledgers</h4><p>Open the <strong>🔒 Confidential</strong> tab to verify <code>Edwards25519</code> ZK payroll &amp; defense batches, or redeem/co-sign personal shielded notes &amp; stealth contracts via <code>$0</code>-gas ephemeral EOAs.</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🎛️ Top Bar &amp; Statement Controls</h4>
            <ul>
              <li><strong>Company Dropdown (Top-Left):</strong> Switch between <strong>Nvidya Systems</strong>, <strong>Bostun Dynamix</strong>, or any newly incorporated company.</li>
              <li><strong>⚡ FX: ON / OFF:</strong> Toggles kinetic number tweening and SVG sonar delta callouts on incoming WebSocket events.</li>
              <li><strong>🔬 Diagnostics:</strong> Opens the audit drawer with IAS 1 / IAS 7 / Virgin Treasury proof pills and 1-click <strong>Verify On-Chain Parity</strong>.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔒 Role-Adaptive Confidential View</h4>
            <ul>
              <li><strong>Public View:</strong> Verifies ZK range &amp; DLEQ sum proofs on aggregate totals while individual lines remain encrypted.</li>
              <li><strong>Employee / Stealth Client:</strong> Automatically decrypts <em>your</em> payslip notes &amp; stealth contracts locally and enables <code>$0</code>-gas ephemeral withdrawals/co-signs.</li>
              <li><strong>Finance Officer / Scoped Auditor:</strong> Unlocks authorized audit envelopes + Toggle <strong>👁️ Preview Public View</strong> anytime to compare!</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Workspace Tab</th><th>Key Capabilities</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>📊 Statements</strong></td><td>Proportional SVG Balance Sheet, Income Statement &amp; Cash Flows + multi-block trajectory chart.</td></tr>
            <tr><td><strong>📒 Journal &amp; Guide</strong></td><td>3-row scrollable Live General Journal (with Plain-English translator) + interactive double-entry scenario blueprints.</td></tr>
            <tr><td><strong>💎 Valuation (<code>V*</code>)</strong></td><td>Live Football-Field blending Residual Income (EBO), DCF, and Multiples vs. live DEX share price (<code>P*</code>) with WACC/growth sliders.</td></tr>
            <tr><td><strong>🔒 Confidential</strong></td><td>Homomorphic payroll &amp; defense category cards, personal shielded notes, 3-row scrollable verified batch/receivable feed &amp; officer booking studio.</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Try Full Officer Confidential Booking:</strong> Incorporate your own company on <code>/charter.html</code> (which makes your wallet Founder &amp; Finance Officer), then select it here in the top-left dropdown to compose confidential payroll batches, propose blinded stealth B2B contracts, and flush category epochs yourself!
        </div>
      `,
    },
  },

  social: {
    id: 'social',
    icon: '📡',
    title: 'CommonsRF Social Guild — User Instructions',
    tagline:
      'Establish mutual RF friendships, earn stake-free Trust, chat in guild lounges, RSVP to local events, and run citizen storefronts.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Experience physical-radio-grounded community networking with zero cloud servers, zero ads, and automatic spam isolation.</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Enroll Your Citizen Identity &amp; Presence Lease</h4><p>Connect or create your unified <code>Identity</code> handle and activate your <code>SocialCharter</code> presence lease (or run a <strong>1-Click Guided Scenario</strong> at the top of the page!).</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Complete a Mutual RF Handshake</h4><p>Simulate or broadcast a physical radio encounter with a nearby peer to establish a verified bilateral friendship in <code>SocialRelationships</code>.</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Post, Message &amp; Shop Citizen Storefronts</h4><p>Publish to the Trust-gated guild feed, chat in real-time lounges/DMs, RSVP to neighborhood events, or buy from citizen storefronts!</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🧭 Guild Navigation &amp; Guided Demos</h4>
            <ul>
              <li><strong>1-Click Guided Thesis Scenarios:</strong> Automated walkthroughs demonstrating RF friendship handshakes, Trust vouching, and <code>-18</code> voucher slashing against spammers.</li>
              <li><strong>Valid vs. Spam Filter:</strong> Shows how v2 <code>Identity</code> whitelist standing + <code>SocialCharter</code> Trust cleanly isolate unvouched spam bots.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>💬 Cross-App Social Pills (Top-Right Header)</h4>
            <ul>
              <li>Click <strong>👥 Network</strong> or <strong>💬 Messages</strong> in the top header bar of <em>any</em> SuperLexicon app to message your CommonsRF friends without leaving what you’re doing!</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>CommonsRF Mechanism</th><th>How It Works</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>RF Encounter Handshake</strong></td><td>Both peers commit a shared encounter nonce proving co-location within Semtech <code>LR2021</code> radio range.</td></tr>
            <tr><td><strong>Citizen Vouching &amp; Slashing</strong></td><td>High-Trust citizens can vouch newcomers; if the invitee violates charter norms, the voucher loses <code>-18 Trust</code> automatically.</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Launch Your Own Neighborhood Guild:</strong> Use the top-left <strong>SocialCharter Dropdown</strong> to deploy an independent 6-module community guild with its own constitution and lounges!
        </div>
      `,
    },
  },

  lottery: {
    id: 'lottery',
    icon: '🎰',
    title: 'Quantum 4D Jackpot — User Instructions',
    tagline:
      'Pick 4-digit numbers (0000–9999), win across 4 instant SGD-FIAT prize tiers, and audit validator-quorum ECVRF proofs in 1 click.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-hero">
          <div class="slx-ucd-hero-title">🚀 30-Second Quick-Start</div>
          <p>Play a provably-fair 4D draw every ~12 blocks (~48s) powered by Subnet 1’s <code>&gt; 2/3</code> BFT Validator-Quorum Threshold ECVRF.</p>
        </div>
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step"><span>STEP 1</span><h4>Claim Free Test <code>SGD-FIAT</code></h4><p>Click <strong>💧 +1,000 SGD Test Funds</strong> in the header bar to fund your sovereign <code>Identity</code>.</p></div>
          <div class="slx-ucd-step"><span>STEP 2</span><h4>Build Your 4D Ticket Slip</h4><p>Dial any 4-digit number (<code>0000–9999</code>) on the reels—or click <strong>🎲 Quick-Pick ×5</strong>—add numbers to your slip cart, and click <strong>🎟️ Buy Slip on Subnet 1</strong> (<code>10 SGD</code> per number).</p></div>
          <div class="slx-ucd-step"><span>STEP 3</span><h4>Trigger Quorum Draw &amp; Audit Proof</h4><p>Once the 12-block window elapses, click <strong>⚡ Close Sales &amp; Request Quorum VRF Draw</strong> (or let the autonomous keeper trigger it). Any winning tiers pay out <code>SGD-FIAT</code> automatically!</p></div>
        </div>
      `,
      controls: `
        <div class="slx-ucd-grid">
          <div class="slx-ucd-card">
            <h4>🎰 Reel Builder &amp; Draw Controls</h4>
            <ul>
              <li><strong>4-Digit Reels:</strong> Use <code>▲ / ▼</code> steppers, type digits directly, or use <strong>🎲 Quick-Pick</strong> to populate random 4D combinations.</li>
              <li><strong>Lottery Pool Switcher (Top-Left):</strong> Switch between <strong>Bellagyo 4D Pool #1</strong>, <strong>Caesarrs 4D Pool #2</strong>, or deploy a custom pool.</li>
            </ul>
          </div>
          <div class="slx-ucd-card">
            <h4>🔬 1-Click Cryptographic Verifier</h4>
            <ul>
              <li>In the right-hand <strong>🏆 Provably-Fair Draw History</strong> card, click <strong>🔬 Verify Proof</strong> on any settled round to verify every validator’s DLEQ proof and Lagrange VRF interpolation in your browser!</li>
            </ul>
          </div>
        </div>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Prize Tier</th><th>Match Rule (Ticket <code>10 SGD</code>)</th><th>Instant Automatic Payout</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>🏆 Tier 1 — Exact 4D</strong></td><td>All 4 digits match in exact order (<code>1 in 10,000</code>)</td><td><strong>100% of Rolling Grand Jackpot</strong> (split equally if multiple exact winners)</td></tr>
            <tr><td><strong>🥈 Tier 2 — Last 3 Digits (3D)</strong></td><td>Last 3 digits match (<code>000–999</code>)</td><td><strong>250 SGD</strong> fixed odds from Reserve</td></tr>
            <tr><td><strong>🥉 Tier 3 — Last 2 Digits (2D)</strong></td><td>Last 2 digits match (<code>00–99</code>)</td><td><strong>40 SGD</strong> fixed odds from Reserve</td></tr>
            <tr><td><strong>✨ Tier 4 — Last 1 Digit (1D)</strong></td><td>Final digit matches (<code>1 in 10</code> odds!)</td><td><strong>15 SGD</strong> fixed odds from Reserve</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Tip — Cover All 10 Last Digits for Guaranteed Action:</strong> Adding 10 tickets ending in <code>0..9</code> guarantees at least one Tier-4 (<code>15 SGD</code>) hit on every draw while giving you 10 shots at 2D, 3D, and the Rolling 4D Grand Jackpot!
        </div>
      `,
    },
  },
  apps: {
    id: 'apps',
    icon: '🧩',
    title: 'HFS App Store & Publisher Studio — User & Builder Guide',
    tagline:
      'Browse, run, fork, and publish complete applications on Subnet 1 with zero backend servers, zero databases, and zero EC2 instances.',
    tabs: {
      quickstart: `
        <div class="slx-ucd-steps">
          <div class="slx-ucd-step">
            <h4>1. Browse &amp; Launch Any App Instantly (Zero Setup)</h4>
            <p>Filter the Directory by category or search by name/hash, then click <strong>▶ Launch App</strong> (or paste any <code>0x…</code> HFS contract address in the quick-launch bar). The Host Shell verifies the app’s <code>keccak256</code> UI bundle, decompresses it in ~2 ms, and caches it locally in <code>IndexedDB</code>.</p>
          </div>
          <div class="slx-ucd-step">
            <h4>2. Click “+ Create / Publish a New App”</h4>
            <p>Click the emerald <strong>+ Create / Publish a New App</strong> button at the top of the App Store. Pick a starter template (or fork any of the 15 existing apps!), edit your single-file HTML/CSS/JS right in the Studio, and optionally attach a compiled <code>.wasm</code> Halt-Free Subroutine.</p>
          </div>
          <div class="slx-ucd-step">
            <h4>3. Preview in Sandbox &amp; Publish On-Chain in 1 Block</h4>
            <p>Click <strong>👁️ Preview in Sandbox</strong> to test your UI inside an isolated <code>&lt;iframe sandbox="allow-scripts"&gt;</code> with live <code>window.slx</code> calls, then click <strong>🚀 Publish App Bundle</strong>. Your app goes live immediately in the Directory—no EC2 server, no RDS database, and no web-client redeploy needed!</p>
          </div>
        </div>
      `,
      controls: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Control / API</th><th>What It Does</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>➕ Create / Publish a New App</strong></td><td>Opens the guided Zero-Server App Builder &amp; Publisher Studio with live gzip &amp; Radio-2 airtime telemetry.</td></tr>
            <tr><td><strong>window.slx.getContext()</strong></td><td>Returns active <code>instanceAddr</code>, <code>blockNumber</code>, and the user’s connected <code>Identity</code> (<code>nickname</code>, <code>tag4</code>, <code>identityAddr</code>) without Auth0 or cookies.</td></tr>
            <tr><td><strong>window.slx.callContract(fnSig, args)</strong></td><td>Reads state directly from your HFS’s on-chain storage (replacing REST <code>GET</code> endpoints &amp; SQL <code>SELECT</code> queries).</td></tr>
            <tr><td><strong>window.slx.sendTransaction({ fnSig, args, summary })</strong></td><td>Pops the Host Wallet Approval sheet and executes a <code>$0.00</code>-gas transaction via the user’s <code>Identity</code> HFS (replacing REST <code>POST</code> endpoints &amp; SQL <code>INSERT/UPDATE</code>).</td></tr>
          </tbody>
        </table>
      `,
      reference: `
        <table class="slx-ucd-table">
          <thead>
            <tr><th>Parameter</th><th>Specification</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Max Compressed UI Bundle</strong></td><td><code>256 KiB</code> gzip (<code>8 × 32 KiB</code> chunks ≈ <code>1.2+ MB</code> raw HTML/CSS/JS)</td></tr>
            <tr><td><strong>Typical App UI Size</strong></td><td><code>2 KiB – 40 KiB</code> gzip (<code>~10–140 ms</code> single burst over <code>LR2021</code> Radio 2)</td></tr>
            <tr><td><strong>Monthly Server / DB Cost</strong></td><td><strong>$0.00 / month</strong> (0 EC2 instances, 0 Postgres DBs, 0 CDN bills)</td></tr>
            <tr><td><strong>Transaction Gas Fee</strong></td><td><strong>$0.00 per tx</strong> on Layer 1</td></tr>
          </tbody>
        </table>
      `,
      tips: `
        <div class="slx-ucd-callout">
          <strong>💡 Tip — Hot-Update Any Existing App Without Redeploying:</strong> Click <strong>✏ Fork / Studio</strong> on any card in the Directory (or click <strong>✏ Studio</strong> on the bottom-left <code>🧩 UI 0x…</code> pill of any page), edit its HTML/CSS/JS, and click <strong>🚀 Publish App Bundle</strong>. Your updated UI loads immediately on the next refresh!
        </div>
      `,
    },
  },
};

// ---------------------------------------------------------------------------
// 3. Shared Modal Styles & Singleton DOM Controller
// ---------------------------------------------------------------------------

function injectUseCaseDocStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('slx-usecase-docs-styles')) return;
  const style = document.createElement('style');
  style.id = 'slx-usecase-docs-styles';
  style.textContent = `
    .slx-ucd-hdr-btn {
      display: inline-flex !important;
      align-items: center;
      gap: 6px;
      padding: 5px 11px !important;
      border-radius: 999px !important;
      font-family: 'JetBrains Mono', ui-monospace, monospace !important;
      font-size: 11.5px !important;
      font-weight: 800 !important;
      letter-spacing: 0.02em;
      cursor: pointer;
      white-space: nowrap;
      transition: transform 0.14s ease, filter 0.14s ease, box-shadow 0.14s ease;
    }
    .slx-ucd-hdr-btn:hover {
      filter: brightness(1.12);
      transform: translateY(-1px);
    }
    .slx-ucd-hdr-btn-desc {
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.24), rgba(79, 70, 229, 0.28)) !important;
      border: 1.5px solid rgba(167, 139, 250, 0.72) !important;
      color: #ede9fe !important;
      box-shadow: 0 0 14px rgba(139, 92, 246, 0.22);
    }
    .slx-ucd-hdr-btn-inst {
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(56, 189, 248, 0.26)) !important;
      border: 1.5px solid rgba(56, 189, 248, 0.72) !important;
      color: #e0f2fe !important;
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.2);
    }

    .slx-ucd-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9996;
      background: rgba(2, 6, 23, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .slx-ucd-backdrop.slx-open {
      display: flex;
    }
    .slx-ucd-modal {
      width: min(960px, 96vw);
      max-height: 89vh;
      display: flex;
      flex-direction: column;
      background: #0b1222;
      border: 1.5px solid rgba(139, 92, 246, 0.48);
      border-radius: 16px;
      box-shadow: 0 24px 68px rgba(0, 0, 0, 0.88);
      color: #e2e8f0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    }
    .slx-ucd-modal.mode-inst {
      border-color: rgba(56, 189, 248, 0.48);
    }
    .slx-ucd-hdr {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 20px 12px;
      background: rgba(15, 23, 42, 0.96);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    }
    .slx-ucd-kicker {
      display: inline-block;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #c4b5fd;
      margin-bottom: 3px;
    }
    .slx-ucd-modal.mode-inst .slx-ucd-kicker {
      color: #7dd3fc;
    }
    .slx-ucd-hdr h2 {
      margin: 0;
      font-size: 16.5px;
      font-weight: 800;
      color: #f8fafc;
      line-height: 1.25;
    }
    .slx-ucd-sub {
      margin: 4px 0 0 0;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.45;
    }
    .slx-ucd-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 9px 20px;
      background: rgba(11, 18, 34, 0.96);
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }
    .slx-ucd-pill {
      display: inline-flex;
      align-items: center;
      padding: 2.5px 8px;
      border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 700;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(30, 41, 59, 0.65);
      color: #e2e8f0;
    }
    .slx-ucd-pill.tone-emerald { background: rgba(16, 185, 129, 0.15); border-color: rgba(52, 211, 153, 0.5); color: #6ee7b7; }
    .slx-ucd-pill.tone-violet  { background: rgba(139, 92, 246, 0.17); border-color: rgba(167, 139, 250, 0.52); color: #ddd6fe; }
    .slx-ucd-pill.tone-cyan    { background: rgba(6, 182, 212, 0.16); border-color: rgba(34, 211, 238, 0.5); color: #a5f3fc; }
    .slx-ucd-pill.tone-amber   { background: rgba(245, 158, 11, 0.16); border-color: rgba(251, 191, 36, 0.5); color: #fde68a; }
    .slx-ucd-pill.tone-rose    { background: rgba(244, 63, 94, 0.16); border-color: rgba(251, 113, 133, 0.5); color: #fecdd3; }
    .slx-ucd-pill.tone-indigo  { background: rgba(99, 102, 241, 0.17); border-color: rgba(129, 140, 248, 0.52); color: #e0e7ff; }
    .slx-ucd-pill.tone-sky     { background: rgba(14, 165, 233, 0.16); border-color: rgba(56, 189, 248, 0.5); color: #bae6fd; }

    .slx-ucd-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 20px;
      background: rgba(8, 13, 26, 0.96);
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      overflow-x: auto;
    }
    .slx-ucd-tab {
      appearance: none;
      padding: 7px 12px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #94a3b8;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.14s ease;
    }
    .slx-ucd-tab:hover {
      color: #f1f5f9;
      border-color: rgba(167, 139, 250, 0.45);
    }
    .slx-ucd-tab.slx-active {
      background: rgba(139, 92, 246, 0.22);
      border-color: rgba(167, 139, 250, 0.8);
      color: #ede9fe;
    }
    .slx-ucd-modal.mode-inst .slx-ucd-tab.slx-active {
      background: rgba(14, 165, 233, 0.2);
      border-color: rgba(56, 189, 248, 0.78);
      color: #e0f2fe;
    }

    .slx-ucd-body {
      padding: 18px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-size: 13px;
      line-height: 1.56;
    }
    .slx-ucd-body code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.24);
      color: #7dd3fc;
    }
    .slx-ucd-hero {
      padding: 13px 16px;
      border-radius: 11px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.13), rgba(14, 165, 233, 0.09));
      border: 1px solid rgba(167, 139, 250, 0.34);
    }
    .slx-ucd-modal.mode-inst .slx-ucd-hero {
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.13), rgba(16, 185, 129, 0.09));
      border-color: rgba(56, 189, 248, 0.34);
    }
    .slx-ucd-hero-title {
      font-size: 13.5px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 5px;
    }
    .slx-ucd-hero p {
      margin: 0;
      color: #cbd5e1;
      font-size: 12.6px;
    }
    .slx-ucd-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .slx-ucd-steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    @media (max-width: 780px) {
      .slx-ucd-grid,
      .slx-ucd-steps {
        grid-template-columns: 1fr;
      }
    }
    .slx-ucd-card,
    .slx-ucd-step {
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.76);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .slx-ucd-step span {
      display: inline-block;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 800;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.14);
      padding: 2px 7px;
      border-radius: 999px;
      margin-bottom: 6px;
    }
    .slx-ucd-card h4,
    .slx-ucd-step h4 {
      margin: 0 0 6px 0;
      font-size: 13px;
      font-weight: 800;
      color: #f8fafc;
    }
    .slx-ucd-card p,
    .slx-ucd-step p {
      margin: 0;
      font-size: 12.2px;
      color: #cbd5e1;
    }
    .slx-ucd-card ul {
      margin: 0;
      padding-left: 17px;
      color: #cbd5e1;
      font-size: 12.2px;
    }
    .slx-ucd-card li {
      margin-bottom: 5px;
    }
    .slx-ucd-callout {
      padding: 11px 14px;
      border-radius: 10px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.36);
      color: #d1fae5;
      font-size: 12.2px;
    }
    .slx-ucd-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      background: rgba(15, 23, 42, 0.62);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 8px;
      overflow: hidden;
    }
    .slx-ucd-table th,
    .slx-ucd-table td {
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }
    .slx-ucd-table th {
      background: rgba(30, 41, 59, 0.88);
      color: #f8fafc;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .slx-ucd-table tr:last-child td {
      border-bottom: none;
    }

    .slx-ucd-ftr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.96);
      border-top: 1px solid rgba(148, 163, 184, 0.18);
      font-size: 11.5px;
      color: #94a3b8;
    }
    .slx-ucd-btn-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .slx-ucd-btn {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(30, 41, 59, 0.8);
      color: #e2e8f0;
      transition: filter 0.14s ease;
    }
    .slx-ucd-btn:hover {
      filter: brightness(1.12);
    }
    .slx-ucd-btn-primary {
      background: linear-gradient(135deg, #8b5cf6, #6366f1);
      border-color: rgba(196, 181, 253, 0.6);
      color: #ffffff;
    }
    .slx-ucd-btn-cyan {
      background: linear-gradient(135deg, #0284c7, #0ea5e9);
      border-color: rgba(125, 211, 252, 0.6);
      color: #ffffff;
    }
    @media (max-width: 640px) {
      .slx-ucd-hdr-btn {
        padding: 4px 8px;
        font-size: 11px;
        gap: 4px;
      }
      .slx-ucd-backdrop {
        padding: 0;
        align-items: flex-end;
      }
      .slx-ucd-modal {
        max-width: 100%;
        width: 100%;
        max-height: 92dvh;
        border-radius: 14px 14px 0 0;
        border-left: none;
        border-right: none;
        border-bottom: none;
      }
      .slx-ucd-hdr {
        padding: 12px 14px;
      }
      .slx-ucd-hdr h2 {
        font-size: 15px;
      }
      .slx-ucd-pills,
      .slx-ucd-tabs {
        padding: 8px 12px;
      }
      .slx-ucd-body {
        padding: 13px 14px;
        font-size: 12.4px;
      }
      .slx-ucd-table {
        display: block;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .slx-ucd-ftr {
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
      }
    }
  `;
  document.head.appendChild(style);
}

const DESC_TAB_DEFS = [
  { key: 'codification', label: '🛡️ API → HFS Codification' },
  { key: 'primitives', label: '🔐 Crypto & L1 Features' },
  { key: 'topology', label: '🧩 HFS Subroutine Graph' },
  { key: 'verification', label: '🔬 Live Audit & Invariants' },
];

const INST_TAB_DEFS = [
  { key: 'quickstart', label: '🚀 Quick-Start (3 Steps)' },
  { key: 'controls', label: '🎮 Controls & Interface' },
  { key: 'reference', label: '📊 Rules & Reference' },
  { key: 'tips', label: '💡 Scenarios & Tips' },
];

let singletonModal = null;

function ensureUseCaseModalDom() {
  if (typeof document === 'undefined') return null;
  injectUseCaseDocStyles();
  if (singletonModal) return singletonModal;

  const backdrop = document.createElement('div');
  backdrop.className = 'slx-ucd-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.innerHTML = `
    <div class="slx-ucd-modal" data-ucd="modal">
      <div class="slx-ucd-hdr">
        <div style="min-width:0;">
          <span class="slx-ucd-kicker" data-ucd="kicker">HFS USE-CASE ARCHITECTURE</span>
          <h2 data-ucd="title"></h2>
          <p class="slx-ucd-sub" data-ucd="sub"></p>
        </div>
        <button type="button" class="slx-ucd-btn" data-ucd-close="1" aria-label="Close modal">✕</button>
      </div>
      <div class="slx-ucd-pills" data-ucd="pills"></div>
      <div class="slx-ucd-tabs" role="tablist" data-ucd="tabs"></div>
      <div class="slx-ucd-body" data-ucd="body"></div>
      <div class="slx-ucd-ftr">
        <span data-ucd="ftrNote">100% Layer-1 Halt-Free Subroutines • Zero Cloud APIs • Zero L2 Sequencers</span>
        <div class="slx-ucd-btn-row" data-ucd="ftrBtns"></div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const modalEl = backdrop.querySelector('[data-ucd="modal"]');
  modalEl.addEventListener('click', (ev) => ev.stopPropagation());

  const close = () => backdrop.classList.remove('slx-open');
  backdrop.addEventListener('click', close);
  backdrop.querySelector('[data-ucd-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && backdrop.classList.contains('slx-open')) {
      close();
    }
  });

  singletonModal = {
    backdrop,
    modalEl,
    kickerEl: backdrop.querySelector('[data-ucd="kicker"]'),
    titleEl: backdrop.querySelector('[data-ucd="title"]'),
    subEl: backdrop.querySelector('[data-ucd="sub"]'),
    pillsEl: backdrop.querySelector('[data-ucd="pills"]'),
    tabsEl: backdrop.querySelector('[data-ucd="tabs"]'),
    bodyEl: backdrop.querySelector('[data-ucd="body"]'),
    ftrNoteEl: backdrop.querySelector('[data-ucd="ftrNote"]'),
    ftrBtnsEl: backdrop.querySelector('[data-ucd="ftrBtns"]'),
    close,
  };
  return singletonModal;
}

/**
 * Opens the 4-Tab Use-Case Architecture & Cryptographic Primitives Description modal.
 */
export function openSlxUseCaseDescription(appId, tabKey = 'codification', { currentPageAppId = '' } = {}) {
  const id = normalizeUseCaseId(appId);
  const spec = USECASE_DESCRIPTIONS[id];
  if (!spec) return false;
  const ui = ensureUseCaseModalDom();
  if (!ui) return false;

  ui.modalEl.classList.remove('mode-inst');
  ui.kickerEl.textContent = '🏛️ HALT-FREE SUBROUTINE ARCHITECTURE & CRYPTOGRAPHIC SPEC';
  ui.titleEl.textContent = `${spec.icon} ${spec.title}`;
  ui.subEl.textContent = spec.tagline;

  ui.pillsEl.style.display = 'flex';
  ui.pillsEl.innerHTML = (spec.featurePills || [])
    .map(
      (p) =>
        `<span class="slx-ucd-pill tone-${p.tone || 'cyan'}">✦ ${p.label}</span>`
    )
    .join('');

  const renderTab = (tKey) => {
    const chosen = spec.tabs[tKey] ? tKey : 'codification';
    ui.tabsEl.innerHTML = DESC_TAB_DEFS.map(
      (t) =>
        `<button type="button" class="slx-ucd-tab ${t.key === chosen ? 'slx-active' : ''}" data-ucd-tab="${t.key}">${t.label}</button>`
    ).join('');
    ui.tabsEl.querySelectorAll('[data-ucd-tab]').forEach((btn) => {
      btn.addEventListener('click', () => renderTab(btn.getAttribute('data-ucd-tab')));
    });
    ui.bodyEl.innerHTML = spec.tabs[chosen];
    ui.bodyEl.scrollTop = 0;
  };
  renderTab(tabKey);

  const onSamePage =
    normalizeUseCaseId(currentPageAppId) === id ||
    (typeof window !== 'undefined' &&
      spec.href &&
      window.location?.pathname?.endsWith(spec.href));

  ui.ftrNoteEl.innerHTML =
    '100% Layer-1 Halt-Free Subroutines • Zero Cloud APIs • Zero L2 Sequencers';

  if (onSamePage) {
    ui.ftrBtnsEl.innerHTML = `
      <button type="button" class="slx-ucd-btn" data-ucd-switch-inst="1">📖 View Instructions &amp; Controls</button>
      <button type="button" class="slx-ucd-btn slx-ucd-btn-primary" data-ucd-done="1">✓ Back to Live App</button>
    `;
    ui.ftrBtnsEl.querySelector('[data-ucd-switch-inst]')?.addEventListener('click', () => {
      ui.close();
      openSlxUseCaseInstructions(id);
    });
    ui.ftrBtnsEl.querySelector('[data-ucd-done]')?.addEventListener('click', ui.close);
  } else {
    ui.ftrBtnsEl.innerHTML = `
      <button type="button" class="slx-ucd-btn" data-ucd-done="1">Close</button>
      <a href="${spec.href}" class="slx-ucd-btn slx-ucd-btn-primary">🚀 Open Live Use Case →</a>
    `;
    ui.ftrBtnsEl.querySelector('[data-ucd-done]')?.addEventListener('click', ui.close);
  }

  ui.backdrop.classList.add('slx-open');
  return true;
}

/**
 * Opens the 4-Tab Use-Case Instructions modal (delegating to `game-guide.js` if active on a game page).
 */
export function openSlxUseCaseInstructions(appId, tabKey = 'quickstart') {
  const id = normalizeUseCaseId(appId);
  if (
    GAME_GUIDE_IDS.has(id) &&
    typeof window !== 'undefined' &&
    typeof window.__slxOpenGameGuide === 'function' &&
    window.__slxOpenGameGuide(id, tabKey)
  ) {
    return true;
  }

  const spec = USECASE_INSTRUCTIONS[id];
  if (!spec) {
    return openSlxUseCaseDescription(id, 'codification');
  }
  const ui = ensureUseCaseModalDom();
  if (!ui) return false;

  ui.modalEl.classList.add('mode-inst');
  ui.kickerEl.textContent = '📖 INTERACTIVE USER INSTRUCTIONS & WORKFLOW GUIDE';
  ui.titleEl.textContent = `${spec.icon} ${spec.title}`;
  ui.subEl.textContent = spec.tagline;
  ui.pillsEl.style.display = 'none';
  ui.pillsEl.innerHTML = '';

  const renderTab = (tKey) => {
    const chosen = spec.tabs[tKey] ? tKey : 'quickstart';
    ui.tabsEl.innerHTML = INST_TAB_DEFS.map(
      (t) =>
        `<button type="button" class="slx-ucd-tab ${t.key === chosen ? 'slx-active' : ''}" data-ucd-tab="${t.key}">${t.label}</button>`
    ).join('');
    ui.tabsEl.querySelectorAll('[data-ucd-tab]').forEach((btn) => {
      btn.addEventListener('click', () => renderTab(btn.getAttribute('data-ucd-tab')));
    });
    ui.bodyEl.innerHTML = spec.tabs[chosen];
    ui.bodyEl.scrollTop = 0;
  };
  renderTab(tabKey);

  ui.ftrNoteEl.innerHTML =
    'Tip: Reopen <strong>📖 Instructions</strong> or <strong>🏛️ Description</strong> anytime from the top header bar.';
  ui.ftrBtnsEl.innerHTML = `
    <button type="button" class="slx-ucd-btn" data-ucd-switch-desc="1">🏛️ HFS Architecture &amp; Crypto</button>
    <button type="button" class="slx-ucd-btn slx-ucd-btn-cyan" data-ucd-done="1">✓ Got It</button>
  `;
  ui.ftrBtnsEl.querySelector('[data-ucd-switch-desc]')?.addEventListener('click', () => {
    ui.close();
    openSlxUseCaseDescription(id, 'codification', { currentPageAppId: id });
  });
  ui.ftrBtnsEl.querySelector('[data-ucd-done]')?.addEventListener('click', ui.close);

  ui.backdrop.classList.add('slx-open');
  return true;
}

/**
 * Mounts standardized `🏛️ Description` (and `📖 Instructions` when not already provided by `game-guide.js`)
 * pills into a Unified Header container (`refs.extra`) and handles `?modal=description|instructions` deep links.
 */
export function mountSlxUseCaseHeaderDocs({ activeAppId, extraContainer }) {
  if (typeof document === 'undefined' || !extraContainer) return null;
  const id = normalizeUseCaseId(activeAppId);
  if (!USECASE_DESCRIPTIONS[id]) return null;
  injectUseCaseDocStyles();

  if (typeof window !== 'undefined') {
    window.openSlxUseCaseDescription = (targetId = id, tab = 'codification') =>
      openSlxUseCaseDescription(targetId, tab, { currentPageAppId: id });
    window.openSlxUseCaseInstructions = (targetId = id, tab = 'quickstart') =>
      openSlxUseCaseInstructions(targetId, tab);
  }

  const existingGuideBtn = GAME_GUIDE_IDS.has(id)
    ? extraContainer.querySelector('#btnNavalHowToPlay, #btnHowToPlay, #btnNoirRules, .slx-gg-hdr-btn')
    : null;

  const descBtn = document.createElement('button');
  descBtn.type = 'button';
  descBtn.className = 'slx-ucd-hdr-btn slx-ucd-hdr-btn-desc';
  descBtn.innerHTML = '🏛️ Description';
  descBtn.title =
    'View Halt-Free Subroutine Architecture, API De-Risking & Cryptographic Primitives';
  descBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    openSlxUseCaseDescription(id, 'codification', { currentPageAppId: id });
  });
  if (existingGuideBtn && existingGuideBtn.parentNode === extraContainer) {
    extraContainer.insertBefore(descBtn, existingGuideBtn);
  } else {
    extraContainer.appendChild(descBtn);
  }

  let instBtn = null;
  if (!existingGuideBtn && USECASE_INSTRUCTIONS[id]) {
    instBtn = document.createElement('button');
    instBtn.type = 'button';
    instBtn.className = 'slx-ucd-hdr-btn slx-ucd-hdr-btn-inst';
    instBtn.innerHTML = '📖 Instructions';
    instBtn.title = 'Open Step-by-Step User Instructions, Controls & Reference';
    instBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openSlxUseCaseInstructions(id, 'quickstart');
    });
    extraContainer.appendChild(instBtn);
  }

  // Support `?modal=description` or `?modal=instructions` URL deep links
  if (typeof window !== 'undefined') {
    try {
      const q = new URLSearchParams(window.location.search);
      const modalParam = (q.get('modal') || '').toLowerCase();
      if (modalParam === 'description' || modalParam === 'arch' || modalParam === 'architecture') {
        setTimeout(() => openSlxUseCaseDescription(id, 'codification', { currentPageAppId: id }), 60);
      } else if (modalParam === 'instructions' || modalParam === 'guide') {
        setTimeout(() => openSlxUseCaseInstructions(id, 'quickstart'), 60);
      }
    } catch (_) {}
  }

  return { descBtn, instBtn };
}
