/**
 * @superlexicon/sdk/ui — Live Multi-Subnet Phase Sync & Roamer Bridge Diagram (`subnet-phase-diagram.js`)
 *
 * Real-time animated visualization of how multiple independent SuperLexicon Subnets coexist
 * on completely decoupled 4-phase BFT clocks (`P1 TX` -> `P2 VOTE` -> `P3 PROP` -> `P4 FIN`)
 * while exchanging cross-subnet transactions (`ForeignSubnetTxn`) and cryptographic execution
 * receipts (`ForeignSubnetTxnResponse`) asynchronously via Hybrid Roamer / Repeater nodes.
 */

import {
  keccak256Hex,
  utf8ToBytes,
  signOrderedLexiconTx,
  generatePrivateKeyHex,
} from '../crypto.js';
import { encodeAbi, shortHex } from '../abi.js';
import { SlxSubnetManager, slxNodeRpc } from '../rpc.js';
import { slxSubscribeStats, slxSubscribeNewHeads } from '../events.js';

const DIAG_W = 1200;
const DIAG_H = 675;

const PHASE_META = [
  null,
  { idx: 1, code: 'P1', name: 'TX GOSSIP', color: '#38bdf8', startDeg: -86, endDeg: -4 },
  { idx: 2, code: 'P2', name: 'BFT VOTE', color: '#fbbf24', startDeg: 4, endDeg: 86 },
  { idx: 3, code: 'P3', name: 'PROPOSAL', color: '#c084fc', startDeg: 94, endDeg: 176 },
  { idx: 4, code: 'P4', name: 'FINALIZE', color: '#34d399', startDeg: 184, endDeg: 266 },
];

const DEFAULT_S1_MSG = '0x4e9bc36f233ccb81d00ccceb892fdf08e28196fb';
const DEFAULT_S2_MSG = '0x07fd8feb5638a3b33a24dc6acf7fe9839ce5c92f';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
}

