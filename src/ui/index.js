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
import { slxSubscribeStats, slxSubscribeNewHeads } from '../events.js';
import {
  HFS_TYPES,
  fetchRegisteredHfsByType,
  getUrlHfsParam,
  setUrlHfsParam,
  registerIdentityPromptHandler,
} from '../identity.js';
import { SlxSocialClient } from '../social.js';

function escapeHtmlText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FALLBACK_CSS = `
.slx-sticky-top-stack{position:sticky;top:0;z-index:45;display:flex;flex-direction:column;width:100%;flex-shrink:0}
.slx-chain-bar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;width:100%;height:40px;min-height:40px;padding:0 1.2rem;background:linear-gradient(90deg,#040914 0%,#071226 50%,#040914 100%);border-bottom:1px solid rgba(56,189,248,.28);font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;color:#dbeafe;white-space:nowrap;overflow-x:auto;scrollbar-width:none;flex-shrink:0;z-index:50}
.slx-chain-bar.embedded{height:38px;min-height:38px;padding:0 1.25rem;background:rgba(4,9,20,.94);border-top:1px solid rgba(56,189,248,.24);border-bottom:none;font-size:.76rem}
.slx-chain-bar::-webkit-scrollbar{display:none}
.slx-cb-group{display:inline-flex;align-items:center;gap:.52rem;flex-shrink:0}
.slx-cb-sep{color:rgba(100,116,139,.45);user-select:none}
.slx-cb-net{display:inline-flex;align-items:center;gap:.42rem;font-size:.78rem;font-weight:800;color:#ecfdf5;letter-spacing:.03em}
.slx-cb-dot{width:8.5px;height:8.5px;border-radius:999px;background:#f59e0b;box-shadow:0 0 7px #f59e0b;display:inline-block;transition:all .2s ease}
.slx-cb-dot.live{background:#10b981;box-shadow:0 0 9px #10b981}
.slx-cb-chip{display:inline-flex;align-items:center;gap:.32rem;padding:.18rem .56rem;border-radius:.42rem;background:rgba(15,23,42,.94);border:1px solid rgba(71,85,105,.58);color:#f1f5f9;font-family:inherit;font-size:.74rem;font-weight:700;line-height:1.25}
.slx-cb-chip.clickable{cursor:pointer;transition:all .14s ease}
.slx-cb-chip.clickable:hover{border-color:#38bdf8;color:#fff;background:rgba(14,165,233,.16)}
.slx-cb-chip.emerald{border-color:rgba(52,211,153,.45);background:rgba(6,78,59,.35);color:#6ee7b7}
.slx-cb-chip.cyan{border-color:rgba(56,189,248,.45);background:rgba(12,74,110,.32);color:#7dd3fc}
.slx-cb-blk{font-size:.82rem;font-weight:800;color:#38bdf8;transition:color .18s ease,transform .18s ease;display:inline-block}
.slx-cb-blk.bump{color:#6ee7b7;transform:translateY(-1px)}
.slx-cb-phases{display:inline-flex;align-items:center;gap:3px;padding:2px;border-radius:.42rem;background:rgba(2,6,23,.88);border:1px solid rgba(51,65,85,.7)}
.slx-cb-phase{padding:.15rem .44rem;border-radius:.3rem;font-size:.69rem;font-weight:700;color:#64748b;transition:all .12s ease}
.slx-cb-phase.active{background:rgba(56,189,248,.24);color:#bae6fd;box-shadow:inset 0 0 0 1px rgba(56,189,248,.6)}
.slx-cb-phase.active.p4{background:rgba(16,185,129,.26);color:#6ee7b7;box-shadow:inset 0 0 0 1px rgba(52,211,153,.65)}
.slx-cb-link{display:inline-flex;align-items:center;gap:.28rem;padding:.18rem .56rem;border-radius:.42rem;border:1px solid rgba(56,189,248,.46);background:rgba(14,165,233,.14);color:#7dd3fc;text-decoration:none;font-weight:700;font-size:.74rem;transition:all .14s ease}
.slx-cb-link:hover{background:rgba(14,165,233,.24);border-color:#38bdf8;color:#fff}
.slx-wallet-pill-group{display:inline-flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.slx-wallet-btn{display:inline-flex;align-items:center;gap:.45rem;padding:.44rem .82rem;border-radius:.65rem;background:linear-gradient(135deg,rgba(16,185,129,.2),rgba(14,165,233,.2));border:1.5px solid rgba(52,211,153,.65);color:#ecfdf5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;font-weight:700;cursor:pointer}
.slx-wallet-dot{width:8px;height:8px;border-radius:999px;background:#34d399;box-shadow:0 0 8px #34d399;display:inline-block}
.slx-wasm-proof-pill{display:inline-flex;align-items:center;gap:.38rem;padding:.42rem .72rem;border-radius:.65rem;background:rgba(15,23,42,.92);border:1px solid rgba(56,189,248,.52);color:#bae6fd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;font-weight:700;cursor:pointer}
.slx-wasm-proof-pill.tx-pulse{border-color:#34d399;background:rgba(6,78,59,.65);color:#a7f3d0}
.slx-hfs-selector-bar{display:inline-flex;align-items:center;gap:.38rem;padding:.32rem .6rem;border-radius:999px;background:rgba(15,23,42,.92);border:1px solid rgba(56,189,248,.45);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.77rem;color:#e2e8f0}
.slx-hfs-select{background:transparent;border:none;color:#f8fafc;font-family:inherit;font-size:.77rem;font-weight:700;max-width:280px;cursor:pointer;outline:none}
.slx-hfs-select option{background:#0f172a;color:#f8fafc}
.slx-hfs-deploy-btn{padding:.28rem .62rem;border-radius:999px;border:1px solid rgba(52,211,153,.55);background:rgba(16,185,129,.2);color:#6ee7b7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.73rem;font-weight:700;cursor:pointer;white-space:nowrap}
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
.slx-mini-btn{padding:.34rem .68rem;border-radius:.45rem;border:1px solid rgba(100,116,139,.6);background:#16233d;color:#e2e8f0;font-family:monospace;font-size:.73rem;font-weight:700;cursor:pointer;white-space:nowrap}
.slx-mini-btn.emerald{background:#10b981;border-color:#34d399;color:#022c22}
.slx-mini-btn.sky{background:#0ea5e9;border-color:#38bdf8;color:#082f49}
.slx-input-field{flex:1;min-width:200px;padding:.45rem .65rem;border-radius:.5rem;border:1px solid rgba(100,116,139,.65);background:#050a14;color:#f8fafc;font-family:monospace;font-size:.74rem}
.slx-tx-item{padding:.52rem .65rem;border-radius:.55rem;background:#060b16;border:1px solid rgba(52,211,153,.35);font-family:monospace;font-size:.7rem;display:flex;flex-direction:column;gap:.24rem}
.slx-social-pill-group{display:inline-flex;align-items:center;gap:.38rem;flex-wrap:wrap}
.slx-social-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.42rem .76rem;border-radius:.65rem;background:rgba(15,23,42,.94);border:1px solid rgba(168,85,247,.58);color:#e9d5ff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.77rem;font-weight:700;cursor:pointer;transition:all .16s ease;white-space:nowrap}
.slx-social-btn:hover{border-color:#c084fc;background:rgba(88,28,135,.36);color:#fff}
.slx-social-btn.msgs{border-color:rgba(56,189,248,.55);color:#bae6fd}
.slx-social-btn.msgs:hover{border-color:#38bdf8;background:rgba(14,165,233,.22);color:#fff}
.slx-social-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 .36rem;border-radius:999px;font-size:.68rem;font-weight:800;line-height:1}
.slx-social-badge.violet{background:rgba(168,85,247,.28);border:1px solid rgba(192,132,252,.65);color:#f3e8ff}
.slx-social-badge.amber{background:rgba(245,158,11,.28);border:1px solid rgba(251,191,36,.85);color:#fde68a;box-shadow:0 0 8px rgba(245,158,11,.45)}
.slx-social-badge.cyan{background:rgba(14,165,233,.28);border:1px solid rgba(56,189,248,.8);color:#e0f2fe}
.slx-social-drawer-backdrop{position:fixed;top:var(--slx-unified-hdr-h,114px);right:0;bottom:0;left:0;z-index:9850;background:rgba(2,6,23,.48);backdrop-filter:blur(3px);display:none;justify-content:flex-end}
.slx-social-drawer-backdrop.is-open{display:flex}
.slx-social-drawer{width:min(450px,96vw);height:100%;background:linear-gradient(180deg,#080f1e 0%,#0b1326 100%);border-left:1.5px solid rgba(56,189,248,.45);box-shadow:-20px 0 56px rgba(0,0,0,.78);color:#f1f5f9;font-family:Inter,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.slx-soc-hdr{padding:.8rem 1rem .65rem;background:#060b17;border-bottom:1px solid rgba(71,85,105,.45);display:flex;flex-direction:column;gap:.55rem;flex-shrink:0}
.slx-soc-mode-tabs{display:grid;grid-template-columns:1fr 1fr;gap:.4rem}
.slx-soc-mode-btn{display:inline-flex;align-items:center;justify-content:center;gap:.38rem;padding:.45rem .65rem;border-radius:.5rem;border:1px solid rgba(71,85,105,.55);background:rgba(15,23,42,.75);color:#94a3b8;font-family:monospace;font-size:.75rem;font-weight:700;cursor:pointer}
.slx-soc-mode-btn.active{background:rgba(14,165,233,.18);border-color:rgba(56,189,248,.75);color:#f8fafc}
.slx-soc-subtabs{display:flex;gap:.35rem;padding:.48rem 1rem;background:#081020;border-bottom:1px solid rgba(51,65,85,.55);flex-shrink:0}
.slx-soc-subtab{flex:1;padding:.35rem .48rem;border-radius:.42rem;border:1px solid transparent;background:rgba(15,23,42,.65);color:#94a3b8;font-family:monospace;font-size:.7rem;font-weight:700;cursor:pointer;text-align:center}
.slx-soc-subtab.active{background:rgba(16,185,129,.18);border-color:rgba(52,211,153,.6);color:#6ee7b7}
.slx-soc-scroll{flex:1;overflow-y:auto;padding:.8rem 1rem;display:flex;flex-direction:column;gap:.68rem}
.slx-soc-sec-title{display:flex;align-items:center;justify-content:space-between;font-family:monospace;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#7dd3fc;margin-top:.15rem}
.slx-soc-peer-row{display:flex;align-items:center;justify-content:space-between;gap:.55rem;padding:.55rem .68rem;border-radius:.55rem;background:rgba(15,25,45,.92);border:1px solid rgba(71,85,105,.45)}
.slx-soc-peer-row.ally{border-color:rgba(52,211,153,.42);background:rgba(6,78,59,.2)}
.slx-soc-peer-row.incoming{border-color:rgba(251,191,36,.65);background:rgba(120,53,15,.25)}
.slx-soc-msg-bubble{padding:.52rem .68rem;border-radius:.6rem;background:rgba(15,23,42,.92);border:1px solid rgba(71,85,105,.5);display:flex;flex-direction:column;gap:.22rem;font-size:.78rem}
.slx-soc-msg-bubble.mine{background:rgba(12,74,110,.38);border-color:rgba(56,189,248,.55);margin-left:1.1rem}
.slx-soc-composer{padding:.7rem 1rem;background:#060b17;border-top:1px solid rgba(71,85,105,.48);display:flex;gap:.45rem;align-items:center;flex-shrink:0}
.slx-unified-header{position:sticky;top:0;z-index:60;display:flex;flex-direction:column;width:100%;flex-shrink:0;background:linear-gradient(180deg,#0d172b 0%,#091122 100%);border-bottom:1px solid rgba(56,189,248,.34);box-shadow:0 8px 28px rgba(0,0,0,.45);color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif}
.slx-uh-main-row{display:flex;align-items:center;justify-content:space-between;gap:.9rem;min-height:76px;padding:.55rem 1.25rem;flex-wrap:wrap}
.slx-uh-left{display:flex;align-items:center;gap:.95rem;min-width:0;flex:1 1 auto}
.slx-uh-logo-link{display:inline-flex;align-items:center;flex-shrink:0;text-decoration:none;transition:opacity .15s ease,transform .15s ease}
.slx-uh-logo-link:hover{opacity:.94;transform:translateY(-1px)}
.slx-uh-logo{height:66px;width:auto;object-fit:contain;display:block}
@media(max-width:1024px){.slx-uh-logo{height:52px}}
@media(max-width:640px){.slx-uh-logo{height:40px}}
.slx-uh-divider{width:1.5px;height:46px;background:rgba(100,116,139,.5);flex-shrink:0}
.slx-uh-titles{display:flex;flex-direction:column;min-width:0;gap:3px}
.slx-uh-title{font-size:1.18rem;font-weight:800;color:#f8fafc;letter-spacing:-.015em;line-height:1.22;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-uh-subtitle{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;color:#94a3b8;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:900px){.slx-uh-subtitle{display:none}}
.slx-uh-context{display:inline-flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-left:.35rem}
.slx-uh-right{display:inline-flex;align-items:center;gap:.45rem;flex-wrap:wrap;flex-shrink:0}
.slx-uh-extra{display:inline-flex;align-items:center;gap:.42rem;flex-wrap:wrap}
.slx-uh-apps-wrap{position:relative;display:inline-flex}
.slx-uh-apps-btn{display:inline-flex;align-items:center;gap:.42rem;padding:.42rem .8rem;border-radius:.65rem;background:rgba(14,165,233,.16);border:1px solid rgba(56,189,248,.58);color:#e0f2fe;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;font-weight:700;cursor:pointer;transition:all .15s ease;white-space:nowrap}
.slx-uh-apps-btn:hover,.slx-uh-apps-btn[aria-expanded='true']{background:rgba(14,165,233,.26);border-color:#38bdf8;color:#fff}
.slx-uh-apps-menu{position:absolute;top:calc(100% + 6px);right:0;width:315px;max-height:82vh;overflow-y:auto;padding:.5rem;border-radius:.85rem;background:#0a1224;border:1.5px solid rgba(56,189,248,.52);box-shadow:0 20px 48px rgba(0,0,0,.78);display:none;flex-direction:column;gap:.2rem;z-index:9930}
.slx-uh-apps-menu.is-open{display:flex}
.slx-uh-apps-group-lbl{padding:.3rem .52rem .14rem;font-family:monospace;font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.slx-uh-app-item{display:flex;align-items:center;justify-content:space-between;gap:.55rem;padding:.48rem .6rem;border-radius:.55rem;border:1px solid transparent;color:#e2e8f0;text-decoration:none;transition:all .13s ease}
.slx-uh-app-item:hover{background:rgba(30,41,59,.85);border-color:rgba(56,189,248,.35);color:#fff}
.slx-uh-app-item.active{background:rgba(14,165,233,.18);border-color:rgba(56,189,248,.65);color:#7dd3fc}
.slx-uh-suite-pills{display:inline-flex;align-items:center;gap:.4rem;flex-wrap:wrap}
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
      <span>📜</span>
      <span id="slxTxCountBadge">0 Txs</span>
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
      txBadgeEl.textContent = `${wallet.txHistory.length} Tx${wallet.txHistory.length === 1 ? '' : 's'}`;
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

function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function normHexPrefixed(h) {
  if (!h) return '';
  const s = String(h).trim();
  if (!s || s.startsWith('seed-')) return '';
  return s.startsWith('0x') || s.startsWith('0X') ? s.toLowerCase() : '0x' + s.toLowerCase();
}

/**
 * Standardized 34px Horizontal Live Blockchain Telemetry Bar (`mountSlxChainBar`)
 *
 * Mounts at the identical top edge (`y = 0`) across all SuperLexicon App UIs (`DEX`, `Charter`,
 * `Commerce`, `Phantom Fleet`, `CommonsRF`, `Fractured Hegemony`, `Cipher Noir`) and external SDK apps, streaming live
 * validator `stats` + `newHeads` over the shared multiplexed WebSocket with zero polling:
 *  - Subnet 1 Live Status + Active Validator Quorum (`3 Val`)
 *  - Finalized Block Height (`#56,500`) + Click-to-Copy Block Hash
 *  - Real-Time 4-Phase Consensus Progression (`P1 TX -> P2 VOTE -> P3 PROP -> P4 FIN`)
 *  - Live Throughput (`tx/s`), Block Fill (`txs/blk`) & Finality Latency (`4.27s`)
 *  - Live Mempool Queue + Cumulative Chain Confirmed Transactions + `$0.00 Gas`
 *  - Active HFS Contract Address Chip (Click-to-Copy) + Optional `⚙ Node` Toggle + `📊 Explorer ↗`
 */
