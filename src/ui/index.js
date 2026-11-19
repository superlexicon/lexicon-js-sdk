/**
 * @superlexicon/sdk/ui
 *
 * Optional drop-in browser UI widgets for SuperLexicon web apps:
 *  - `mountSlxWalletHeader`: Unified Identity & Keypair pill + Signed Tx Inspector modal
 *  - `openIdentityCreateModal`: Interactive 1-time Nickname & `identity.wasm` deployment prompt
 *  - `mountHfsRegistryDropdown`: Global `HfsRegistry` selector dropdown + `+ New` deployment modal
 *  - `registerHfsTypeDeployer`: Pluggable deployer registry for custom HFS types
 *  - `injectSlxUiStyles`: Self-contained CSS injector so standalone pages work with zero build setup
 */

import { shortHex, truncAddr4 } from '../abi.js';
import { getDefaultNodeWsUrl, SlxHfsCache } from '../rpc.js';
import {
  HFS_TYPES,
  fetchRegisteredHfsByType,
  getUrlHfsParam,
  setUrlHfsParam,
  registerIdentityPromptHandler,
} from '../identity.js';

function escapeHtmlText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FALLBACK_CSS = `
.slx-wallet-pill-group{display:inline-flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.slx-wallet-btn{display:inline-flex;align-items:center;gap:.42rem;padding:.34rem .68rem;border-radius:.6rem;background:linear-gradient(135deg,rgba(16,185,129,.18),rgba(14,165,233,.18));border:1.5px solid rgba(52,211,153,.6);color:#ecfdf5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;font-weight:700;cursor:pointer}
.slx-wallet-dot{width:7px;height:7px;border-radius:999px;background:#34d399;box-shadow:0 0 8px #34d399;display:inline-block}
.slx-wasm-proof-pill{display:inline-flex;align-items:center;gap:.35rem;padding:.32rem .6rem;border-radius:.6rem;background:rgba(15,23,42,.9);border:1px solid rgba(56,189,248,.5);color:#bae6fd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.69rem;font-weight:700;cursor:pointer}
.slx-wasm-proof-pill.tx-pulse{border-color:#34d399;background:rgba(6,78,59,.65);color:#a7f3d0}
.slx-hfs-selector-bar{display:inline-flex;align-items:center;gap:.32rem;padding:.2rem .42rem;border-radius:999px;background:rgba(15,23,42,.88);border:1px solid rgba(56,189,248,.4);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.71rem;color:#e2e8f0}
.slx-hfs-select{background:transparent;border:none;color:#f8fafc;font-family:inherit;font-size:.71rem;font-weight:700;max-width:270px;cursor:pointer;outline:none}
.slx-hfs-select option{background:#0f172a;color:#f8fafc}
.slx-hfs-deploy-btn{padding:.22rem .52rem;border-radius:999px;border:1px solid rgba(52,211,153,.5);background:rgba(16,185,129,.18);color:#6ee7b7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.68rem;font-weight:700;cursor:pointer;white-space:nowrap}
.slx-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.84);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:1rem}
.slx-modal-backdrop.is-open{display:flex}
.slx-modal-card{width:100%;max-width:840px;max-height:88vh;overflow-y:auto;background:#0b1222;border:2px solid rgba(56,189,248,.5);border-radius:1rem;box-shadow:0 24px 64px rgba(0,0,0,.78);color:#f1f5f9;font-family:Inter,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column}
.slx-modal-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.9rem 1.15rem;border-bottom:1px solid rgba(100,116,139,.35);background:#080e1c;position:sticky;top:0;z-index:2}
.slx-modal-tabs{display:flex;gap:.45rem;padding:.65rem 1.15rem 0;border-bottom:1px solid rgba(100,116,139,.3);background:#091020}
.slx-tab-btn{padding:.48rem .85rem;border-radius:.55rem .55rem 0 0;border:1px solid transparent;border-bottom:none;background:transparent;color:#94a3b8;font-family:monospace;font-size:.74rem;font-weight:700;cursor:pointer}
.slx-tab-btn.active{background:#0b1222;border-color:rgba(56,189,248,.45);color:#7dd3fc}
.slx-modal-body{padding:1rem 1.15rem 1.2rem;display:flex;flex-direction:column;gap:.9rem;font-size:.78rem}
.slx-panel-box{background:#0f192d;border:1px solid rgba(100,116,139,.38);border-radius:.75rem;padding:.85rem;display:flex;flex-direction:column;gap:.55rem}
.slx-kv-row{display:flex;flex-direction:column;gap:.2rem}
.slx-kv-label{font-family:monospace;font-size:.67rem;font-weight:700;text-transform:uppercase;color:#94a3b8}
.slx-kv-val{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.42rem .6rem;border-radius:.5rem;background:#060b16;border:1px solid rgba(71,85,105,.55);font-family:monospace;font-size:.72rem;color:#e2e8f0;word-break:break-all}
.slx-mini-btn{padding:.3rem .62rem;border-radius:.45rem;border:1px solid rgba(100,116,139,.6);background:#16233d;color:#e2e8f0;font-family:monospace;font-size:.69rem;font-weight:700;cursor:pointer;white-space:nowrap}
.slx-mini-btn.emerald{background:#10b981;border-color:#34d399;color:#022c22}
.slx-mini-btn.sky{background:#0ea5e9;border-color:#38bdf8;color:#082f49}
.slx-input-field{flex:1;min-width:200px;padding:.45rem .65rem;border-radius:.5rem;border:1px solid rgba(100,116,139,.65);background:#050a14;color:#f8fafc;font-family:monospace;font-size:.73rem}
.slx-tx-item{padding:.52rem .65rem;border-radius:.55rem;background:#060b16;border:1px solid rgba(52,211,153,.35);font-family:monospace;font-size:.68rem;display:flex;flex-direction:column;gap:.24rem}
`;

