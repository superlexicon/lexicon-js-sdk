/**
 * SuperLexicon Site-Wide Legal, Risk, Non-Solicitation & Cookie / Local-Storage Consent Module
 *
 * Mounted across `index.html` and all interactive Subnet 1 dApp / Explorer pages
 * (`dex.html`, `charter.html`, `commerce.html`, `social.html`, `battleship.html`,
 * `cipher-noir.html`, `hegemony.html`).
 *
 * Features:
 *  1. Non-blocking first-visit bottom consent & cheeky startup/protocol risk banner
 *     (persisted in strictly-necessary `localStorage['slx_legal_consent_v1']`).
 *  2. Persistent compliance footer links on every page (adapts cleanly to `index.html`'s
 *     existing `<footer>` or appends a subtle footer strip on standalone dApp pages).
 *  3. Tabbed full-detail Legal, Risk, Non-Solicitation & Cookie/Storage modal with an
 *     interactive GDPR/ePrivacy local-storage inspector & one-click reset control.
 */

const CONSENT_STORAGE_KEY = 'slx_legal_consent_v1';
const CONSENT_VERSION = '2026.11-v1';

function readStoredConsent() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === CONSENT_VERSION && parsed.acceptedAt) {
      return parsed;
    }
  } catch (_) {
    // Ignore malformed storage entries
  }
  return null;
}

function saveStoredConsent() {
  const record = {
    version: CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    strictlyNecessaryOnly: true,
    analyticsCookies: false,
    marketingCookies: false,
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch (_) {
      // Ignore quota / private-mode write errors
    }
  }
  return record;
}

function listLocalSlxKeys() {
  const out = [];
  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) out.push(`localStorage: ${k}`);
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k) out.push(`sessionStorage: ${k}`);
      }
    }
  } catch (_) {
    // Ignore storage enumeration errors
  }
  return out.sort();
}