export function mountSlxChainBar({
  mountContainer = null,
  rpcUrlFn = () => getDefaultNodeWsUrl(),
  getContractAddr = () => '',
  getContractLabel = () => 'HFS',
  onToggleNodeDrawer = null,
  explorerHref = '/#slide-4',
  embedded = false,
} = {}) {
  if (typeof document === 'undefined') return null;
  injectSlxUiStyles();

  let host = mountContainer;
  if (!host) {
    host = document.getElementById('slxChainBarMount');
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'slxChainBarMount';
    document.body.prepend(host);
  }

  // Idempotent replace if already mounted in this container
  host.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = embedded ? 'slx-chain-bar embedded' : 'slx-chain-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'SuperLexicon Live Blockchain Telemetry');
  bar.innerHTML = `
    <div class="slx-cb-group">
      <span class="slx-cb-net" title="Connected to SuperLexicon Subnet 1 BFT Blockchain Mesh">
        <span class="slx-cb-dot" data-cb="dot"></span>
        <span>SUBNET 1 CHAIN</span>
      </span>
      <span class="slx-cb-chip" data-cb="vals" title="Active BFT Validators &amp; Mesh Peers">— Val</span>
      <span class="slx-cb-sep">│</span>
      <span>BLK <strong class="slx-cb-blk" data-cb="height">#—</strong></span>
      <button type="button" class="slx-cb-chip clickable" data-cb="hash" title="Click to copy latest finalized block hash" style="display:none;">—</button>
      <span class="slx-cb-sep">│</span>
      <div class="slx-cb-phases" title="Real-Time 4-Phase BFT Consensus Pipeline">
        <span class="slx-cb-phase" data-cb-phase="1">P1 TX</span>
        <span class="slx-cb-phase" data-cb-phase="2">P2 VOTE</span>
        <span class="slx-cb-phase" data-cb-phase="3">P3 PROP</span>
        <span class="slx-cb-phase p4" data-cb-phase="4">P4 FIN</span>
      </div>
    </div>

    <div class="slx-cb-group">
      <span class="slx-cb-chip emerald" data-cb="tps" title="Rolling finalized Subnet 1 throughput">⚡ — tx/s</span>
      <span class="slx-cb-chip" data-cb="blkmeta" title="Transactions &amp; BFT finality latency of latest block">— txs/blk • —s</span>
      <span class="slx-cb-chip" data-cb="mempool" title="Merged Subnet 1 mempool queue">Mempool: 0</span>
      <span class="slx-cb-chip" data-cb="totaltxs" title="Cumulative finalized transactions since Subnet 1 genesis">∑ — txs</span>
      <span class="slx-cb-chip emerald" title="Zero gas fees via explicit extraTargets parallel execution">$0.00 Gas</span>
    </div>

    <div class="slx-cb-group">
      <button type="button" class="slx-cb-chip cyan clickable" data-cb="hfs" title="Click to copy active HFS smart contract address" style="display:none;"></button>
      ${
        typeof onToggleNodeDrawer === 'function'
          ? `<button type="button" class="slx-cb-chip clickable" data-cb="nodebtn" title="Toggle RPC Node &amp; Deployment Inspector">⚙ Node</button>`
          : ''
      }
      <a class="slx-cb-link" href="${escapeHtmlText(explorerHref)}" title="Open Subnet 1 Live Validator &amp; HFS Explorer">📊 Explorer ↗</a>
    </div>
  `;
  host.appendChild(bar);

  const refs = {
    dot: bar.querySelector('[data-cb="dot"]'),
    vals: bar.querySelector('[data-cb="vals"]'),
    height: bar.querySelector('[data-cb="height"]'),
    hash: bar.querySelector('[data-cb="hash"]'),
    tps: bar.querySelector('[data-cb="tps"]'),
    blkmeta: bar.querySelector('[data-cb="blkmeta"]'),
    mempool: bar.querySelector('[data-cb="mempool"]'),
    totaltxs: bar.querySelector('[data-cb="totaltxs"]'),
    hfs: bar.querySelector('[data-cb="hfs"]'),
    nodebtn: bar.querySelector('[data-cb="nodebtn"]'),
    phases: Array.from(bar.querySelectorAll('[data-cb-phase]')),
  };

  const st = {
    live: false,
    height: 0,
    blockHash: '',
    phase: 0,
    validators: 0,
    peers: 0,
    mempool: 0,
    confirmedTotal: 0,
    lastBlockTxs: 0,
    lastConfirmMs: 0,
    recentBlocks: new Map(), // height -> { txs, confirmMs }
    tps: 0,
    hashCopiedUntil: 0,
    hfsCopiedUntil: 0,
  };

  function recomputeRollingTps() {
    const entries = Array.from(st.recentBlocks.values()).slice(-6);
    if (entries.length === 0) return;
    let sumTxs = 0;
    let sumMs = 0;
    const fallbackMs = st.lastConfirmMs > 0 ? st.lastConfirmMs : 4280;
    for (const e of entries) {
      sumTxs += Number(e.txs || 0);
      sumMs += Number(e.confirmMs > 0 ? e.confirmMs : fallbackMs);
    }
    if (sumMs > 0) {
      st.tps = sumTxs / (sumMs / 1000);
    }
  }

  function setPhaseHighlight(p) {
    st.phase = p;
    for (const el of refs.phases) {
      const idx = Number(el.getAttribute('data-cb-phase'));
      el.classList.toggle('active', idx === p);
    }
  }

  function applyP4Sample(pm) {
    if (!pm) return;
    const h = Number(pm.blockHeight || 0);
    if (h >= st.height) {
      if (h > st.height && st.height > 0 && refs.height) {
        refs.height.classList.add('bump');
        setTimeout(() => refs.height?.classList.remove('bump'), 450);
      }
      if (h > 0) st.height = h;
      const bh = normHexPrefixed(pm.blockHash);
      if (bh) st.blockHash = bh;
    }
    const cMs = Number(pm.confirmMs || pm.rollingAvgConfirmMs || 0);
    if (cMs > 0) {
      st.lastConfirmMs = cMs;
    }
    if (typeof pm.phaseValue === 'number' && pm.phaseValue >= 0) {
      if (h >= st.height) st.lastBlockTxs = pm.phaseValue;
      if (h > 0) {
        st.recentBlocks.set(h, { txs: pm.phaseValue, confirmMs: cMs || st.lastConfirmMs || 4280 });
        while (st.recentBlocks.size > 8) {
          const oldest = st.recentBlocks.keys().next().value;
          if (oldest !== undefined) st.recentBlocks.delete(oldest);
        }
      }
    }
    recomputeRollingTps();
  }

  function renderHfsChip() {
    if (!refs.hfs) return;
    const addr = normHexPrefixed(getContractAddr?.());
    if (!addr || /^0x0{40}$/.test(addr)) {
      refs.hfs.style.display = 'none';
      return;
    }
    refs.hfs.style.display = 'inline-flex';
    const label = String(getContractLabel?.() || 'HFS').trim();
    if (Date.now() < st.hfsCopiedUntil) {
      refs.hfs.textContent = `✓ Copied ${shortHex(addr, 6, 4)}`;
    } else {
      refs.hfs.textContent = `${label} ${shortHex(addr, 6, 4)}`;
    }
    refs.hfs.title = `Active ${label} HFS: ${addr} (click to copy)`;
  }

  function renderBar() {
    if (refs.dot) refs.dot.classList.toggle('live', st.live);
    if (refs.vals) {
      refs.vals.textContent = st.validators > 0 ? `${st.validators} Val` : 'Sync…';
      refs.vals.title = `${st.validators} Active BFT Validators • ${st.peers} Connected Mesh Peers`;
    }
    if (refs.height && st.height > 0) {
      refs.height.textContent = `#${fmtInt(st.height)}`;
    }
    if (refs.hash) {
      if (st.blockHash) {
        refs.hash.style.display = 'inline-flex';
        refs.hash.textContent =
          Date.now() < st.hashCopiedUntil ? '✓ Copied!' : shortHex(st.blockHash, 8, 4);
        refs.hash.title = `Finalized Block #${fmtInt(st.height)} Hash: ${st.blockHash} (click to copy)`;
      } else {
        refs.hash.style.display = 'none';
      }
    }
    if (refs.tps) {
      refs.tps.textContent = st.lastConfirmMs > 0 ? `⚡ ${st.tps.toFixed(1)} tx/s` : '⚡ Live';
    }
    if (refs.blkmeta) {
      const finStr = st.lastConfirmMs > 0 ? `${(st.lastConfirmMs / 1000).toFixed(2)}s` : '—s';
      refs.blkmeta.textContent = `${fmtInt(st.lastBlockTxs)} txs/blk • ${finStr}`;
    }
    if (refs.mempool) {
      refs.mempool.textContent = `Mempool: ${fmtInt(st.mempool)}`;
    }
    if (refs.totaltxs && st.confirmedTotal > 0) {
      refs.totaltxs.textContent = `∑ ${fmtInt(st.confirmedTotal)} txs`;
    }
    renderHfsChip();
  }

  refs.hash?.addEventListener('click', () => {
    if (!st.blockHash) return;
    navigator.clipboard?.writeText(st.blockHash).catch(() => {});
    st.hashCopiedUntil = Date.now() + 1400;
    renderBar();
    setTimeout(renderBar, 1450);
  });

  refs.hfs?.addEventListener('click', () => {
    const addr = normHexPrefixed(getContractAddr?.());
    if (!addr) return;
    navigator.clipboard?.writeText(addr).catch(() => {});
    st.hfsCopiedUntil = Date.now() + 1400;
    renderHfsChip();
    setTimeout(renderHfsChip, 1450);
  });

  refs.nodebtn?.addEventListener('click', () => {
    if (typeof onToggleNodeDrawer === 'function') onToggleNodeDrawer();
  });

  const statsSub = slxSubscribeStats(rpcUrlFn, (snap) => {
    if (!snap || typeof snap !== 'object') return;
    st.live = true;
    if (snap.height > st.height) {
      if (st.height > 0 && refs.height) {
        refs.height.classList.add('bump');
        setTimeout(() => refs.height?.classList.remove('bump'), 450);
      }
      st.height = Number(snap.height);
    }
    if (typeof snap.validatorCount === 'number') st.validators = snap.validatorCount;
    if (typeof snap.peerCount === 'number') st.peers = snap.peerCount;
    st.mempool = Number(snap.mergedMempoolCount ?? snap.localMempoolCount ?? 0);
    if (snap.confirmedTxTotal > st.confirmedTotal) {
      st.confirmedTotal = Number(snap.confirmedTxTotal);
    }

    if (Array.isArray(snap.phaseMetricsHistory) && snap.phaseMetricsHistory.length > 0) {
      for (const histPm of snap.phaseMetricsHistory) {
        if (histPm && Number(histPm.phase) === 4) {
          applyP4Sample(histPm);
        }
      }
    }

    const pm = snap.phaseMetrics;
    if (pm && typeof pm === 'object') {
      const p = Number(pm.phase || 0);
      if (p >= 1 && p <= 4) setPhaseHighlight(p);
      if (p === 4) {
        applyP4Sample(pm);
      } else if (pm.rollingAvgConfirmMs > 0 && st.lastConfirmMs === 0) {
        st.lastConfirmMs = Number(pm.rollingAvgConfirmMs);
      }
    }

    renderBar();
  });

  const headsSub = slxSubscribeNewHeads(rpcUrlFn, (head) => {
    if (!head) return;
    st.live = true;
    if (head.blockNumberNum > st.height) {
      if (st.height > 0 && refs.height) {
        refs.height.classList.add('bump');
        setTimeout(() => refs.height?.classList.remove('bump'), 450);
      }
      st.height = head.blockNumberNum;
    }
    const bh = normHexPrefixed(head.hash);
    if (bh) st.blockHash = bh;
    if (typeof head.txCountNum === 'number' && head.txCountNum >= 0) {
      st.lastBlockTxs = head.txCountNum;
      if (head.blockNumberNum > 0) {
        const prev = st.recentBlocks.get(head.blockNumberNum);
        st.recentBlocks.set(head.blockNumberNum, {
          txs: head.txCountNum,
          confirmMs: prev?.confirmMs || st.lastConfirmMs || 4280,
        });
        while (st.recentBlocks.size > 8) {
          const oldest = st.recentBlocks.keys().next().value;
          if (oldest !== undefined) st.recentBlocks.delete(oldest);
        }
      }
      recomputeRollingTps();
    }
    setPhaseHighlight(4);
    renderBar();
  });

  renderBar();

  return {
    refresh: renderHfsChip,
    destroy: () => {
      statsSub.unsubscribe();
      headsSub.unsubscribe();
      bar.remove();
    },
  };
}

