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
import { getDefaultNodeWsUrl, SlxHfsCache, SlxSubnetManager } from '../rpc.js';
import { slxSubscribeStats, slxSubscribeNewHeads } from '../events.js';
import {
  HFS_TYPES,
  HFS_ASSOC_STATUS,
  HFS_ASSOC_STATUS_LABELS,
  fetchRegisteredHfsByType,
  fetchIdentityHfsAssociations,
  classifyHfsInstancesForIdentity,
  onIdentityHfsAssociationsChanged,
  getUrlHfsParam,
  setUrlHfsParam,
  registerIdentityPromptHandler,
} from '../identity.js';
import { SlxSocialClient } from '../social.js';
import {
  USECASE_DESCRIPTIONS,
  USECASE_INSTRUCTIONS,
  openSlxUseCaseDescription,
  openSlxUseCaseInstructions,
  mountSlxUseCaseHeaderDocs,
} from './usecase-docs.js';
import {
  createIdentitySecurityTabController,
  renderEciesSubtabBarHtml,
} from './identity-security-ui.js';
import {
  MAP_BASE_W,
  MAP_BASE_H,
  formatLatLon,
  latLonToMapXY,
  mapXYToLatLon,
  lonToMercX,
  latToMercY,
  mercXToLon,
  mercYToLat,
  computeAutoFitCamera,
  chooseGraticuleStep,
  extractLiveGpsFromStats,
  mountSlxSubnetWorldMap,
  openSlxSubnetWorldMapModal,
  openSlxSubnetRegistryModal,
} from './subnet-world-map.js';
import { mountSlxSubnetPhaseDiagram } from './subnet-phase-diagram.js';