function injectStyles() {
  if (document.getElementById('slx-legal-consent-styles')) return;
  const style = document.createElement('style');
  style.id = 'slx-legal-consent-styles';
  style.textContent = `
    .slx-legal-banner {
      position: fixed;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      width: min(1160px, calc(100vw - 24px));
      z-index: 9990;
      background: rgba(8, 13, 26, 0.96);
      border: 1.5px solid rgba(245, 158, 11, 0.55);
      border-radius: 14px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(34, 211, 238, 0.12);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      padding: 13px 16px;
      color: #e2e8f0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    .slx-legal-banner.slx-has-mobile-nav {
      bottom: 14px;
    }
    @media (max-width: 1023px) {
      .slx-legal-banner.slx-has-mobile-nav {
        bottom: 66px;
      }
    }
    .slx-legal-banner.slx-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(-50%) translateY(14px);
    }
    .slx-legal-banner-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .slx-legal-banner-copy {
      flex: 1 1 560px;
      min-width: 260px;
      font-size: 12px;
      line-height: 1.52;
      color: #cbd5e1;
    }
    .slx-legal-badge-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .slx-legal-pill-warn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: rgba(245, 158, 11, 0.18);
      border: 1px solid rgba(245, 158, 11, 0.45);
      color: #fcd34d;
    }
    .slx-legal-pill-cookie {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 600;
      background: rgba(34, 211, 238, 0.12);
      border: 1px solid rgba(34, 211, 238, 0.35);
      color: #67e8f9;
    }
    .slx-legal-banner-copy strong {
      color: #f8fafc;
      font-weight: 700;
    }
    .slx-legal-banner-copy em {
      color: #fde68a;
      font-style: italic;
    }
    .slx-legal-inline-link {
      color: #38bdf8;
      text-decoration: underline;
      text-underline-offset: 2px;
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      cursor: pointer;
    }
    .slx-legal-inline-link:hover {
      color: #7dd3fc;
    }
    .slx-legal-banner-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .slx-legal-btn {
      appearance: none;
      border-radius: 9px;
      padding: 8px 13px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .slx-legal-btn-secondary {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.4);
      color: #e2e8f0;
    }
    .slx-legal-btn-secondary:hover {
      background: rgba(51, 65, 85, 0.95);
      border-color: rgba(148, 163, 184, 0.7);
    }
    .slx-legal-btn-primary {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      border: 1px solid rgba(251, 191, 36, 0.8);
      color: #090d16;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.3);
    }
    .slx-legal-btn-primary:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
    .slx-legal-btn-danger {
      background: rgba(244, 63, 94, 0.14);
      border: 1px solid rgba(244, 63, 94, 0.45);
      color: #fda4af;
    }
    .slx-legal-btn-danger:hover {
      background: rgba(244, 63, 94, 0.24);
    }

    /* Persistent Footer Bar */
    .slx-legal-footer-strip {
      max-width: 1600px;
      margin: 12px auto 0 auto;
      padding: 10px 16px 18px 16px;
      border-top: 1px solid rgba(148, 163, 184, 0.16);
      text-align: center;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.6;
      color: #94a3b8;
    }
    .slx-legal-footer-strip.slx-embedded-in-footer {
      margin-top: 8px;
      padding: 8px 0 0 0;
    }
    .slx-legal-footer-links {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 6px 14px;
      margin-bottom: 4px;
    }
    .slx-legal-footer-link {
      background: none;
      border: none;
      padding: 0;
      color: #cbd5e1;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-color: rgba(148, 163, 184, 0.4);
      text-underline-offset: 3px;
      transition: color 0.15s ease;
    }
    .slx-legal-footer-link:hover {
      color: #fcd34d;
      text-decoration-color: rgba(252, 211, 77, 0.7);
    }
    .slx-legal-footer-micro {
      font-size: 10.2px;
      color: #64748b;
      max-width: 1080px;
      margin: 0 auto;
    }

    /* Full Legal, Risk & Cookie Modal */
    .slx-legal-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(3, 7, 18, 0.82);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .slx-legal-modal-backdrop.slx-open {
      display: flex;
    }
    .slx-legal-modal {
      width: min(880px, 96vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: #0b1222;
      border: 1.5px solid rgba(148, 163, 184, 0.32);
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.85);
      color: #e2e8f0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
    }
    .slx-legal-modal-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 15px 20px;
      background: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    }
    .slx-legal-modal-hdr h2 {
      margin: 0;
      font-size: 15.5px;
      font-weight: 800;
      color: #f8fafc;
      letter-spacing: -0.01em;
    }
    .slx-legal-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 20px;
      background: rgba(9, 14, 28, 0.9);
      border-bottom: 1px solid rgba(148, 163, 184, 0.16);
      overflow-x: auto;
    }
    .slx-legal-tab {
      appearance: none;
      background: rgba(30, 41, 59, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #94a3b8;
      border-radius: 8px;
      padding: 6px 11px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .slx-legal-tab:hover {
      color: #e2e8f0;
      border-color: rgba(148, 163, 184, 0.5);
    }
    .slx-legal-tab.slx-active {
      background: rgba(245, 158, 11, 0.18);
      border-color: rgba(245, 158, 11, 0.6);
      color: #fcd34d;
    }
    .slx-legal-modal-body {
      padding: 18px 22px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.65;
      color: #cbd5e1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .slx-legal-callout-cheeky {
      padding: 14px 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.13) 0%, rgba(244, 63, 94, 0.11) 100%);
      border: 1.5px solid rgba(245, 158, 11, 0.45);
      color: #fef3c7;
    }
    .slx-legal-callout-cheeky h3 {
      margin: 0 0 6px 0;
      font-size: 13.5px;
      font-weight: 800;
      color: #fcd34d;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .slx-legal-section {
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .slx-legal-section h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #38bdf8;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .slx-legal-section p {
      margin: 0 0 8px 0;
    }
    .slx-legal-section p:last-child {
      margin-bottom: 0;
    }
    .slx-legal-section ul {
      margin: 6px 0 0 0;
      padding-left: 18px;
    }
    .slx-legal-section li {
      margin-bottom: 6px;
    }
    .slx-legal-section code {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #67e8f9;
    }
    .slx-legal-storage-box {
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(2, 6, 23, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.25);
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #94a3b8;
    }
    .slx-legal-mobile-prose {
      display: none;
    }
    .slx-legal-modal-ftr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.92);
      border-top: 1px solid rgba(148, 163, 184, 0.2);
      font-size: 11.5px;
      color: #94a3b8;
    }
    @media (max-width: 680px) {
      .slx-legal-banner {
        width: calc(100vw - 14px);
        padding: 9px 11px;
        border-radius: 12px;
        bottom: max(10px, env(safe-area-inset-bottom));
      }
      .slx-legal-banner.slx-has-mobile-nav {
        bottom: calc(58px + env(safe-area-inset-bottom));
      }
      .slx-legal-banner-inner {
        gap: 8px;
      }
      .slx-legal-banner-copy {
        min-width: 0;
        flex: 1 1 100%;
        font-size: 11px;
        line-height: 1.38;
      }
      .slx-legal-pill-cookie,
      .slx-legal-desktop-prose {
        display: none;
      }
      .slx-legal-mobile-prose {
        display: inline;
      }
      .slx-legal-banner-actions {
        width: 100%;
        justify-content: flex-end;
        gap: 6px;
      }
      .slx-legal-banner-actions .slx-legal-btn {
        padding: 6px 10px;
        font-size: 11px;
        flex: 1;
        text-align: center;
      }
      .slx-legal-modal-backdrop {
        padding: 0;
        align-items: flex-end;
      }
      .slx-legal-modal {
        width: 100vw;
        max-height: 92dvh;
        border-radius: 15px 15px 0 0;
        border-left: none;
        border-right: none;
        border-bottom: none;
      }
      .slx-legal-modal-hdr,
      .slx-legal-tabs,
      .slx-legal-modal-body {
        padding-left: 14px;
        padding-right: 14px;
      }
      .slx-legal-modal-ftr {
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
      }
    }
  `;
  document.head.appendChild(style);
}