/**
 * Standardized Cross-App Social Network & Messaging Widgets (`mountSlxSocialWidgets`)
 *
 * Mounts two compact header pills (`👥 Network` + `💬 Messages`) right beside `mountSlxWalletHeader`
 * across all SuperLexicon App UIs (`DEX`, `CorporateCharter`, `E-Commerce`, `Phantom Fleet`,
 * `Fractured Hegemony`, `Cipher Noir`, and `CommonsRF`) backed by Subnet 1's shared
 * `SocialCharter`, `SocialRelationships`, `SocialFeed`, and `Messaging` Haltproof Subroutines.
 */
export function mountSlxSocialWidgets({
  wallet,
  mountContainer,
  appId = 'subnet1',
  appTitle = 'Subnet 1',
  rpcUrlFn = () => getDefaultNodeWsUrl(),
  getAppPeers = null,
  socialClient = null,
} = {}) {
  if (!wallet || !mountContainer || typeof document === 'undefined') return null;
  injectSlxUiStyles();

  // Ensure mountContainer lays out HFS selector, Social pills, and Wallet pills cleanly on one line
  if (!mountContainer.style.display) {
    mountContainer.style.display = 'inline-flex';
    mountContainer.style.alignItems = 'center';
    mountContainer.style.gap = '0.36rem';
    mountContainer.style.flexWrap = 'wrap';
  }

  const client =
    socialClient ||
    new SlxSocialClient({
      rpcUrlFn,
      appId,
    });

  const pillWrap = document.createElement('div');
  pillWrap.className = 'slx-social-pill-group';
  pillWrap.innerHTML = `
    <button type="button" class="slx-social-btn" data-soc-open="network" title="Your Social Network — Friends, Connected Allies &amp; Mutual RF Handshakes">
      <span>👥</span>
      <span>Social Network</span>
      <span class="slx-social-badge violet" data-soc="allyCount">0</span>
      <span class="slx-social-badge amber" data-soc="hsBadge" style="display:none;">+0</span>
    </button>
    <button type="button" class="slx-social-btn msgs" data-soc-open="messages" title="Direct Messages, Live #${escapeHtmlText(appId)} Lounge &amp; Subnet Wall">
      <span>💬</span>
      <span>Messages</span>
      <span class="slx-social-badge cyan" data-soc="unreadBadge" style="display:none;">0</span>
    </button>
  `;

  const walletGroup = mountContainer.querySelector('.slx-wallet-pill-group');
  if (walletGroup) {
    mountContainer.insertBefore(pillWrap, walletGroup);
  } else {
    mountContainer.appendChild(pillWrap);
  }

  let backdrop = document.getElementById('slxSocialDrawerBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'slxSocialDrawerBackdrop';
    backdrop.className = 'slx-social-drawer-backdrop';
    document.body.appendChild(backdrop);
  }

  let activeMode = 'network'; // 'network' | 'messages'
  let activeMsgTab = 'dm'; // 'dm' | 'lounge' | 'wall'
  let searchFilter = '';
  let statusText = '';
  let statusTone = 'info';
  let busy = false;
  let lastSeenTotalMsgs = null;
  let unreadCount = 0;

  backdrop.innerHTML = `
    <aside class="slx-social-drawer" onclick="event.stopPropagation()">
      <div class="slx-soc-hdr">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
          <div>
            <div style="display:flex;align-items:center;gap:0.42rem;flex-wrap:wrap;">
              <strong style="font-size:0.88rem;color:#f8fafc;">🌐 Subnet 1 Social &amp; Comms</strong>
              <span style="padding:0.1rem 0.42rem;border-radius:999px;background:rgba(16,185,129,0.18);border:1px solid rgba(52,211,153,0.5);color:#6ee7b7;font-family:monospace;font-size:0.62rem;font-weight:700;">Unified HFS Graph</span>
            </div>
            <div data-soc="myIdLine" style="font-size:0.68rem;color:#94a3b8;margin-top:2px;">
              Syncing Unified Identity…
            </div>
          </div>
          <button type="button" class="slx-mini-btn" data-soc="closeBtn">✕</button>
        </div>

        <div class="slx-soc-mode-tabs">
          <button type="button" class="slx-soc-mode-btn active" data-soc-mode="network">
            <span>👥 Social Network</span>
            <span class="slx-social-badge violet" data-soc="tabAllyCount">0</span>
            <span class="slx-social-badge amber" data-soc="tabHsCount" style="display:none;">+0</span>
          </button>
          <button type="button" class="slx-soc-mode-btn" data-soc-mode="messages">
            <span>💬 Messages &amp; Lounge</span>
          </button>
        </div>

        <div data-soc="statusStrip" style="display:none;padding:0.38rem 0.58rem;border-radius:0.45rem;font-family:monospace;font-size:0.68rem;"></div>
      </div>

      <div data-soc="networkPane" style="display:flex;flex-direction:column;flex:1;min-height:0;">
        <div style="padding:0.5rem 0.95rem;background:#081020;border-bottom:1px solid rgba(51,65,85,0.55);display:flex;gap:0.4rem;align-items:center;">
          <input type="text" class="slx-input-field" data-soc="filterInput" placeholder="Filter allies, players or Subnet citizens…" style="min-width:0;padding:0.34rem 0.55rem;font-size:0.7rem;" />
          <a href="/social.html" class="slx-mini-btn" title="Open Full CommonsRF Map &amp; Governance UI" style="text-decoration:none;">📡 Map ↗</a>
        </div>
        <div class="slx-soc-scroll" data-soc="networkList"></div>
      </div>

      <div data-soc="messagesPane" style="display:none;flex-direction:column;flex:1;min-height:0;">
        <div class="slx-soc-subtabs">
          <button type="button" class="slx-soc-subtab active" data-soc-subtab="dm">🔒 Direct</button>
          <button type="button" class="slx-soc-subtab" data-soc-subtab="lounge">📡 #${escapeHtmlText(appId)}</button>
          <button type="button" class="slx-soc-subtab" data-soc-subtab="wall">🌐 Wall</button>
        </div>

        <div data-soc="dmPeerBar" style="padding:0.48rem 0.95rem;background:#070e1c;border-bottom:1px solid rgba(51,65,85,0.5);display:flex;align-items:center;gap:0.42rem;">
          <span style="font-family:monospace;font-size:0.66rem;color:#94a3b8;white-space:nowrap;">To Ally:</span>
          <select data-soc="dmPeerSelect" class="slx-input-field" style="min-width:0;padding:0.3rem 0.5rem;font-size:0.71rem;"></select>
        </div>

        <div class="slx-soc-scroll" data-soc="msgScroll"></div>

        <form class="slx-soc-composer" data-soc="msgForm">
          <input type="text" class="slx-input-field" data-soc="msgInput" maxlength="220" placeholder="Write on-chain message ($0.00 gas)…" style="min-width:0;padding:0.42rem 0.6rem;font-size:0.73rem;" />
          <button type="submit" class="slx-mini-btn emerald" data-soc="msgSendBtn" style="padding:0.42rem 0.78rem;">Send →</button>
        </form>
      </div>
    </aside>
  `;

  const refs = {
    allyCount: pillWrap.querySelector('[data-soc="allyCount"]'),
    hsBadge: pillWrap.querySelector('[data-soc="hsBadge"]'),
    unreadBadge: pillWrap.querySelector('[data-soc="unreadBadge"]'),
    myIdLine: backdrop.querySelector('[data-soc="myIdLine"]'),
    closeBtn: backdrop.querySelector('[data-soc="closeBtn"]'),
    modeBtns: Array.from(backdrop.querySelectorAll('[data-soc-mode]')),
    tabAllyCount: backdrop.querySelector('[data-soc="tabAllyCount"]'),
    tabHsCount: backdrop.querySelector('[data-soc="tabHsCount"]'),
    statusStrip: backdrop.querySelector('[data-soc="statusStrip"]'),
    networkPane: backdrop.querySelector('[data-soc="networkPane"]'),
    filterInput: backdrop.querySelector('[data-soc="filterInput"]'),
    networkList: backdrop.querySelector('[data-soc="networkList"]'),
    messagesPane: backdrop.querySelector('[data-soc="messagesPane"]'),
    subTabBtns: Array.from(backdrop.querySelectorAll('[data-soc-subtab]')),
    dmPeerBar: backdrop.querySelector('[data-soc="dmPeerBar"]'),
    dmPeerSelect: backdrop.querySelector('[data-soc="dmPeerSelect"]'),
    msgScroll: backdrop.querySelector('[data-soc="msgScroll"]'),
    msgForm: backdrop.querySelector('[data-soc="msgForm"]'),
    msgInput: backdrop.querySelector('[data-soc="msgInput"]'),
    msgSendBtn: backdrop.querySelector('[data-soc="msgSendBtn"]'),
  };

  function setStatus(msg, tone = 'info') {
    statusText = msg || '';
    statusTone = tone;
    if (!refs.statusStrip) return;
    if (!statusText) {
      refs.statusStrip.style.display = 'none';
      return;
    }
    refs.statusStrip.style.display = 'block';
    refs.statusStrip.textContent = statusText;
    if (tone === 'err') {
      refs.statusStrip.style.background = 'rgba(127,29,29,0.35)';
      refs.statusStrip.style.border = '1px solid rgba(248,113,113,0.6)';
      refs.statusStrip.style.color = '#fecaca';
    } else if (tone === 'ok') {
      refs.statusStrip.style.background = 'rgba(6,78,59,0.4)';
      refs.statusStrip.style.border = '1px solid rgba(52,211,153,0.6)';
      refs.statusStrip.style.color = '#a7f3d0';
    } else {
      refs.statusStrip.style.background = 'rgba(14,165,233,0.18)';
      refs.statusStrip.style.border = '1px solid rgba(56,189,248,0.5)';
      refs.statusStrip.style.color = '#bae6fd';
    }
  }

  function renderPillsAndHeader() {
    const allyN = client.connectedIds.size;
    const hsN = client.incomingHandshakes.length;
    if (refs.allyCount) refs.allyCount.textContent = String(allyN);
    if (refs.tabAllyCount) refs.tabAllyCount.textContent = String(allyN);

    if (refs.hsBadge) {
      refs.hsBadge.style.display = hsN > 0 ? 'inline-flex' : 'none';
      refs.hsBadge.textContent = `+${hsN}`;
    }
    if (refs.tabHsCount) {
      refs.tabHsCount.style.display = hsN > 0 ? 'inline-flex' : 'none';
      refs.tabHsCount.textContent = `+${hsN}`;
    }

    const totalNow = (client.dmMsgs?.length || 0) + (client.appChannelMsgs?.length || 0);
    if (lastSeenTotalMsgs === null) {
      lastSeenTotalMsgs = totalNow;
    } else if (totalNow > lastSeenTotalMsgs) {
      if (!backdrop.classList.contains('is-open') || activeMode !== 'messages') {
        unreadCount += totalNow - lastSeenTotalMsgs;
      }
      lastSeenTotalMsgs = totalNow;
    } else {
      lastSeenTotalMsgs = totalNow;
    }

    if (refs.unreadBadge) {
      refs.unreadBadge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
      refs.unreadBadge.textContent = String(unreadCount);
    }

    const idRec = wallet.getIdentityRecord?.();
    const myIdLow = String(client.myIdentityAddr || idRec?.identityAddr || '').toLowerCase();
    const meMem = client.charterSnap?.members?.find((m) => m.identityAddr === myIdLow);
    if (refs.myIdLine) {
      if (idRec?.nickname) {
        const trustStr = meMem ? ` • Trust ${meMem.trustScore}` : ' • Ready to Enroll';
        refs.myIdLine.innerHTML = `Signed as <strong style="color:#6ee7b7;">${escapeHtmlText(idRec.nickname)} · ${truncAddr4(wallet.keypair.address)}</strong>${escapeHtmlText(trustStr)}`;
      } else {
        refs.myIdLine.innerHTML = `Keypair <code>${shortHex(wallet.keypair.address)}</code> — <button type="button" class="slx-mini-btn emerald" data-soc-act="createId" style="padding:0.1rem 0.42rem;font-size:0.62rem;">🪪 Create Identity</button>`;
        refs.myIdLine.querySelector('[data-soc-act="createId"]')?.addEventListener('click', async () => {
          await wallet.ensureIdentityWithPrompt({ rpcUrl: rpcUrlFn(), appName: appTitle });
          await client.refresh(wallet);
        });
      }
    }

    for (const b of refs.modeBtns) {
      b.classList.toggle('active', b.getAttribute('data-soc-mode') === activeMode);
    }
    if (refs.networkPane) {
      refs.networkPane.style.display = activeMode === 'network' ? 'flex' : 'none';
    }
    if (refs.messagesPane) {
      refs.messagesPane.style.display = activeMode === 'messages' ? 'flex' : 'none';
    }
  }

  function renderNetworkPane() {
    if (!refs.networkList || !backdrop.classList.contains('is-open') || activeMode !== 'network') {
      return;
    }
    const q = searchFilter.trim().toLowerCase();
    const myIdLow = String(client.myIdentityAddr || '').toLowerCase();
    const members = client.charterSnap?.members || [];
    const memByAddr = new Map(members.map((m) => [m.identityAddr, m]));

    const matchesFilter = (name, role, addr) => {
      if (!q) return true;
      return (
        String(name || '').toLowerCase().includes(q) ||
        String(role || '').toLowerCase().includes(q) ||
        String(addr || '').toLowerCase().includes(q)
      );
    };

    let html = '';

    // 1. Incoming Handshakes
    if (client.incomingHandshakes.length > 0) {
      html += `<div class="slx-soc-sec-title"><span style="color:#fbbf24;">⚡ Incoming Handshakes (${client.incomingHandshakes.length})</span><span>+3 Trust</span></div>`;
      for (const hs of client.incomingHandshakes) {
        const tag = client.resolveDisplayTag(hs.initiatorIdentity);
        const m = memByAddr.get(hs.initiatorIdentity);
        html += `
          <div class="slx-soc-peer-row incoming">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:0.77rem;color:#fef3c7;">${escapeHtmlText(tag)}</div>
              <div style="font-size:0.66rem;color:#fde68a;">${escapeHtmlText(m?.role || 'Subnet Citizen')} • Wants to connect</div>
            </div>
            <button type="button" class="slx-mini-btn emerald" data-soc-accept="${escapeHtmlText(hs.initiatorIdentity)}" ${busy ? 'disabled' : ''}>✓ Accept</button>
          </div>
        `;
      }
    }

    // 2. Connected Allies (shared with Phantom Fleet & CommonsRF!)
    const allies = [...client.connectedIds]
      .map((idAddr) => {
        const m = memByAddr.get(idAddr);
        const tag = client.resolveDisplayTag(idAddr);
        return {
          identityAddr: idAddr,
          tag,
          role: m?.role || 'Connected Ally',
          trust: m?.trustScore ?? 50,
        };
      })
      .filter((a) => matchesFilter(a.tag, a.role, a.identityAddr));

    html += `<div class="slx-soc-sec-title"><span style="color:#6ee7b7;">🤝 Connected Allies (${client.connectedIds.size})</span><span>Phantom Fleet + Subnet</span></div>`;
    if (allies.length === 0) {
      html += `<div style="padding:0.55rem 0.65rem;border-radius:0.5rem;background:rgba(15,23,42,0.65);border:1px dashed rgba(100,116,139,0.45);color:#94a3b8;font-size:0.71rem;">No connected allies match yet — click <strong>🤝 Connect</strong> below to establish a mutual on-chain relationship (AI Captains, Sovereigns &amp; Operatives auto-accept!).</div>`;
    } else {
      for (const a of allies) {
        html += `
          <div class="slx-soc-peer-row ally">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:0.76rem;color:#ecfdf5;">${escapeHtmlText(a.tag)}</div>
              <div style="font-size:0.65rem;color:#a7f3d0;">${escapeHtmlText(a.role)} • Trust ${a.trust}</div>
            </div>
            <button type="button" class="slx-mini-btn sky" data-soc-dm="${escapeHtmlText(a.identityAddr)}">💬 Message</button>
          </div>
        `;
      }
    }

    // 3. Active in Current App (`getAppPeers`)
    let appPeers = [];
    if (typeof getAppPeers === 'function') {
      try {
        const rawPeers = getAppPeers() || [];
        const seen = new Set();
        for (const p of rawPeers) {
          const idAddr = String(p?.identityAddr || '').toLowerCase();
          if (
            !idAddr ||
            /^0x0{40}$/.test(idAddr) ||
            idAddr === myIdLow ||
            seen.has(idAddr) ||
            client.connectedIds.has(idAddr)
          ) {
            continue;
          }
          seen.add(idAddr);
          const m = memByAddr.get(idAddr);
          const label = p.label || client.resolveDisplayTag(idAddr);
          const role = p.role || m?.role || appTitle;
          if (matchesFilter(label, role, idAddr)) {
            appPeers.push({ identityAddr: idAddr, label, role });
          }
        }
      } catch (_) {}
    }

    if (appPeers.length > 0) {
      html += `<div class="slx-soc-sec-title"><span>🎯 Active in ${escapeHtmlText(appTitle)} (${appPeers.length})</span><span>In-Session</span></div>`;
      for (const p of appPeers) {
        const isPending = client.outgoingIds.has(p.identityAddr);
        html += `
          <div class="slx-soc-peer-row">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:0.75rem;color:#f1f5f9;">${escapeHtmlText(p.label)}</div>
              <div style="font-size:0.65rem;color:#94a3b8;">${escapeHtmlText(p.role)}</div>
            </div>
            ${
              isPending
                ? `<span style="font-family:monospace;font-size:0.65rem;color:#fbbf24;">⏳ Pending…</span>`
                : `<button type="button" class="slx-mini-btn emerald" data-soc-connect="${escapeHtmlText(p.identityAddr)}" ${busy ? 'disabled' : ''}>🤝 Connect</button>`
            }
          </div>
        `;
      }
    }

    // 4. Subnet 1 Citizens Directory (`SocialCharter`)
    const appPeerSet = new Set(appPeers.map((p) => p.identityAddr));
    const directory = members.filter(
      (m) =>
        m.identityAddr !== myIdLow &&
        !client.connectedIds.has(m.identityAddr) &&
        !appPeerSet.has(m.identityAddr) &&
        matchesFilter(m.name, m.role, m.identityAddr)
    );

    html += `<div class="slx-soc-sec-title"><span>🌐 Subnet 1 Citizens (${directory.length})</span><span>SocialCharter</span></div>`;
    for (const m of directory) {
      const tag = client.resolveDisplayTag(m.identityAddr);
      const isPending = client.outgoingIds.has(m.identityAddr);
      html += `
        <div class="slx-soc-peer-row">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:0.75rem;color:#e2e8f0;">${escapeHtmlText(tag)}</div>
            <div style="font-size:0.65rem;color:#94a3b8;">${escapeHtmlText(m.role)} • Trust ${m.trustScore}</div>
          </div>
          ${
            isPending
              ? `<span style="font-family:monospace;font-size:0.65rem;color:#fbbf24;">⏳ Pending…</span>`
              : `<button type="button" class="slx-mini-btn" data-soc-connect="${escapeHtmlText(m.identityAddr)}" ${busy ? 'disabled' : ''}>🤝 Connect</button>`
          }
        </div>
      `;
    }

    refs.networkList.innerHTML = html;

    refs.networkList.querySelectorAll('[data-soc-connect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const targetId = btn.getAttribute('data-soc-connect');
        if (!targetId || busy) return;
        busy = true;
        setStatus('⏳ Signing mutual RF encounter handshake on Subnet 1…', 'info');
        renderDrawer();
        try {
          await client.connectPeer(wallet, targetId, { appName: appTitle });
          setStatus('✓ Handshake broadcast! (AI personas auto-accept within ~1 block)', 'ok');
        } catch (err) {
          setStatus(`⚠ ${err?.message || err}`, 'err');
        } finally {
          busy = false;
          renderDrawer();
        }
      });
    });

    refs.networkList.querySelectorAll('[data-soc-accept]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const initId = btn.getAttribute('data-soc-accept');
        if (!initId || busy) return;
        busy = true;
        setStatus('⏳ Accepting mutual handshake (+3 Trust)…', 'info');
        renderDrawer();
        try {
          await client.acceptHandshake(wallet, initId, { appName: appTitle });
          setStatus('✓ Connected! Mutual relationship verified on Subnet 1.', 'ok');
        } catch (err) {
          setStatus(`⚠ ${err?.message || err}`, 'err');
        } finally {
          busy = false;
          renderDrawer();
        }
      });
    });

    refs.networkList.querySelectorAll('[data-soc-dm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const peerId = btn.getAttribute('data-soc-dm');
        if (!peerId) return;
        await openMessages(peerId);
      });
    });
  }

  function renderMessagesPane() {
    if (!backdrop.classList.contains('is-open') || activeMode !== 'messages') return;

    for (const b of refs.subTabBtns) {
      const t = b.getAttribute('data-soc-subtab');
      b.classList.toggle('active', t === activeMsgTab);
      if (t === 'dm') b.textContent = `🔒 Direct (${client.dmMsgs.length})`;
      if (t === 'lounge') b.textContent = `📡 #${appId} (${client.appChannelMsgs.length})`;
      if (t === 'wall') b.textContent = `🌐 Wall (${client.feedSnap?.posts?.length || 0})`;
    }

    const myIdLow = String(client.myIdentityAddr || '').toLowerCase();
    const allies = [...client.connectedIds];

    if (refs.dmPeerBar) {
      refs.dmPeerBar.style.display = activeMsgTab === 'dm' ? 'flex' : 'none';
    }

    if (activeMsgTab === 'dm' && refs.dmPeerSelect && document.activeElement !== refs.dmPeerSelect) {
      if (allies.length === 0) {
        refs.dmPeerSelect.innerHTML = `<option value="">Connect with an ally first to unlock Direct Messages</option>`;
      } else {
        if (!client.activeDmPeerId || !client.connectedIds.has(client.activeDmPeerId)) {
          client.activeDmPeerId = allies[0];
        }
        refs.dmPeerSelect.innerHTML = allies
          .map((idAddr) => {
            const sel = idAddr === client.activeDmPeerId ? 'selected' : '';
            return `<option value="${escapeHtmlText(idAddr)}" ${sel}>${escapeHtmlText(client.resolveDisplayTag(idAddr))}</option>`;
          })
          .join('');
      }
    }

    if (refs.msgInput) {
      if (activeMsgTab === 'dm') {
        refs.msgInput.placeholder =
          allies.length > 0
            ? `Message ${client.resolveDisplayTag(client.activeDmPeerId)} ($0.00 gas)…`
            : 'Connect with an ally in 👥 Social Network to send Direct Messages…';
        refs.msgInput.disabled = busy || allies.length === 0;
      } else if (activeMsgTab === 'lounge') {
        refs.msgInput.placeholder = `Broadcast to #${appId} Lounge ($0.00 gas)…`;
        refs.msgInput.disabled = busy;
      } else {
        refs.msgInput.placeholder = `Publish to Subnet 1 Global Wall ($0.00 gas)…`;
        refs.msgInput.disabled = busy;
      }
    }
    if (refs.msgSendBtn) {
      refs.msgSendBtn.disabled = busy || (activeMsgTab === 'dm' && allies.length === 0);
      refs.msgSendBtn.textContent = busy ? '⏳…' : activeMsgTab === 'wall' ? 'Post →' : 'Send →';
    }

    if (!refs.msgScroll) return;

    if (activeMsgTab === 'dm') {
      if (allies.length === 0) {
        refs.msgScroll.innerHTML = `
          <div style="padding:0.85rem;border-radius:0.65rem;background:rgba(15,23,42,0.8);border:1px dashed rgba(56,189,248,0.45);display:flex;flex-direction:column;gap:0.55rem;">
            <strong style="color:#7dd3fc;font-size:0.78rem;">🔒 Mutual RF Connection Required for Direct Comms</strong>
            <div style="color:#cbd5e1;font-size:0.72rem;"><code>SocialFeed.sendDirectMessage</code> enforces mutual <code>SocialRelationships</code> verification on Subnet 1 so zero spam can reach your inbox.</div>
            <div>
              <button type="button" class="slx-mini-btn emerald" data-soc-goto-net="1">👥 Choose an Ally to Connect →</button>
            </div>
          </div>
        `;
        refs.msgScroll.querySelector('[data-soc-goto-net]')?.addEventListener('click', () => {
          activeMode = 'network';
          renderDrawer();
        });
        return;
      }

      if (client.dmMsgs.length === 0) {
        refs.msgScroll.innerHTML = `<div style="color:#94a3b8;font-size:0.73rem;padding:0.6rem 0.2rem;">No direct messages with <strong>${escapeHtmlText(client.resolveDisplayTag(client.activeDmPeerId))}</strong> yet — say hello below!</div>`;
      } else {
        refs.msgScroll.innerHTML = client.dmMsgs
          .map((m) => {
            const mine = m.authorAddr === myIdLow;
            const author = mine ? 'You' : client.resolveDisplayTag(m.authorAddr);
            return `
              <div class="slx-soc-msg-bubble ${mine ? 'mine' : ''}">
                <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:0.63rem;color:#94a3b8;">
                  <strong style="color:${mine ? '#7dd3fc' : '#6ee7b7'};">${escapeHtmlText(author)}</strong>
                  <span>Blk #${m.block}</span>
                </div>
                <div style="color:#f8fafc;word-break:break-word;">${escapeHtmlText(m.text)}</div>
              </div>
            `;
          })
          .join('');
        refs.msgScroll.scrollTop = refs.msgScroll.scrollHeight;
      }
    } else if (activeMsgTab === 'lounge') {
      if (client.appChannelMsgs.length === 0) {
        refs.msgScroll.innerHTML = `<div style="color:#94a3b8;font-size:0.73rem;padding:0.6rem 0.2rem;">Welcome to the live <strong>#${escapeHtmlText(appId)}</strong> on-chain lounge on <code>Messaging</code> HFS! Send the first message below.</div>`;
      } else {
        refs.msgScroll.innerHTML = client.appChannelMsgs
          .map((m) => {
            const mine = m.authorAddr === myIdLow;
            const author = mine ? 'You' : client.resolveDisplayTag(m.authorAddr);
            return `
              <div class="slx-soc-msg-bubble ${mine ? 'mine' : ''}">
                <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:0.63rem;color:#94a3b8;">
                  <strong style="color:${mine ? '#7dd3fc' : '#c084fc'};">${escapeHtmlText(author)}</strong>
                  <span>Blk #${m.block}</span>
                </div>
                <div style="color:#f8fafc;word-break:break-word;">${escapeHtmlText(m.text)}</div>
              </div>
            `;
          })
          .join('');
        refs.msgScroll.scrollTop = refs.msgScroll.scrollHeight;
      }
    } else {
      const posts = client.feedSnap?.posts || [];
      const byUid = new Map((client.charterSnap?.members || []).map((m) => [m.uid, m]));
      if (posts.length === 0) {
        refs.msgScroll.innerHTML = `<div style="color:#94a3b8;font-size:0.73rem;padding:0.6rem 0.2rem;">No Subnet 1 Wall posts yet — share an update across all apps!</div>`;
      } else {
        refs.msgScroll.innerHTML = posts
          .map((p) => {
            const authorMem = byUid.get(p.authorUid);
            const authorLabel = authorMem
              ? client.resolveDisplayTag(authorMem.identityAddr)
              : `Citizen #${p.authorUid}`;
            return `
              <div class="slx-soc-msg-bubble">
                <div style="display:flex;justify-content:space-between;align-items:center;font-family:monospace;font-size:0.63rem;color:#94a3b8;">
                  <strong style="color:#fde68a;">${escapeHtmlText(authorLabel)}</strong>
                  <span>Blk #${p.createdBlock}</span>
                </div>
                <div style="color:#f8fafc;word-break:break-word;margin:0.15rem 0;">${escapeHtmlText(p.content)}</div>
                <div style="display:flex;justify-content:flex-end;">
                  <button type="button" class="slx-mini-btn" data-soc-like="${p.postId}" style="padding:0.14rem 0.44rem;font-size:0.63rem;" ${busy ? 'disabled' : ''}>❤️ ${p.likeCount}</button>
                </div>
              </div>
            `;
          })
          .join('');

        refs.msgScroll.querySelectorAll('[data-soc-like]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const pid = Number(btn.getAttribute('data-soc-like'));
            if (Number.isNaN(pid) || busy) return;
            busy = true;
            setStatus(`⏳ Reacting to Post #${pid}…`, 'info');
            renderDrawer();
            try {
              await client.reactWallPost(wallet, pid, { appName: appTitle });
              setStatus(`✓ Liked Post #${pid} on Subnet 1!`, 'ok');
            } catch (err) {
              setStatus(`⚠ ${err?.message || err}`, 'err');
            } finally {
              busy = false;
              renderDrawer();
            }
          });
        });
      }
    }
  }

  function renderDrawer() {
    renderPillsAndHeader();
    renderNetworkPane();
    renderMessagesPane();
  }

  async function openNetwork() {
    activeMode = 'network';
    backdrop.classList.add('is-open');
    renderDrawer();
    await client.refresh(wallet);
  }

  async function openMessages(peerIdentityAddr = '') {
    activeMode = 'messages';
    unreadCount = 0;
    if (peerIdentityAddr) {
      activeMsgTab = 'dm';
      client.activeDmPeerId = String(peerIdentityAddr).toLowerCase();
    } else if (activeMsgTab === 'dm' && client.connectedIds.size === 0) {
      activeMsgTab = 'lounge';
    }
    backdrop.classList.add('is-open');
    renderDrawer();
    await client.refresh(wallet);
    setTimeout(() => refs.msgInput?.focus(), 40);
  }

  pillWrap.querySelector('[data-soc-open="network"]')?.addEventListener('click', () => {
    openNetwork();
  });
  pillWrap.querySelector('[data-soc-open="messages"]')?.addEventListener('click', () => {
    openMessages();
  });

  backdrop.addEventListener('click', () => {
    backdrop.classList.remove('is-open');
  });
  refs.closeBtn?.addEventListener('click', () => {
    backdrop.classList.remove('is-open');
  });

  for (const b of refs.modeBtns) {
    b.addEventListener('click', () => {
      activeMode = b.getAttribute('data-soc-mode') || 'network';
      if (activeMode === 'messages') unreadCount = 0;
      renderDrawer();
    });
  }

  for (const b of refs.subTabBtns) {
    b.addEventListener('click', () => {
      activeMsgTab = b.getAttribute('data-soc-subtab') || 'dm';
      renderDrawer();
      setTimeout(() => refs.msgInput?.focus(), 30);
    });
  }

  refs.filterInput?.addEventListener('input', () => {
    searchFilter = refs.filterInput.value || '';
    renderNetworkPane();
  });

  refs.dmPeerSelect?.addEventListener('change', async () => {
    const nextPeer = refs.dmPeerSelect.value;
    if (nextPeer) {
      await client.setActiveDmPeer(nextPeer, wallet);
    }
  });

  refs.msgForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy || !refs.msgInput) return;
    const txt = String(refs.msgInput.value || '').trim();
    if (!txt) return;
    busy = true;
    setStatus('⏳ Signing & confirming message on Subnet 1 ($0.00 gas)…', 'info');
    renderDrawer();
    try {
      if (activeMsgTab === 'dm') {
        await client.sendDirectMessage(wallet, client.activeDmPeerId, txt, { appName: appTitle });
      } else if (activeMsgTab === 'lounge') {
        await client.postAppChannel(wallet, txt, { appName: appTitle });
      } else {
        await client.postWall(wallet, txt, { appName: appTitle });
      }
      refs.msgInput.value = '';
      setStatus('✓ Confirmed on Subnet 1!', 'ok');
    } catch (err) {
      setStatus(`⚠ ${err?.message || err}`, 'err');
    } finally {
      busy = false;
      renderDrawer();
      refs.msgInput?.focus();
    }
  });

  const unsubClient = client.onChange(() => {
    renderDrawer();
  });
  let lastWalletAddr = wallet.keypair?.address || '';
  const unsubWallet = wallet.onChange((kp) => {
    if (kp?.address && kp.address !== lastWalletAddr) {
      lastWalletAddr = kp.address;
      client.activeDmPeerId = '';
      client.refresh(wallet);
    } else {
      renderPillsAndHeader();
    }
  });

  const stopWatch = client.startLiveWatch(wallet);

  return {
    client,
    refresh: () => client.refresh(wallet),
    openNetwork,
    openMessages,
    destroy: () => {
      stopWatch();
      unsubClient();
      unsubWallet();
      pillWrap.remove();
    },
  };
}