export function injectSlxUiStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('slx-sdk-ui-styles')) return;
  const st = document.createElement('style');
  st.id = 'slx-sdk-ui-styles';
  st.textContent = FALLBACK_CSS;
  document.head.prepend(st);
}

let _activePromptPromise = null;

export function openIdentityCreateModal(
  wallet,
  { rpcUrl = getDefaultNodeWsUrl(), appName = 'SuperLexicon' } = {}
) {
  if (typeof document === 'undefined') {
    return wallet.deployUnifiedIdentityWithNickname(`Capt_${truncAddr4(wallet.keypair.address)}`, {
      rpcUrl,
    });
  }
  injectSlxUiStyles();
  if (_activePromptPromise) return _activePromptPromise;

  _activePromptPromise = new Promise((resolve) => {
    let backdrop = document.getElementById('slxIdentityPromptBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'slxIdentityPromptBackdrop';
      backdrop.className = 'slx-modal-backdrop';
      backdrop.style.zIndex = '10050';
      document.body.appendChild(backdrop);
    }

    const defaultSuggestion = `Capt_${truncAddr4(wallet.keypair.address)}`;
    backdrop.classList.add('is-open');
    backdrop.innerHTML = `
      <div class="slx-modal-card" style="max-width:520px;" onclick="event.stopPropagation()">
        <div class="slx-modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
              <strong style="font-size:0.98rem;color:#f8fafc;">🪪 Create Your On-Chain Identity</strong>
              <span style="padding:0.14rem 0.48rem;border-radius:999px;background:rgba(16,185,129,0.2);border:1px solid rgba(52,211,153,0.5);color:#6ee7b7;font-family:monospace;font-size:0.66rem;font-weight:700;">1-Time Subnet 1 Deploy</span>
            </div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:3px;">
              Welcome to <strong>${escapeHtmlText(appName)}</strong>! Deploy your personal <code>identity.wasm</code> smart contract once — shared automatically across <strong>Phantom Fleet</strong>, <strong>DEX CLOB</strong>, <strong>CorporateCharter</strong> &amp; <strong>E-Commerce</strong>.
            </div>
          </div>
        </div>
        <form id="slxIdentityCreateForm" class="slx-modal-body">
          <div class="slx-panel-box">
            <div style="font-size:0.73rem;color:#cbd5e1;display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
              <span>Active Browser Keypair:</span>
              <code style="color:#6ee7b7;font-weight:700;">${wallet.keypair.address.slice(0, 10)}…${wallet.keypair.address.slice(-6)} (${truncAddr4(wallet.keypair.address)})</code>
            </div>
            <label style="font-size:0.76rem;font-weight:700;color:#7dd3fc;margin-top:0.25rem;" for="slxIdentityNickInput">
              Choose Your Public Nickname (1–24 chars)
            </label>
            <input
              id="slxIdentityNickInput"
              class="slx-input-field"
              type="text"
              maxlength="24"
              required
              placeholder="e.g. AdmiralVex, Mano, MacroWhale"
              value="${escapeHtmlText(defaultSuggestion)}"
              style="font-size:0.88rem;padding:0.55rem 0.7rem;"
            />
            <div style="font-size:0.69rem;color:#94a3b8;">
              Rendered on-chain alongside your 4-char account tag (<code>· ${truncAddr4(wallet.keypair.address)}</code>) next to your vessels in Phantom Fleet and orders in DEX CLOB.
            </div>
          </div>
          <div id="slxIdentityCreateStatus" style="display:none;padding:0.5rem 0.7rem;border-radius:0.5rem;background:rgba(14,165,233,0.16);border:1px solid rgba(56,189,248,0.45);color:#bae6fd;font-family:monospace;font-size:0.72rem;"></div>
          <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
            <button type="submit" id="slxIdentitySubmitBtn" class="slx-mini-btn emerald" style="padding:0.55rem 1.1rem;font-size:0.82rem;">
              🚀 Deploy Identity &amp; Nickname on Subnet 1 →
            </button>
          </div>
        </form>
      </div>
    `;

    const form = backdrop.querySelector('#slxIdentityCreateForm');
    const inp = backdrop.querySelector('#slxIdentityNickInput');
    const statusEl = backdrop.querySelector('#slxIdentityCreateStatus');
    const submitBtn = backdrop.querySelector('#slxIdentitySubmitBtn');
    setTimeout(() => {
      inp?.focus();
      inp?.select();
    }, 40);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const chosen = String(inp.value || '').trim();
      if (!chosen) return;
      inp.disabled = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Deploying Identity on Subnet 1…';
      statusEl.style.display = 'block';
      try {
        const deployed = await wallet.deployUnifiedIdentityWithNickname(chosen, {
          rpcUrl,
          onStatus: (msg) => {
            statusEl.textContent = msg;
          },
        });
        backdrop.classList.remove('is-open');
        _activePromptPromise = null;
        resolve(deployed);
      } catch (err) {
        inp.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Retry Identity Deployment →';
        statusEl.style.borderColor = 'rgba(248,113,113,0.6)';
        statusEl.style.color = '#fecaca';
        statusEl.textContent = `⚠ ${err.message || err}`;
      }
    });
  });

  return _activePromptPromise;
}