export {
  USECASE_DESCRIPTIONS,
  USECASE_INSTRUCTIONS,
  openSlxUseCaseDescription,
  openSlxUseCaseInstructions,
  mountSlxUseCaseHeaderDocs,
  MAP_BASE_W,
  MAP_BASE_H,
  formatLatLon,
  latLonToMapXY,
  mapXYToLatLon,
  lonToMercX,
  latToMercY,
  mercXToLon,
  mercYToLat,
  computeAutoFitCamera,
  chooseGraticuleStep,
  extractLiveGpsFromStats,
  mountSlxSubnetWorldMap,
  openSlxSubnetWorldMapModal,
  openSlxSubnetRegistryModal,
  mountSlxSubnetPhaseDiagram,
};

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
.slx-wallet-btn.spectator{background:linear-gradient(135deg,rgba(14,165,233,.16),rgba(30,41,59,.92));border-color:rgba(56,189,248,.58);color:#e0f2fe}
.slx-wallet-dot.spectator{background:#38bdf8;box-shadow:0 0 8px #38bdf8}
.slx-wasm-proof-pill{display:inline-flex;align-items:center;gap:.38rem;padding:.42rem .72rem;border-radius:.65rem;background:rgba(15,23,42,.92);border:1px solid rgba(56,189,248,.52);color:#bae6fd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;font-weight:700;cursor:pointer}
.slx-wasm-proof-pill.tx-pulse{border-color:#34d399;background:rgba(6,78,59,.65);color:#a7f3d0}
.slx-hfs-selector-bar{display:inline-flex;align-items:center;gap:.38rem;padding:.32rem .6rem;border-radius:999px;background:rgba(15,23,42,.92);border:1px solid rgba(56,189,248,.45);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.77rem;color:#e2e8f0}
.slx-hfs-select{background:transparent;border:none;color:#f8fafc;font-family:inherit;font-size:.77rem;font-weight:700;max-width:270px;cursor:pointer;outline:none}
.slx-hfs-select option,.slx-hfs-select optgroup{background:#0f172a;color:#f8fafc}
.slx-hfs-select optgroup{color:#7dd3fc;font-weight:800}
.slx-hfs-deploy-btn{padding:.28rem .62rem;border-radius:999px;border:1px solid rgba(52,211,153,.55);background:rgba(16,185,129,.2);color:#6ee7b7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.73rem;font-weight:700;cursor:pointer;white-space:nowrap}
.slx-hfs-wl-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.24rem .56rem;border-radius:999px;border:1px solid rgba(56,189,248,.45);background:rgba(14,165,233,.14);color:#bae6fd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.71rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s ease}
.slx-hfs-wl-btn:hover{border-color:#38bdf8;background:rgba(14,165,233,.25);color:#fff}
.slx-hfs-wl-btn.has-spam{border-color:rgba(245,158,11,.75);background:rgba(245,158,11,.18);color:#fde68a;box-shadow:0 0 10px rgba(245,158,11,.24)}
.slx-hfs-wl-pill{display:inline-flex;align-items:center;gap:.24rem;padding:.2rem .5rem;border-radius:999px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.69rem;font-weight:700;cursor:pointer;white-space:nowrap;border:1px solid rgba(100,116,139,.5);background:rgba(15,23,42,.85);color:#cbd5e1}
.slx-hfs-wl-pill.valid{border-color:rgba(52,211,153,.55);background:rgba(6,78,59,.45);color:#6ee7b7}
.slx-hfs-wl-pill.spam{border-color:rgba(244,63,94,.65);background:rgba(136,19,55,.45);color:#fda4af}
.slx-quarantine-banner{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;padding:.58rem 1.15rem;background:linear-gradient(90deg,rgba(120,53,15,.88),rgba(69,10,26,.88));border-bottom:1.5px solid rgba(251,191,36,.65);color:#fef3c7;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:.78rem;z-index:44}
.slx-quarantine-banner.blocked{background:linear-gradient(90deg,rgba(127,29,29,.92),rgba(76,5,25,.92));border-bottom-color:rgba(248,113,113,.8);color:#ffe4e6}
.slx-hfs-row{display:flex;align-items:center;justify-content:space-between;gap:.65rem;flex-wrap:wrap;padding:.58rem .72rem;border-radius:.58rem;background:#060c18;border:1px solid rgba(71,85,105,.55)}
.slx-hfs-row.valid{border-color:rgba(52,211,153,.4)}
.slx-hfs-row.spam{border-color:rgba(245,158,11,.5);background:rgba(40,22,8,.36)}
.slx-hfs-row.blocked{border-color:rgba(244,63,94,.55);background:rgba(56,10,24,.38)}
.slx-mini-btn.rose{background:rgba(225,29,72,.22);border-color:rgba(251,113,133,.65);color:#fecdd3}
.slx-mini-btn.amber{background:rgba(245,158,11,.22);border-color:rgba(251,191,36,.65);color:#fde68a}
.slx-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.84);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:1rem}
.slx-modal-backdrop.is-open{display:flex}
.slx-modal-card{width:100%;max-width:840px;max-height:88vh;overflow-y:auto;background:#0b1222;border:2px solid rgba(56,189,248,.5);border-radius:1rem;box-shadow:0 24px 64px rgba(0,0,0,.78);color:#f1f5f9;font-family:Inter,system-ui,-apple-system,sans-serif;display:flex;flex-direction:column}
.slx-modal-header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.9rem 1.15rem;border-bottom:1px solid rgba(100,116,139,.35);background:#080e1c;position:sticky;top:0;z-index:2}
.slx-modal-tabs{display:flex;gap:.45rem;padding:.65rem 1.15rem 0;border-bottom:1px solid rgba(100,116,139,.3);background:#091020;overflow-x:auto;white-space:nowrap;flex-wrap:nowrap;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.slx-modal-tabs::-webkit-scrollbar{display:none}
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
.slx-uh-main-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:76px;padding:.55rem 1.25rem;flex-wrap:nowrap}
@media(max-width:960px){.slx-uh-main-row{flex-wrap:wrap}}
.slx-uh-left{display:flex;align-items:center;gap:.95rem;min-width:0;flex:1 1 0%;overflow:hidden}
.slx-uh-logo-link{display:inline-flex;align-items:center;flex-shrink:0;text-decoration:none;transition:opacity .15s ease,transform .15s ease}
.slx-uh-logo-link:hover{opacity:.94;transform:translateY(-1px)}
.slx-uh-logo{height:66px;width:auto;object-fit:contain;display:block}
@media(max-width:1024px){.slx-uh-logo{height:52px}}
@media(max-width:640px){.slx-uh-logo{height:40px}}
.slx-uh-divider{width:1.5px;height:46px;background:rgba(100,116,139,.5);flex-shrink:0}
.slx-uh-titles{display:flex;flex-direction:column;min-width:0;flex:1 1 0%;overflow:hidden;gap:3px}
.slx-uh-title{font-size:1.18rem;font-weight:800;color:#f8fafc;letter-spacing:-.015em;line-height:1.22;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slx-uh-subtitle{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;color:#94a3b8;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:900px){.slx-uh-subtitle{display:none}}
.slx-uh-context{display:inline-flex;align-items:center;gap:.55rem;flex-wrap:wrap}
.slx-uh-right{display:inline-flex;align-items:center;gap:.45rem;flex-wrap:nowrap;flex-shrink:0}
@media(max-width:960px){.slx-uh-right{flex-wrap:wrap}}
.slx-uh-extra{display:inline-flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-left:auto}
.slx-uh-app-bar{display:none;align-items:center;justify-content:space-between;gap:.75rem;min-height:44px;padding:.38rem 1.25rem;background:linear-gradient(90deg,#071021 0%,#0a162d 50%,#071021 100%);border-top:1px solid rgba(56,189,248,.24);flex-wrap:wrap}
.slx-uh-app-bar.has-items{display:flex}
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
.slx-boot-loader{display:flex;flex-direction:column;gap:10px;padding:13px 18px;margin-bottom:12px;border-radius:14px;background:linear-gradient(135deg,rgba(10,24,48,.96),rgba(8,17,34,.96));border:1px solid rgba(56,189,248,.45);box-shadow:0 8px 26px rgba(2,6,23,.48),inset 0 0 24px rgba(56,189,248,.06);font-family:Inter,system-ui,-apple-system,sans-serif;transition:opacity .28s ease,transform .28s ease,border-color .25s ease}
.slx-boot-loader.complete{border-color:rgba(16,185,129,.55)}
.slx-boot-loader.fading{opacity:0;transform:translateY(-4px);pointer-events:none}
.slx-boot-loader[hidden]{display:none!important}
.slx-boot-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.slx-boot-left{display:flex;align-items:center;gap:12px}
.slx-boot-spinner{width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(56,189,248,.22);border-top-color:#38bdf8;border-right-color:#10b981;animation:slxBootSpin .78s linear infinite;flex-shrink:0}
.slx-boot-loader.complete .slx-boot-spinner{border-color:#10b981;animation:none;background:rgba(16,185,129,.2)}
@keyframes slxBootSpin{to{transform:rotate(360deg)}}
.slx-boot-title{font-size:13px;font-weight:800;color:#f0f9ff;letter-spacing:-.01em}
.slx-boot-sub{font-size:11.5px;font-family:'JetBrains Mono',ui-monospace,monospace;color:#94a3b8;margin-top:2px}
.slx-boot-pct{padding:3px 9px;border-radius:999px;background:rgba(14,165,233,.16);border:1px solid rgba(56,189,248,.4);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11.5px;font-weight:800;color:#7dd3fc}
.slx-boot-loader.complete .slx-boot-pct{background:rgba(16,185,129,.2);border-color:rgba(16,185,129,.5);color:#6ee7b7}
.slx-boot-track{width:100%;height:6px;border-radius:999px;background:rgba(15,23,42,.9);border:1px solid rgba(51,65,85,.65);overflow:hidden}
.slx-boot-fill{height:100%;width:16%;border-radius:999px;background:linear-gradient(90deg,#0ea5e9,#38bdf8,#10b981);background-size:200% 100%;animation:slxSkelShimmer 1.6s linear infinite;transition:width .32s cubic-bezier(.22,1,.36,1)}
@keyframes slxSkelShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.slx-skel-bar{display:inline-block;height:12px;border-radius:6px;background:linear-gradient(90deg,rgba(30,41,59,.72) 20%,rgba(56,189,248,.22) 50%,rgba(30,41,59,.72) 80%);background-size:200% 100%;animation:slxSkelShimmer 1.45s ease-in-out infinite;vertical-align:middle}
.slx-skel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;width:100%}
.slx-skel-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:12px;background:rgba(11,20,38,.78);border:1px solid rgba(51,65,85,.55)}
.slx-cb-subnet-btn{background:rgba(15,23,42,.85);border:1px solid rgba(56,189,248,.45);border-radius:999px;padding:2px 9px;cursor:pointer;transition:all .16s ease;font-family:inherit}
.slx-cb-subnet-menu{display:none;position:fixed;z-index:10050;width:min(350px,calc(100vw - 16px));border-radius:12px;border:1px solid rgba(56,189,248,.55);background:rgba(6,12,24,.98);box-shadow:0 18px 42px rgba(0,0,0,.65);padding:8px;flex-direction:column;gap:6px;backdrop-filter:blur(14px)}
.slx-cb-subnet-menu.is-open{display:flex}
.slx-cb-sm-hdr{font-size:.64rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#7dd3fc;padding:2px 6px 4px;border-bottom:1px solid rgba(51,65,85,.55)}
.slx-cb-sm-list{display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto}
.slx-cb-sm-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border-radius:8px;border:1px solid rgba(51,65,85,.45);background:rgba(15,23,42,.65);cursor:pointer;transition:all .14s ease}
.slx-cb-sm-item.active{border-color:rgba(52,211,153,.7);background:rgba(16,185,129,.14)}
.slx-cb-sm-add{border-top:1px solid rgba(51,65,85,.55);padding:6px 4px 2px;font-size:.68rem;color:#bae6fd}
@media(max-width:820px){html,body{max-width:100vw;overflow-x:clip}.slx-uh-main-row{flex-wrap:nowrap;min-height:48px;padding:.34rem .65rem;gap:.4rem}.slx-uh-left{gap:.5rem}.slx-uh-logo{height:30px}.slx-uh-divider{height:24px}.slx-uh-title{font-size:.86rem}.slx-uh-right,.slx-uh-suite-pills,.slx-social-pill-group,.slx-wallet-pill-group{flex-wrap:nowrap;gap:.28rem}.slx-social-btn .slx-btn-lbl,.slx-wasm-proof-pill{display:none!important}.slx-uh-apps-btn,.slx-social-btn,.slx-wallet-btn{padding:.32rem .52rem;font-size:.71rem;border-radius:.52rem;gap:.28rem}.slx-uh-apps-menu{position:fixed;top:calc(var(--slx-unified-hdr-h,80px) + 4px);left:8px;right:8px;width:auto;max-height:calc(100dvh - var(--slx-unified-hdr-h,80px) - 16px)}.slx-uh-app-bar{min-height:36px;padding:.26rem .65rem;gap:.38rem;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.slx-uh-app-bar::-webkit-scrollbar{display:none}.slx-uh-context,.slx-uh-extra{flex-wrap:nowrap;flex-shrink:0;gap:.35rem}.slx-hfs-selector-bar{padding:.22rem .48rem;font-size:.69rem;flex-shrink:0}.slx-hfs-select{max-width:155px;font-size:.7rem}.slx-chain-bar,.slx-chain-bar.embedded{height:32px;min-height:32px;padding:0 .65rem;gap:.4rem;font-size:.68rem}.slx-cb-secondary,[data-cb="hash"],[data-cb="hfs"],.slx-cb-phase-sub{display:none!important}.slx-cb-subnet-btn{padding:1px 7px;font-size:.68rem}.slx-cb-chip,.slx-cb-link{padding:.12rem .42rem;font-size:.67rem}.slx-cb-phase{padding:.1rem .3rem;font-size:.63rem}}
@media(max-width:560px){.slx-uh-divider,.slx-uh-titles{display:none!important}.slx-uh-logo{height:25px}[data-uh="mobileSlot"] button{padding:.26rem .44rem!important;font-size:.67rem!important}[data-uh="appsLabel"]{max-width:68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}#slxWalletAddrBadge{max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}.slx-modal-backdrop{padding:0;align-items:flex-end}.slx-modal-card{max-width:100%!important;width:100%!important;max-height:92dvh;border-radius:1rem 1rem 0 0;border-left:none;border-right:none;border-bottom:none}.slx-modal-header{padding:.72rem .85rem}.slx-modal-tabs{padding:.45rem .85rem 0}.slx-modal-body{padding:.8rem .85rem calc(1rem + env(safe-area-inset-bottom))}.slx-kv-val{flex-wrap:wrap;font-size:.68rem}.slx-input-field{min-width:0!important;width:100%;font-size:16px!important}.slx-social-drawer{width:100vw;max-width:100vw;border-left:none}.slx-quarantine-banner{padding:.48rem .75rem;font-size:.72rem}}
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

/**
 * Shared 60-FPS animated modal deployment progress controller (used by `openIdentityCreateModal`
 * and `mountHfsRegistryDropdown.openDeployModal`). Glides smoothly up to `95%` while awaiting
 * Subnet 1 block finality so deployment modals always feel responsive and alive.
 */
function createModalProgressController(hostEl) {
  let rafId = 0;
  let anchorPct = 10;
  let displayPct = 10;
  let anchorAt = 0;
  let active = false;

  hostEl.innerHTML = `
    <div class="slx-boot-loader" style="margin-bottom:0;padding:11px 14px;" data-mp="box">
      <div class="slx-boot-top">
        <div class="slx-boot-left" style="min-width:0;flex:1;">
          <div class="slx-boot-spinner" data-mp="spinner" aria-hidden="true"></div>
          <div style="min-width:0;">
            <div class="slx-boot-title" data-mp="title" style="font-size:0.78rem;">Preparing transaction…</div>
            <div class="slx-boot-sub" data-mp="sub" style="font-size:0.68rem;">Connecting to Subnet 1 validator</div>
          </div>
        </div>
        <span class="slx-boot-pct" data-mp="pct">10%</span>
      </div>
      <div class="slx-boot-track">
        <div class="slx-boot-fill" data-mp="fill" style="width:10%;"></div>
      </div>
    </div>
  `;

  const boxEl = hostEl.querySelector('[data-mp="box"]');
  const spinnerEl = hostEl.querySelector('[data-mp="spinner"]');
  const titleEl = hostEl.querySelector('[data-mp="title"]');
  const subEl = hostEl.querySelector('[data-mp="sub"]');
  const pctEl = hostEl.querySelector('[data-mp="pct"]');
  const fillEl = hostEl.querySelector('[data-mp="fill"]');

  const paintPct = (p) => {
    const r = Math.max(8, Math.min(100, Math.round(p)));
    if (pctEl) pctEl.textContent = `${r}%`;
    if (fillEl) fillEl.style.width = `${r}%`;
  };

  const tick = (now) => {
    if (!active) return;
    const elapsed = Math.max(0, now - anchorAt);
    const ceiling = 95;
    if (displayPct < ceiling) {
      const target = anchorPct + (ceiling - anchorPct) * (1 - Math.exp(-elapsed / 5200));
      displayPct = Math.max(displayPct, target);
      paintPct(displayPct);
    }
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(tick);
    }
  };

  const stopRaf = () => {
    active = false;
    if (rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  return {
    start(title, sub = '', pct = 14) {
      stopRaf();
      hostEl.style.display = 'block';
      boxEl?.classList.remove('complete');
      if (boxEl) boxEl.style.borderColor = 'rgba(56, 189, 248, 0.45)';
      if (spinnerEl) spinnerEl.style.display = '';
      if (titleEl) {
        titleEl.style.color = '#f0f9ff';
        titleEl.textContent = title;
      }
      if (subEl) subEl.textContent = sub;
      anchorPct = Math.max(8, Math.min(94, Number(pct) || 14));
      displayPct = anchorPct;
      anchorAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      paintPct(displayPct);
      active = true;
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
      }
    },
    update(title, meta = {}) {
      if (meta?.done || Number(meta?.pct) >= 100) {
        this.complete(title, meta?.sub);
        return;
      }
      if (title && titleEl) titleEl.textContent = title;
      if (meta?.sub && subEl) subEl.textContent = meta.sub;
      const nextPct = Number(meta?.pct || 0);
      if (nextPct > displayPct) {
        anchorPct = Math.min(94, nextPct);
        displayPct = anchorPct;
        anchorAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        paintPct(displayPct);
      } else {
        anchorPct = Math.max(anchorPct, Math.min(94, displayPct + 4));
        anchorAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      }
    },
    complete(doneTitle = '✓ Confirmed on Subnet 1!', doneSub = '') {
      stopRaf();
      boxEl?.classList.add('complete');
      if (titleEl && doneTitle) titleEl.textContent = doneTitle;
      if (subEl && doneSub) subEl.textContent = doneSub;
      paintPct(100);
    },
    fail(errMsg) {
      stopRaf();
      boxEl?.classList.remove('complete');
      if (boxEl) boxEl.style.borderColor = 'rgba(248, 113, 113, 0.65)';
      if (spinnerEl) spinnerEl.style.display = 'none';
      if (titleEl) {
        titleEl.style.color = '#fecaca';
        titleEl.textContent = `⚠ ${errMsg}`;
      }
      if (subEl) subEl.textContent = 'Check your connection or click Retry below';
    },
  };
}

export function openIdentityCreateModal(
  wallet,
  {
    rpcUrl = getDefaultNodeWsUrl(),
    appName = 'SuperLexicon',
    requireOrderProfile = false,
    existingRecord = null,
  } = {}
) {
  if (typeof document === 'undefined') {
    return wallet.deployUnifiedIdentityWithNickname(`Capt_${truncAddr4(wallet.keypair.address)}`, {
      rpcUrl,
    });
  }
  injectSlxUiStyles();
  if (_activePromptPromise) return _activePromptPromise;

  _activePromptPromise = new Promise((resolve, reject) => {
    let backdrop = document.getElementById('slxIdentityPromptBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'slxIdentityPromptBackdrop';
      backdrop.className = 'slx-modal-backdrop';
      backdrop.style.zIndex = '10050';
      document.body.appendChild(backdrop);
    }

    let isDeploying = false;
    const currentRec = existingRecord || wallet.getIdentityRecord?.() || null;
    const isUpdateExisting = Boolean(currentRec?.identityAddr);
    const preferredNick = currentRec?.nickname || wallet.getPreferredNickname?.() || '';
    const clearedNotice = wallet.lastClearedIdentityNotice || null;
    const defaultSuggestion = preferredNick || `Capt_${truncAddr4(wallet.keypair.address)}`;
    const initFullName = currentRec?.fullName || '';
    const initBilling = currentRec?.billingAddress || '';
    const initShipping = currentRec?.shippingAddress || '';
    const defaultSameShip = !initShipping || initShipping === initBilling;

    backdrop.classList.add('is-open');
    backdrop.innerHTML = `
      <div class="slx-modal-card" style="max-width:560px;" onclick="event.stopPropagation()">
        <div class="slx-modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
              <strong style="font-size:0.98rem;color:#f8fafc;">
                ${isUpdateExisting ? '🪪 Complete Identity Pre-Order Profile' : '🪪 Create Your On-Chain Identity'}
              </strong>
              <span style="padding:0.14rem 0.48rem;border-radius:999px;background:rgba(16,185,129,0.2);border:1px solid rgba(52,211,153,0.5);color:#6ee7b7;font-family:monospace;font-size:0.66rem;font-weight:700;">
                ${isUpdateExisting ? 'On-Chain Profile Sync' : '1-Time Subnet Deploy'}
              </span>
            </div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:3px;">
              ${
                isUpdateExisting
                  ? `Attach your credit-card holder name, billing address, and shipping address to your existing Identity HFS (<code>${shortHex(currentRec.identityAddr)}</code>). Editable anytime.`
                  : `This action in <strong>${escapeHtmlText(appName)}</strong> uses an on-chain <code>identity.wasm</code> smart contract — deploy once to share across all SuperLexicon apps${requireOrderProfile ? ' with your Pre-Order Billing & Shipping profile' : ''}.`
              }
            </div>
          </div>
          <button type="button" class="slx-mini-btn" id="slxIdentityCloseBtn" aria-label="Close">✕</button>
        </div>
        <form id="slxIdentityCreateForm" class="slx-modal-body">
          ${
            clearedNotice && !isUpdateExisting
              ? `<div style="padding:0.45rem 0.65rem;border-radius:0.5rem;background:rgba(245,158,11,0.14);border:1px solid rgba(251,191,36,0.45);color:#fde68a;font-size:0.71rem;">
                   Previous cached Identity HFS (<code>${shortHex(clearedNotice.identityAddr)}</code>) is not deployed on the active subnet — confirm your profile below to deploy a fresh Identity smart contract in 1 block.
                 </div>`
              : ''
          }
          <div class="slx-panel-box">
            <div style="font-size:0.73rem;color:#cbd5e1;display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
              <span>Active Browser Keypair:</span>
              <code style="color:#6ee7b7;font-weight:700;">${wallet.keypair.address.slice(0, 10)}…${wallet.keypair.address.slice(-6)} (${truncAddr4(wallet.keypair.address)})</code>
            </div>
            <label style="font-size:0.76rem;font-weight:700;color:#7dd3fc;margin-top:0.25rem;" for="slxIdentityNickInput">
              Public Nickname (1–24 chars) *
            </label>
            <input
              id="slxIdentityNickInput"
              class="slx-input-field"
              type="text"
              maxlength="24"
              required
              placeholder="e.g. AdmiralVex, Mano, MacroWhale"
              value="${escapeHtmlText(defaultSuggestion)}"
              style="font-size:0.95rem;padding:0.5rem 0.7rem;"
            />
            <div style="font-size:0.68rem;color:#94a3b8;">
              Rendered on-chain alongside your 4-char account tag (<code>· ${truncAddr4(wallet.keypair.address)}</code>). You can change your nickname, full name, or addresses at any time.
            </div>
          </div>

          <details id="slxIdentityOrderDetails" class="slx-panel-box" ${requireOrderProfile || initFullName || initBilling || initShipping ? 'open' : ''} style="border-color:${requireOrderProfile ? 'rgba(56,189,248,0.45)' : 'rgba(148,163,184,0.25)'};">
            <summary style="cursor:pointer;font-size:0.77rem;font-weight:700;color:${requireOrderProfile ? '#38bdf8' : '#cbd5e1'};user-select:none;">
              💳 ${requireOrderProfile ? 'Required for Pre-Order: Full Name, Billing & Shipping Address *' : 'Optional: Attach Full Name & Billing/Shipping Address (for Hardware Pre-Orders)'}
            </summary>
            <div style="display:flex;flex-direction:column;gap:0.45rem;margin-top:0.55rem;">
              <div style="font-size:0.68rem;color:#94a3b8;line-height:1.4;">
                🔒 Client-side authenticated encryption (<code>enc1</code> Keccak-CTR+MAC) seals these fields to your Identity HFS keypair so cleartext home addresses are never exposed on public RF state.
              </div>
              <div>
                <label style="font-size:0.72rem;font-weight:700;color:#e2e8f0;display:block;margin-bottom:3px;" for="slxIdFullNameInput">
                  Full Legal Name (as per Credit Card Account) ${requireOrderProfile ? '*' : '(optional)'}
                </label>
                <input
                  id="slxIdFullNameInput"
                  class="slx-input-field"
                  type="text"
                  maxlength="160"
                  ${requireOrderProfile ? 'required' : ''}
                  placeholder="Exact cardholder full name (e.g. Tan Wei Ming)"
                  value="${escapeHtmlText(initFullName)}"
                  style="width:100%;box-sizing:border-box;"
                />
              </div>
              <div>
                <label style="font-size:0.72rem;font-weight:700;color:#e2e8f0;display:block;margin-bottom:3px;" for="slxIdBillingInput">
                  Billing Address (as per Credit Card Statement) ${requireOrderProfile ? '*' : '(optional)'}
                </label>
                <textarea
                  id="slxIdBillingInput"
                  class="slx-input-field"
                  rows="2"
                  maxlength="480"
                  ${requireOrderProfile ? 'required' : ''}
                  placeholder="Street address, unit/apt, city, state/province, postal code, country"
                  style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"
                >${escapeHtmlText(initBilling)}</textarea>
              </div>
              <label style="display:inline-flex;align-items:center;gap:0.42rem;font-size:0.72rem;color:#cbd5e1;cursor:pointer;">
                <input id="slxIdSameAsBillChk" type="checkbox" ${defaultSameShip ? 'checked' : ''} />
                <span>Shipping address is the same as Billing Address</span>
              </label>
              <div id="slxIdShipWrap" style="display:${defaultSameShip ? 'none' : 'block'};">
                <label style="font-size:0.72rem;font-weight:700;color:#e2e8f0;display:block;margin-bottom:3px;" for="slxIdShippingInput">
                  Shipping Address (Hardware Delivery Destination) ${requireOrderProfile ? '*' : '(optional)'}
                </label>
                <textarea
                  id="slxIdShippingInput"
                  class="slx-input-field"
                  rows="2"
                  maxlength="480"
                  placeholder="Recipient street address, unit/apt, city, postal code, country"
                  style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"
                >${escapeHtmlText(initShipping)}</textarea>
              </div>
            </div>
          </details>

          <div id="slxIdentityCreateStatus" style="display:none;"></div>
          <div style="display:flex;justify-content:flex-end;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" id="slxIdentityCancelBtn" class="slx-mini-btn" style="padding:0.55rem 0.9rem;font-size:0.8rem;">
              ${isUpdateExisting ? 'Cancel' : '👁️ Spectate Only'}
            </button>
            <button type="submit" id="slxIdentitySubmitBtn" class="slx-mini-btn emerald" style="padding:0.55rem 1.1rem;font-size:0.82rem;">
              ${isUpdateExisting ? '💾 Save Profile & Continue →' : '🚀 Deploy Identity & Continue →'}
            </button>
          </div>
        </form>
      </div>
    `;

    const form = backdrop.querySelector('#slxIdentityCreateForm');
    const inp = backdrop.querySelector('#slxIdentityNickInput');
    const fnInp = backdrop.querySelector('#slxIdFullNameInput');
    const billInp = backdrop.querySelector('#slxIdBillingInput');
    const sameChk = backdrop.querySelector('#slxIdSameAsBillChk');
    const shipWrap = backdrop.querySelector('#slxIdShipWrap');
    const shipInp = backdrop.querySelector('#slxIdShippingInput');
    const statusEl = backdrop.querySelector('#slxIdentityCreateStatus');
    const submitBtn = backdrop.querySelector('#slxIdentitySubmitBtn');
    const cancelBtn = backdrop.querySelector('#slxIdentityCancelBtn');
    const closeBtn = backdrop.querySelector('#slxIdentityCloseBtn');
    const prog = createModalProgressController(statusEl);

    sameChk?.addEventListener('change', () => {
      if (shipWrap) shipWrap.style.display = sameChk.checked ? 'none' : 'block';
    });

    const cancelToSpectator = () => {
      if (isDeploying) return;
      document.removeEventListener('keydown', onEscKey);
      backdrop.onclick = null;
      backdrop.classList.remove('is-open');
      _activePromptPromise = null;
      const cancelErr = new Error('Identity prompt canceled.');
      cancelErr.isIdentityPromptCanceled = true;
      reject(cancelErr);
    };

    const onEscKey = (ev) => {
      if (ev.key === 'Escape' && backdrop.classList.contains('is-open')) {
        cancelToSpectator();
      }
    };
    document.addEventListener('keydown', onEscKey);
    backdrop.onclick = (ev) => {
      if (ev.target === backdrop) cancelToSpectator();
    };
    cancelBtn?.addEventListener('click', cancelToSpectator);
    closeBtn?.addEventListener('click', cancelToSpectator);

    setTimeout(() => {
      if (isUpdateExisting && requireOrderProfile && fnInp && !fnInp.value) {
        fnInp.focus();
      } else {
        inp?.focus();
        inp?.select();
      }
    }, 40);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const chosen = String(inp.value || '').trim();
      if (!chosen) return;
      const fullName = String(fnInp?.value || '').trim();
      const billingAddress = String(billInp?.value || '').trim();
      const shippingAddress = sameChk?.checked
        ? billingAddress
        : String(shipInp?.value || '').trim();

      if (requireOrderProfile && (!fullName || !billingAddress || !shippingAddress)) {
        prog.fail('Full Name, Billing Address, and Shipping Address are required for hardware pre-orders.');
        const detailsEl = backdrop.querySelector('#slxIdentityOrderDetails');
        if (detailsEl) detailsEl.open = true;
        return;
      }

      isDeploying = true;
      inp.disabled = true;
      if (fnInp) fnInp.disabled = true;
      if (billInp) billInp.disabled = true;
      if (shipInp) shipInp.disabled = true;
      if (sameChk) sameChk.disabled = true;
      submitBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      if (closeBtn) closeBtn.disabled = true;
      submitBtn.textContent = isUpdateExisting ? '⏳ Saving Profile…' : '⏳ Deploying Identity…';
      prog.start(
        isUpdateExisting
          ? `Updating "${chosen}" Identity HFS Profile…`
          : `Deploying "${chosen}" Unified Identity…`,
        isUpdateExisting
          ? 'Sealing encrypted name & addresses to your Identity HFS'
          : 'Instantiating identity.wasm & sealing IdentityRegistry in 1 block',
        18
      );
      try {
        const deployed = isUpdateExisting
          ? await wallet.updateIdentityProfile(
              { nickname: chosen, fullName, billingAddress, shippingAddress },
              {
                rpcUrl,
                onStatus: (msg, meta) => prog.update(msg, meta),
              }
            )
          : await wallet.deployUnifiedIdentityWithNickname(chosen, {
              rpcUrl,
              fullName,
              billingAddress,
              shippingAddress,
              onStatus: (msg, meta) => prog.update(msg, meta),
            });
        prog.complete(
          `✓ Identity "${chosen}" (${shortHex(deployed.identityAddr)}) Synced!`,
          'Synchronized across all SuperLexicon apps'
        );
        await new Promise((r) => setTimeout(r, 240));
        document.removeEventListener('keydown', onEscKey);
        backdrop.onclick = null;
        backdrop.classList.remove('is-open');
        _activePromptPromise = null;
        resolve(deployed);
      } catch (err) {
        isDeploying = false;
        inp.disabled = false;
        if (fnInp) fnInp.disabled = false;
        if (billInp) billInp.disabled = false;
        if (shipInp) shipInp.disabled = false;
        if (sameChk) sameChk.disabled = false;
        submitBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = false;
        submitBtn.textContent = isUpdateExisting
          ? '💾 Retry Profile Save →'
          : '🚀 Retry Identity Deployment →';
        prog.fail(err.message || String(err));
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
  if (typeof window !== 'undefined' && wallet) {
    window.__SLX_WALLET__ = wallet;
  }
  injectSlxUiStyles();

  const formatPillLabel = () => {
    const rec = wallet.getIdentityRecord();
    const tag4 = truncAddr4(wallet.keypair.address);
    return rec && rec.nickname ? `${rec.nickname} · ${tag4}` : `Spectate · ${tag4}`;
  };

  const hasDeployedIdentity = () => Boolean(wallet.getIdentityRecord()?.nickname);

  const wrap = document.createElement('div');
  wrap.className = 'slx-wallet-pill-group';
  wrap.innerHTML = `
    <button type="button" class="slx-wallet-btn ${hasDeployedIdentity() ? '' : 'spectator'}" id="slxWalletOpenBtn" title="Inspect On-Chain Identity, Nickname & secp256k1 Keypair">
      <span class="slx-wallet-dot ${hasDeployedIdentity() ? '' : 'spectator'}" id="slxWalletDot"></span>
      <span id="slxWalletIcon">${hasDeployedIdentity() ? '🪪' : '👁️'}</span>
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
  let walletAssocItems = [];
  let walletAssocVer = 4;
  let walletAssocLoading = false;

  const securityCtrl = createIdentitySecurityTabController({
    wallet,
    getRpcUrl: () => SlxHfsCache.load().rpcUrl || getDefaultNodeWsUrl(),
    setStatus: (s) => {
      statusBanner = s;
    },
    requestRender: () => renderModal(),
    onWalletSwitch,
  });

  async function refreshWalletAssocList() {
    const idRec = wallet.getIdentityRecord();
    if (!idRec?.identityAddr) {
      walletAssocItems = [];
      return;
    }
    walletAssocLoading = true;
    renderModal();
    try {
      const cachedRpc = SlxHfsCache.load().rpcUrl || getDefaultNodeWsUrl();
      const res = await fetchIdentityHfsAssociations(cachedRpc, idRec.identityAddr, {
        forceRefresh: true,
      });
      walletAssocVer = res.version || 2;
      walletAssocItems = res.items || [];
    } catch (_) {}
    walletAssocLoading = false;
    renderModal();
  }

  function renderModal() {
    const kp = wallet.keypair;
    const idRec = wallet.getIdentityRecord();
    const cachedRpc = SlxHfsCache.load().rpcUrl || getDefaultNodeWsUrl();

    const addrEl = wrap.querySelector('#slxWalletAddrBadge');
    if (addrEl) addrEl.textContent = formatPillLabel();
    const openBtnEl = wrap.querySelector('#slxWalletOpenBtn');
    const dotEl = wrap.querySelector('#slxWalletDot');
    const iconEl = wrap.querySelector('#slxWalletIcon');
    const deployedNow = hasDeployedIdentity();
    openBtnEl?.classList.toggle('spectator', !deployedNow);
    dotEl?.classList.toggle('spectator', !deployedNow);
    if (iconEl) iconEl.textContent = deployedNow ? '🪪' : '👁️';

    const txBadgeEl = wrap.querySelector('#slxTxCountBadge');
    if (txBadgeEl) {
      txBadgeEl.textContent = `${wallet.txHistory.length} Tx${wallet.txHistory.length === 1 ? '' : 's'}`;
    }

    if (!modal.classList.contains('is-open')) return;

    const wlValid = walletAssocItems.filter((x) => x.status === HFS_ASSOC_STATUS.WHITELISTED);
    const wlSpam = walletAssocItems.filter(
      (x) => x.status === HFS_ASSOC_STATUS.PENDING || x.status === HFS_ASSOC_STATUS.SPAM
    );

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
          <button type="button" class="slx-tab-btn ${activeTab === 'security' ? 'active' : ''}" data-slx-tab="security">
            📱 Devices &amp; Shamir Recovery
          </button>
          <button type="button" class="slx-tab-btn ${activeTab === 'whitelist' ? 'active' : ''}" data-slx-tab="whitelist">
            🛡️ HFS Whitelist &amp; Spam${wlSpam.length ? ` (${wlSpam.length}⚠️)` : wlValid.length ? ` (${wlValid.length})` : ''}
          </button>
          <button type="button" class="slx-tab-btn ${activeTab === 'txs' ? 'active' : ''}" data-slx-tab="txs">
            📡 Live Signed Txs (${wallet.txHistory.length})
          </button>
        </div>

        <div class="slx-modal-body">
          ${statusBanner ? `<div style="padding:0.48rem 0.7rem;border-radius:0.5rem;background:rgba(16,185,129,0.16);border:1px solid rgba(52,211,153,0.45);color:#a7f3d0;font-family:monospace;font-size:0.72rem;">${escapeHtmlText(statusBanner)}</div>` : ''}

          ${
            activeTab === 'wallet'
              ? `
            <div class="slx-panel-box">
              <strong style="color:#7dd3fc;font-size:0.82rem;">🪪 Shared On-Chain Identity HFS (<code>identity.wasm</code>) &amp; Order Profile</strong>
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
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0.45rem;margin-top:0.35rem;">
                      <div>
                        <label style="font-size:0.68rem;color:#94a3b8;display:block;margin-bottom:2px;">Public Nickname (1–24 chars)</label>
                        <input id="slxEditNickInput" type="text" maxlength="24" class="slx-input-field" value="${escapeHtmlText(idRec.nickname)}" placeholder="Public nickname" style="width:100%;box-sizing:border-box;" />
                      </div>
                      <div>
                        <label style="font-size:0.68rem;color:#94a3b8;display:block;margin-bottom:2px;">Full Name (as per Credit Card)</label>
                        <input id="slxEditFullNameInput" type="text" maxlength="160" class="slx-input-field" value="${escapeHtmlText(idRec.fullName || '')}" placeholder="Cardholder full legal name (optional)" style="width:100%;box-sizing:border-box;" />
                      </div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0.45rem;margin-top:0.4rem;">
                      <div>
                        <label style="font-size:0.68rem;color:#94a3b8;display:block;margin-bottom:2px;">Billing Address (Credit Card Account)</label>
                        <textarea id="slxEditBillingInput" rows="2" maxlength="480" class="slx-input-field" placeholder="Street, unit, city, postal code, country" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;">${escapeHtmlText(idRec.billingAddress || '')}</textarea>
                      </div>
                      <div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.35rem;margin-bottom:2px;">
                          <label style="font-size:0.68rem;color:#94a3b8;">Shipping Address (Delivery)</label>
                          <label style="font-size:0.65rem;color:#38bdf8;cursor:pointer;display:inline-flex;align-items:center;gap:3px;">
                            <input id="slxEditSameAsBillChk" type="checkbox" ${idRec.billingAddress && idRec.shippingAddress === idRec.billingAddress ? 'checked' : ''} />
                            Same as Billing
                          </label>
                        </div>
                        <textarea id="slxEditShippingInput" rows="2" maxlength="480" class="slx-input-field" placeholder="Delivery street, unit, city, postal code, country" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;">${escapeHtmlText(idRec.shippingAddress || '')}</textarea>
                      </div>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.45rem;flex-wrap:wrap;margin-top:0.45rem;">
                      <span style="font-size:0.66rem;color:#94a3b8;">🔒 Name &amp; addresses are encrypted (<code>enc1</code>) before sealing to your Identity HFS. Editable anytime.</span>
                      <button type="button" class="slx-mini-btn emerald" id="slxBtnSaveNick">💾 Update Profile on Identity HFS</button>
                    </div>
                  `
                  : `
                    ${
                      wallet.lastClearedIdentityNotice
                        ? `<div style="padding:0.42rem 0.6rem;border-radius:0.45rem;background:rgba(245,158,11,0.14);border:1px solid rgba(251,191,36,0.42);color:#fde68a;font-size:0.71rem;margin-bottom:0.35rem;">
                             Cached Identity HFS <code>${shortHex(wallet.lastClearedIdentityNotice.identityAddr)}</code> is no longer deployed on this blockchain (chain reset). Your keypair is intact — deploy a fresh Identity HFS below.
                           </div>`
                        : ''
                    }
                    <div style="color:#cbd5e1;font-size:0.74rem;">
                      No Identity HFS deployed on-chain yet for keypair <code>${shortHex(kp.address)}</code>.
                    </div>
                    <div>
                      <button type="button" class="slx-mini-btn emerald" id="slxBtnCreateIdModal">🚀 Create Identity${wallet.getPreferredNickname?.() ? ` ("${escapeHtmlText(wallet.getPreferredNickname())}")` : ''} on Subnet 1</button>
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
              : activeTab === 'whitelist'
                ? `
            <div class="slx-panel-box">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                <div>
                  <strong style="color:#7dd3fc;font-size:0.83rem;">🛡️ On-Chain Identity HFS Subroutine Whitelist Register</strong>
                  <div style="font-size:0.71rem;color:#94a3b8;margin-top:2px;">
                    Manages validity states of associated HFS subroutines on your Identity smart contract (<code>1 = Pending</code>, <code>2 = Whitelisted</code>, <code>3 = Spam / Firewall-Blocked</code> • ABI v${walletAssocVer}).
                  </div>
                </div>
                <button type="button" class="slx-mini-btn" id="slxBtnRefreshWlModal">${walletAssocLoading ? '⏳ Syncing…' : '↻ Sync On-Chain'}</button>
              </div>

              ${
                !idRec
                  ? `<div style="color:#fde68a;font-size:0.74rem;">Create your Identity HFS first to manage your on-chain subroutine whitelist.</div>`
                  : `
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.2rem;">
                  <input id="slxWlAddAddr" type="text" class="slx-input-field" placeholder="0x… HFS Subroutine Address" style="min-width:190px;" />
                  <select id="slxWlAddType" class="slx-input-field" style="max-width:165px;min-width:130px;">
                    ${Object.keys(HFS_TYPES)
                      .map((k) => `<option value="${k}">${escapeHtmlText(HFS_TYPES[k].shortLabel)} (${k})</option>`)
                      .join('')}
                  </select>
                  <input id="slxWlAddLabel" type="text" maxlength="48" class="slx-input-field" placeholder="Optional label" style="max-width:165px;min-width:120px;" />
                  <button type="button" class="slx-mini-btn emerald" id="slxBtnAddWhitelist">✓ Whitelist</button>
                  <button type="button" class="slx-mini-btn rose" id="slxBtnAddSpam">🚫 Block Spam</button>
                </div>
              `
              }
            </div>

            <div class="slx-panel-box">
              <strong style="color:#6ee7b7;font-size:0.81rem;">✅ Valid Whitelisted Subroutines (${wlValid.length})</strong>
              <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:200px;overflow-y:auto;">
                ${
                  wlValid.length
                    ? wlValid
                        .map((item) => {
                          const tSpec = HFS_TYPES[item.typeName] || { icon: '🗂️', shortLabel: item.typeName || 'HFS' };
                          return `
                            <div class="slx-hfs-row valid">
                              <div style="display:flex;flex-direction:column;gap:2px;">
                                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                  <strong>${tSpec.icon} ${escapeHtmlText(item.label || tSpec.shortLabel)}</strong>
                                  <span style="font-family:monospace;font-size:0.66rem;color:#6ee7b7;">State 2 • WHITELISTED</span>
                                </div>
                                <div style="font-family:monospace;font-size:0.69rem;color:#94a3b8;">
                                  ${escapeHtmlText(item.typeName || 'HFS')} • <code>${item.hfsAddr}</code> • Blk #${item.updatedBlock}
                                </div>
                              </div>
                              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                                <button type="button" class="slx-mini-btn" data-copy="${item.hfsAddr}">Copy</button>
                                <button type="button" class="slx-mini-btn rose" data-wl-set-status="3" data-wl-addr="${item.hfsAddr}" data-wl-type="${escapeHtmlText(item.typeName)}" data-wl-label="${escapeHtmlText(item.label)}">🚫 Mark Spam</button>
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                    : `<div style="color:#94a3b8;font-size:0.73rem;">No subroutines explicitly recorded yet. Deploying any HFS or clicking <strong>+ Whitelist</strong> in any app records it here on-chain.</div>`
                }
              </div>
            </div>

            <div class="slx-panel-box" style="border-color:rgba(245,158,11,0.45);">
              <strong style="color:#fcd34d;font-size:0.81rem;">⚠️ Spam &amp; Unverified Subroutines (${wlSpam.length})</strong>
              <div style="font-size:0.7rem;color:#cbd5e1;">
                Subroutines that attempted to associate with your Identity (<code>State = 1 Pending</code>) or were blocked as Spam (<code>State = 3 Firewall-Blocked</code>).
              </div>
              <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:200px;overflow-y:auto;">
                ${
                  wlSpam.length
                    ? wlSpam
                        .map((item) => {
                          const tSpec = HFS_TYPES[item.typeName] || { icon: '⚠️', shortLabel: item.typeName || 'HFS' };
                          const isBlocked = item.status === HFS_ASSOC_STATUS.SPAM;
                          return `
                            <div class="slx-hfs-row ${isBlocked ? 'blocked' : 'spam'}">
                              <div style="display:flex;flex-direction:column;gap:2px;">
                                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                  <strong>${tSpec.icon} ${escapeHtmlText(item.label || tSpec.shortLabel)}</strong>
                                  <span style="font-family:monospace;font-size:0.66rem;color:${isBlocked ? '#fda4af' : '#fde68a'};">
                                    State ${item.status} • ${escapeHtmlText(HFS_ASSOC_STATUS_LABELS[item.status])}
                                  </span>
                                </div>
                                <div style="font-family:monospace;font-size:0.69rem;color:#cbd5e1;">
                                  ${escapeHtmlText(item.typeName || 'HFS')} • <code>${item.hfsAddr}</code> • From ${shortHex(item.actor)}
                                </div>
                              </div>
                              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                                <button type="button" class="slx-mini-btn emerald" data-wl-set-status="2" data-wl-addr="${item.hfsAddr}" data-wl-type="${escapeHtmlText(item.typeName)}" data-wl-label="${escapeHtmlText(item.label)}">✓ Whitelist</button>
                                ${
                                  !isBlocked
                                    ? `<button type="button" class="slx-mini-btn rose" data-wl-set-status="3" data-wl-addr="${item.hfsAddr}" data-wl-type="${escapeHtmlText(item.typeName)}" data-wl-label="${escapeHtmlText(item.label)}">🚫 Block Spam</button>`
                                    : ''
                                }
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                    : `<div style="color:#94a3b8;font-size:0.73rem;">✓ Zero pending or blocked spam subroutines in your Identity register.</div>`
                }
              </div>
            </div>
          `
                : activeTab === 'security'
                  ? securityCtrl.renderHtml()
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
                    <div style="color:#cbd5e1;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                      <span>txHash: <strong style="color:#7dd3fc;">${shortHex(tx.txHash, 12, 8)}</strong></span>
                      <div style="display:inline-flex;align-items:center;gap:0.35rem;">
                        <button type="button" class="slx-mini-btn" data-copy="${escapeHtmlText(tx.txHash)}" style="padding:0.16rem 0.45rem;font-size:0.65rem;">Copy Hash</button>
                        <a href="/?tx=${encodeURIComponent(tx.txHash)}#slide-4" class="slx-mini-btn sky" data-verify-tx="${escapeHtmlText(tx.txHash)}" style="padding:0.16rem 0.5rem;font-size:0.65rem;text-decoration:none;">🔍 Verify in Explorer ↗</a>
                      </div>
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
        if (activeTab === 'whitelist') {
          refreshWalletAssocList();
        } else if (activeTab === 'security') {
          securityCtrl.refresh();
        }
      });
    });
    if (activeTab === 'security') {
      securityCtrl.wireEvents(modal);
    }
    modal.querySelector('#slxBtnRefreshWlModal')?.addEventListener('click', () => {
      refreshWalletAssocList();
    });
    const submitWlModalAdd = async (targetStatus) => {
      const addrInp = modal.querySelector('#slxWlAddAddr');
      const typeSel = modal.querySelector('#slxWlAddType');
      const lblInp = modal.querySelector('#slxWlAddLabel');
      const hfsAddr = String(addrInp?.value || '').trim();
      const tName = String(typeSel?.value || '');
      const lbl = String(lblInp?.value || '').trim();
      try {
        statusBanner = `⏳ Recording on-chain HFS state=${targetStatus}…`;
        renderModal();
        await wallet.setHfsAssociation({
          hfsAddr,
          typeName: tName,
          status: targetStatus,
          label: lbl,
          rpcUrl: cachedRpc,
        });
        statusBanner =
          targetStatus === HFS_ASSOC_STATUS.WHITELISTED
            ? `✓ Whitelisted ${shortHex(hfsAddr)} on your Identity HFS!`
            : `🛑 Blocked ${shortHex(hfsAddr)} as Spam (State = 3) on your Identity HFS!`;
        await refreshWalletAssocList();
      } catch (err) {
        statusBanner = `⚠ ${err.message || err}`;
        renderModal();
      }
    };
    modal.querySelector('#slxBtnAddWhitelist')?.addEventListener('click', () => {
      submitWlModalAdd(HFS_ASSOC_STATUS.WHITELISTED);
    });
    modal.querySelector('#slxBtnAddSpam')?.addEventListener('click', () => {
      submitWlModalAdd(HFS_ASSOC_STATUS.SPAM);
    });
    modal.querySelectorAll('[data-wl-set-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const nextSt = Number(btn.getAttribute('data-wl-set-status'));
        const hfsAddr = btn.getAttribute('data-wl-addr');
        const tName = btn.getAttribute('data-wl-type') || '';
        const lbl = btn.getAttribute('data-wl-label') || '';
        btn.disabled = true;
        btn.textContent = '⏳…';
        try {
          await wallet.setHfsAssociation({
            hfsAddr,
            typeName: tName,
            status: nextSt,
            label: lbl,
            rpcUrl: cachedRpc,
          });
          statusBanner =
            nextSt === HFS_ASSOC_STATUS.WHITELISTED
              ? `✓ Promoted ${shortHex(hfsAddr)} to Valid Whitelisted (State = 2)!`
              : `🛑 Moved ${shortHex(hfsAddr)} to Spam / Blocked (State = 3)!`;
          await refreshWalletAssocList();
        } catch (err) {
          statusBanner = `⚠ ${err.message || err}`;
          renderModal();
        }
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
    modal.querySelectorAll('[data-verify-tx]').forEach((link) => {
      link.addEventListener('click', (ev) => {
        const txHash = link.getAttribute('data-verify-tx');
        const path = window.location?.pathname || '';
        if (path === '/' || path.endsWith('/index.html')) {
          ev.preventDefault();
          modal.classList.remove('is-open');
          if (typeof window.goToSlide === 'function') window.goToSlide(3);
          window.dispatchEvent(new CustomEvent('slx:inspect-tx', { detail: { txHash } }));
        }
      });
    });
    modal.querySelector('#slxBtnTogglePriv')?.addEventListener('click', () => {
      privRevealed = !privRevealed;
      renderModal();
    });
    modal.querySelector('#slxEditSameAsBillChk')?.addEventListener('change', (ev) => {
      const chk = ev.currentTarget;
      const billInp = modal.querySelector('#slxEditBillingInput');
      const shipInp = modal.querySelector('#slxEditShippingInput');
      if (chk.checked && billInp && shipInp) {
        shipInp.value = billInp.value;
      }
    });
    modal.querySelector('#slxBtnSaveNick')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const inp = modal.querySelector('#slxEditNickInput');
      const fnInp = modal.querySelector('#slxEditFullNameInput');
      const billInp = modal.querySelector('#slxEditBillingInput');
      const shipInp = modal.querySelector('#slxEditShippingInput');
      const sameChk = modal.querySelector('#slxEditSameAsBillChk');
      const nextNick = String(inp?.value || '').trim();
      if (!nextNick) return;
      const nextFullName = String(fnInp?.value || '').trim();
      const nextBilling = String(billInp?.value || '').trim();
      const nextShipping = sameChk?.checked
        ? nextBilling
        : String(shipInp?.value || '').trim();
      btn.disabled = true;
      btn.textContent = '⏳ Saving…';
      try {
        await wallet.updateIdentityProfile(
          {
            nickname: nextNick,
            fullName: nextFullName,
            billingAddress: nextBilling,
            shippingAddress: nextShipping,
          },
          { rpcUrl: cachedRpc }
        );
        statusBanner = `✓ Updated Identity HFS profile ("${nextNick}")!`;
        if (onWalletSwitch) await onWalletSwitch(wallet.keypair);
      } catch (err) {
        statusBanner = `⚠ ${err.message || err}`;
      }
      renderModal();
    });
    modal.querySelector('#slxBtnCreateIdModal')?.addEventListener('click', async () => {
      modal.classList.remove('is-open');
      try {
        await wallet.ensureIdentityWithPrompt({ rpcUrl: cachedRpc, appName: appTitle });
        if (onWalletSwitch) await onWalletSwitch(wallet.keypair);
      } catch (_) {}
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
        const verified = await wallet.resolveVerifiedIdentity?.(cachedRpc, { force: true }).catch(() => null);
        statusBanner = verified
          ? `Connected imported keypair ${shortHex(imported.address)} (Identity HFS ${shortHex(verified.identityAddr)} verified on-chain)`
          : `Connected imported keypair ${shortHex(imported.address)} — no Identity HFS deployed on this chain yet`;
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
        const verified = await wallet.resolveVerifiedIdentity?.(cachedRpc, { force: true }).catch(() => null);
        statusBanner = verified
          ? `Loaded keyfile ${shortHex(imported.address)} (Identity HFS ${shortHex(verified.identityAddr)} verified on-chain)`
          : parsedJson?.identity?.identityAddr
            ? `Loaded keyfile ${shortHex(imported.address)} — previous Identity HFS (${shortHex(parsedJson.identity.identityAddr)}) is not deployed on this chain`
            : `Loaded keyfile: ${imported.address}`;
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
    const cachedRpc = SlxHfsCache.load().rpcUrl || getDefaultNodeWsUrl();
    wallet.resolveVerifiedIdentity?.(cachedRpc, { force: true }).then(() => renderModal()).catch(() => {});
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

  // Proactively verify cached Identity HFS against live blockchain on mount (clears stale pre-reset identities immediately!)
  Promise.resolve()
    .then(() => SlxHfsCache.hydrateWithManifest())
    .then(({ cache }) => {
      const rpcUrl = cache?.rpcUrl || getDefaultNodeWsUrl();
      return wallet.resolveVerifiedIdentity?.(rpcUrl);
    })
    .catch(() => {});

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
  if (typeof window !== 'undefined' && wallet) {
    window.__SLX_WALLET__ = wallet;
  }
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
    <select class="slx-hfs-select" id="slxHfsSelect_${escapeHtmlText(typeName)}" title="Switch active ${escapeHtmlText(spec.shortLabel)} (Valid Whitelisted &amp; Public Directory)">
      <option value="">Loading ${escapeHtmlText(spec.shortLabel)}s…</option>
    </select>
    <button type="button" class="slx-hfs-wl-pill" id="slxHfsCurStatus_${escapeHtmlText(typeName)}" title="Whitelist or inspect association status for the active subroutine" style="display:none;"></button>
    <button type="button" class="slx-hfs-wl-btn" id="slxHfsManageWl_${escapeHtmlText(typeName)}" title="Open Identity HFS Whitelist &amp; Spam Section">🛡️ Whitelist</button>
    <button type="button" class="slx-mini-btn" id="slxHfsRefresh_${escapeHtmlText(typeName)}" title="Refresh deployed ${escapeHtmlText(spec.typeName)} list from HfsRegistry" style="padding:0.12rem 0.36rem;font-size:0.66rem;">↻</button>
    ${
      (defaultDeployer || onCustomDeployClick) && spec.deployBtnText
        ? `<button type="button" class="slx-hfs-deploy-btn" id="slxHfsDeploy_${escapeHtmlText(typeName)}">${escapeHtmlText(spec.deployBtnText)}</button>`
        : ''
    }
  `;
  mountContainer.prepend(bar);

  const selectEl = bar.querySelector(`#slxHfsSelect_${typeName}`);
  const curStatusBtn = bar.querySelector(`#slxHfsCurStatus_${typeName}`);
  const manageWlBtn = bar.querySelector(`#slxHfsManageWl_${typeName}`);
  const refreshBtn = bar.querySelector(`#slxHfsRefresh_${typeName}`);
  const deployBtn = bar.querySelector(`#slxHfsDeploy_${typeName}`);

  let instances = [];
  let whitelistedItems = [];
  let publicItems = [];
  let spamItems = [];
  let initialUrlApplied = false;
  let activeSelection = null;
  let wlModalTab = 'valid';
  let wlModalFeedback = '';

  function ensureQuarantineHost() {
    let qEl = document.getElementById(`slxHfsQuarantineBar_${typeName}`);
    if (!qEl) {
      qEl = document.createElement('div');
      qEl.id = `slxHfsQuarantineBar_${typeName}`;
      qEl.style.display = 'none';
      const sticky = document.querySelector('.slx-sticky-top-stack');
      if (sticky && sticky.parentNode) {
        sticky.insertAdjacentElement('afterend', qEl);
      } else {
        document.body.prepend(qEl);
      }
    }
    return qEl;
  }

  function findClassifiedByAddrOrKey(val) {
    if (!val) return null;
    const low = String(val).toLowerCase();
    const all = [...whitelistedItems, ...publicItems, ...spamItems];
    return (
      all.find((it) => it.selectionKey === low || it.primaryAddr === low) ||
      instances.find((it) => it.selectionKey === low || it.primaryAddr === low) ||
      null
    );
  }

  function renderStatusControlsAndQuarantine() {
    const curAddr = String(
      activeSelection?.primaryAddr || getCurrentPrimaryAddr() || ''
    ).toLowerCase();
    const curItem = findClassifiedByAddrOrKey(activeSelection?.selectionKey || curAddr);

    if (manageWlBtn) {
      if (spamItems.length > 0) {
        manageWlBtn.classList.add('has-spam');
        manageWlBtn.innerHTML = `🛡️ Whitelist • ⚠️ ${spamItems.length} Spam`;
        manageWlBtn.title = `${spamItems.length} unverified/spam ${spec.shortLabel} association(s) quarantined — click to review`;
      } else {
        manageWlBtn.classList.remove('has-spam');
        manageWlBtn.innerHTML = whitelistedItems.length
          ? `🛡️ Whitelist (${whitelistedItems.length})`
          : `🛡️ Whitelist`;
        manageWlBtn.title = `Manage Valid Whitelisted ${spec.shortLabel}s & Spam Quarantine on your Identity HFS`;
      }
    }

    if (curStatusBtn) {
      if (!curItem) {
        curStatusBtn.style.display = 'none';
      } else if (curItem.assocCategory === 'whitelisted') {
        curStatusBtn.style.display = 'inline-flex';
        curStatusBtn.className = 'slx-hfs-wl-pill valid';
        curStatusBtn.textContent = curItem.isImplicitOwnEoa ? '✓ Your HFS' : '✓ Whitelisted';
        curStatusBtn.title = curItem.isImplicitOwnEoa
          ? 'Deployed by your keypair — click to seal or manage in Identity Whitelist'
          : 'Validly whitelisted in your Identity HFS Register (State = 2)';
      } else if (curItem.assocCategory === 'spam') {
        curStatusBtn.style.display = 'inline-flex';
        curStatusBtn.className = 'slx-hfs-wl-pill spam';
        curStatusBtn.textContent =
          curItem.assocStatus === HFS_ASSOC_STATUS.SPAM ? '🛑 Spam' : '⚠️ Unverified';
        curStatusBtn.title = curItem.spamReason || 'Unwhitelisted association — click to review';
      } else {
        curStatusBtn.style.display = 'inline-flex';
        curStatusBtn.className = 'slx-hfs-wl-pill';
        curStatusBtn.textContent = '+ Whitelist';
        curStatusBtn.title = `Pin & whitelist "${curItem.label}" in your Identity HFS smart contract`;
      }
    }

    const qEl = document.getElementById(`slxHfsQuarantineBar_${typeName}`);
    if (!curItem || curItem.assocCategory !== 'spam') {
      if (qEl) qEl.style.display = 'none';
      return;
    }
    const host = ensureQuarantineHost();
    const isBlocked = curItem.assocStatus === HFS_ASSOC_STATUS.SPAM;
    host.className = `slx-quarantine-banner${isBlocked ? ' blocked' : ''}`;
    host.style.display = 'flex';
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;max-width:760px;">
        <div style="font-weight:800;font-size:0.82rem;">
          ${
            isBlocked
              ? `🛑 Blocked Spam Subroutine (${escapeHtmlText(curItem.label)} • ${shortHex(curItem.primaryAddr)})`
              : `⚠️ Unverified HFS Association Quarantined (${escapeHtmlText(curItem.label)} • ${shortHex(curItem.primaryAddr)})`
          }
        </div>
        <div style="font-size:0.73rem;opacity:0.92;">
          ${escapeHtmlText(
            curItem.spamReason ||
              'This subroutine attempted to associate with your Identity without being whitelisted.'
          )}
          ${
            isBlocked
              ? ' Outbound calls through your Identity HFS are blocked by the on-chain WASM firewall (Err -29).'
              : ' Whitelist it on your Identity smart contract if valid, or Block as Spam to engage the on-chain firewall.'
          }
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
        <button type="button" class="slx-mini-btn emerald" data-qbar-act="whitelist">
          ✓ Whitelist as Valid (State → 2)
        </button>
        ${
          !isBlocked
            ? `<button type="button" class="slx-mini-btn rose" data-qbar-act="spam">🚫 Block as Spam (State → 3)</button>`
            : ''
        }
        <button type="button" class="slx-mini-btn" data-qbar-act="open-spam-tab">
          🛡️ Open Spam List (${spamItems.length})
        </button>
      </div>
    `;
    host.querySelector('[data-qbar-act="whitelist"]')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = '⏳ Whitelisting…';
      try {
        await wallet.setHfsAssociation({
          hfsAddr: curItem.primaryAddr,
          typeName,
          status: HFS_ASSOC_STATUS.WHITELISTED,
          label: curItem.label || '',
          rpcUrl: rpcUrlFn(),
        });
        await refreshList({ selectKey: curItem.selectionKey });
      } catch (_) {
        b.disabled = false;
        b.textContent = '✓ Whitelist as Valid (State → 2)';
      }
    });
    host.querySelector('[data-qbar-act="spam"]')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = '⏳ Blocking…';
      try {
        await wallet.setHfsAssociation({
          hfsAddr: curItem.primaryAddr,
          typeName,
          status: HFS_ASSOC_STATUS.SPAM,
          label: curItem.label || '',
          rpcUrl: rpcUrlFn(),
        });
        await refreshList();
      } catch (_) {
        b.disabled = false;
        b.textContent = '🚫 Block as Spam (State → 3)';
      }
    });
    host.querySelector('[data-qbar-act="open-spam-tab"]')?.addEventListener('click', () => {
      openWhitelistModal('spam');
    });
  }

  function renderSelectOptions(chosen) {
    const renderOpt = (it, prefix = '') => {
      const sel = chosen && it.selectionKey === chosen.selectionKey ? 'selected' : '';
      const byStr = it.creatorTag ? ` · by ${it.creatorTag}` : '';
      return `<option value="${escapeHtmlText(it.selectionKey)}" ${sel}>${prefix}${escapeHtmlText(it.label)} (${shortHex(it.primaryAddr, 6, 4)})${escapeHtmlText(byStr)}</option>`;
    };

    const groups = [];
    if (chosen && chosen.assocCategory === 'spam') {
      groups.push(
        `<optgroup label="⚠️ Quarantined / Spam (Inspecting)">${renderOpt(chosen, '⚠️ ')}</optgroup>`
      );
    }
    if (whitelistedItems.length > 0) {
      groups.push(
        `<optgroup label="✅ Valid Whitelisted for Your Identity (${whitelistedItems.length})">${whitelistedItems
          .map((it) => renderOpt(it, '✓ '))
          .join('')}</optgroup>`
      );
    }
    if (publicItems.length > 0) {
      groups.push(
        `<optgroup label="🌐 Public Subnet 1 Directory (${publicItems.length})">${publicItems
          .map((it) => renderOpt(it, ''))
          .join('')}</optgroup>`
      );
    }
    if (!groups.length) {
      const cur = getCurrentPrimaryAddr();
      selectEl.innerHTML = `<option value="">${cur ? `${spec.shortLabel} · ${shortHex(cur)}` : `No valid ${spec.shortLabel}s`}</option>`;
      return;
    }
    selectEl.innerHTML = groups.join('');
  }

  async function refreshList({ selectKey = null, triggerCallbackIfUrlMatched = false } = {}) {
    try {
      const rpcUrl = rpcUrlFn();
      const rawInstances = await fetchRegisteredHfsByType(typeName, { rpcUrl });
      instances = rawInstances;

      const idRec = wallet?.getIdentityRecord?.() || null;
      const classified = await classifyHfsInstancesForIdentity(rawInstances, {
        typeName,
        identityAddr: idRec?.identityAddr || '',
        myEoa: wallet?.keypair?.address || '',
        rpcUrl,
      });
      whitelistedItems = classified.whitelistedItems;
      publicItems = classified.publicItems;
      spamItems = classified.spamItems;

      const validPool = [...whitelistedItems, ...publicItems];
      if (!validPool.length && !spamItems.length) {
        const cur = getCurrentPrimaryAddr();
        selectEl.innerHTML = `<option value="">${cur ? `${spec.shortLabel} · ${shortHex(cur)}` : `No ${spec.shortLabel}s registered`}</option>`;
        renderStatusControlsAndQuarantine();
        return instances;
      }

      const urlAddr = getUrlHfsParam();
      const curAddr = String(getCurrentPrimaryAddr() || '').toLowerCase();

      let chosen = null;
      if (selectKey) {
        chosen = findClassifiedByAddrOrKey(selectKey);
      }
      if (!chosen && !initialUrlApplied && urlAddr) {
        chosen = findClassifiedByAddrOrKey(urlAddr);
        if (chosen) {
          initialUrlApplied = true;
          if (triggerCallbackIfUrlMatched && chosen.primaryAddr !== curAddr && onSelectInstance) {
            await onSelectInstance(chosen);
          }
        }
      }
      if (!chosen && curAddr) {
        const curMatch = findClassifiedByAddrOrKey(curAddr);
        // Never auto-default to a quarantined spam item unless explicitly requested via URL/selectKey!
        if (curMatch && (curMatch.assocCategory !== 'spam' || urlAddr === curAddr)) {
          chosen = curMatch;
        }
      }
      if (!chosen) {
        chosen = whitelistedItems[0] || publicItems[0] || spamItems[0] || null;
      }

      activeSelection = chosen;
      renderSelectOptions(chosen);
      renderStatusControlsAndQuarantine();
      if (document.getElementById('slxHfsWhitelistModalBackdrop')?.classList.contains('is-open')) {
        renderWhitelistModal();
      }
    } catch (_) {}
    return instances;
  }

  selectEl?.addEventListener('change', async () => {
    const key = selectEl.value;
    const picked = findClassifiedByAddrOrKey(key);
    if (!picked) return;
    activeSelection = picked;
    setUrlHfsParam(picked.primaryAddr);
    renderStatusControlsAndQuarantine();
    if (onSelectInstance) {
      await onSelectInstance(picked);
    }
  });

  curStatusBtn?.addEventListener('click', async () => {
    const curAddr = String(
      activeSelection?.primaryAddr || getCurrentPrimaryAddr() || ''
    ).toLowerCase();
    const curItem = findClassifiedByAddrOrKey(activeSelection?.selectionKey || curAddr);
    if (!curItem) return;
    if (curItem.assocCategory === 'public' || curItem.isImplicitOwnEoa) {
      const origTxt = curStatusBtn.textContent;
      curStatusBtn.disabled = true;
      curStatusBtn.textContent = '⏳ Whitelisting…';
      try {
        await wallet.setHfsAssociation({
          hfsAddr: curItem.primaryAddr,
          typeName,
          status: HFS_ASSOC_STATUS.WHITELISTED,
          label: curItem.label || '',
          rpcUrl: rpcUrlFn(),
        });
        await refreshList({ selectKey: curItem.selectionKey });
      } catch (_) {
        curStatusBtn.textContent = origTxt;
      } finally {
        curStatusBtn.disabled = false;
      }
    } else {
      openWhitelistModal(curItem.assocCategory === 'spam' ? 'spam' : 'valid');
    }
  });

  manageWlBtn?.addEventListener('click', () => {
    openWhitelistModal(spamItems.length > 0 ? 'spam' : 'valid');
  });

  refreshBtn?.addEventListener('click', () => {
    refreshList();
  });

  function renderWhitelistModal() {
    const backdrop = document.getElementById('slxHfsWhitelistModalBackdrop');
    if (!backdrop || !backdrop.classList.contains('is-open')) return;
    const idRec = wallet?.getIdentityRecord?.() || null;

    backdrop.innerHTML = `
      <div class="slx-modal-card" style="width:min(680px,96vw);" onclick="event.stopPropagation()">
        <div class="slx-modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
              <strong style="font-size:0.96rem;color:#f8fafc;">🛡️ ${spec.icon} ${escapeHtmlText(spec.shortLabel)} — Identity Whitelist &amp; Spam Register</strong>
              <span style="padding:0.14rem 0.48rem;border-radius:999px;background:rgba(14,165,233,0.18);border:1px solid rgba(56,189,248,0.5);color:#7dd3fc;font-family:monospace;font-size:0.66rem;font-weight:700;">On-Chain Identity HFS</span>
            </div>
            <div style="font-size:0.71rem;color:#94a3b8;margin-top:2px;">
              Subroutines are free to reference any Identity on-chain, while your <code>Identity</code> smart contract governs which associations are <strong>Valid (State = 2)</strong> vs <strong>Spam (State = 1 / 3)</strong>.
            </div>
          </div>
          <button type="button" class="slx-mini-btn" id="slxWlModalClose">✕</button>
        </div>

        <div class="slx-modal-tabs">
          <button type="button" class="slx-tab-btn ${wlModalTab === 'valid' ? 'active' : ''}" data-wl-tab="valid">
            ✅ Valid Subroutines (${whitelistedItems.length})
          </button>
          <button type="button" class="slx-tab-btn ${wlModalTab === 'spam' ? 'active' : ''}" data-wl-tab="spam">
            ⚠️ Spam &amp; Unverified (${spamItems.length})
          </button>
        </div>

        <div class="slx-modal-body">
          ${
            wlModalFeedback
              ? `<div style="padding:0.46rem 0.68rem;border-radius:0.5rem;background:rgba(14,165,233,0.16);border:1px solid rgba(56,189,248,0.45);color:#bae6fd;font-family:monospace;font-size:0.72rem;">${escapeHtmlText(wlModalFeedback)}</div>`
              : ''
          }

          ${
            !idRec
              ? `<div class="slx-panel-box"><div style="color:#fde68a;font-size:0.75rem;">Deploy your Unified Identity first to persist on-chain whitelist &amp; spam states.</div></div>`
              : ''
          }

          ${
            wlModalTab === 'valid'
              ? `
            <div class="slx-panel-box">
              <strong style="color:#6ee7b7;font-size:0.81rem;">✅ Validly Associated ${escapeHtmlText(spec.shortLabel)}s (${whitelistedItems.length})</strong>
              <div style="display:flex;flex-direction:column;gap:0.45rem;max-height:280px;overflow-y:auto;">
                ${
                  whitelistedItems.length
                    ? whitelistedItems
                        .map(
                          (it) => `
                        <div class="slx-hfs-row valid">
                          <div style="display:flex;flex-direction:column;gap:2px;">
                            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                              <strong>${spec.icon} ${escapeHtmlText(it.label)}</strong>
                              <span style="font-family:monospace;font-size:0.66rem;color:#6ee7b7;">
                                ${escapeHtmlText(it.assocBadge || 'Whitelisted (State 2)')}
                              </span>
                            </div>
                            <div style="font-family:monospace;font-size:0.69rem;color:#94a3b8;">
                              <code>${it.primaryAddr}</code>${it.creatorTag ? ` • by ${escapeHtmlText(it.creatorTag)}` : ''}
                            </div>
                          </div>
                          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                            <button type="button" class="slx-mini-btn sky" data-wl-open="${escapeHtmlText(it.selectionKey)}">Open</button>
                            ${
                              it.isImplicitOwnEoa
                                ? `<button type="button" class="slx-mini-btn emerald" data-wl-status="2" data-wl-addr="${it.primaryAddr}" data-wl-lbl="${escapeHtmlText(it.label)}">Seal State 2</button>`
                                : ''
                            }
                            <button type="button" class="slx-mini-btn rose" data-wl-status="3" data-wl-addr="${it.primaryAddr}" data-wl-lbl="${escapeHtmlText(it.label)}">🚫 Move to Spam</button>
                          </div>
                        </div>
                      `
                        )
                        .join('')
                    : `<div style="color:#94a3b8;font-size:0.74rem;">No ${escapeHtmlText(spec.shortLabel)}s whitelisted yet. Deploy a new instance or click <strong>+ Whitelist</strong> on any public subroutine.</div>`
                }
              </div>
            </div>

            <div class="slx-panel-box">
              <strong style="color:#7dd3fc;font-size:0.79rem;">➕ Whitelist ${escapeHtmlText(spec.shortLabel)} by Contract Address</strong>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <input id="slxTypeWlAddr" type="text" class="slx-input-field" placeholder="Paste 0x… ${escapeHtmlText(spec.shortLabel)} address" />
                <input id="slxTypeWlLabel" type="text" maxlength="48" class="slx-input-field" placeholder="Display label (optional)" style="max-width:190px;" />
                <button type="button" class="slx-mini-btn emerald" id="slxBtnTypeWlAdd">✓ Whitelist</button>
              </div>
            </div>
          `
              : `
            <div class="slx-panel-box" style="border-color:rgba(245,158,11,0.48);">
              <strong style="color:#fcd34d;font-size:0.81rem;">⚠️ Spam &amp; Unverified ${escapeHtmlText(spec.shortLabel)} Associations (${spamItems.length})</strong>
              <div style="font-size:0.71rem;color:#cbd5e1;">
                Lists other HFS subroutines that attempted to associate with your Identity without being whitelisted (unsolicited Board/Cap-Table/Token assignments, <code>State = 1 Pending</code> invites, and <code>State = 3 Blocked Spam</code>).
              </div>
              <div style="display:flex;flex-direction:column;gap:0.45rem;max-height:310px;overflow-y:auto;">
                ${
                  spamItems.length
                    ? spamItems
                        .map((it) => {
                          const isBlocked = it.assocStatus === HFS_ASSOC_STATUS.SPAM;
                          return `
                            <div class="slx-hfs-row ${isBlocked ? 'blocked' : 'spam'}">
                              <div style="display:flex;flex-direction:column;gap:3px;max-width:410px;">
                                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                  <strong>${isBlocked ? '🛑' : '⚠️'} ${escapeHtmlText(it.label)}</strong>
                                  <span style="font-family:monospace;font-size:0.66rem;color:${isBlocked ? '#fda4af' : '#fde68a'};">
                                    ${escapeHtmlText(HFS_ASSOC_STATUS_LABELS[it.assocStatus] || 'Unwhitelisted')}
                                  </span>
                                </div>
                                <div style="font-size:0.71rem;color:#fde68a;">
                                  ${escapeHtmlText(it.spamReason || 'Attempted association without whitelist')}
                                </div>
                                <div style="font-family:monospace;font-size:0.68rem;color:#94a3b8;">
                                  <code>${it.primaryAddr}</code>${it.creatorTag ? ` • by ${escapeHtmlText(it.creatorTag)}` : ''}
                                </div>
                              </div>
                              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                                <button type="button" class="slx-mini-btn emerald" data-wl-status="2" data-wl-addr="${it.primaryAddr}" data-wl-lbl="${escapeHtmlText(it.label)}">✓ Whitelist</button>
                                ${
                                  !isBlocked
                                    ? `<button type="button" class="slx-mini-btn rose" data-wl-status="3" data-wl-addr="${it.primaryAddr}" data-wl-lbl="${escapeHtmlText(it.label)}">🚫 Block Spam</button>`
                                    : ''
                                }
                                <button type="button" class="slx-mini-btn" data-wl-open="${escapeHtmlText(it.selectionKey)}">Inspect</button>
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                    : `<div style="color:#94a3b8;font-size:0.74rem;">✓ Zero spam or unverified ${escapeHtmlText(spec.shortLabel)} subroutines have attempted to associate with your Identity.</div>`
                }
              </div>
            </div>
          `
          }
        </div>
      </div>
    `;

    backdrop.querySelector('#slxWlModalClose')?.addEventListener('click', () => {
      backdrop.classList.remove('is-open');
    });
    backdrop.querySelectorAll('[data-wl-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        wlModalTab = b.getAttribute('data-wl-tab');
        wlModalFeedback = '';
        renderWhitelistModal();
      });
    });
    backdrop.querySelectorAll('[data-wl-open]').forEach((b) => {
      b.addEventListener('click', async () => {
        const key = b.getAttribute('data-wl-open');
        const picked = findClassifiedByAddrOrKey(key);
        backdrop.classList.remove('is-open');
        if (!picked) return;
        activeSelection = picked;
        setUrlHfsParam(picked.primaryAddr);
        renderSelectOptions(picked);
        renderStatusControlsAndQuarantine();
        if (onSelectInstance) {
          await onSelectInstance(picked);
        }
      });
    });
    backdrop.querySelectorAll('[data-wl-status]').forEach((b) => {
      b.addEventListener('click', async () => {
        const nextSt = Number(b.getAttribute('data-wl-status'));
        const addr = b.getAttribute('data-wl-addr');
        const lbl = b.getAttribute('data-wl-lbl') || '';
        b.disabled = true;
        b.textContent = '⏳…';
        try {
          await wallet.setHfsAssociation({
            hfsAddr: addr,
            typeName,
            status: nextSt,
            label: lbl,
            rpcUrl: rpcUrlFn(),
          });
          wlModalFeedback =
            nextSt === HFS_ASSOC_STATUS.WHITELISTED
              ? `✓ Whitelisted ${shortHex(addr)} on your Identity HFS (State = 2)!`
              : `🛑 Blocked ${shortHex(addr)} as Spam on your Identity HFS (State = 3)!`;
          await refreshList(
            nextSt === HFS_ASSOC_STATUS.WHITELISTED ? { selectKey: addr } : {}
          );
          renderWhitelistModal();
        } catch (err) {
          wlModalFeedback = `⚠ ${err.message || err}`;
          renderWhitelistModal();
        }
      });
    });
    backdrop.querySelector('#slxBtnTypeWlAdd')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const addr = String(backdrop.querySelector('#slxTypeWlAddr')?.value || '').trim();
      const lbl = String(backdrop.querySelector('#slxTypeWlLabel')?.value || '').trim();
      btn.disabled = true;
      btn.textContent = '⏳…';
      try {
        await wallet.setHfsAssociation({
          hfsAddr: addr,
          typeName,
          status: HFS_ASSOC_STATUS.WHITELISTED,
          label: lbl,
          rpcUrl: rpcUrlFn(),
        });
        wlModalFeedback = `✓ Whitelisted ${shortHex(addr)} on your Identity HFS!`;
        await refreshList({ selectKey: addr });
        renderWhitelistModal();
      } catch (err) {
        wlModalFeedback = `⚠ ${err.message || err}`;
        renderWhitelistModal();
      }
    });
  }

  function openWhitelistModal(initialTab = 'valid') {
    wlModalTab = initialTab;
    wlModalFeedback = '';
    let backdrop = document.getElementById('slxHfsWhitelistModalBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'slxHfsWhitelistModalBackdrop';
      backdrop.className = 'slx-modal-backdrop';
      backdrop.onclick = () => backdrop.classList.remove('is-open');
      document.body.appendChild(backdrop);
    }
    backdrop.classList.add('is-open');
    renderWhitelistModal();
  }

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
          <div id="slxHfsDeployStatus" style="display:none;"></div>
          <div style="display:flex;justify-content:flex-end;gap:0.45rem;">
            <button type="button" class="slx-mini-btn" id="slxHfsDeployCancel">Cancel</button>
            <button type="submit" id="slxHfsDeploySubmit" style="padding:0.5rem 1rem;" class="slx-mini-btn emerald">
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
    const deployProg = createModalProgressController(statusEl);
    setTimeout(() => inp?.focus(), 40);

    backdrop.querySelector('#slxHfsDeployForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const label = String(inp?.value || '').trim();
      if (!label) return;
      inp.disabled = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Deploying on Subnet 1…';
      deployProg.start(
        `Deploying "${label}" on Subnet 1…`,
        'Instantiating WASM HFS & registering in HfsRegistry',
        16
      );
      try {
        const created = await defaultDeployer({
          wallet,
          label,
          rpcUrl: rpcUrlFn(),
          onStatus: (s, meta) => {
            deployProg.update(s, meta);
          },
        });
        deployProg.complete(`✓ "${label}" Live on Subnet 1!`);
        await new Promise((r) => setTimeout(r, 240));
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
        deployProg.fail(err?.message || String(err));
      }
    });
  }

  let lastKnownEoa = wallet?.keypair?.address?.toLowerCase() || '';
  let lastKnownId = wallet?.getIdentityRecord?.()?.identityAddr?.toLowerCase() || '';
  wallet?.onChange?.(() => {
    const nextEoa = wallet?.keypair?.address?.toLowerCase() || '';
    const nextId = wallet?.getIdentityRecord?.()?.identityAddr?.toLowerCase() || '';
    if (nextEoa !== lastKnownEoa || nextId !== lastKnownId) {
      lastKnownEoa = nextEoa;
      lastKnownId = nextId;
      refreshList();
    }
  });
  onIdentityHfsAssociationsChanged(() => {
    refreshList();
  });

  refreshList({ triggerCallbackIfUrlMatched: true });

  function setSelectedAddr(addrHex) {
    if (!selectEl || !addrHex) return;
    const low = String(addrHex).toLowerCase();
    const matched = findClassifiedByAddrOrKey(low);
    if (matched) {
      activeSelection = matched;
      renderSelectOptions(matched);
      renderStatusControlsAndQuarantine();
    }
  }

  return {
    refreshList,
    getInstances: () => instances,
    getWhitelistedInstances: () => whitelistedItems,
    getSpamInstances: () => spamItems,
    openDeployModal,
    openWhitelistModal,
    setSelectedAddr,
  };
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
function isSlidesDeployment() {
  if (typeof __SLX_HAS_SLIDES__ !== 'undefined') {
    return Boolean(__SLX_HAS_SLIDES__);
  }
  return Boolean(typeof window !== 'undefined' && window.__SLX_HAS_SLIDES__);
}

export function mountSlxChainBar({
  mountContainer = null,
  rpcUrlFn = () => getDefaultNodeWsUrl(),
  getContractAddr = () => '',
  getContractLabel = () => 'HFS',
  onToggleNodeDrawer = null,
  explorerHref = undefined,
  embedded = false,
} = {}) {
  const effectiveExplorerHref =
    explorerHref !== undefined
      ? explorerHref
      : isSlidesDeployment()
      ? '/?view=explorer#slide-4'
      : '/explorer.html';
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

  const initSubnet = SlxSubnetManager.getActiveSubnetProfile();
  const bar = document.createElement('div');
  bar.className = embedded ? 'slx-chain-bar embedded' : 'slx-chain-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'SuperLexicon Live Blockchain Telemetry');
  bar.innerHTML = `
    <div class="slx-cb-group">
      <button type="button" class="slx-cb-net slx-cb-subnet-btn" data-cb="subnetbtn" aria-expanded="false" title="Select Active SuperLexicon Subnet (switches live telemetry &amp; HFS directory)">
        <span class="slx-cb-dot" data-cb="dot"></span>
        <span data-cb="subnetlbl">${escapeHtmlText(initSubnet?.icon || '📡')} ${escapeHtmlText(initSubnet?.shortLabel || 'SUBNET 1')} (${escapeHtmlText(initSubnet?.subnetId || '00000001')})</span>
        <span style="opacity:0.75;font-size:0.62rem;">▾</span>
      </button>
      <span class="slx-cb-chip" data-cb="vals" title="Active BFT Validators &amp; Mesh Peers">— Val</span>
      <span class="slx-cb-sep">│</span>
      <span>BLK <strong class="slx-cb-blk" data-cb="height">#—</strong></span>
      <button type="button" class="slx-cb-chip clickable" data-cb="hash" title="Click to copy latest finalized block hash" style="display:none;">—</button>
      <span class="slx-cb-sep">│</span>
      <div class="slx-cb-phases" title="Real-Time 4-Phase BFT Consensus Pipeline">
        <span class="slx-cb-phase" data-cb-phase="1">P1<span class="slx-cb-phase-sub"> TX</span></span>
        <span class="slx-cb-phase" data-cb-phase="2">P2<span class="slx-cb-phase-sub"> VOTE</span></span>
        <span class="slx-cb-phase" data-cb-phase="3">P3<span class="slx-cb-phase-sub"> PROP</span></span>
        <span class="slx-cb-phase p4" data-cb-phase="4">P4<span class="slx-cb-phase-sub"> FIN</span></span>
      </div>
    </div>

    <div class="slx-cb-group slx-cb-secondary">
      <span class="slx-cb-chip emerald" data-cb="tps" title="Rolling finalized Subnet throughput">⚡ — tx/s</span>
      <span class="slx-cb-chip" data-cb="blkmeta" title="Transactions &amp; BFT finality latency of latest block">— txs/blk • —s</span>
      <span class="slx-cb-chip" data-cb="mempool" title="Merged Subnet mempool queue">Mempool: 0</span>
      <span class="slx-cb-chip" data-cb="totaltxs" title="Cumulative finalized transactions since Subnet genesis">∑ — txs</span>
      <span class="slx-cb-chip emerald" data-cb="gas" title="Zero gas fees via explicit extraTargets parallel execution">$0.00 Gas</span>
    </div>

    <div class="slx-cb-group">
      <button type="button" class="slx-cb-chip cyan clickable" data-cb="hfs" title="Click to copy active HFS smart contract address" style="display:none;"></button>
      ${
        typeof onToggleNodeDrawer === 'function'
          ? `<button type="button" class="slx-cb-chip clickable" data-cb="nodebtn" title="Toggle RPC Node &amp; Deployment Inspector">⚙ Node</button>`
          : ''
      }
      <button type="button" class="slx-cb-chip cyan clickable" data-cb="worldmap" title="Open Interactive Global Subnet World Map">🗺️ Map</button>
      <a class="slx-cb-link" data-cb="explorer" href="${escapeHtmlText(effectiveExplorerHref)}" title="Open Multi-Subnet Cryptographic Block Explorer &amp; HFS Inspector">📊 Explorer ↗</a>
    </div>
  `;
  host.appendChild(bar);

  const subnetMenu = document.createElement('div');
  subnetMenu.className = 'slx-cb-subnet-menu';
  subnetMenu.setAttribute('role', 'menu');
  document.body.appendChild(subnetMenu);

  const refs = {
    subnetbtn: bar.querySelector('[data-cb="subnetbtn"]'),
    subnetlbl: bar.querySelector('[data-cb="subnetlbl"]'),
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
    worldmap: bar.querySelector('[data-cb="worldmap"]'),
    explorer: bar.querySelector('[data-cb="explorer"]'),
    phases: Array.from(bar.querySelectorAll('[data-cb-phase]')),
  };

  function updateSubnetBadgeLabel() {
    const cur = SlxSubnetManager.getActiveSubnetProfile();
    if (refs.subnetlbl && cur) {
      refs.subnetlbl.textContent = `${cur.icon || '🌐'} ${cur.shortLabel} (${cur.subnetId || '—'})`;
    }
  }

  function closeSubnetMenu() {
    subnetMenu.classList.remove('is-open');
    refs.subnetbtn?.setAttribute('aria-expanded', 'false');
  }

  function renderSubnetMenu() {
    const list = SlxSubnetManager.listSubnets();
    const activeKey = SlxSubnetManager.getActiveSubnetKey();
    subnetMenu.innerHTML = `
      <div class="slx-cb-sm-hdr">Select Active Subnet (Switches HFS Directory &amp; RPC)</div>
      <div class="slx-cb-sm-list">
        ${list
          .map((s) => {
            const act = s.key === activeKey;
            return `
              <div class="slx-cb-sm-item ${act ? 'active' : ''}" data-sm-select="${escapeHtmlText(s.key)}">
                <div style="display:flex;align-items:center;gap:0.45rem;min-width:0;">
                  <span style="font-size:0.92rem;">${escapeHtmlText(s.icon || '🌐')}</span>
                  <div style="min-width:0;">
                    <div style="font-size:0.73rem;font-weight:700;color:#f8fafc;">${escapeHtmlText(s.name)}</div>
                    <div style="font-size:0.62rem;color:#94a3b8;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">ID: ${escapeHtmlText(s.subnetId || '—')}${s.tipHeight ? ` • #${fmtInt(s.tipHeight)}` : ''} • ${escapeHtmlText(s.rpcUrl || 'Awaiting TLS gateway')}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:0.35rem;flex-shrink:0;">
                  ${act ? '<span style="font-size:0.6rem;font-weight:800;color:#6ee7b7;font-family:monospace;">ACTIVE</span>' : ''}
                  ${
                    !s.builtin
                      ? `<button type="button" data-sm-del="${escapeHtmlText(s.key)}" title="Remove custom subnet" style="background:transparent;border:none;color:#f87171;cursor:pointer;font-size:0.72rem;padding:2px 4px;">✕</button>`
                      : ''
                  }
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
      <div style="padding:0.4rem 0.55rem;border-top:1px solid rgba(51,65,85,0.55);display:flex;flex-direction:column;gap:0.35rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
          <button type="button" data-sm-open-map class="slx-mini-btn" style="justify-content:center;padding:0.38rem 0.5rem;font-size:0.68rem;border-color:rgba(56,189,248,0.65);background:rgba(14,165,233,0.18);color:#bae6fd;">
            🌍 World Map
          </button>
          <button type="button" data-sm-open-phase class="slx-mini-btn" style="justify-content:center;padding:0.38rem 0.5rem;font-size:0.68rem;border-color:rgba(192,132,252,0.65);background:rgba(168,85,247,0.18);color:#e9d5ff;">
            ⚡ Phase &amp; Bridge
          </button>
        </div>
        <button type="button" data-sm-reg-hfs class="slx-mini-btn emerald" style="width:100%;justify-content:center;padding:0.36rem 0.6rem;font-size:0.69rem;">
          ⛓️ + Register Subnet &amp; Stats URLs On-Chain (HFS)
        </button>
      </div>
      <details class="slx-cb-sm-add">
        <summary>+ Connect Custom Subnet RPC…</summary>
        <form data-sm-form style="display:flex;flex-direction:column;gap:0.38rem;margin-top:0.45rem;">
          <input type="text" name="name" placeholder="Subnet Name (e.g. Geneva Subnet 3)" required class="slx-input-field" style="padding:0.3rem 0.5rem;font-size:0.68rem;" />
          <input type="text" name="rpcUrl" placeholder="JSON-RPC URL (e.g. ws://192.168.1.10:8545)" required class="slx-input-field" style="padding:0.3rem 0.5rem;font-size:0.68rem;" />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
            <input type="number" step="any" name="lat" placeholder="Lat (e.g. 46.20)" class="slx-input-field" style="padding:0.3rem 0.5rem;font-size:0.68rem;" />
            <input type="number" step="any" name="lon" placeholder="Lon (e.g. 6.14)" class="slx-input-field" style="padding:0.3rem 0.5rem;font-size:0.68rem;" />
          </div>
          <input type="text" name="manifestUrl" placeholder="Optional Manifest URL (/contracts/...)" class="slx-input-field" style="padding:0.3rem 0.5rem;font-size:0.68rem;" />
          <button type="submit" class="slx-mini-btn emerald" style="justify-content:center;padding:0.32rem 0.6rem;font-size:0.68rem;">Connect &amp; Switch Subnet →</button>
        </form>
      </details>
    `;

    subnetMenu.querySelector('[data-sm-open-map]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeSubnetMenu();
      openSlxSubnetWorldMapModal({ initialView: 'map' });
    });

    subnetMenu.querySelector('[data-sm-open-phase]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeSubnetMenu();
      openSlxSubnetWorldMapModal({ initialView: 'phase' });
    });

    subnetMenu.querySelector('[data-sm-reg-hfs]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeSubnetMenu();
      openSlxSubnetRegistryModal({
        onSaved: () => renderSubnetMenu(),
      });
    });

    subnetMenu.querySelectorAll('[data-sm-select]').forEach((row) => {
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-sm-del]')) return;
        const k = row.getAttribute('data-sm-select');
        closeSubnetMenu();
        if (k && k !== SlxSubnetManager.getActiveSubnetKey()) {
          SlxSubnetManager.setActiveSubnetKey(k, { reload: true });
        }
      });
    });

    subnetMenu.querySelectorAll('[data-sm-del]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = btn.getAttribute('data-sm-del');
        if (k) {
          SlxSubnetManager.removeCustomSubnet(k);
          renderSubnetMenu();
        }
      });
    });

    subnetMenu.querySelector('[data-sm-form]')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const key = SlxSubnetManager.addCustomSubnet({
        name: fd.get('name'),
        rpcUrl: fd.get('rpcUrl'),
        manifestUrl: fd.get('manifestUrl'),
        lat: fd.get('lat'),
        lon: fd.get('lon'),
      });
      closeSubnetMenu();
      SlxSubnetManager.setActiveSubnetKey(key, { reload: true });
    });
  }

  refs.worldmap?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeSubnetMenu();
    openSlxSubnetWorldMapModal();
  });

  refs.subnetbtn?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = !subnetMenu.classList.contains('is-open');
    if (!open) {
      closeSubnetMenu();
      return;
    }
    renderSubnetMenu();
    const rect = refs.subnetbtn.getBoundingClientRect();
    subnetMenu.style.top = `${Math.round(rect.bottom + 6)}px`;
    subnetMenu.style.left = `${Math.max(8, Math.round(rect.left))}px`;
    subnetMenu.classList.add('is-open');
    refs.subnetbtn.setAttribute('aria-expanded', 'true');
  });

  const onSubnetDocClick = (ev) => {
    if (!subnetMenu.contains(ev.target) && !refs.subnetbtn?.contains(ev.target)) {
      closeSubnetMenu();
    }
  };
  document.addEventListener('click', onSubnetDocClick);

  SlxSubnetManager.refreshDiscoveryMetadata()
    .then(() => updateSubnetBadgeLabel())
    .catch(() => {});
  window.addEventListener('slx:subnet-changed', updateSubnetBadgeLabel);
  window.addEventListener('slx:subnets-updated', () => {
    updateSubnetBadgeLabel();
    if (subnetMenu.classList.contains('is-open')) {
      renderSubnetMenu();
    }
  });

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

  refs.explorer?.addEventListener('click', (ev) => {
    const path = window.location?.pathname || '';
    if (
      (path === '/' || path.endsWith('/index.html')) &&
      String(effectiveExplorerHref).includes('#slide-4')
    ) {
      ev.preventDefault();
      if (typeof window.goToSlide === 'function') window.goToSlide(3);
      window.dispatchEvent(new CustomEvent('slx:open-explorer'));
    }
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
    refresh: () => {
      updateSubnetBadgeLabel();
      renderHfsChip();
    },
    destroy: () => {
      document.removeEventListener('click', onSubnetDocClick);
      window.removeEventListener('slx:subnet-changed', updateSubnetBadgeLabel);
      statsSub.unsubscribe();
      headsSub.unsubscribe();
      subnetMenu.remove();
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

  if (!mountContainer.className && !mountContainer.style.display) {
    mountContainer.style.display = 'inline-flex';
    mountContainer.style.alignItems = 'center';
    mountContainer.style.gap = '0.4rem';
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
      <span class="slx-btn-lbl">Social Network</span>
      <span class="slx-social-badge violet" data-soc="allyCount">0</span>
      <span class="slx-social-badge amber" data-soc="hsBadge" style="display:none;">+0</span>
    </button>
    <button type="button" class="slx-social-btn msgs" data-soc-open="messages" title="Direct Messages, Live #${escapeHtmlText(appId)} Lounge &amp; Subnet Wall">
      <span>💬</span>
      <span class="slx-btn-lbl">Messages</span>
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
  let activeMsgTab = 'ecies'; // 'ecies' | 'dm' | 'lounge' | 'wall'
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
          <button type="button" class="slx-soc-subtab active" data-soc-subtab="ecies">🔐 ECIES</button>
          <button type="button" class="slx-soc-subtab" data-soc-subtab="dm">🔒 Direct</button>
          <button type="button" class="slx-soc-subtab" data-soc-subtab="lounge">📡 #${escapeHtmlText(appId)}</button>
          <button type="button" class="slx-soc-subtab" data-soc-subtab="wall">🌐 Wall</button>
        </div>

        <div data-soc="eciesBar" style="padding:0.48rem 0.85rem;background:#070e1c;border-bottom:1px solid rgba(51,65,85,0.5);display:none;"></div>

        <div data-soc="dmPeerBar" style="padding:0.48rem 0.95rem;background:#070e1c;border-bottom:1px solid rgba(51,65,85,0.5);display:none;align-items:center;gap:0.42rem;">
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
    eciesBar: backdrop.querySelector('[data-soc="eciesBar"]'),
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
        refs.myIdLine.innerHTML = `Spectating (<code>${shortHex(wallet.keypair.address)}</code>) — <button type="button" class="slx-mini-btn emerald" data-soc-act="createId" style="padding:0.1rem 0.42rem;font-size:0.62rem;">🪪 Create Identity</button>`;
        refs.myIdLine.querySelector('[data-soc-act="createId"]')?.addEventListener('click', async () => {
          try {
            await wallet.ensureIdentityWithPrompt({ rpcUrl: rpcUrlFn(), appName: appTitle });
            await client.refresh(wallet);
          } catch (_) {}
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
          setStatus(err?.isIdentityPromptCanceled ? '' : `⚠ ${err?.message || err}`, 'err');
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
          setStatus(err?.isIdentityPromptCanceled ? '' : `⚠ ${err?.message || err}`, 'err');
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
      if (t === 'ecies') b.textContent = `🔐 ECIES (${client.eciesChannels?.length || 0})`;
      if (t === 'dm') b.textContent = `🔒 Direct (${client.dmMsgs.length})`;
      if (t === 'lounge') b.textContent = `📡 #${appId} (${client.appChannelMsgs.length})`;
      if (t === 'wall') b.textContent = `🌐 Wall (${client.feedSnap?.posts?.length || 0})`;
    }

    const myIdLow = String(client.myIdentityAddr || '').toLowerCase();
    const allies = [...client.connectedIds];

    if (refs.eciesBar) {
      refs.eciesBar.style.display = activeMsgTab === 'ecies' ? 'block' : 'none';
      if (activeMsgTab === 'ecies' && !refs.eciesBar.contains(document.activeElement)) {
        refs.eciesBar.innerHTML = renderEciesSubtabBarHtml(client, myIdLow);
        refs.eciesBar.querySelector('[data-ecies="chanSelect"]')?.addEventListener('change', async (ev) => {
          const cid = ev.target.value;
          if (cid) await client.setActiveEciesChannel(cid, 0, wallet);
        });
        refs.eciesBar.querySelector('[data-ecies="toggleNew"]')?.addEventListener('click', () => {
          const nb = refs.eciesBar.querySelector('[data-ecies="newBox"]');
          if (nb) nb.style.display = nb.style.display === 'none' ? 'flex' : 'none';
        });
        refs.eciesBar.querySelector('[data-ecies="openBtn"]')?.addEventListener('click', async () => {
          if (busy) return;
          const checked = Array.from(refs.eciesBar.querySelectorAll('[data-ecies-peer]:checked')).map((el) =>
            el.getAttribute('data-ecies-peer')
          );
          if (!checked.length) {
            setStatus('⚠ Select at least 1 peer Identity to open an ECIES channel or topic.', 'err');
            return;
          }
          const lbl = String(refs.eciesBar.querySelector('[data-ecies="newLabel"]')?.value || '').trim();
          const tTitle = String(refs.eciesBar.querySelector('[data-ecies="newTopic"]')?.value || 'General').trim();
          busy = true;
          setStatus('⏳Wrapping AES-256-GCM key via secp256k1 ECIES & resolving roster…', 'info');
          renderDrawer();
          try {
            const res = await client.openOrReuseEciesChannel(wallet, {
              members: checked,
              channelLabel: lbl,
              topicTitle: tTitle,
              appName: appTitle,
            });
            setStatus(
              res?.createdNewChannel
                ? `✓ Created ECIES Channel (${shortHex(res.channelId)}) • Topic #0 "${tTitle}" • Epoch #1!`
                : `✓ Existing roster channel reused — created new Topic #${res?.topicId} "${tTitle}" under Epoch #${res?.keyEpoch}!`,
              'ok'
            );
          } catch (err) {
            setStatus(`⚠ ${err?.message || err}`, 'err');
          } finally {
            busy = false;
            renderDrawer();
          }
        });
        refs.eciesBar.querySelectorAll('[data-ecies-topic]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const tid = Number(btn.getAttribute('data-ecies-topic') || 0);
            await client.setActiveEciesChannel(client.activeEciesChannelId, tid, wallet);
          });
        });
        refs.eciesBar.querySelector('[data-ecies="addTopicBtn"]')?.addEventListener('click', async () => {
          if (busy || !client.activeEciesChannelId) return;
          const nb = refs.eciesBar.querySelector('[data-ecies="newBox"]');
          const topicInp = refs.eciesBar.querySelector('[data-ecies="newTopic"]');
          const title = String(topicInp?.value || '').trim();
          if (nb && nb.style.display === 'none') {
            nb.style.display = 'flex';
            topicInp?.focus();
            setStatus('ℹ Enter a new Topic title above and click + Topic again (or Open).', 'info');
            return;
          }
          const effTitle = title && title !== 'General' ? title : `Topic #${client.activeEciesDetails?.topicCount || 1}`;
          busy = true;
          setStatus(`⏳ Creating sub-topic "${effTitle}"…`, 'info');
          renderDrawer();
          try {
            const res = await client.createEciesTopic(wallet, client.activeEciesChannelId, effTitle, { appName: appTitle });
            setStatus(`✓ Created sub-topic #${res?.topicId} "${effTitle}"!`, 'ok');
          } catch (err) {
            setStatus(`⚠ ${err?.message || err}`, 'err');
          } finally {
            busy = false;
            renderDrawer();
          }
        });
        refs.eciesBar.querySelector('[data-ecies="rollKeyBtn"]')?.addEventListener('click', async () => {
          if (busy || !client.activeEciesChannelId) return;
          busy = true;
          setStatus('⏳ Generating fresh 256-bit AES-GCM key & ECIES-wrapping for active members…', 'info');
          renderDrawer();
          try {
            const res = await client.rollEciesChannelKey(wallet, client.activeEciesChannelId, { appName: appTitle });
            setStatus(`✓ Rolled channel key to Epoch #${res?.newKeyEpoch}!`, 'ok');
          } catch (err) {
            setStatus(`⚠ ${err?.message || err}`, 'err');
          } finally {
            busy = false;
            renderDrawer();
          }
        });
        refs.eciesBar.querySelector('[data-ecies="leaveBtn"]')?.addEventListener('click', async () => {
          if (busy || !client.activeEciesChannelId) return;
          busy = true;
          setStatus('⏳ Leaving ECIES channel & setting rekeyRequired=1 on-chain…', 'info');
          renderDrawer();
          try {
            await client.leaveEciesChannel(wallet, client.activeEciesChannelId, { appName: appTitle });
            setStatus('✓ Left channel — survivors must roll AES key before next send!', 'ok');
          } catch (err) {
            setStatus(`⚠ ${err?.message || err}`, 'err');
          } finally {
            busy = false;
            renderDrawer();
          }
        });
      }
    }

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

    const activeEciesCh = (client.eciesChannels || []).find((c) => c.channelId === client.activeEciesChannelId);
    if (refs.msgInput) {
      if (activeMsgTab === 'ecies') {
        const curTopic = activeEciesCh?.topics?.find((t) => t.topicId === client.activeEciesTopicId);
        refs.msgInput.placeholder = activeEciesCh?.isActiveMember
          ? `Encrypt to #${curTopic?.title || 'General'} (AES-256-GCM Ep#${activeEciesCh.rekeyRequired ? activeEciesCh.currentKeyEpoch + 1 : activeEciesCh.currentKeyEpoch})…`
          : 'Open or select an active ECIES channel above to send encrypted messages…';
        refs.msgInput.disabled = busy || !activeEciesCh?.isActiveMember;
      } else if (activeMsgTab === 'dm') {
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
      refs.msgSendBtn.disabled =
        busy ||
        (activeMsgTab === 'dm' && allies.length === 0) ||
        (activeMsgTab === 'ecies' && !activeEciesCh?.isActiveMember);
      refs.msgSendBtn.textContent = busy ? '⏳…' : activeMsgTab === 'wall' ? 'Post →' : activeMsgTab === 'ecies' ? '🔐 Send' : 'Send →';
    }

    if (!refs.msgScroll) return;

    if (activeMsgTab === 'ecies') {
      if (!activeEciesCh) {
        refs.msgScroll.innerHTML = `
          <div style="padding:0.85rem;border-radius:0.65rem;background:rgba(15,23,42,0.8);border:1px dashed rgba(52,211,153,0.45);display:flex;flex-direction:column;gap:0.45rem;">
            <strong style="color:#6ee7b7;font-size:0.78rem;">🔐 Sovereign ECIES + AES-256-GCM Multi-Topic Channels</strong>
            <div style="color:#cbd5e1;font-size:0.71rem;">
              Select 1 or more Identities above and click <strong>🔐 Open</strong>. Channels are deduplicated on-chain by hashing the sorted list of member <code>secp256k1</code> public keys, self-discovered directly from your <code>Identity</code> HFS, and protected by rolling <code>AES-256-GCM</code> epoch keys!
            </div>
          </div>
        `;
      } else if (!client.eciesTopicMsgs?.length) {
        const curTopic = activeEciesCh.topics?.find((t) => t.topicId === client.activeEciesTopicId);
        refs.msgScroll.innerHTML = `<div style="color:#94a3b8;font-size:0.73rem;padding:0.6rem 0.2rem;">No messages in <strong>#${escapeHtmlText(curTopic?.title || 'General')}</strong> yet — send the first <code>AES-256-GCM</code> ciphertext below!</div>`;
      } else {
        refs.msgScroll.innerHTML = client.eciesTopicMsgs
          .map((m) => {
            const mine = m.author === myIdLow;
            const author = mine ? 'You' : client.resolveDisplayTag(m.author);
            return `
              <div class="slx-soc-msg-bubble ${mine ? 'mine' : ''}">
                <div style="display:flex;justify-content:space-between;gap:0.35rem;font-family:monospace;font-size:0.62rem;color:#94a3b8;">
                  <strong style="color:${mine ? '#7dd3fc' : '#6ee7b7'};">${escapeHtmlText(author)}</strong>
                  <span>🔑 Ep#${m.keyEpoch} • Blk #${m.blockNumber}</span>
                </div>
                <div style="color:${m.decrypted ? '#f8fafc' : '#94a3b8'};word-break:break-word;">${escapeHtmlText(m.text)}</div>
              </div>
            `;
          })
          .join('');
        refs.msgScroll.scrollTop = refs.msgScroll.scrollHeight;
      }
    } else if (activeMsgTab === 'dm') {
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
              setStatus(err?.isIdentityPromptCanceled ? '' : `⚠ ${err?.message || err}`, 'err');
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
      if (activeMsgTab === 'ecies') {
        const sendRes = await client.sendEciesTopicMessage(wallet, {
          channelId: client.activeEciesChannelId,
          topicId: client.activeEciesTopicId,
          text: txt,
          appName: appTitle,
        });
        refs.msgInput.value = '';
        setStatus(
          sendRes?.rotatedKeyAutomatically
            ? `✓ Auto-rolled AES-256-GCM key to Epoch #${sendRes.keyEpoch} & confirmed encrypted message!`
            : `✓ Encrypted (AES-256-GCM Ep#${sendRes?.keyEpoch}) & confirmed on Subnet 1!`,
          'ok'
        );
        return;
      } else if (activeMsgTab === 'dm') {
        await client.sendDirectMessage(wallet, client.activeDmPeerId, txt, { appName: appTitle });
      } else if (activeMsgTab === 'lounge') {
        await client.postAppChannel(wallet, txt, { appName: appTitle });
      } else {
        await client.postWall(wallet, txt, { appName: appTitle });
      }
      refs.msgInput.value = '';
      setStatus('✓ Confirmed on Subnet 1!', 'ok');
    } catch (err) {
      setStatus(err?.isIdentityPromptCanceled ? '' : `⚠ ${err?.message || err}`, 'err');
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
    id: 'explorer',
    icon: '🔎',
    label: 'Subnet Block Explorer',
    shortLabel: 'Block Explorer',
    sub: 'Blocks, Quorum Verifier & Subnet HFS Directory',
    href: '/explorer.html',
    group: 'SuperLexicon Platform',
  },
  {
    id: 'apps',
    icon: '🧩',
    label: 'HFS App Store & Studio',
    shortLabel: 'App Store',
    sub: 'On-Chain UI Bundles & Zero-Redeploy Publisher',
    href: '/apps.html',
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
    id: 'ballot',
    icon: '🗳️',
    label: 'CipherVote Secret Ballot',
    shortLabel: 'CipherVote',
    sub: 'Threshold Homomorphic ZK Voting',
    href: '/ballot.html',
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
    id: 'crowdfunding',
    icon: '🚀',
    label: 'Milestone Crowdfunding',
    shortLabel: 'Crowdfunding',
    sub: 'All-or-Nothing & Stretch Growth Budgets',
    href: '/crowdfunding.html',
    group: 'Institutional & Social HFS',
  },
  {
    id: 'rewards',
    icon: '🎁',
    label: 'SLXR Hardware Vouchers',
    shortLabel: 'SLXR Vouchers',
    sub: '90-Day Validator Gate & Cash-Back Pool',
    href: '/rewards.html',
    group: 'Institutional & Social HFS',
  },
  {
    id: 'accounting',
    icon: '📒',
    label: 'IFRS Accounting Ledger',
    shortLabel: 'IFRS Ledger',
    sub: 'IAS/IFRS Statements & Treasury Custody',
    href: '/accounting.html',
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
    sub: 'Bulletproofs & Threshold ZK Deduction',
    href: '/cipher-noir.html',
    group: 'Multiplayer On-Chain Games',
  },
  {
    id: 'lottery',
    icon: '🎰',
    label: 'Quantum 4D Jackpot',
    shortLabel: '4D Lottery',
    sub: 'Validator-Quorum Threshold VRF',
    href: '/lottery.html',
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
  'quantum-lottery': 'lottery',
  'secret-ballot': 'ballot',
  ciphervote: 'ballot',
  'ifrs-ledger': 'accounting',
  ifrs: 'accounting',
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
  logoSrc = undefined,
  logoHref = '/',
  rpcUrlFn = () => getDefaultNodeWsUrl(),
  getContractAddr = () => '',
  getContractLabel = () => 'HFS',
  onToggleNodeDrawer = null,
  explorerHref = undefined,
  onWalletSwitch = null,
  getAppPeers = null,
  socialClient = null,
  contextElements = [],
  extraElements = [],
  mobileElements = [],
  appsList = SLX_PLATFORM_APPS,
} = {}) {
  const slidesMode = isSlidesDeployment();
  const effectiveLogoSrc =
    logoSrc !== undefined
      ? logoSrc
      : slidesMode
      ? '/assets/presentation/slide_asset_01_ff6f13a11e4a.png'
      : '/logo_horizontal_transparent.png';
  const effectiveExplorerHref =
    explorerHref !== undefined
      ? explorerHref
      : slidesMode
      ? '/?view=explorer#slide-4'
      : '/explorer.html';
  const effectiveAppsList = (appsList || SLX_PLATFORM_APPS).filter(
    (app) => slidesMode || app.id !== 'deck'
  );
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
  const activeAppSpec = effectiveAppsList.find((a) => a.id === canonicalActiveId) || null;

  const groups = [];
  for (const app of effectiveAppsList) {
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
        <a href="${escapeHtmlText(logoHref)}" class="slx-uh-logo-link" title="SuperLexicon Home">
          <img
            src="${escapeHtmlText(effectiveLogoSrc)}"
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
      </div>

      <div class="slx-uh-right">
        <div data-uh="mobileSlot" style="display:inline-flex;align-items:center;gap:0.35rem;"></div>

        <div class="slx-uh-apps-wrap">
          <button type="button" class="slx-uh-apps-btn" data-uh="appsBtn" aria-expanded="false" title="Switch between Presentation Slides &amp; Live Subnet 1 HFS Apps">
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

    <div class="slx-uh-app-bar" data-uh="appBar">
      <div class="slx-uh-context" data-uh="context"></div>
      <div class="slx-uh-extra" data-uh="extra"></div>
    </div>
  `;

  host.appendChild(hdr);

  const refs = {
    title: hdr.querySelector('[data-uh="title"]'),
    subtitle: hdr.querySelector('[data-uh="subtitle"]'),
    appBar: hdr.querySelector('[data-uh="appBar"]'),
    context: hdr.querySelector('[data-uh="context"]'),
    extra: hdr.querySelector('[data-uh="extra"]'),
    mobileSlot: hdr.querySelector('[data-uh="mobileSlot"]'),
    appsBtn: hdr.querySelector('[data-uh="appsBtn"]'),
    appsMenu: hdr.querySelector('[data-uh="appsMenu"]'),
    suitePills: hdr.querySelector('[data-uh="suitePills"]'),
    telemetryMount: hdr.querySelector('[data-uh="telemetryMount"]'),
  };

  // Adopt any caller-provided DOM elements (preserving IDs & event listeners!)
  for (const el of mobileElements || []) {
    if (el && refs.mobileSlot) {
      if (el.style?.display === 'none' && el.hasAttribute('data-uh-unhide')) {
        el.style.display = '';
      }
      refs.mobileSlot.appendChild(el);
    }
  }
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

  // Standardized Use-Case Description (`🏛️ Description`) + Instructions (`📖 Instructions`) modals & header pills
  if (typeof window !== 'undefined' && !window.openSlxUseCaseDescription) {
    window.openSlxUseCaseDescription = (targetId, tab = 'codification') =>
      openSlxUseCaseDescription(targetId, tab, { currentPageAppId: canonicalActiveId });
    window.openSlxUseCaseInstructions = (targetId, tab = 'quickstart') =>
      openSlxUseCaseInstructions(targetId, tab);
  }
  mountSlxUseCaseHeaderDocs({
    activeAppId: canonicalActiveId,
    extraContainer: refs.extra,
  });

  const syncAppBarVisibility = () => {
    if (!refs.appBar) return;
    const hasAny =
      (refs.context?.children?.length || 0) > 0 || (refs.extra?.children?.length || 0) > 0;
    refs.appBar.classList.toggle('has-items', hasAny);
  };
  syncAppBarVisibility();

  let appBarMo = null;
  if (typeof MutationObserver !== 'undefined') {
    appBarMo = new MutationObserver(syncAppBarVisibility);
    if (refs.context) appBarMo.observe(refs.context, { childList: true });
    if (refs.extra) appBarMo.observe(refs.extra, { childList: true });
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
    explorerHref: effectiveExplorerHref,
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
      appBarMo?.disconnect();
      chainBar?.destroy?.();
      socialUi?.destroy?.();
      hdr.remove();
    },
  };
}

/**
 * Mount or adopt a multi-stage Subnet 1 HFS hydration progress banner (`mountSlxBootLoader`).
 * Works both with pre-rendered static 0ms HTML (`existingElement`) and zero-markup auto-mounting
 * (`mountContainer` / `insertAfterElement`).
 */
export function mountSlxBootLoader({
  existingElement = null,
  mountContainer = null,
  insertAfterElement = null,
  initialPct = 16,
  initialTitle = 'Connecting to Subnet 1 & reading HFS smart contracts…',
  initialSub = 'Opening parallel WebSocket stream…',
  autoHideDelayMs = 340,
} = {}) {
  if (typeof document === 'undefined') return null;
  injectSlxUiStyles();

  let root = existingElement;
  if (!root) {
    root = document.createElement('section');
    root.className = 'slx-boot-loader';
    root.setAttribute('aria-live', 'polite');
    const clampedInit = Math.max(8, Math.min(99, Math.round(initialPct)));
    root.innerHTML = `
      <div class="slx-boot-top">
        <div class="slx-boot-left">
          <div class="slx-boot-spinner" aria-hidden="true"></div>
          <div>
            <div class="slx-boot-title" data-slx-boot="title">${escapeHtmlText(initialTitle)}</div>
            <div class="slx-boot-sub" data-slx-boot="sub">${escapeHtmlText(initialSub)}</div>
          </div>
        </div>
        <span class="slx-boot-pct" data-slx-boot="pct">${clampedInit}%</span>
      </div>
      <div class="slx-boot-track">
        <div class="slx-boot-fill" data-slx-boot="fill" style="width:${clampedInit}%;"></div>
      </div>
    `;
    if (insertAfterElement && insertAfterElement.parentNode) {
      insertAfterElement.parentNode.insertBefore(root, insertAfterElement.nextSibling);
    } else {
      const host = mountContainer || document.querySelector('main') || document.body;
      host?.prepend?.(root);
    }
  }

  const titleEl =
    root.querySelector('[data-slx-boot="title"]') ||
    root.querySelector('.slx-boot-title, .chr-boot-title');
  const subEl =
    root.querySelector('[data-slx-boot="sub"]') ||
    root.querySelector('.slx-boot-sub, .chr-boot-sub');
  const pctEl =
    root.querySelector('[data-slx-boot="pct"]') ||
    root.querySelector('.slx-boot-pct, .chr-boot-pct');
  const fillEl =
    root.querySelector('[data-slx-boot="fill"]') ||
    root.querySelector('.slx-boot-fill, .chr-boot-fill');

  let hideTimer = 0;
  let completed = false;

  const setStage = (pct, title, sub = undefined) => {
    clearTimeout(hideTimer);
    completed = false;
    root.hidden = false;
    root.classList.remove('fading', 'complete');
    const clamped = Math.max(8, Math.min(99, Math.round(Number(pct) || 16)));
    if (titleEl && title) titleEl.textContent = title;
    if (subEl && sub !== undefined && sub !== null) subEl.textContent = sub;
    if (pctEl) pctEl.textContent = `${clamped}%`;
    if (fillEl) fillEl.style.width = `${clamped}%`;
  };

  const complete = (
    doneTitle = '✓ Synchronized with Subnet 1',
    doneSub = undefined
  ) => {
    if (completed && root.hidden) return;
    clearTimeout(hideTimer);
    completed = true;
    root.classList.add('complete');
    if (titleEl && doneTitle) titleEl.textContent = doneTitle;
    if (subEl && doneSub !== undefined && doneSub !== null) subEl.textContent = doneSub;
    if (pctEl) pctEl.textContent = '100%';
    if (fillEl) fillEl.style.width = '100%';
    hideTimer = setTimeout(() => {
      root.classList.add('fading');
      hideTimer = setTimeout(() => {
        root.hidden = true;
      }, 290);
    }, Math.max(0, autoHideDelayMs));
  };

  const hide = () => {
    clearTimeout(hideTimer);
    completed = true;
    root.hidden = true;
  };

  return {
    el: root,
    setStage,
    reset: (pct = 24, title = 'Switching HFS instance…', sub = '') => setStage(pct, title, sub),
    complete,
    hide,
    isComplete: () => completed,
  };
}