export const SLX_PLATFORM_APPS = [
  {
    id: 'deck',
    icon: '📽️',
    label: 'Presentation Slides',
    shortLabel: 'Slides Deck',
    sub: 'Blockchain 3.0 & HFS Architecture',
    href: '/',
    group: 'SuperLexicon Platform',
  },
  {
    id: 'dex',
    icon: '📈',
    label: 'DEX Central Limit Book',
    shortLabel: 'DEX CLOB',
    sub: '16 Multi-Asset Orderbooks',
    href: '/dex.html',
    group: 'Institutional & Social HFS',
  },
  {
    id: 'charter',
    icon: '🏛️',
    label: 'CorporateCharter',
    shortLabel: 'Charter',
    sub: 'Governance, Quorums & Share Auctions',
    href: '/charter.html',
    group: 'Institutional & Social HFS',
  },
  {
    id: 'commerce',
    icon: '🛒',
    label: 'E-Commerce Storefront',
    shortLabel: 'E-Commerce',
    sub: 'ProductLedger & Double-Entry Retail',
    href: '/commerce.html',
    group: 'Institutional & Social HFS',
  },
  {
    id: 'social',
    icon: '📡',
    label: 'CommonsRF Social',
    shortLabel: 'CommonsRF',
    sub: 'Radio-Bounded Guild & Storefronts',
    href: '/social.html',
    group: 'Institutional & Social HFS',
  },
  {
    id: 'battleship',
    icon: '⚓',
    label: 'Phantom Fleet',
    shortLabel: 'Phantom Fleet',
    sub: '100-Player Naval Warfare',
    href: '/battleship.html',
    group: 'Multiplayer On-Chain Games',
  },
  {
    id: 'hegemony',
    icon: '⬢',
    label: 'Fractured Hegemony',
    shortLabel: 'Hegemony',
    sub: 'Simultaneous World Conquest',
    href: '/hegemony.html',
    group: 'Multiplayer On-Chain Games',
  },
  {
    id: 'cipher-noir',
    icon: '🔐',
    label: 'Cipher Noir',
    shortLabel: 'Cipher Noir',
    sub: 'ECDH Sabotage Deduction',
    href: '/cipher-noir.html',
    group: 'Multiplayer On-Chain Games',
  },
];