// Automatically wire the interactive modal into `SlxWalletManager.ensureIdentityWithPrompt`
registerIdentityPromptHandler(openIdentityCreateModal);

export function mountSlxWalletHeader({
  wallet,
  mountContainer,
  appTitle = 'SuperLexicon HFS App',
  onWalletSwitch = null,
}) {
  if (!mountContainer || typeof document === 'undefined') return null;
  injectSlxUiStyles();

  const formatPillLabel = () => {
    const rec = wallet.getIdentityRecord();
    const tag4 = truncAddr4(wallet.keypair.address);
    return rec && rec.nickname ? `${rec.nickname} · ${tag4}` : shortHex(wallet.keypair.address);
  };

  const wrap = document.createElement('div');
  wrap.className = 'slx-wallet-pill-group';
  wrap.innerHTML = `
    <button type="button" class="slx-wallet-btn" id="slxWalletOpenBtn" title="Inspect On-Chain Identity, Nickname & secp256k1 Keypair">
      <span class="slx-wallet-dot"></span>
      <span>🪪</span>
      <span id="slxWalletAddrBadge">${escapeHtmlText(formatPillLabel())}</span>
    </button>
    <button type="button" class="slx-wasm-proof-pill" id="slxWasmOpenBtn" title="Inspect live signed Subnet 1 EIP-155 transactions">
      <span id="slxWasmCountBadge">📡 Subnet 1 Live</span>
      <span style="opacity:0.45;">|</span>
      <span id="slxTxCountBadge">0 Signed Txs</span>
    </button>
  `;
  mountContainer.prepend(wrap);

  let modal = document.getElementById('slxWalletModalBackdrop');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'slxWalletModalBackdrop';
    modal.className = 'slx-modal-backdrop';
    document.body.appendChild(modal);
  }

  let activeTab = 'wallet';
  let privRevealed = false;
  let statusBanner = '';

  function renderModal() {
    const kp = wallet.keypair;
    const idRec = wallet.getIdentityRecord();
    const cachedRpc = SlxHfsCache.load().rpcUrl || getDefaultNodeWsUrl();

    const addrEl = wrap.querySelector('#slxWalletAddrBadge');
    if (addrEl) addrEl.textContent = formatPillLabel();

    const txBadgeEl = wrap.querySelector('#slxTxCountBadge');
    if (txBadgeEl) {
      txBadgeEl.textContent = `${wallet.txHistory.length} Signed Tx${wallet.txHistory.length === 1 ? '' : 's'}`;
    }

    if (!modal.classList.contains('is-open')) return;

    modal.innerHTML = `
      <div class="slx-modal-card" onclick="event.stopPropagation()">
        <div class="slx-modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <strong style="font-size:0.96rem;color:#f8fafc;">🪪 SuperLexicon On-Chain Identity &amp; Keypair Wallet</strong>
              <span style="padding:0.15rem 0.5rem;border-radius:999px;background:rgba(16,185,129,0.2);border:1px solid rgba(52,211,153,0.5);color:#6ee7b7;font-family:monospace;font-size:0.68rem;font-weight:700;">Live RPC • secp256k1</span>
            </div>
            <div style="font-size:0.71rem;color:#94a3b8;margin-top:2px;">
              ${escapeHtmlText(appTitle)} — Shared Identity HFS across DEX, Phantom Fleet, Charter &amp; Commerce (<code>${cachedRpc}</code>).
            </div>
          </div>
          <button type="button" class="slx-mini-btn" id="slxModalCloseBtn">✕ Close</button>
        </div>

        <div class="slx-modal-tabs">
          <button type="button" class="slx-tab-btn ${activeTab === 'wallet' ? 'active' : ''}" data-slx-tab="wallet">
            🪪 Identity &amp; Keypair
          </button>
          <button type="button" class="slx-tab-btn ${activeTab === 'txs' ? 'active' : ''}" data-slx-tab="txs">
            📡 Live On-Chain Signed Txs (${wallet.txHistory.length})
          </button>
        </div>

        <div class="slx-modal-body">
          ${statusBanner ? `<div style="padding:0.48rem 0.7rem;border-radius:0.5rem;background:rgba(16,185,129,0.16);border:1px solid rgba(52,211,153,0.45);color:#a7f3d0;font-family:monospace;font-size:0.72rem;">${escapeHtmlText(statusBanner)}</div>` : ''}

          ${
            activeTab === 'wallet'
              ? `
            <div class="slx-panel-box">
              <strong style="color:#7dd3fc;font-size:0.82rem;">🪪 Shared On-Chain Identity HFS (<code>identity.wasm</code>)</strong>
              ${
                idRec
                  ? `
                    <div class="slx-kv-row">
                      <span class="slx-kv-label">Nickname &amp; 4-Char Tag</span>
                      <div class="slx-kv-val">
                        <strong style="color:#fde047;font-size:0.86rem;">${escapeHtmlText(idRec.nickname)} · ${truncAddr4(kp.address)}</strong>
                        <span style="color:#94a3b8;">(@${escapeHtmlText(idRec.handle)})</span>
                      </div>
                    </div>
                    <div class="slx-kv-row">
                      <span class="slx-kv-label">Deployed Identity HFS Address</span>
                      <div class="slx-kv-val">
                        <span style="color:#6ee7b7;font-weight:700;">${idRec.identityAddr}</span>
                        <button type="button" class="slx-mini-btn" data-copy="${idRec.identityAddr}">Copy</button>
                      </div>
                    </div>
                    <div style="display:flex;gap:0.45rem;flex-wrap:wrap;margin-top:0.2rem;">
                      <input id="slxEditNickInput" type="text" maxlength="24" class="slx-input-field" value="${escapeHtmlText(idRec.nickname)}" placeholder="New nickname (1–24 chars)" />
                      <button type="button" class="slx-mini-btn emerald" id="slxBtnSaveNick">✏ Update On-Chain Nickname</button>
                    </div>
                  `
                  : `
                    <div style="color:#cbd5e1;font-size:0.74rem;">
                      No Identity HFS deployed yet for keypair <code>${shortHex(kp.address)}</code>.
                    </div>
                    <div>
                      <button type="button" class="slx-mini-btn emerald" id="slxBtnCreateIdModal">🚀 Create Identity &amp; Nickname on Subnet 1</button>
                    </div>
                  `
              }
            </div>

            <div class="slx-panel-box">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                <strong style="color:#6ee7b7;font-size:0.82rem;">Active Connected <code>secp256k1</code> Keypair (${kp.source === 'imported' ? 'Imported Key' : 'Generated Key'})</strong>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                  <button type="button" class="slx-mini-btn emerald" id="slxBtnGenNew">⚡ Generate New Keypair</button>
                  <button type="button" class="slx-mini-btn sky" id="slxBtnExportJson">⬇ Download .json Keyfile</button>
                </div>
              </div>

              <div class="slx-kv-row">
                <span class="slx-kv-label">Account EOA Address (Truncated Tag: <code>${truncAddr4(kp.address)}</code>)</span>
                <div class="slx-kv-val">
                  <span style="color:#6ee7b7;font-weight:700;">${kp.address}</span>
                  <button type="button" class="slx-mini-btn" data-copy="${kp.address}">Copy</button>
                </div>
              </div>

              <div class="slx-kv-row">
                <span class="slx-kv-label">Private Key (32-Byte Hex — Signs EIP-155 RLP Transactions Locally)</span>
                <div class="slx-kv-val">
                  <span style="color:${privRevealed ? '#fcd34d' : '#64748b'};">${privRevealed ? kp.privateKey : '0x••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}</span>
                  <div style="display:flex;gap:0.35rem;">
                    <button type="button" class="slx-mini-btn" id="slxBtnTogglePriv">${privRevealed ? '🙈 Hide' : '👁 Reveal'}</button>
                    <button type="button" class="slx-mini-btn" data-copy="${kp.privateKey}">Copy</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="slx-panel-box">
              <strong style="color:#7dd3fc;font-size:0.82rem;">📥 Connect / Import Existing Keypair</strong>
              <div style="display:flex;gap:0.45rem;flex-wrap:wrap;margin-top:0.2rem;">
                <input id="slxImportPrivInput" type="password" class="slx-input-field" placeholder="Paste 0x... 32-byte private key or JSON" />
                <button type="button" class="slx-mini-btn emerald" id="slxBtnImportKey">Connect Keypair</button>
                <label class="slx-mini-btn" style="cursor:pointer;">
                  📂 Load .json
                  <input id="slxImportFileInput" type="file" accept=".json,application/json" style="display:none;" />
                </label>
              </div>
            </div>
          `
              : `
            <div class="slx-panel-box">
              <strong style="color:#6ee7b7;font-size:0.82rem;">📜 Live Signed EIP-155 Transactions on Subnet 1 (<code>${cachedRpc}</code>)</strong>
              <div style="display:flex;flex-direction:column;gap:0.45rem;max-height:320px;overflow-y:auto;">
                ${
                  wallet.txHistory
                    .map(
                      (tx) => `
                  <div class="slx-tx-item">
                    <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
                      <span style="color:#6ee7b7;font-weight:700;">✓ ${escapeHtmlText(tx.contractLabel)}.${escapeHtmlText(tx.fnLabel)} <span style="color:#94a3b8;">(${tx.selector})</span></span>
                      <span style="color:#fcd34d;">Blk #${tx.blockNumber} • Nonce #${tx.nonce}</span>
                    </div>
                    <div style="color:#cbd5e1;display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
                      <span>txHash: <strong style="color:#7dd3fc;">${shortHex(tx.txHash, 12, 8)}</strong></span>
                      <span>from: <strong>${shortHex(tx.from, 8, 6)}</strong> &rarr; to: <strong>${shortHex(tx.to, 8, 6)}</strong></span>
                    </div>
                  </div>
                `
                    )
                    .join('') ||
                  `<div style="color:#94a3b8;">Submit any live transaction in the app to inspect its signed EIP-155 RLP payload and Subnet 1 block receipt.</div>`
                }
              </div>
            </div>
          `
          }
        </div>
      </div>
    `;

    modal.querySelector('#slxModalCloseBtn')?.addEventListener('click', () => {
      modal.classList.remove('is-open');
    });
    modal.querySelectorAll('[data-slx-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-slx-tab');
        statusBanner = '';
        renderModal();
      });
    });
    modal.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-copy');
        navigator.clipboard?.writeText(val);
        statusBanner = `Copied ${shortHex(val, 10, 6)} to clipboard.`;
        renderModal();
      });
    });
    modal.querySelector('#slxBtnTogglePriv')?.addEventListener('click', () => {
      privRevealed = !privRevealed;
      renderModal();
    });
    modal.querySelector('#slxBtnSaveNick')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const inp = modal.querySelector('#slxEditNickInput');
      const nextNick = String(inp?.value || '').trim();
      if (!nextNick) return;
      btn.disabled = true;
      btn.textContent = '⏳ Saving…';
      try {
        await wallet.updateIdentityNickname(nextNick, { rpcUrl: cachedRpc });
        statusBanner = `✓ Updated on-chain nickname to "${nextNick}"!`;
        if (onWalletSwitch) await onWalletSwitch(wallet.keypair);
      } catch (err) {
        statusBanner = `⚠ ${err.message || err}`;
      }
      renderModal();
    });
    modal.querySelector('#slxBtnCreateIdModal')?.addEventListener('click', async () => {
      modal.classList.remove('is-open');
      await wallet.ensureIdentityWithPrompt({ rpcUrl: cachedRpc, appName: appTitle });
      if (onWalletSwitch) await onWalletSwitch(wallet.keypair);
      renderModal();
    });
    modal.querySelector('#slxBtnGenNew')?.addEventListener('click', async () => {
      const next = wallet.generateNewKeypair();
      privRevealed = false;
      modal.classList.remove('is-open');
      if (onWalletSwitch) await onWalletSwitch(next);
    });
    modal.querySelector('#slxBtnExportJson')?.addEventListener('click', () => {
      const payload = JSON.stringify(
        {
          protocol: 'SuperLexicon-HFS-Wallet-v1',
          address: kp.address,
          compressedPublicKey: kp.compressedPubKey,
          privateKey: kp.privateKey,
          identity: wallet.getIdentityRecord(),
          exportedAt: new Date().toISOString(),
        },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `superlexicon-keypair-${truncAddr4(kp.address)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      statusBanner = `Downloaded keyfile for ${kp.address}`;
      renderModal();
    });
    modal.querySelector('#slxBtnImportKey')?.addEventListener('click', async () => {
      const inp = modal.querySelector('#slxImportPrivInput');
      try {
        const imported = wallet.importPrivateKey(inp?.value || '');
        statusBanner = `Connected imported keypair: ${imported.address}`;
        if (onWalletSwitch) await onWalletSwitch(imported);
        renderModal();
      } catch (err) {
        statusBanner = `⚠ ${err.message || 'Invalid private key'}`;
        renderModal();
      }
    });
    modal.querySelector('#slxImportFileInput')?.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const txt = await file.text();
        const parsedJson = txt.trim().startsWith('{') ? JSON.parse(txt) : null;
        const imported = wallet.importPrivateKey(txt);
        if (parsedJson?.identity?.identityAddr) {
          wallet.saveIdentityRecord(parsedJson.identity, imported.address);
        }
        statusBanner = `Loaded keyfile: ${imported.address}`;
        if (onWalletSwitch) await onWalletSwitch(imported);
        renderModal();
      } catch (err) {
        statusBanner = `⚠ ${err.message || 'Invalid keyfile JSON'}`;
        renderModal();
      }
    });
  }

  modal.onclick = () => modal.classList.remove('is-open');

  wrap.querySelector('#slxWalletOpenBtn')?.addEventListener('click', () => {
    activeTab = 'wallet';
    statusBanner = '';
    modal.classList.add('is-open');
    renderModal();
  });

  wrap.querySelector('#slxWasmOpenBtn')?.addEventListener('click', () => {
    activeTab = 'txs';
    statusBanner = '';
    modal.classList.add('is-open');
    renderModal();
  });

  wallet.onChange(() => {
    const pill = wrap.querySelector('#slxWasmOpenBtn');
    if (pill) {
      pill.classList.add('tx-pulse');
      setTimeout(() => pill.classList.remove('tx-pulse'), 450);
    }
    renderModal();
  });

  return { refresh: renderModal };
}

const _registeredDeployers = new Map();

export function registerHfsTypeDeployer(typeName, deployerFn) {
  if (typeName && typeof deployerFn === 'function') {
    _registeredDeployers.set(String(typeName), deployerFn);
  }
}

export function mountHfsRegistryDropdown({
  mountContainer,
  wallet,
  typeName,
  rpcUrlFn = () => getDefaultNodeWsUrl(),
  getCurrentPrimaryAddr = () => '',
  onSelectInstance = null,
  customDeployFn = null,
  onCustomDeployClick = null,
}) {
  if (!mountContainer || typeof document === 'undefined') return null;
  injectSlxUiStyles();

  const spec = HFS_TYPES[typeName] || {
    typeName,
    icon: '🗂️',
    shortLabel: typeName,
    deployBtnText: null,
    modalTitle: `Deploy ${typeName}`,
    placeholder: '',
  };

  const defaultDeployer = customDeployFn || _registeredDeployers.get(typeName) || null;

  const bar = document.createElement('div');
  bar.className = 'slx-hfs-selector-bar';
  bar.innerHTML = `
    <span title="Global On-Chain HfsRegistry (${escapeHtmlText(spec.typeName)})">${spec.icon}</span>
    <select class="slx-hfs-select" id="slxHfsSelect_${escapeHtmlText(typeName)}" title="Switch active ${escapeHtmlText(spec.shortLabel)} from Global HfsRegistry">
      <option value="">Loading ${escapeHtmlText(spec.shortLabel)}s…</option>
    </select>
    <button type="button" class="slx-mini-btn" id="slxHfsRefresh_${escapeHtmlText(typeName)}" title="Refresh deployed ${escapeHtmlText(spec.typeName)} list from HfsRegistry" style="padding:0.12rem 0.36rem;font-size:0.66rem;">↻</button>
    ${
      (defaultDeployer || onCustomDeployClick) && spec.deployBtnText
        ? `<button type="button" class="slx-hfs-deploy-btn" id="slxHfsDeploy_${escapeHtmlText(typeName)}">${escapeHtmlText(spec.deployBtnText)}</button>`
        : ''
    }
  `;
  mountContainer.prepend(bar);

  const selectEl = bar.querySelector(`#slxHfsSelect_${typeName}`);
  const refreshBtn = bar.querySelector(`#slxHfsRefresh_${typeName}`);
  const deployBtn = bar.querySelector(`#slxHfsDeploy_${typeName}`);

  let instances = [];
  let initialUrlApplied = false;

  async function refreshList({ selectKey = null, triggerCallbackIfUrlMatched = false } = {}) {
    try {
      const rpcUrl = rpcUrlFn();
      instances = await fetchRegisteredHfsByType(typeName, { rpcUrl });
      if (!instances.length) {
        const cur = getCurrentPrimaryAddr();
        selectEl.innerHTML = `<option value="">${cur ? `${spec.shortLabel} · ${shortHex(cur)}` : `No ${spec.shortLabel}s registered`}</option>`;
        return instances;
      }

      const urlAddr = getUrlHfsParam();
      const curAddr = String(getCurrentPrimaryAddr() || '').toLowerCase();

      let chosen = null;
      if (selectKey) {
        chosen = instances.find((it) => it.selectionKey === selectKey || it.primaryAddr === selectKey);
      }
      if (!chosen && !initialUrlApplied && urlAddr) {
        chosen = instances.find(
          (it) => it.primaryAddr === urlAddr || it.selectionKey.startsWith(urlAddr)
        );
        if (chosen) {
          initialUrlApplied = true;
          if (triggerCallbackIfUrlMatched && chosen.primaryAddr !== curAddr && onSelectInstance) {
            await onSelectInstance(chosen);
          }
        }
      }
      if (!chosen && curAddr) {
        chosen = instances.find((it) => it.primaryAddr === curAddr);
      }
      if (!chosen) chosen = instances[0];

      selectEl.innerHTML = instances
        .map((it) => {
          const sel = chosen && it.selectionKey === chosen.selectionKey ? 'selected' : '';
          const byStr = it.creatorTag ? ` · by ${it.creatorTag}` : '';
          return `<option value="${escapeHtmlText(it.selectionKey)}" ${sel}>${escapeHtmlText(it.label)} (${shortHex(it.primaryAddr, 6, 4)})${escapeHtmlText(byStr)}</option>`;
        })
        .join('');
    } catch (_) {}
    return instances;
  }

  selectEl?.addEventListener('change', async () => {
    const key = selectEl.value;
    const picked = instances.find((it) => it.selectionKey === key);
    if (!picked) return;
    setUrlHfsParam(picked.primaryAddr);
    if (onSelectInstance) {
      await onSelectInstance(picked);
    }
  });

  refreshBtn?.addEventListener('click', () => {
    refreshList();
  });

  deployBtn?.addEventListener('click', () => {
    if (onCustomDeployClick) {
      onCustomDeployClick({ refreshList, setUrlHfsParam });
    } else if (defaultDeployer) {
      openDeployModal();
    }
  });

  function openDeployModal() {
    if (!defaultDeployer) return;
    let backdrop = document.getElementById('slxHfsDeployModalBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'slxHfsDeployModalBackdrop';
      backdrop.className = 'slx-modal-backdrop';
      document.body.appendChild(backdrop);
    }
    backdrop.classList.add('is-open');
    backdrop.innerHTML = `
      <div class="slx-modal-card" style="width:min(490px,95vw);" onclick="event.stopPropagation()">
        <div class="slx-modal-header">
          <div>
            <strong style="font-size:0.95rem;color:#f8fafc;">${spec.icon} ${escapeHtmlText(spec.modalTitle)}</strong>
            <div style="font-size:0.71rem;color:#94a3b8;margin-top:2px;">
              Instantiates a live WASM HFS on Subnet 1 and registers it in <code>HfsRegistry</code> under your Unified Identity.
            </div>
          </div>
          <button type="button" class="slx-mini-btn" id="slxHfsDeployClose">✕</button>
        </div>
        <form id="slxHfsDeployForm" class="slx-modal-body">
          <div class="slx-panel-box">
            <label style="font-size:0.75rem;font-weight:700;color:#7dd3fc;" for="slxHfsDeployLabel">
              Instance Display Name (shown in Global Dropdown)
            </label>
            <input
              id="slxHfsDeployLabel"
              class="slx-input-field"
              type="text"
              maxlength="48"
              required
              placeholder="${escapeHtmlText(spec.placeholder)}"
            />
          </div>
          <div id="slxHfsDeployStatus" style="display:none;padding:0.48rem 0.7rem;border-radius:0.5rem;background:rgba(14,165,233,0.16);border:1px solid rgba(56,189,248,0.45);color:#bae6fd;font-family:monospace;font-size:0.72rem;"></div>
          <div style="display:flex;justify-content:flex-end;gap:0.45rem;">
            <button type="button" class="slx-mini-btn" id="slxHfsDeployCancel">Cancel</button>
            <button type="submit" class="slx-mini-btn emerald" id="slxHfsDeploySubmit" style="padding:0.5rem 1rem;">
              🚀 Deploy &amp; Register on Subnet 1
            </button>
          </div>
        </form>
      </div>
    `;

    backdrop.onclick = () => backdrop.classList.remove('is-open');
    backdrop.querySelector('#slxHfsDeployClose')?.addEventListener('click', () => {
      backdrop.classList.remove('is-open');
    });
    backdrop.querySelector('#slxHfsDeployCancel')?.addEventListener('click', () => {
      backdrop.classList.remove('is-open');
    });

    const inp = backdrop.querySelector('#slxHfsDeployLabel');
    const statusEl = backdrop.querySelector('#slxHfsDeployStatus');
    const submitBtn = backdrop.querySelector('#slxHfsDeploySubmit');
    setTimeout(() => inp?.focus(), 40);

    backdrop.querySelector('#slxHfsDeployForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const label = String(inp?.value || '').trim();
      if (!label) return;
      inp.disabled = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Deploying on Subnet 1…';
      statusEl.style.display = 'block';
      try {
        const created = await defaultDeployer({
          wallet,
          label,
          rpcUrl: rpcUrlFn(),
          onStatus: (s) => {
            statusEl.textContent = s;
          },
        });
        backdrop.classList.remove('is-open');
        setUrlHfsParam(created.primaryAddr);
        await refreshList({ selectKey: created.selectionKey });
        if (onSelectInstance) {
          const matched =
            instances.find((it) => it.selectionKey === created.selectionKey) || created;
          await onSelectInstance(matched);
        }
      } catch (err) {
        inp.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Retry Deploy & Register';
        statusEl.textContent = `⚠ ${err?.message || err}`;
      }
    });
  }

  refreshList({ triggerCallbackIfUrlMatched: true });

  function setSelectedAddr(addrHex) {
    if (!selectEl || !addrHex) return;
    const low = String(addrHex).toLowerCase();
    const matched = instances.find((it) => it.primaryAddr === low || it.selectionKey === low);
    if (matched) {
      selectEl.value = matched.selectionKey;
    }
  }

  return { refreshList, getInstances: () => instances, openDeployModal, setSelectedAddr };
}