function polarToXY(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx, cy, r, startDeg, endDeg) {
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function quadBezierPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

/**
 * Mount the animated Multi-Subnet Phase Sync & Cross-Subnet Roamer Bridge Diagram.
 */
export function mountSlxSubnetPhaseDiagram({
  mountContainer,
  isVisibleFn = () => true,
} = {}) {
  if (typeof document === 'undefined' || !mountContainer) return null;

  const state = {
    destroyed: false,
    subnets: [],
    // key -> { phase, phaseEnteredAt, confirmMs, height, blockHash, lastBlockTxs, mempool, validators, flashUntil }
    teleByKey: new Map(),
    subsHandles: [],
    // Active animated cross-subnet packets:
    // { id, txHash, originIdx, targetIdx, progress (0..1), stage, targetBlock, realStageRank, spawnedAt, speed }
    packets: [],
    seenTxRanks: new Map(),
    confirmedTotal: 0,
    roamerLane: '915 MHz RF ⇄ Encrypted TCP',
    roamerPulseUntil: 0,
    sendingDir: '',
  };

  mountContainer.innerHTML = `
    <div class="slx-spd-wrap" style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:radial-gradient(ellipse at 50% 48%, #0b1930 0%, #050b17 70%, #030712 100%);">
      <svg class="slx-spd-svg" viewBox="0 0 ${DIAG_W} ${DIAG_H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;"></svg>
      <div class="slx-spd-cta-bar" style="position:absolute;right:10px;bottom:10px;display:flex;flex-wrap:wrap;gap:6px;z-index:3;">
        <button type="button" class="slx-swm-btn" data-spd-send="RF_TO_TCP" style="border-color:rgba(56,189,248,0.68);background:rgba(8,22,42,0.9);color:#bae6fd;padding:4px 9px;font-size:0.64rem;">
          📡➔🔌 Bridge RF→TCP Tx
        </button>
        <button type="button" class="slx-swm-btn" data-spd-send="TCP_TO_RF" style="border-color:rgba(192,132,252,0.68);background:rgba(20,12,38,0.9);color:#f3e8ff;padding:4px 9px;font-size:0.64rem;">
          🔌➔📡 Bridge TCP→RF Tx
        </button>
      </div>
    </div>
  `;

  const svg = mountContainer.querySelector('.slx-spd-svg');
  const btnRfToTcp = mountContainer.querySelector('[data-spd-send="RF_TO_TCP"]');
  const btnTcpToRf = mountContainer.querySelector('[data-spd-send="TCP_TO_RF"]');

  let domRefs = {
    subnetNodes: [],
    packetsGroup: null,
    roamerStatusTxt: null,
    roamerCountTxt: null,
    roamerCoreDiamond: null,
  };

  function getOrInitTele(s, idx) {
    let t = state.teleByKey.get(s.key);
    if (!t) {
      // Stagger initial phases slightly before first WS frame arrives so independent clocks are clear
      const initPhase = ((idx * 2) % 4) + 1;
      t = {
        phase: initPhase,
        phaseEnteredAt: performance.now() - idx * 650,
        confirmMs: s.transport === 'tcp' ? 4800 : 4200,
        height: Number(s.tipHeight || 0),
        blockHash: '',
        lastBlockTxs: 0,
        mempool: 0,
        validators: Number(s.validatorCount || s.validatorNodes?.length || 3),
        flashUntil: 0,
        liveConnected: false,
      };
      state.teleByKey.set(s.key, t);
    }
    return t;
  }

  function computeRingGeometry(count) {
    const roamer = { x: 600, y: 342 };
    if (count <= 2) {
      return {
        roamer,
        rings: [
          { cx: 256, cy: 342, r: 158, valR: 112 },
          { cx: 944, cy: 342, r: 158, valR: 112 },
        ].slice(0, Math.max(1, count)),
      };
    }
    if (count === 3) {
      return {
        roamer: { x: 600, y: 365 },
        rings: [
          { cx: 235, cy: 405, r: 132, valR: 92 },
          { cx: 965, cy: 405, r: 132, valR: 92 },
          { cx: 600, cy: 148, r: 118, valR: 82 },
        ],
      };
    }
    return {
      roamer,
      rings: [
        { cx: 235, cy: 205, r: 120, valR: 84 },
        { cx: 965, cy: 205, r: 120, valR: 84 },
        { cx: 235, cy: 485, r: 120, valR: 84 },
        { cx: 965, cy: 485, r: 120, valR: 84 },
      ],
    };
  }

  function rebuildTopology() {
    if (!svg || state.destroyed) return;
    const allSubs = SlxSubnetManager.listSubnets().slice(0, 4);
    state.subnets = allSubs;
    const { roamer, rings } = computeRingGeometry(allSubs.length);

    let bgGrid = '';
    for (let x = 60; x < DIAG_W; x += 60) {
      bgGrid += `<line x1="${x}" y1="0" x2="${x}" y2="${DIAG_H}" stroke="rgba(56,189,248,0.045)" stroke-width="1" />`;
    }
    for (let y = 60; y < DIAG_H; y += 60) {
      bgGrid += `<line x1="0" y1="${y}" x2="${DIAG_W}" y2="${y}" stroke="rgba(56,189,248,0.045)" stroke-width="1" />`;
    }

    // Build bridge guide tracks between each subnet ring and the central Roamer
    let lanesSvg = '';
    const ringPorts = rings.map((rg) => {
      const dx = roamer.x - rg.cx;
      const dy = roamer.y - rg.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      // Orthogonal normal for separating outbound vs return lane
      const nx = -uy;
      const ny = ux;
      const edgePt = { x: rg.cx + ux * (rg.r + 10), y: rg.cy + uy * (rg.r + 10) };
      const roamerEdge = { x: roamer.x - ux * 68, y: roamer.y - uy * 48 };
      const ctrlUpper = {
        x: (edgePt.x + roamerEdge.x) / 2 + nx * 38,
        y: (edgePt.y + roamerEdge.y) / 2 + ny * 38,
      };
      const ctrlLower = {
        x: (edgePt.x + roamerEdge.x) / 2 - nx * 38,
        y: (edgePt.y + roamerEdge.y) / 2 - ny * 38,
      };
      return { edgePt, roamerEdge, ctrlUpper, ctrlLower };
    });

    ringPorts.forEach((pt, i) => {
      const isTcp = allSubs[i]?.transport === 'tcp';
      const col = isTcp ? 'rgba(192,132,252,0.34)' : 'rgba(56,189,248,0.34)';
      lanesSvg += `
        <path d="M ${pt.edgePt.x.toFixed(1)} ${pt.edgePt.y.toFixed(1)} Q ${pt.ctrlUpper.x.toFixed(1)} ${pt.ctrlUpper.y.toFixed(1)} ${pt.roamerEdge.x.toFixed(1)} ${pt.roamerEdge.y.toFixed(1)}"
          fill="none" stroke="${col}" stroke-width="1.8" stroke-dasharray="6 5" />
        <path d="M ${pt.roamerEdge.x.toFixed(1)} ${pt.roamerEdge.y.toFixed(1)} Q ${pt.ctrlLower.x.toFixed(1)} ${pt.ctrlLower.y.toFixed(1)} ${pt.edgePt.x.toFixed(1)} ${pt.edgePt.y.toFixed(1)}"
          fill="none" stroke="rgba(52,211,153,0.26)" stroke-width="1.5" stroke-dasharray="4 5" />
      `;
    });

    // Build each Subnet's Independent 4-Phase Consensus Ring + Validator Mesh
    let ringsSvg = '';
    allSubs.forEach((s, idx) => {
      const rg = rings[idx];
      if (!rg) return;
      const isTcp = s.transport === 'tcp';
      const themeCol = isTcp ? '#c084fc' : '#38bdf8';
      const valNodes =
        Array.isArray(s.validatorNodes) && s.validatorNodes.length
          ? s.validatorNodes.slice(0, 6)
          : Array.from({ length: Math.min(5, Number(s.validatorCount || 3)) }, (_, k) => ({
              name: `node${k + 1}`,
              pubkeyPrefix: null,
            }));

      // Validator positions & internal gossip mesh chords
      const vCoords = valNodes.map((vn, vIdx) => {
        const ang = -90 + (vIdx * 360) / valNodes.length + (valNodes.length === 4 ? 45 : 0);
        const pos = polarToXY(rg.cx, rg.cy, rg.valR, ang);
        return { ...vn, x: pos.x, y: pos.y, ang };
      });

      let meshLines = '';
      for (let a = 0; a < vCoords.length; a++) {
        for (let b = a + 1; b < vCoords.length; b++) {
          meshLines += `<line x1="${vCoords[a].x.toFixed(1)}" y1="${vCoords[a].y.toFixed(1)}" x2="${vCoords[b].x.toFixed(1)}" y2="${vCoords[b].y.toFixed(1)}"
            stroke="${isTcp ? 'rgba(192,132,252,0.22)' : 'rgba(56,189,248,0.22)'}"
            stroke-width="1.2" ${isTcp ? '' : 'stroke-dasharray="3 3"'} />`;
        }
      }

      // 4 Phase Quadrant Arcs
      let phaseArcs = '';
      for (let p = 1; p <= 4; p++) {
        const pm = PHASE_META[p];
        const d = describeArc(rg.cx, rg.cy, rg.r, pm.startDeg, pm.endDeg);
        const mid = polarToXY(rg.cx, rg.cy, rg.r + 22, (pm.startDeg + pm.endDeg) / 2);
        phaseArcs += `
          <path data-spd-arc="${idx}-${p}" d="${d}" fill="none" stroke="${pm.color}" stroke-width="8" stroke-linecap="round" opacity="0.22" />
          <text data-spd-plbl="${idx}-${p}" x="${mid.x.toFixed(1)}" y="${(mid.y + 3.5).toFixed(1)}" text-anchor="middle"
            fill="${pm.color}" opacity="0.55" font-size="10.5" font-weight="800" font-family="JetBrains Mono, monospace">${pm.code} ${pm.name}</text>
        `;
      }

      const valsHtml = vCoords
        .map((vc, vIdx) => {
          const shortName = String(vc.name || `val${vIdx + 1}`)
            .replace(/^(TCP |RF )?Validator\s*/i, '')
            .slice(0, 10);
          return `
            <g transform="translate(${vc.x.toFixed(1)}, ${vc.y.toFixed(1)})">
              <circle r="13" fill="#071022" stroke="${themeCol}" stroke-width="1.8" />
              <circle data-spd-vdot="${idx}-${vIdx}" r="4.2" fill="${themeCol}" />
              <rect x="-32" y="16" width="64" height="14" rx="4" fill="rgba(3,7,18,0.88)" stroke="rgba(71,85,105,0.6)" stroke-width="0.8" />
              <text x="0" y="26" text-anchor="middle" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="JetBrains Mono, monospace">${esc(shortName)}</text>
            </g>
          `;
        })
        .join('');

      const headerY = rg.cy - rg.r - 48;
      ringsSvg += `
        <g data-spd-ring="${idx}">
          <!-- Header Banner above Ring -->
          <g transform="translate(${rg.cx}, ${Math.max(30, headerY)})">
            <rect x="-148" y="-16" width="296" height="32" rx="8" fill="rgba(5,12,26,0.92)" stroke="${themeCol}" stroke-width="1.3" />
            <text x="0" y="4" text-anchor="middle" fill="${isTcp ? '#f3e8ff' : '#e0f2fe'}" font-size="11.5" font-weight="800" font-family="JetBrains Mono, monospace">
              ${esc(s.icon || (isTcp ? '🔌' : '📡'))} ${esc((s.shortLabel || s.name).slice(0, 22))} (${esc(s.subnetId)})
            </text>
          </g>

          <!-- P4 Block Finality Shockwave Ring -->
          <circle data-spd-shock="${idx}" cx="${rg.cx}" cy="${rg.cy}" r="${rg.r}" fill="none" stroke="#34d399" stroke-width="3" opacity="0" />

          <!-- Subtle Inner Track & Mesh Chords -->
          <circle cx="${rg.cx}" cy="${rg.cy}" r="${rg.r}" fill="rgba(8,16,34,0.52)" stroke="rgba(71,85,105,0.28)" stroke-width="1" />
          ${meshLines}
          ${phaseArcs}

          <!-- Rotating Phase Sweep Hand -->
          <g data-spd-needle="${idx}" transform="rotate(-86 ${rg.cx} ${rg.cy})">
            <line x1="${rg.cx}" y1="${rg.cy}" x2="${rg.cx + rg.r - 6}" y2="${rg.cy}" stroke="#f8fafc" stroke-width="2" stroke-dasharray="4 3" opacity="0.65" />
            <circle cx="${rg.cx + rg.r}" cy="${rg.cy}" r="6.5" fill="#f8fafc" filter="url(#spdGlow)" />
          </g>

          <!-- Validator Gossip Pulse Orb -->
          <circle data-spd-gossip="${idx}" cx="${rg.cx}" cy="${rg.cy - rg.valR}" r="4" fill="${themeCol}" filter="url(#spdGlow)" opacity="0.9" />

          <!-- Validator Nodes -->
          ${valsHtml}

          <!-- Center Live Block & Phase Readout Hub -->
          <circle cx="${rg.cx}" cy="${rg.cy}" r="54" fill="#040a17" stroke="${themeCol}" stroke-width="1.6" />
          <text data-spd-blk="${idx}" x="${rg.cx}" y="${rg.cy - 12}" text-anchor="middle" fill="#f8fafc" font-size="14.5" font-weight="800" font-family="JetBrains Mono, monospace">#—</text>
          <text data-spd-pbadge="${idx}" x="${rg.cx}" y="${rg.cy + 7}" text-anchor="middle" fill="#38bdf8" font-size="10.5" font-weight="800" font-family="JetBrains Mono, monospace">P1 • TX</text>
          <text data-spd-submeta="${idx}" x="${rg.cx}" y="${rg.cy + 24}" text-anchor="middle" fill="#94a3b8" font-size="8.6" font-family="JetBrains Mono, monospace">${isTcp ? 'TLS TCP Mesh' : '915 MHz FLRC'}</text>
        </g>
      `;
    });

    // Central Hybrid Roamer / Repeater Bridge Core
    const roamerSvg = `
      <g transform="translate(${roamer.x}, ${roamer.y})">
        <rect x="-86" y="-66" width="172" height="132" rx="16" fill="rgba(9,14,29,0.96)" stroke="#fbbf24" stroke-width="2" filter="url(#spdSoftShadow)" />
        <polygon data-spd="roamer-diamond" points="0,-28 28,0 0,28 -28,0" fill="rgba(251,191,36,0.16)" stroke="#fbbf24" stroke-width="2" />
        <text x="0" y="5" text-anchor="middle" font-size="18">🛰️</text>
        <text x="0" y="-44" text-anchor="middle" fill="#fde68a" font-size="10.5" font-weight="800" font-family="JetBrains Mono, monospace">HYBRID ROAMER / REPEATER</text>
        <text data-spd="roamer-lane" x="0" y="44" text-anchor="middle" fill="#cbd5e1" font-size="8.8" font-weight="700" font-family="JetBrains Mono, monospace">915 MHz RF ⇄ TCP/IP</text>
        <text data-spd="roamer-cnt" x="0" y="57" text-anchor="middle" fill="#6ee7b7" font-size="8.4" font-family="JetBrains Mono, monospace">Listening to Subnets…</text>

        <!-- Left & Right Transceiver Port Pins -->
        <circle cx="-86" cy="0" r="6" fill="#38bdf8" stroke="#040a17" stroke-width="2" />
        <circle cx="86" cy="0" r="6" fill="#c084fc" stroke="#040a17" stroke-width="2" />
      </g>
    `;

    // Top Explanatory Title Banner inside SVG
    const topBannerSvg = `
      <g transform="translate(600, 26)">
        <text x="0" y="0" text-anchor="middle" fill="#94a3b8" font-size="10.5" font-weight="700" font-family="JetBrains Mono, monospace">
          ASYNCHRONOUS MULTI-SUBNET CONSENSUS • EACH SUBNET RUNS ITS OWN INDEPENDENT P1→P4 BFT CLOCK • ROAMER BRIDGES TXNS &amp; RECEIPTS
        </text>
      </g>
    `;

    svg.innerHTML = `
      <defs>
        <filter id="spdGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="spdSoftShadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.55" />
        </filter>
      </defs>
      ${bgGrid}
      ${topBannerSvg}
      ${lanesSvg}
      ${ringsSvg}
      ${roamerSvg}
      <g data-spd="packets"></g>
    `;

    domRefs = {
      roamer,
      rings,
      ringPorts,
      packetsGroup: svg.querySelector('[data-spd="packets"]'),
      roamerStatusTxt: svg.querySelector('[data-spd="roamer-lane"]'),
      roamerCountTxt: svg.querySelector('[data-spd="roamer-cnt"]'),
      roamerCoreDiamond: svg.querySelector('[data-spd="roamer-diamond"]'),
      subnetNodes: allSubs.map((s, idx) => ({
        subnet: s,
        rg: rings[idx],
        shock: svg.querySelector(`[data-spd-shock="${idx}"]`),
        needle: svg.querySelector(`[data-spd-needle="${idx}"]`),
        gossip: svg.querySelector(`[data-spd-gossip="${idx}"]`),
        blk: svg.querySelector(`[data-spd-blk="${idx}"]`),
        pbadge: svg.querySelector(`[data-spd-pbadge="${idx}"]`),
        submeta: svg.querySelector(`[data-spd-submeta="${idx}"]`),
        arcs: [
          null,
          svg.querySelector(`[data-spd-arc="${idx}-1"]`),
          svg.querySelector(`[data-spd-arc="${idx}-2"]`),
          svg.querySelector(`[data-spd-arc="${idx}-3"]`),
          svg.querySelector(`[data-spd-arc="${idx}-4"]`),
        ],
        plbls: [
          null,
          svg.querySelector(`[data-spd-plbl="${idx}-1"]`),
          svg.querySelector(`[data-spd-plbl="${idx}-2"]`),
          svg.querySelector(`[data-spd-plbl="${idx}-3"]`),
          svg.querySelector(`[data-spd-plbl="${idx}-4"]`),
        ],
      })),
    };
  }

  function wireLiveSubscriptions() {
    for (const h of state.subsHandles) {
      try {
        h.unsubscribe?.();
      } catch (_) {}
    }
    state.subsHandles = [];

    const subs = SlxSubnetManager.listSubnets().slice(0, 4);
    subs.forEach((s, idx) => {
      if (!s.rpcUrl) return;
      const tele = getOrInitTele(s, idx);

      const hStats = slxSubscribeStats(
        () => s.rpcUrl,
        (snap) => {
          if (!snap || state.destroyed) return;
          tele.liveConnected = true;
          const now = performance.now();
          if (Number(snap.height) > tele.height) {
            if (tele.height > 0) tele.flashUntil = now + 750;
            tele.height = Number(snap.height);
          }
          if (typeof snap.validatorCount === 'number' && snap.validatorCount > 0) {
            tele.validators = snap.validatorCount;
          }
          tele.mempool = Number(snap.mergedMempoolCount ?? snap.localMempoolCount ?? 0);

          const pm = snap.phaseMetrics;
          if (pm && typeof pm === 'object') {
            const p = Number(pm.phase || 0);
            if (p >= 1 && p <= 4 && p !== tele.phase) {
              tele.phase = p;
              tele.phaseEnteredAt = now;
              if (p === 4) tele.flashUntil = now + 750;
            }
            const cMs = Number(pm.confirmMs || pm.rollingAvgConfirmMs || 0);
            if (cMs >= 600 && cMs <= 60_000) tele.confirmMs = cMs;
            if (Number(pm.blockHeight) > tele.height) {
              tele.height = Number(pm.blockHeight);
            }
            if (typeof pm.phaseValue === 'number' && p === 4) {
              tele.lastBlockTxs = pm.phaseValue;
            }
          }
        },
        { pubsubWsUrls: s.pubsubWsUrls }
      );

      const hHeads = slxSubscribeNewHeads(
        () => s.rpcUrl,
        (head) => {
          if (!head || state.destroyed) return;
          tele.liveConnected = true;
          if (head.blockNumberNum > tele.height) {
            tele.height = head.blockNumberNum;
            tele.phase = 4;
            tele.phaseEnteredAt = performance.now();
            tele.flashUntil = performance.now() + 750;
            if (typeof head.txCountNum === 'number') tele.lastBlockTxs = head.txCountNum;
          }
        },
        { pubsubWsUrls: s.pubsubWsUrls }
      );

      state.subsHandles.push(hStats, hHeads);
    });
  }

  function spawnOrAdvancePacket({
    txHash,
    originIdx = 0,
    targetIdx = 1,
    rank = 1, // 1=staged, 2=roamer, 3=executed/returning, 4=confirmed
    targetBlock = null,
  }) {
    if (state.subnets.length < 2) return;
    const cleanHash = String(txHash || '').toLowerCase();
    const prevRank = state.seenTxRanks.get(cleanHash) || 0;
    if (rank <= prevRank && state.packets.some((p) => p.txHash === cleanHash)) return;
    state.seenTxRanks.set(cleanHash, rank);
    if (state.seenTxRanks.size > 200) {
      const oldest = state.seenTxRanks.keys().next().value;
      if (oldest) state.seenTxRanks.delete(oldest);
    }

    const existing = state.packets.find((p) => p.txHash === cleanHash);
    const minProgForRank = rank === 1 ? 0.04 : rank === 2 ? 0.3 : rank === 3 ? 0.68 : 0.78;
    if (existing) {
      existing.realStageRank = Math.max(existing.realStageRank, rank);
      if (targetBlock) existing.targetBlock = targetBlock;
      if (existing.progress < minProgForRank) {
        existing.progress = minProgForRank;
      }
      return;
    }

    // Cap concurrent visual packets to 6 for crisp readability
    if (state.packets.length >= 6) return;
    state.packets.push({
      id: `${cleanHash}_${Date.now()}`,
      txHash: cleanHash,
      originIdx: Math.min(originIdx, state.subnets.length - 1),
      targetIdx: Math.min(targetIdx, state.subnets.length - 1),
      progress: rank >= 4 ? 0.55 : minProgForRank,
      realStageRank: rank,
      targetBlock,
      spawnedAt: performance.now(),
    });
    state.roamerPulseUntil = performance.now() + 900;
  }

  // Poll `slx_roamingStatus` on Subnet 1 & Subnet 2 to ingest real live bridged transactions
  let seededRecentConfirmedOnBoot = false;
  async function pollRoamingPools() {
    if (state.destroyed || !isVisibleFn()) return;
    const subs = state.subnets;
    if (subs.length < 2) return;
    const s1 = subs[0];
    const s2 = subs[1];

    const [r1, r2] = await Promise.all([
      s1?.rpcUrl ? slxNodeRpc(s1.rpcUrl, 'slx_roamingStatus', [], 2800).catch(() => null) : null,
      s2?.rpcUrl ? slxNodeRpc(s2.rpcUrl, 'slx_roamingStatus', [], 2800).catch(() => null) : null,
    ]);

    const c1 = Number(r1?.confirmed_foreign_responses || 0);
    const c2 = Number(r2?.confirmed_foreign_responses || 0);
    if (c1 + c2 > 0) state.confirmedTotal = c1 + c2;

    const s1Id = String(s1.subnetId || 'e40af3dd').toLowerCase();
    const ingestList = (arr, rank, maxTake = 2) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr.slice(0, maxTake)) {
        const rawH = String(item?.tx_hash || '').replace(/^0x/i, '').toLowerCase();
        if (!rawH) continue;
        const h = `0x${rawH}`;
        const orig = String(item.origin_subnet || '').toLowerCase() === s1Id ? 0 : 1;
        const targ = orig === 0 ? 1 : 0;
        spawnOrAdvancePacket({
          txHash: h,
          originIdx: orig,
          targetIdx: targ,
          rank,
          targetBlock: item.block_height || null,
        });
      }
    };

    ingestList(r1?.recent_pending_txns, 1, 2);
    ingestList(r2?.recent_pending_txns, 1, 2);
    ingestList(r1?.recent_pending_responses, 3, 2);
    ingestList(r2?.recent_pending_responses, 3, 2);

    if (!seededRecentConfirmedOnBoot) {
      // On initial open, animate the single most recent confirmed cross-subnet tx so user sees real traffic right away
      seededRecentConfirmedOnBoot = true;
      ingestList(r1?.recent_confirmed_responses, 2, 1);
      ingestList(r2?.recent_confirmed_responses, 2, 1);
    } else {
      // Subsequent newly confirmed hashes advance smoothly
      for (const item of [...(r1?.recent_confirmed_responses || []), ...(r2?.recent_confirmed_responses || [])].slice(0, 3)) {
        const rawH = String(item?.tx_hash || '').replace(/^0x/i, '').toLowerCase();
        if (!rawH) continue;
        const h = `0x${rawH}`;
        if (!state.seenTxRanks.has(h)) {
          const orig = String(item.origin_subnet || '').toLowerCase() === s1Id ? 0 : 1;
          spawnOrAdvancePacket({
            txHash: h,
            originIdx: orig,
            targetIdx: orig === 0 ? 1 : 0,
            rank: 2,
            targetBlock: item.block_height || null,
          });
        } else {
          spawnOrAdvancePacket({
            txHash: h,
            originIdx: 0,
            targetIdx: 1,
            rank: 4,
            targetBlock: item.block_height || null,
          });
        }
      }
    }
  }

  async function dispatchLiveCrossSubnetTx(dir) {
    if (state.sendingDir || state.subnets.length < 2) return;
    state.sendingDir = dir;
    const isRfToTcp = dir === 'RF_TO_TCP';
    const origBtn = isRfToTcp ? btnRfToTcp : btnTcpToRf;
    const origLabel = origBtn?.textContent || '';
    if (origBtn) {
      origBtn.disabled = true;
      origBtn.textContent = '⏳ Dispatching…';
    }

    try {
      const s1 = state.subnets[0];
      const s2 = state.subnets[1];
      const originSub = isRfToTcp ? s1 : s2;
      const targetSub = isRfToTcp ? s2 : s1;
      const targetMsgAddr =
        targetSub?.contracts?.messaging || (isRfToTcp ? DEFAULT_S2_MSG : DEFAULT_S1_MSG);

      const ephPriv = generatePrivateKeyHex();
      const channel = keccak256Hex(utf8ToBytes('CROSS_SUBNET_BRIDGE'));
      const msg = `[PhaseDiagram ${isRfToTcp ? 'RF->TCP' : 'TCP->RF'}] Live Cross-Subnet Bridge @ ${new Date().toISOString()}`;
      const calldata = encodeAbi('postMessage(bytes32,bytes)', [channel, utf8ToBytes(msg)]);
      const signed = signOrderedLexiconTx({
        privateKey: ephPriv,
        nonce: 0n,
        to: targetMsgAddr,
        value: 0n,
        data: calldata,
        gasLimit: 500_000n,
        chainId: 1337n,
      });

      // Immediately launch the visual packet for this exact signed txHash!
      spawnOrAdvancePacket({
        txHash: signed.txHash,
        originIdx: isRfToTcp ? 0 : 1,
        targetIdx: isRfToTcp ? 1 : 0,
        rank: 1,
      });

      const targets =
        Array.isArray(originSub?.validatorNodes) && originSub.validatorNodes.length
          ? originSub.validatorNodes.map((v) => v.url).filter(Boolean)
          : [originSub?.rpcUrl].filter(Boolean);

      await Promise.allSettled(
        targets.map((u) =>
          slxNodeRpc(u, 'subnet_sendTransaction', [targetSub.subnetId, signed.raw], 4000)
        )
      );
    } finally {
      state.sendingDir = '';
      if (origBtn) {
        origBtn.disabled = false;
        origBtn.textContent = origLabel;
      }
    }
  }

  btnRfToTcp?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dispatchLiveCrossSubnetTx('RF_TO_TCP');
  });
  btnTcpToRf?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dispatchLiveCrossSubnetTx('TCP_TO_RF');
  });

  // Smooth 60fps animation loop (runs lightweight DOM attribute updates ONLY when visible)
  let lastFrameMs = performance.now();
  let rafId = 0;

  function stepAnimation(now) {
    if (state.destroyed) {
      rafId = 0;
      return;
    }
    if (!isVisibleFn()) {
      rafId = 0;
      return;
    }
    const dt = Math.min(0.08, Math.max(0.001, (now - lastFrameMs) / 1000));
    lastFrameMs = now;

    if (domRefs.subnetNodes.length > 0) {
      // 1. Update each Subnet's Independent Phase Clock, Needle, Shockwave & Readouts
      domRefs.subnetNodes.forEach((nd, idx) => {
        const s = nd.subnet;
        const tele = getOrInitTele(s, idx);
        const phaseDurMs = Math.max(350, tele.confirmMs / 4);
        let elapsedPhase = now - tele.phaseEnteredAt;

        // If validator WS hasn't pushed a transition yet (e.g. idle TCP interval), advance local phase smoothly
        if (elapsedPhase > phaseDurMs * 1.15 && !tele.liveConnected) {
          tele.phase = (tele.phase % 4) + 1;
          tele.phaseEnteredAt = now;
          elapsedPhase = 0;
        }
        const frac = Math.max(0, Math.min(0.98, elapsedPhase / phaseDurMs));
        const pm = PHASE_META[tele.phase] || PHASE_META[1];
        const needleDeg = pm.startDeg + (pm.endDeg - pm.startDeg) * frac;

        nd.needle?.setAttribute('transform', `rotate(${needleDeg.toFixed(1)} ${nd.rg.cx} ${nd.rg.cy})`);

        // Orbiting validator gossip pulse
        const gossipDeg = ((now * (s.transport === 'tcp' ? 0.16 : 0.11) + idx * 90) % 360);
        const gp = polarToXY(nd.rg.cx, nd.rg.cy, nd.rg.valR, gossipDeg);
        nd.gossip?.setAttribute('cx', gp.x.toFixed(1));
        nd.gossip?.setAttribute('cy', gp.y.toFixed(1));

        // Highlight active phase quadrant arc
        for (let p = 1; p <= 4; p++) {
          const active = p === tele.phase;
          nd.arcs[p]?.setAttribute('opacity', active ? '0.98' : '0.2');
          nd.arcs[p]?.setAttribute('stroke-width', active ? '11' : '7');
          nd.plbls[p]?.setAttribute('opacity', active ? '1' : '0.48');
        }

        // P4 Finality Shockwave
        if (now < tele.flashUntil) {
          const k = 1 - (tele.flashUntil - now) / 750;
          nd.shock?.setAttribute('r', (nd.rg.r + k * 28).toFixed(1));
          nd.shock?.setAttribute('opacity', ((1 - k) * 0.85).toFixed(2));
        } else {
          nd.shock?.setAttribute('opacity', '0');
        }

        if (nd.blk) {
          nd.blk.textContent = tele.height > 0 ? `#${fmtNum(tele.height)}` : 'SYNCING';
        }
        if (nd.pbadge) {
          nd.pbadge.textContent = `${pm.code} • ${pm.name}`;
          nd.pbadge.setAttribute('fill', pm.color);
        }
        if (nd.submeta) {
          const beatSec = (tele.confirmMs / 1000).toFixed(1);
          nd.submeta.textContent = `${tele.validators} Val • ~${beatSec}s cycle`;
        }
      });

      // 2. Update Central Roamer Core Status
      if (domRefs.roamerCountTxt) {
        domRefs.roamerCountTxt.textContent =
          state.confirmedTotal > 0
            ? `${fmtNum(state.confirmedTotal)} Confirmed • ${state.packets.length} Active`
            : `${state.packets.length} Bridging • WorldMap Sync`;
      }
      if (domRefs.roamerCoreDiamond) {
        const pulsing = now < state.roamerPulseUntil || state.packets.some((p) => p.progress > 0.24 && p.progress < 0.48);
        domRefs.roamerCoreDiamond.setAttribute(
          'fill',
          pulsing ? 'rgba(251,191,36,0.38)' : 'rgba(251,191,36,0.14)'
        );
      }

      // 3. Advance & Render Animated Cross-Subnet Transactions & Return Receipts
      if (domRefs.packetsGroup && domRefs.ringPorts.length >= 2) {
        let pktsHtml = '';
        const keep = [];

        for (const pkt of state.packets) {
          const origPort = domRefs.ringPorts[pkt.originIdx];
          const targPort = domRefs.ringPorts[pkt.targetIdx];
          if (!origPort || !targPort) continue;

          // Target subnet phase gate: slightly slow down at Roamer gate (0.33..0.38) if target is in P3 PROP, release into P1/P2!
          const targSub = state.subnets[pkt.targetIdx];
          const targTele = targSub ? state.teleByKey.get(targSub.key) : null;
          let speed = 0.17; // ~5.8s full 4-stage round-trip visual flight
          if (pkt.progress >= 0.31 && pkt.progress <= 0.37 && targTele && targTele.phase === 3) {
            speed = 0.05; // Brief Roamer buffer hold while target finishes P3 proposal
          }
          pkt.progress += dt * speed;

          if (pkt.progress >= 1.0) {
            continue;
          }
          keep.push(pkt);

          let pos = { x: domRefs.roamer.x, y: domRefs.roamer.y };
          let badgeCol = pkt.originIdx === 0 ? '#38bdf8' : '#c084fc';
          let textCol = '#f8fafc';
          let labelTxt = `TX ${shortHex(pkt.txHash, 6, 4)}`;

          if (pkt.progress < 0.32) {
            // Stage 1: Origin Subnet -> Roamer
            const t = pkt.progress / 0.32;
            pos = quadBezierPoint(origPort.edgePt, origPort.ctrlUpper, origPort.roamerEdge, t);
            labelTxt = `➔ TX ${shortHex(pkt.txHash, 6, 4)}`;
          } else if (pkt.progress < 0.42) {
            // Stage 2: Inside Hybrid Roamer (Frequency / Transport Switch)
            const t = (pkt.progress - 0.32) / 0.1;
            pos = {
              x: origPort.roamerEdge.x + (targPort.roamerEdge.x - origPort.roamerEdge.x) * t,
              y: origPort.roamerEdge.y + (targPort.roamerEdge.y - origPort.roamerEdge.y) * t - 26,
            };
            badgeCol = '#fbbf24';
            textCol = '#fef08a';
            labelTxt = `🛰️ RELAY ${shortHex(pkt.txHash, 4, 4)}`;
          } else if (pkt.progress < 0.72) {
            // Stage 3: Roamer -> Target Subnet Execution
            const t = (pkt.progress - 0.42) / 0.3;
            pos = quadBezierPoint(targPort.roamerEdge, targPort.ctrlUpper, targPort.edgePt, t);
            labelTxt = `⚡ EXEC ${shortHex(pkt.txHash, 6, 4)}`;
          } else {
            // Stage 4: Verified ForeignSubnetTxnResponse Receipt Returning Target -> Roamer -> Origin
            const t = (pkt.progress - 0.72) / 0.28;
            if (t < 0.5) {
              pos = quadBezierPoint(targPort.edgePt, targPort.ctrlLower, targPort.roamerEdge, t * 2);
            } else {
              pos = quadBezierPoint(origPort.roamerEdge, origPort.ctrlLower, origPort.edgePt, (t - 0.5) * 2);
            }
            badgeCol = '#34d399';
            textCol = '#ecfdf5';
            labelTxt = pkt.targetBlock ? `✓ RCPT #${pkt.targetBlock}` : `✓ RECEIPT ${shortHex(pkt.txHash, 4, 3)}`;
          }

          pktsHtml += `
            <g transform="translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})">
              <circle r="6" fill="${badgeCol}" filter="url(#spdGlow)" />
              <rect x="-54" y="-24" width="108" height="15" rx="5" fill="rgba(3,7,18,0.92)" stroke="${badgeCol}" stroke-width="1.2" />
              <text x="0" y="-13.5" text-anchor="middle" fill="${textCol}" font-size="8.2" font-weight="800" font-family="JetBrains Mono, monospace">${esc(labelTxt)}</text>
            </g>
          `;
        }
        state.packets = keep;
        domRefs.packetsGroup.innerHTML = pktsHtml;
      }
    }

    rafId = requestAnimationFrame(stepAnimation);
  }

  const onSubnetsUpdated = () => {
    rebuildTopology();
    wireLiveSubscriptions();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('slx:subnets-updated', onSubnetsUpdated);
  }

  function wake() {
    if (state.destroyed || !isVisibleFn()) return;
    pollRoamingPools();
    if (!rafId) {
      lastFrameMs = performance.now();
      rafId = requestAnimationFrame(stepAnimation);
    }
  }

  rebuildTopology();
  wireLiveSubscriptions();
  if (isVisibleFn()) {
    wake();
  }
  const roamTimer = setInterval(pollRoamingPools, 3200);

  return {
    wake,
    ingestExternalBridgeData({ s1Tip, s2Tip, confirmedCrossTxns, rows } = {}) {
      if (state.destroyed) return;
      const subs = state.subnets;
      if (subs[0] && Number(s1Tip) > 0) {
        const t1 = getOrInitTele(subs[0], 0);
        if (Number(s1Tip) > t1.height) {
          t1.height = Number(s1Tip);
          t1.flashUntil = performance.now() + 700;
        }
      }
      if (subs[1] && Number(s2Tip) > 0) {
        const t2 = getOrInitTele(subs[1], 1);
        if (Number(s2Tip) > t2.height) {
          t2.height = Number(s2Tip);
          t2.flashUntil = performance.now() + 700;
        }
      }
      if (Number(confirmedCrossTxns) > 0) {
        state.confirmedTotal = Number(confirmedCrossTxns);
      }
      if (Array.isArray(rows)) {
        for (const r of rows.slice(0, 3)) {
          if (!r?.txHash) continue;
          const isRfToTcp = String(r.direction || '').includes('RF ➔ TCP');
          spawnOrAdvancePacket({
            txHash: r.txHash,
            originIdx: isRfToTcp ? 0 : 1,
            targetIdx: isRfToTcp ? 1 : 0,
            rank: Number(r.rank || 2),
            targetBlock: r.targetBlock || null,
          });
        }
      }
    },
    refreshTopology: () => {
      rebuildTopology();
      wireLiveSubscriptions();
      pollRoamingPools();
    },
    destroy() {
      state.destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearInterval(roamTimer);
      for (const h of state.subsHandles) {
        try {
          h.unsubscribe?.();
        } catch (_) {}
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('slx:subnets-updated', onSubnetsUpdated);
      }
    },
  };
}