const APP_ID_ALIASES = {
  slides: 'deck',
  presentation: 'deck',
  dashboard: 'explorer',
  'commons-rf': 'social',
  commonsrf: 'social',
  'phantom-fleet': 'battleship',
  fleet: 'battleship',
  noir: 'cipher-noir',
};

/**
 * Standardized 2-Row Unified Header (`mountSlxUnifiedHeader`)
 *
 * Unifies the SuperLexicon Presentation Slides header with all Subnet 1 App UIs and the Live
 * Explorer (`~76px` sticky header):
 *  - Row 1 (`48px`): SuperLexicon Logo (`/`), Title & Subtitle, optional HFS Context Slot,
 *    optional App Action Slot, `⊞ Apps ▾` Experience Switcher, `👥 Network`, `💬 Messages`,
 *    and `🪪 Identity / Wallet` + `📜 Txs`.
 *  - Row 2 (`28px`): Integrated real-time Subnet 1 Blockchain Telemetry Strip (`mountSlxChainBar`).
 */
export function mountSlxUnifiedHeader({
  mountContainer = null,
  wallet = null,
  activeAppId = 'deck',
  title = 'SuperLexicon — Blockchain 3.0 & Decentralized Apps',
  subtitle = 'Infrastructure-Free Radio Mesh • Zero Gas, Zero ISPs • Hardware-Native Autonomous Ecosystem',
  logoSrc = '/assets/presentation/slide_asset_01_ff6f13a11e4a.png',
  logoHref = '/',
  rpcUrlFn = () => getDefaultNodeWsUrl(),
  getContractAddr = () => '',
  getContractLabel = () => 'HFS',
  onToggleNodeDrawer = null,
  explorerHref = '/#slide-4',
  onWalletSwitch = null,
  getAppPeers = null,
  socialClient = null,
  contextElements = [],
  extraElements = [],
  appsList = SLX_PLATFORM_APPS,
} = {}) {
  if (typeof document === 'undefined') return null;
  injectSlxUiStyles();

  let host = mountContainer;
  if (!host) {
    host = document.getElementById('slxUnifiedHeaderMount');
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'slxUnifiedHeaderMount';
    document.body.prepend(host);
  }

  host.innerHTML = '';

  const canonicalActiveId = APP_ID_ALIASES[activeAppId] || activeAppId;
  const activeAppSpec = appsList.find((a) => a.id === canonicalActiveId) || null;

  const groups = [];
  for (const app of appsList) {
    let g = groups.find((x) => x.name === app.group);
    if (!g) {
      g = { name: app.group, items: [] };
      groups.push(g);
    }
    g.items.push(app);
  }

  const appsMenuHtml = groups
    .map(
      (g) => `
      <div class="slx-uh-apps-group-lbl">${escapeHtmlText(g.name)}</div>
      ${g.items
        .map((it) => {
          const isAct = it.id === canonicalActiveId;
          return `
            <a href="${escapeHtmlText(it.href)}" class="slx-uh-app-item ${isAct ? 'active' : ''}">
              <div style="display:flex;align-items:center;gap:0.5rem;min-width:0;">
                <span style="font-size:0.95rem;flex-shrink:0;">${it.icon}</span>
                <div style="min-width:0;">
                  <div style="font-size:0.74rem;font-weight:700;line-height:1.2;">${escapeHtmlText(it.label)}</div>
                  <div style="font-size:0.63rem;color:#94a3b8;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtmlText(it.sub || '')}</div>
                </div>
              </div>
              ${isAct ? '<span style="font-family:monospace;font-size:0.6rem;font-weight:800;color:#6ee7b7;">ACTIVE</span>' : '<span style="color:#64748b;font-size:0.72rem;">→</span>'}
            </a>
          `;
        })
        .join('')}
    `
    )
    .join('');

  const hdr = document.createElement('header');
  hdr.className = 'slx-unified-header';
  hdr.setAttribute('role', 'banner');
  hdr.innerHTML = `
    <div class="slx-uh-main-row">
      <div class="slx-uh-left">
        <a href="${escapeHtmlText(logoHref)}" class="slx-uh-logo-link" title="SuperLexicon — Blockchain 3.0 Presentation Slides">
          <img
            src="${escapeHtmlText(logoSrc)}"
            alt="SuperLexicon Logo"
            class="slx-uh-logo"
            onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='/logo_horizontal.png';}"
          />
        </a>
        <span class="slx-uh-divider" aria-hidden="true"></span>
        <div class="slx-uh-titles">
          <div class="slx-uh-title" data-uh="title">${escapeHtmlText(title)}</div>
          <div class="slx-uh-subtitle" data-uh="subtitle">${escapeHtmlText(subtitle)}</div>
        </div>
        <div class="slx-uh-context" data-uh="context"></div>
      </div>

      <div class="slx-uh-right">
        <div class="slx-uh-extra" data-uh="extra"></div>

        <div class="slx-uh-apps-wrap">
          <button type="button" class="slx-uh-apps-btn" data-uh="appsBtn" aria-expanded="false" title="Switch between Presentation Slides, Subnet 1 Explorer &amp; Live HFS Apps">
            <span>${activeAppSpec ? activeAppSpec.icon : '⊞'}</span>
            <span data-uh="appsLabel">${escapeHtmlText(activeAppSpec ? activeAppSpec.shortLabel : 'Apps')}</span>
            <span style="opacity:0.75;font-size:0.62rem;">▾</span>
          </button>
          <div class="slx-uh-apps-menu" data-uh="appsMenu" role="menu">
            ${appsMenuHtml}
          </div>
        </div>

        <div class="slx-uh-suite-pills" data-uh="suitePills"></div>
      </div>
    </div>

    <div data-uh="telemetryMount"></div>
  `;

  host.appendChild(hdr);

  const refs = {
    title: hdr.querySelector('[data-uh="title"]'),
    subtitle: hdr.querySelector('[data-uh="subtitle"]'),
    context: hdr.querySelector('[data-uh="context"]'),
    extra: hdr.querySelector('[data-uh="extra"]'),
    appsBtn: hdr.querySelector('[data-uh="appsBtn"]'),
    appsMenu: hdr.querySelector('[data-uh="appsMenu"]'),
    suitePills: hdr.querySelector('[data-uh="suitePills"]'),
    telemetryMount: hdr.querySelector('[data-uh="telemetryMount"]'),
  };

  // Adopt any caller-provided DOM elements (preserving IDs & event listeners!)
  for (const el of contextElements || []) {
    if (el && refs.context) {
      if (el.style?.display === 'none' && el.hasAttribute('data-uh-unhide')) {
        el.style.display = '';
      }
      refs.context.appendChild(el);
    }
  }
  for (const el of extraElements || []) {
    if (el && refs.extra) {
      if (el.style?.display === 'none' && el.hasAttribute('data-uh-unhide')) {
        el.style.display = '';
      }
      refs.extra.appendChild(el);
    }
  }

  const closeAppsMenu = () => {
    refs.appsMenu?.classList.remove('is-open');
    refs.appsBtn?.setAttribute('aria-expanded', 'false');
  };

  refs.appsBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = refs.appsMenu?.classList.toggle('is-open');
    refs.appsBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const onDocClick = (ev) => {
    if (!hdr.contains(ev.target)) {
      closeAppsMenu();
    }
  };
  const onDocKey = (ev) => {
    if (ev.key === 'Escape') closeAppsMenu();
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);

  // Mount Wallet + Social/Messages pills in standardized order: [👥 Network] [💬 Messages] [🪪 Wallet] [📜 Txs]
  let walletUi = null;
  let socialUi = null;
  if (wallet && refs.suitePills) {
    walletUi = mountSlxWalletHeader({
      wallet,
      mountContainer: refs.suitePills,
      appTitle: title,
      onWalletSwitch,
    });
    socialUi = mountSlxSocialWidgets({
      wallet,
      mountContainer: refs.suitePills,
      appId: canonicalActiveId || 'subnet1',
      appTitle: activeAppSpec?.label || title,
      rpcUrlFn,
      getAppPeers,
      socialClient,
    });
  }

  const chainBar = mountSlxChainBar({
    mountContainer: refs.telemetryMount,
    rpcUrlFn,
    getContractAddr,
    getContractLabel,
    onToggleNodeDrawer,
    explorerHref,
    embedded: true,
  });

  const syncHeaderHeightVar = () => {
    const h = hdr.offsetHeight || 114;
    document.documentElement?.style?.setProperty('--slx-unified-hdr-h', `${h}px`);
  };
  syncHeaderHeightVar();
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(syncHeaderHeightVar);
    ro.observe(hdr);
  }

  return {
    headerEl: hdr,
    contextSlot: refs.context,
    extraSlot: refs.extra,
    walletUi,
    socialUi,
    chainBar,
    setTitle: (nextTitle, nextSub = undefined) => {
      if (refs.title && nextTitle !== undefined) refs.title.textContent = nextTitle;
      if (refs.subtitle && nextSub !== undefined) refs.subtitle.textContent = nextSub;
    },
    refresh: () => {
      chainBar?.refresh?.();
      walletUi?.refresh?.();
      socialUi?.refresh?.();
    },
    destroy: () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
      ro?.disconnect();
      chainBar?.destroy?.();
      socialUi?.destroy?.();
      hdr.remove();
    },
  };
}