export function mountLegalConsent() {
  if (typeof document === 'undefined' || document.getElementById('slxLegalModalBackdrop')) {
    return;
  }
  injectStyles();

  const hasMobileBottomNav = Boolean(document.getElementById('mobileBottomNav'));
  const existingConsent = readStoredConsent();

  // -------------------------------------------------------------------------
  // 1. Modal (Full Legal, Cheeky Risk, Non-Solicitation & Cookie Policy)
  // -------------------------------------------------------------------------
  const backdrop = document.createElement('div');
  backdrop.id = 'slxLegalModalBackdrop';
  backdrop.className = 'slx-legal-modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'slxLegalModalTitle');

  backdrop.innerHTML = `
    <div class="slx-legal-modal" onclick="event.stopPropagation()">
      <div class="slx-legal-modal-hdr">
        <h2 id="slxLegalModalTitle">⚖️ SuperLexicon — Risk Disclaimer, Non-Solicitation &amp; Cookie / Storage Policy</h2>
        <button type="button" class="slx-legal-btn slx-legal-btn-secondary" id="slxLegalCloseTopBtn" aria-label="Close">✕</button>
      </div>

      <div class="slx-legal-tabs" role="tablist">
        <button type="button" class="slx-legal-tab slx-active" data-slx-tab="all">All Clauses</button>
        <button type="button" class="slx-legal-tab" data-slx-tab="risk">⚠️ Risk &amp; Losses</button>
        <button type="button" class="slx-legal-tab" data-slx-tab="securities">🚫 No Solicitation</button>
        <button type="button" class="slx-legal-tab" data-slx-tab="cookies">🍪 Cookies &amp; Storage</button>
        <button type="button" class="slx-legal-tab" data-slx-tab="testnet">🧪 Testnet &amp; SLXR</button>
      </div>

      <div class="slx-legal-modal-body" id="slxLegalModalBody">
        <div class="slx-legal-callout-cheeky" data-slx-pane="risk">
          <h3>⚡ THE CHEEKY (YET DEAD-SERIOUS) REALITY CHECK: FUN PROTOCOL ≠ SAFE INVESTMENT</h3>
          <p style="margin:0;">
            Let&rsquo;s be honest: firing Sub-GHz radio bursts across rooms without an ISP, matching limit orders on a zero-gas CLOB DEX, and staging simultaneous coups in <em>Fractured Hegemony</em> or <em>Cipher Noir</em> can make the SuperLexicon protocol feel <strong>dangerously fun</strong>. Do <strong>not</strong> let cool RF engineering or slick live dApps trick your brain into thinking an early-stage hardware + Layer-1 blockchain venture is a safe bet. Deep-tech startups and experimental protocols are <strong>brutally risky</strong> — hardware delays, spectrum rules, consensus bugs, zero market adoption, or regulatory shifts can result in <strong>heavy or total (100%, straight-to-$0.00) losses</strong>. Enjoy the tech, verify every block hash yourself, and never commit a single dollar to any high-risk startup or digital asset unless you could watch it evaporate tomorrow without losing sleep.
          </p>
        </div>

        <div class="slx-legal-section" data-slx-pane="securities">
          <h3>1. No Offer, No Solicitation &amp; Private Financing Notice</h3>
          <p>
            Nothing on this website, presentation deck, technical or financial appendix, block explorer, or interactive application constitutes (or should be construed as) an offer to sell, a solicitation of an offer to buy, a public offering, or a recommendation or endorsement of any equity, shares, debt, convertible instrument, SAFE/SAFT, token, or other security or financial instrument in any jurisdiction worldwide — including under the <strong>U.S. Securities Act of 1933</strong> (and <strong>SEC Regulation D Rule 506(b)</strong>), the <strong>U.K. Financial Services and Markets Act 2000 (FSMA) Financial Promotion Order</strong>, the <strong>EU Markets in Crypto-Assets Regulation (MiCA) / Prospectus Regulation</strong>, or the <strong>Singapore Securities and Futures Act (SFA)</strong>.
          </p>
          <ul>
            <li><strong>Informational &amp; Technical Demonstration Only:</strong> All materials published by SuperLexicon and its contributors/affiliates are provided strictly for general informational, architectural, and technical evaluation purposes.</li>
            <li><strong>Definitive Agreements Govern Exclusively:</strong> Any prospective capital-raising transaction, if ever undertaken, will be conducted strictly on a confidential, private-placement basis with verified accredited, qualified, professional, or institutional investors pursuant to definitive written offering memoranda and subscription agreements, which supersede every statement on this site in its entirety.</li>
            <li><strong>No Investment, Legal, or Tax Advice:</strong> Nothing herein constitutes financial, investment, trading, legal, accounting, or tax advice. Always consult your own independent licensed legal, tax, and financial advisors.</li>
          </ul>
        </div>

        <div class="slx-legal-section" data-slx-pane="risk">
          <h3>2. Early-Stage Startup, Protocol &amp; Forward-Looking Statement Risks</h3>
          <p>
            Early-stage deep-tech hardware and decentralized protocol development involves a high degree of risk, uncertainty, and potential illiquidity:
          </p>
          <ul>
            <li><strong>Total Loss &amp; Illiquidity Risk:</strong> Early-stage ventures frequently fail. Any investment in an early-stage startup or participation in an experimental protocol is speculative, completely illiquid, and may result in a <strong>100% loss of capital</strong>.</li>
            <li><strong>Unaudited Forward-Looking Statements:</strong> All enterprise valuation models, 5-year P&amp;L projections, TAM/SAM/SOM figures, unit BOM estimates, execution roadmaps, and RF range/throughput extrapolations (including Slides <code>01–07</code>, <code>B1–B6</code>, and <code>T1–T5</code>) are unaudited, illustrative forward-looking engineering and business targets based on assumptions that may prove materially inaccurate. Actual outcomes may differ drastically.</li>
            <li><strong>Experimental Cryptography &amp; RF Software/Hardware:</strong> All smart contracts (Halt-Free Subroutines), Rust consensus engines, and Sub-GHz MCU firmware are provided <strong>&ldquo;AS IS&rdquo;</strong> without warranty of any kind. Hardware and radio links must only be operated in compliance with local spectrum laws (e.g., FCC Part 15, ETSI EN 300 220, IMDA SRD bands).</li>
          </ul>
        </div>

        <div class="slx-legal-section" data-slx-pane="cookies">
          <h3>3. Cookie, Local Browser Storage &amp; Privacy Policy (GDPR / ePrivacy / PECR / CCPA / PDPA)</h3>
          <p>
            <strong>Zero Tracking, Analytics, or Advertising Cookies:</strong> SuperLexicon does <strong>not</strong> set third-party advertising cookies, cross-site tracking pixels, behavioral profiling identifiers, or analytics cookies (no Google Analytics, Meta Pixel, or ad-tech SDKs), and we never sell or rent visitor data.
          </p>
          <p>
            <strong>Strictly Necessary Local Storage (Functional Exemption):</strong> To operate the interactive presentation, live Block Explorer, and Subnet 1 testnet dApps, your browser stores a small set of strictly necessary local state entries directly on your device:
          </p>
          <ul>
            <li><code>localStorage['${CONSENT_STORAGE_KEY}']</code>: Remembers that you acknowledged this notice so the bottom banner does not reappear on every page navigation.</li>
            <li><code>sessionStorage</code> (Tab-Scoped Deck Key): Temporarily caches an unlocked slide-deck decryption key inside your active browser tab; automatically erased when you close the tab.</li>
            <li><code>localStorage['slx_*']</code> (Testnet Wallet &amp; dApp Sandbox State): Stores locally generated <code>secp256k1</code> testnet keypairs, simulated DEX order match history, and Charter/game UI state on your machine. Private keys never leave your browser; only signed zero-value testnet transactions are sent to Subnet 1 RPC nodes.</li>
            <li><strong>Direct Testnet RPC &amp; Typography Requests:</strong> Viewing live Subnet 1 telemetry opens WebSocket / JSON-RPC connections to SuperLexicon testnet nodes (which process standard IP connection metadata solely to serve blocks and relay testnet transactions) and loads standard web fonts (<code>Inter</code> / <code>JetBrains Mono</code>).</li>
          </ul>
          <div class="slx-legal-storage-box">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <span id="slxStorageStatusLabel">Checking browser storage keys…</span>
              <button type="button" class="slx-legal-btn slx-legal-btn-danger" id="slxClearConsentStorageBtn" style="padding:5px 10px;font-size:10.5px;">
                🗑️ Clear Consent &amp; Re-Show Banner
              </button>
            </div>
          </div>
        </div>

        <div class="slx-legal-section" data-slx-pane="testnet">
          <h3>4. Live Testnet Sandbox &amp; <code>SLXR</code> Contingent Rebate Disclaimers</h3>
          <ul>
            <li><strong>Zero-Value Testnet Assets Only:</strong> Every live transaction, block, DEX market (<code>DiscreteTimeCLOB</code>), dark-pool game, Sovereign Charter bond, Commerce escrow, and token balance (including <code>SLXR</code>, <code>SLX</code>, and simulated fiat/commodity tickers such as <code>SGD</code> or <code>USD</code>) runs on an <strong>experimental Testnet</strong> and carries <strong>zero real-world monetary value ($0.00)</strong>. Testnet chains, balances, and deployed subroutines may be reset or wiped at any time without notice.</li>
            <li><strong>Contingent Hardware Rebate — Worst-Case Rate Is $0.00:</strong> As detailed in Slide 07, the proposed mainnet <code>SLXR</code> mechanism is strictly a contingent future cash-back rebate funded solely if realized manufacturing, logistics, and tariff costs come in below built-in hardware pricing buffers. If cost shocks consume those buffers, the prevailing redemption rate will be <strong>$0.00</strong>.</li>
            <li><strong>Active Validator Requirement &amp; Non-Security Nature:</strong> <code>SLXR</code> requires active physical RF validator node operation (idle/stored hardware earns <code>0</code> tokens), carries zero guarantee of secondary DEX liquidity or price, and confers <strong>no equity, debt, profit-sharing, dividend, or corporate voting rights</strong> in SuperLexicon or any affiliate.</li>
          </ul>
        </div>
      </div>

      <div class="slx-legal-modal-ftr">
        <span id="slxConsentTimestampNote">Policy version <code>${CONSENT_VERSION}</code> &bull; Strictly-necessary storage only (0 ad/tracking cookies)</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="slx-legal-btn slx-legal-btn-secondary" id="slxLegalCloseBottomBtn">Close</button>
          <button type="button" class="slx-legal-btn slx-legal-btn-primary" id="slxLegalModalAcceptBtn">✓ I Understand &amp; Accept</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  // -------------------------------------------------------------------------
  // 2. Non-Blocking Bottom Banner (First Visit)
  // -------------------------------------------------------------------------
  const banner = document.createElement('aside');
  banner.id = 'slxLegalConsentBanner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie, Local Storage and Risk Disclaimer Notice');
  banner.className = [
    'slx-legal-banner',
    hasMobileBottomNav ? 'slx-has-mobile-nav' : '',
    existingConsent ? 'slx-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  banner.innerHTML = `
    <div class="slx-legal-banner-inner">
      <div class="slx-legal-banner-copy">
        <div class="slx-legal-badge-row">
          <span class="slx-legal-pill-warn">⚠️ High-Risk Protocol &amp; No-Solicitation Notice</span>
          <span class="slx-legal-pill-cookie">🍪 0 Tracking Cookies &bull; Functional Storage Only</span>
        </div>
        <div>
          <span class="slx-legal-desktop-prose">
            <strong>Cheeky reality check:</strong> Firing Sub-GHz mesh bursts, trading on zero-gas DEXs, and playing on-chain games on SuperLexicon might seem <em>very fun</em> — but don&rsquo;t let that fool you: early-stage hardware/crypto startups and experimental protocols are <strong>extremely risky</strong> and can result in <strong>heavy or total (100%) losses</strong>. Nothing here is an offer or solicitation to invest, all live dApps run on <strong>$0.00 testnet state</strong>, and we use strictly necessary browser <code>localStorage</code>/<code>sessionStorage</code> only (zero ad/analytics cookies).
          </span>
          <span class="slx-legal-mobile-prose">
            <strong>Experimental $0-testnet demo:</strong> High-risk R&amp;D protocol (not an offer to invest) &bull; Functional storage only (0 ad/tracking cookies).
          </span>
          <button type="button" class="slx-legal-inline-link" id="slxBannerReadMoreLink">Full Policy</button>.
        </div>
      </div>
      <div class="slx-legal-banner-actions">
        <button type="button" class="slx-legal-btn slx-legal-btn-secondary" id="slxBannerOpenPolicyBtn">
          📜 Full Policy
        </button>
        <button type="button" class="slx-legal-btn slx-legal-btn-primary" id="slxBannerAcceptBtn">
          ✓ I Understand &amp; Accept
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(banner);

  // -------------------------------------------------------------------------
  // 3. Persistent Footer Strip Across All Pages
  // -------------------------------------------------------------------------
  const footerStrip = document.createElement('div');
  footerStrip.id = 'slxLegalFooterBar';
  const existingFooter = document.querySelector('body > footer');
  footerStrip.className = existingFooter
    ? 'slx-legal-footer-strip slx-embedded-in-footer'
    : 'slx-legal-footer-strip';

  footerStrip.innerHTML = `
    <div class="slx-legal-footer-links">
      <button type="button" class="slx-legal-footer-link" data-slx-open-tab="risk">⚠️ Risk &amp; Heavy-Loss Warning</button>
      <span>&bull;</span>
      <button type="button" class="slx-legal-footer-link" data-slx-open-tab="securities">🚫 No Offer / Non-Solicitation</button>
      <span>&bull;</span>
      <button type="button" class="slx-legal-footer-link" data-slx-open-tab="cookies">🍪 Cookie &amp; Local Storage Policy</button>
      <span>&bull;</span>
      <button type="button" class="slx-legal-footer-link" data-slx-open-tab="testnet">🧪 Testnet ($0.00) &amp; SLXR Terms</button>
    </div>
    <div class="slx-legal-footer-micro">
      SuperLexicon Protocol &amp; Contributors &bull; Informational &amp; experimental testnet demonstration only &bull; Not investment, legal, or tax advice &bull; Zero third-party advertising or tracking cookies.
    </div>
  `;

  if (existingFooter) {
    existingFooter.appendChild(footerStrip);
  } else {
    document.body.appendChild(footerStrip);
  }

  // -------------------------------------------------------------------------
  // 4. Interactive Wiring
  // -------------------------------------------------------------------------
  const storageStatusLabel = backdrop.querySelector('#slxStorageStatusLabel');
  const consentTimestampNote = backdrop.querySelector('#slxConsentTimestampNote');
  const tabBtns = Array.from(backdrop.querySelectorAll('[data-slx-tab]'));
  const panes = Array.from(backdrop.querySelectorAll('[data-slx-pane]'));

  function refreshConsentMetadata() {
    const cur = readStoredConsent();
    const keys = listLocalSlxKeys();
    if (storageStatusLabel) {
      storageStatusLabel.textContent = `Active browser keys on this origin: ${keys.length} (${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''})`;
    }
    if (consentTimestampNote) {
      if (cur && cur.acceptedAt) {
        consentTimestampNote.innerHTML = `Acknowledged <code>${cur.acceptedAt.replace('T', ' ').slice(0, 19)} UTC</code> &bull; Policy <code>${CONSENT_VERSION}</code>`;
      } else {
        consentTimestampNote.innerHTML = `Policy version <code>${CONSENT_VERSION}</code> &bull; Strictly-necessary storage only (0 ad/tracking cookies)`;
      }
    }
  }

  function setActiveTab(tabId) {
    tabBtns.forEach((btn) => {
      btn.classList.toggle('slx-active', btn.getAttribute('data-slx-tab') === tabId);
    });
    panes.forEach((pane) => {
      const paneGroup = pane.getAttribute('data-slx-pane');
      pane.style.display = tabId === 'all' || paneGroup === tabId ? '' : 'none';
    });
    const bodyEl = backdrop.querySelector('#slxLegalModalBody');
    if (bodyEl) bodyEl.scrollTop = 0;
  }

  function openModal(tabId = 'all') {
    setActiveTab(tabId);
    refreshConsentMetadata();
    backdrop.classList.add('slx-open');
  }

  function closeModal() {
    backdrop.classList.remove('slx-open');
  }

  function acceptConsent() {
    saveStoredConsent();
    banner.classList.add('slx-hidden');
    refreshConsentMetadata();
    closeModal();
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.getAttribute('data-slx-tab') || 'all');
    });
  });

  footerStrip.querySelectorAll('[data-slx-open-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal(btn.getAttribute('data-slx-open-tab') || 'all');
    });
  });

  document.getElementById('slxBannerReadMoreLink')?.addEventListener('click', () => openModal('all'));
  document.getElementById('slxBannerOpenPolicyBtn')?.addEventListener('click', () => openModal('all'));
  document.getElementById('slxBannerAcceptBtn')?.addEventListener('click', acceptConsent);
  document.getElementById('slxLegalModalAcceptBtn')?.addEventListener('click', acceptConsent);
  document.getElementById('slxLegalCloseTopBtn')?.addEventListener('click', closeModal);
  document.getElementById('slxLegalCloseBottomBtn')?.addEventListener('click', closeModal);

  document.getElementById('slxClearConsentStorageBtn')?.addEventListener('click', () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(CONSENT_STORAGE_KEY);
      }
    } catch (_) {
      // Ignore storage errors
    }
    banner.classList.remove('slx-hidden');
    refreshConsentMetadata();
    closeModal();
  });

  backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && backdrop.classList.contains('slx-open')) {
      closeModal();
    }
  });

  if (typeof window !== 'undefined') {
    window.openSlxLegalModal = openModal;
  }
}

if (typeof document !== 'undefined' && !document.body?.hasAttribute('data-slx-app-slug')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.body?.hasAttribute('data-slx-app-slug')) mountLegalConsent();
    });
  } else {
    mountLegalConsent();
  }
}
