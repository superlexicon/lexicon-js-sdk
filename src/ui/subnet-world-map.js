/**
 * @superlexicon/sdk/ui — Interactive Global Subnet World Map (`subnet-world-map.js`)
 *
 * Visualizes live SuperLexicon Subnets discovered via `SubnetWorldMap` (`slx_roamingStatus`)
 * and `SlxSubnetManager`, including Sub-GHz LR2021 RF propagation rings, Encrypted TCP/IP
 * validator meshes, Hybrid Roamer / Repeater cross-subnet packet arcs, smooth viewBox
 * cluster zoom + pan, and 1-click active subnet switching.
 */

import { SlxSubnetManager, slxNodeRpc } from '../rpc.js';
import { SlxWalletManager } from '../identity.js';
import {
  upsertSubnetOnChain,
  probeSubnetNodeStats,
  SUBNET1_SUBNET_REGISTRY_ADDRESS,
} from '../subnet-registry.js';
import { mountSlxSubnetPhaseDiagram } from './subnet-phase-diagram.js';

export const MAP_BASE_W = 1200;
export const MAP_BASE_H = 675; // Exact 16:9 matching /assets/hegemony/world_map.jpg (1600x900)

// Pixel-calibrated against /assets/hegemony/world_map.jpg (1600x900):
// - 0° Prime Meridian at x = 48.48%, 0.28593% width per degree of longitude
//   -> Singapore (103.913°E) = 78.19% (px 1251/1600), Gibraltar (-5.6°W) = 46.88% (px 750/1600)
// - 0° Equator at y = 60.45%, compact Miller/Mercator curve: yFrac = 0.6045 - 0.00555*lat - 0.000016*lat*|lat|
//   -> Singapore (1.303°N) = 59.72% (px 537.5/900), Gibraltar (36°N) = 38.4% (px 345/900), Cape Agulhas (-34.8°S) = 77.8% (px 700/900)
const PRIME_MERIDIAN_X_FRAC = 0.4848;
const LON_FRAC_PER_DEG = 0.0028593;
const EQUATOR_Y_FRAC = 0.6045;
const LAT_LIN_COEFF = 0.00555;
const LAT_QUAD_COEFF = 0.000016;

// Official Singapore SLA OneMap WGS84 bounding box & HDB blocks for Marine Crescent (440028–440035)
const MC_LAT_NORTH = 1.3043;
const MC_LAT_SOUTH = 1.3017;
const MC_LON_WEST = 103.9111;
const MC_LON_EAST = 103.91455;

const MARINE_CRESCENT_HDB_BLOCKS = [
  { blk: '28', host: '.91', lat: 1.30344, lon: 103.91335, w: 48, h: 20, angle: -12, role: 'validator' },
  { blk: '29', host: '.92', lat: 1.30285, lon: 103.9132, w: 48, h: 20, angle: 8, role: 'validator' },
  { blk: '33', host: '.93', lat: 1.30265, lon: 103.91218, w: 48, h: 20, angle: -8, role: 'validator' },
  { blk: '35', host: '.94', lat: 1.30337, lon: 103.91252, w: 48, h: 20, angle: 12, role: 'validator' },
  { blk: '34', host: '.4', lat: 1.30308, lon: 103.91268, w: 38, h: 18, angle: 0, role: 'repeater' },
  // Neighboring Marine Crescent context slabs for authentic estate geometry
  { blk: '27', host: '', lat: 1.30382, lon: 103.91378, w: 42, h: 16, angle: -6, role: 'context' },
  { blk: '30', host: '', lat: 1.30238, lon: 103.91368, w: 42, h: 16, angle: 4, role: 'context' },
  { blk: '32', host: '', lat: 1.30232, lon: 103.91165, w: 42, h: 16, angle: -4, role: 'context' },
  { blk: '36', host: '', lat: 1.30385, lon: 103.91188, w: 42, h: 16, angle: 6, role: 'context' },
];

export function marineCrescentLatLonToXY(lat, lon, width = MAP_BASE_W, height = MAP_BASE_H) {
  const xFrac = (Number(lon) - MC_LON_WEST) / (MC_LON_EAST - MC_LON_WEST);
  const yFrac = (MC_LAT_NORTH - Number(lat)) / (MC_LAT_NORTH - MC_LAT_SOUTH);
  return {
    x: xFrac * width,
    y: yFrac * height,
  };
}

export function marineCrescentXYToLatLon(x, y, width = MAP_BASE_W, height = MAP_BASE_H) {
  const lon = MC_LON_WEST + (Number(x) / width) * (MC_LON_EAST - MC_LON_WEST);
  const lat = MC_LAT_NORTH - (Number(y) / height) * (MC_LAT_NORTH - MC_LAT_SOUTH);
  return { lat, lon };
}

function escHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
}

export function formatLatLon(lat, lon, decimals = 2) {
  const la = Number(lat || 0);
  const lo = Number(lon || 0);
  const ns = la >= 0 ? 'N' : 'S';
  const ew = lo >= 0 ? 'E' : 'W';
  return `${Math.abs(la).toFixed(decimals)}° ${ns}, ${Math.abs(lo).toFixed(decimals)}° ${ew}`;
}

/**
 * Convert geographic (lat, lon) in degrees to pixel-calibrated SVG coordinates on (width x height).
 */
export function latLonToMapXY(lat, lon, width = MAP_BASE_W, height = MAP_BASE_H) {
  const clampedLat = Math.max(-68, Math.min(82, Number(lat) || 0));
  let normLon = Number(lon) || 0;
  while (normLon < -169) normLon += 360;
  while (normLon > 180) normLon -= 360;

  const xFrac = PRIME_MERIDIAN_X_FRAC + normLon * LON_FRAC_PER_DEG;
  const yFrac =
    EQUATOR_Y_FRAC -
    clampedLat * LAT_LIN_COEFF -
    clampedLat * Math.abs(clampedLat) * LAT_QUAD_COEFF;

  return {
    x: Math.max(12, Math.min(width - 12, xFrac * width)),
    y: Math.max(12, Math.min(height - 12, yFrac * height)),
  };
}

/**
 * Exact inverse projection from SVG (x, y) back to geographic (lat, lon) degrees.
 */
export function mapXYToLatLon(x, y, width = MAP_BASE_W, height = MAP_BASE_H) {
  const xFrac = Number(x || 0) / width;
  const yFrac = Number(y || 0) / height;
  let lon = (xFrac - PRIME_MERIDIAN_X_FRAC) / LON_FRAC_PER_DEG;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;

  const delta = EQUATOR_Y_FRAC - yFrac;
  const sign = delta >= 0 ? 1 : -1;
  const absD = Math.abs(delta);
  const absLat =
    (-LAT_LIN_COEFF + Math.sqrt(LAT_LIN_COEFF * LAT_LIN_COEFF + 4 * LAT_QUAD_COEFF * absD)) /
    (2 * LAT_QUAD_COEFF);
  const lat = sign * absLat;

  return {
    lat: Math.max(-85, Math.min(85, lat)),
    lon: Math.max(-180, Math.min(180, lon)),
  };
}

let _mapStylesInjected = false;
function injectSubnetWorldMapStyles() {
  if (_mapStylesInjected || typeof document === 'undefined') return;
  if (document.getElementById('slx-subnet-world-map-styles')) {
    _mapStylesInjected = true;
    return;
  }
  const st = document.createElement('style');
  st.id = 'slx-subnet-world-map-styles';
  st.textContent = `
    .slx-swm-card {
      border-radius: 15px;
      border: 1.5px solid rgba(56, 189, 248, 0.42);
      background: linear-gradient(180deg, rgba(5, 11, 22, 0.98) 0%, rgba(9, 17, 34, 0.96) 100%);
      padding: 14px 16px;
      box-shadow: 0 14px 38px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(125, 211, 252, 0.12);
      display: flex;
      flex-direction: column;
      gap: 11px;
      min-width: 0;
      max-width: 100%;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .slx-swm-hdr {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .slx-swm-title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .slx-swm-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.84rem;
      font-weight: 800;
      color: #f8fafc;
      letter-spacing: 0.02em;
    }
    .slx-swm-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 9px;
      border-radius: 999px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.66rem;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.16);
      border: 1px solid rgba(52, 211, 153, 0.5);
      color: #6ee7b7;
      white-space: nowrap;
    }
    .slx-swm-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .slx-swm-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid rgba(71, 85, 105, 0.72);
      background: rgba(15, 23, 42, 0.88);
      color: #cbd5e1;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.69rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }
    .slx-swm-btn:hover {
      border-color: rgba(56, 189, 248, 0.75);
      color: #f8fafc;
      background: rgba(14, 165, 233, 0.2);
    }
    .slx-swm-btn.active {
      border-color: rgba(56, 189, 248, 0.85);
      background: rgba(14, 165, 233, 0.24);
      color: #bae6fd;
      box-shadow: 0 0 12px rgba(14, 165, 233, 0.24);
    }
    .slx-swm-btn.cta {
      border-color: rgba(52, 211, 153, 0.78);
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.26), rgba(14, 165, 233, 0.24));
      color: #a7f3d0;
    }
    .slx-swm-btn.cta:hover {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.4), rgba(14, 165, 233, 0.36));
      color: #ecfdf5;
    }
    .slx-swm-coords {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.66rem;
      color: #94a3b8;
      padding: 4px 8px;
      border-radius: 7px;
      background: rgba(2, 6, 23, 0.75);
      border: 1px solid rgba(51, 65, 85, 0.55);
      min-width: 142px;
      text-align: center;
    }
    .slx-swm-stage {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      min-height: 240px;
      max-height: 500px;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(56, 189, 248, 0.35);
      background: radial-gradient(ellipse at 52% 48%, #0c1d36 0%, #050b16 72%, #030712 100%);
      cursor: grab;
      touch-action: pan-y;
      user-select: none;
    }
    .slx-swm-stage.zoomed {
      touch-action: none;
    }
    .slx-swm-stage.dragging {
      cursor: grabbing;
    }
    .slx-swm-track {
      display: flex;
      width: 200%;
      height: 100%;
      transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform;
    }
    .slx-swm-track.swiping {
      transition: none;
    }
    .slx-swm-pane {
      position: relative;
      width: 50%;
      height: 100%;
      flex-shrink: 0;
      overflow: hidden;
    }
    .slx-swm-seg {
      display: inline-flex;
      align-items: center;
      padding: 2px;
      border-radius: 9px;
      background: rgba(2, 6, 23, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.42);
      gap: 2px;
    }
    .slx-swm-seg-btn {
      padding: 4px 10px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: #94a3b8;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.68rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .slx-swm-seg-btn:hover {
      color: #e2e8f0;
    }
    .slx-swm-seg-btn.active {
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.32), rgba(168, 85, 247, 0.28));
      color: #f8fafc;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.22);
    }
    .slx-swm-swipe-pill {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 4;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(3, 7, 18, 0.84);
      border: 1px solid rgba(56, 189, 248, 0.48);
      backdrop-filter: blur(6px);
      color: #bae6fd;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.63rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .slx-swm-swipe-pill:hover {
      border-color: rgba(192, 132, 252, 0.8);
      color: #f8fafc;
      background: rgba(15, 23, 42, 0.94);
    }
    .slx-swm-svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .slx-swm-hud-bl {
      position: absolute;
      left: 10px;
      bottom: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 5px 10px;
      border-radius: 8px;
      background: rgba(3, 7, 18, 0.82);
      border: 1px solid rgba(51, 65, 85, 0.65);
      backdrop-filter: blur(6px);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.63rem;
      color: #cbd5e1;
      pointer-events: none;
    }
    .slx-swm-legend-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      margin-right: 4px;
      vertical-align: middle;
    }
    .slx-swm-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 8px;
    }
    .slx-swm-node-card {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 9px 11px;
      border-radius: 10px;
      background: rgba(6, 12, 25, 0.92);
      border: 1px solid rgba(51, 65, 85, 0.68);
      cursor: pointer;
      transition: all 0.15s ease;
      min-width: 0;
    }
    .slx-swm-node-card:hover {
      border-color: rgba(56, 189, 248, 0.68);
      background: rgba(10, 20, 40, 0.95);
    }
    .slx-swm-node-card.selected {
      border-color: rgba(56, 189, 248, 0.92);
      box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.28), 0 8px 20px rgba(2, 6, 23, 0.45);
      background: linear-gradient(135deg, rgba(10, 22, 44, 0.96), rgba(14, 18, 38, 0.96));
    }
    .slx-swm-node-card.selected.tcp {
      border-color: rgba(192, 132, 252, 0.92);
      box-shadow: 0 0 0 1px rgba(192, 132, 252, 0.28), 0 8px 20px rgba(2, 6, 23, 0.45);
    }
    .slx-swm-inspector {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(4, 9, 20, 0.92);
      border: 1px solid rgba(56, 189, 248, 0.36);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      min-width: 0;
    }
    @keyframes slxSwmPulse {
      0% { transform: scale(0.55); opacity: 0.85; }
      100% { transform: scale(2.35); opacity: 0; }
    }
    .slx-swm-rf-ring {
      transform-box: fill-box;
      transform-origin: center;
      animation: slxSwmPulse 3.1s cubic-bezier(0.16, 1, 0.3, 1) infinite;
    }
    .slx-swm-rf-ring.delay {
      animation-delay: 1.55s;
    }
    .slx-swm-pin-group {
      cursor: pointer;
    }
    .slx-swm-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10050;
      background: rgba(2, 6, 23, 0.82);
      backdrop-filter: blur(7px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    .slx-swm-modal-box {
      width: min(1080px, 100%);
      max-height: 92dvh;
      overflow-y: auto;
      border-radius: 16px;
      position: relative;
    }
    @media (max-width: 680px) {
      .slx-swm-card {
        padding: 10px 11px;
        gap: 9px;
      }
      .slx-swm-title {
        font-size: 0.76rem;
      }
      .slx-swm-coords {
        display: none;
      }
      .slx-swm-stage {
        aspect-ratio: 4 / 3;
        min-height: 220px;
      }
      .slx-swm-hud-bl {
        left: 6px;
        right: 6px;
        bottom: 6px;
        font-size: 0.58rem;
        gap: 6px;
        padding: 4px 7px;
      }
      .slx-swm-strip {
        grid-template-columns: minmax(0, 1fr);
      }
      .slx-swm-inspector {
        flex-direction: column;
        align-items: stretch;
      }
      .slx-swm-modal-backdrop {
        padding: 8px;
        align-items: flex-end;
      }
      .slx-swm-modal-box {
        max-height: 90dvh;
      }
    }
  `;
  document.head.appendChild(st);
  _mapStylesInjected = true;
}

/**
 * Compute spiderfied callout positions so geographically close subnets (e.g. RF Subnet 1
 * & TCP Subnet 2 in Singapore) remain crisp and legible at both Global View and Cluster Zoom.
 */
function layoutMapNodes(subnets, zoom) {
  const uiScale = 1 / Math.pow(Math.max(1, zoom), 0.82);
  const raw = subnets.map((s) => {
    const anchor = latLonToMapXY(s.lat ?? 1.3031, s.lon ?? 103.9128);
    return {
      subnet: s,
      ax: anchor.x,
      ay: anchor.y,
      px: anchor.x,
      py: anchor.y,
      clustered: false,
    };
  });

  // Group nodes within proximity threshold
  const thresh = 68 * uiScale;
  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < raw.length; i++) {
    if (visited.has(i)) continue;
    const group = [raw[i]];
    visited.add(i);
    for (let j = i + 1; j < raw.length; j++) {
      if (visited.has(j)) continue;
      const dx = raw[i].ax - raw[j].ax;
      const dy = raw[i].ay - raw[j].ay;
      if (Math.hypot(dx, dy) < thresh) {
        group.push(raw[j]);
        visited.add(j);
      }
    }
    clusters.push(group);
  }

  for (const group of clusters) {
    if (group.length <= 1) continue;
    const cx = group.reduce((acc, n) => acc + n.ax, 0) / group.length;
    const cy = group.reduce((acc, n) => acc + n.ay, 0) / group.length;
    const radiusX = 88 * uiScale;
    const radiusY = 48 * uiScale;

    if (group.length === 2) {
      // Tactical diagonal fan: RF upper-left, TCP lower-right
      group[0].px = Math.max(76 * uiScale, cx - radiusX);
      group[0].py = Math.max(42 * uiScale, cy - radiusY);
      group[0].clustered = true;

      group[1].px = Math.min(MAP_BASE_W - 76 * uiScale, cx + radiusX);
      group[1].py = Math.min(MAP_BASE_H - 42 * uiScale, cy + radiusY);
      group[1].clustered = true;
    } else {
      group.forEach((node, idx) => {
        const angle = -Math.PI * 0.75 + (idx * 2 * Math.PI) / group.length;
        node.px = Math.max(
          70 * uiScale,
          Math.min(MAP_BASE_W - 70 * uiScale, cx + Math.cos(angle) * radiusX * 1.1)
        );
        node.py = Math.max(
          40 * uiScale,
          Math.min(MAP_BASE_H - 40 * uiScale, cy + Math.sin(angle) * radiusY * 1.15)
        );
        node.clustered = true;
      });
    }
  }

  return { nodes: raw, clusters, uiScale };
}

/**
 * Mount an interactive SuperLexicon Global Subnet World Map into `mountContainer`.
 */
export function mountSlxSubnetWorldMap({
  mountContainer,
  backgroundImgUrl = '/assets/hegemony/world_map.jpg',
  initialMode = 'global', // 'global' | 'cluster'
  initialView = 'map', // 'map' | 'phase'
  showCloseButton = false,
  onClose = null,
  onSelectSubnet = null,
} = {}) {
  if (typeof document === 'undefined' || !mountContainer) return null;
  injectSubnetWorldMapStyles();

  const state = {
    view: initialView === 'phase' ? 'phase' : 'map',
    zoom: 1,
    cx: MAP_BASE_W / 2,
    cy: MAP_BASE_H / 2,
    mode: 'global', // 'global' | 'marine' | 'custom'
    mcBlend: 0, // 0 = World Map, 1 = Marine Crescent Singapore Neighborhood Map
    autoFlyDone: false,
    userInterruptedAutoFly: false,
    selectedKey: SlxSubnetManager.getActiveSubnetKey(),
    bgFailed: false,
    heightsByKey: new Map(),
    nodeStatsByKey: new Map(),
    regAddrCopiedUntil: 0,
    bridge: {
      active: true,
      lane: 'hybrid-rf+tcp',
      confirmedCrossTxns: 0,
      inFlightCrossTxns: 0,
      repeaterLabel: 'Hybrid Repeater (.4)',
    },
    animFrame: 0,
    autoFlyTimer: 0,
    destroyed: false,
  };

  mountContainer.innerHTML = `
    <div class="slx-swm-card" role="region" aria-label="Global SuperLexicon Subnet World Map &amp; Phase Sync">
      <div class="slx-swm-hdr">
        <div class="slx-swm-title-wrap">
          <div class="slx-swm-seg" role="tablist" aria-label="Subnet Visualization View">
            <button type="button" class="slx-swm-seg-btn active" data-swm-view="map" role="tab" aria-selected="true">🌍 1. World &amp; Marine Crescent Map</button>
            <button type="button" class="slx-swm-seg-btn" data-swm-view="phase" role="tab" aria-selected="false">⚡ 2. Phase &amp; Bridge Live</button>
          </div>
          <span class="slx-swm-pill" data-swm="summary-pill">Connecting SubnetRegistry HFS…</span>
          <button type="button" class="slx-swm-btn" data-swm="hfs-badge" title="Click to copy On-Chain SubnetRegistry HFS contract address" style="padding:2px 8px;font-size:0.63rem;color:#7dd3fc;border-color:rgba(56,189,248,0.45);">⛓️ HFS Registry</button>
        </div>
        <div class="slx-swm-controls">
          <span class="slx-swm-coords" data-swm="coords">1.3031° N, 103.9128° E</span>
          <span data-swm="map-tools" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <button type="button" class="slx-swm-btn active" data-swm-act="global" title="Zoom out to Full World Map">🌍 World</button>
            <button type="button" class="slx-swm-btn" data-swm-act="cluster" title="Zoom into Marine Crescent, Singapore (Blks 28–35)">🇸🇬 Marine Crescent</button>
            <button type="button" class="slx-swm-btn" data-swm-act="replay-fly" title="Replay World Map → Marine Crescent Orbital Fly-In">🎬 Fly-In</button>
          </span>
          <button type="button" class="slx-swm-btn cta" data-swm-act="register-hfs" title="Register a new subnet &amp; validator stats URLs on-chain in SubnetRegistry HFS ($0.00 gas)">⛓️ + Register Subnet</button>
          ${
            showCloseButton
              ? `<button type="button" class="slx-swm-btn" data-swm-act="close" title="Close World Map">✕ Close</button>`
              : ''
          }
        </div>
      </div>

      <div class="slx-swm-stage" data-swm="stage">
        <button type="button" class="slx-swm-swipe-pill" data-swm="swipe-toggle" title="Swipe or click to switch between Map and Live Phase Sync &amp; Bridge Diagram">
          ● ○ &nbsp;Swipe ⇄ Phase &amp; Bridge Live ›
        </button>
        <div class="slx-swm-track" data-swm="track">
          <div class="slx-swm-pane" data-swm="pane-map">
            <svg class="slx-swm-svg" data-swm="svg" viewBox="0 0 ${MAP_BASE_W} ${MAP_BASE_H}" preserveAspectRatio="xMidYMid meet"></svg>
            <svg class="slx-swm-svg" data-swm="mc-svg" viewBox="0 0 ${MAP_BASE_W} ${MAP_BASE_H}" preserveAspectRatio="xMidYMid meet"
              style="position:absolute;inset:0;opacity:0;pointer-events:none;transform-origin:center center;will-change:opacity,transform;"></svg>
            <div class="slx-swm-hud-bl" data-swm="map-hud-bl">
              <span><i class="slx-swm-legend-dot" style="background:#38bdf8;box-shadow:0 0 6px #38bdf8;"></i>915 MHz LR2021 RF (Subnet 1)</span>
              <span><i class="slx-swm-legend-dot" style="background:#c084fc;box-shadow:0 0 6px #c084fc;"></i>Encrypted TCP/IP (Subnet 2)</span>
              <span><i class="slx-swm-legend-dot" style="background:#fbbf24;box-shadow:0 0 6px #fbbf24;"></i>Blk 34 Hybrid Repeater (.4)</span>
              <span style="color:#94a3b8;">🌍 World ⇄ 🇸🇬 Marine Crescent • Swipe ⇄ for Phase Diagram</span>
            </div>
          </div>
          <div class="slx-swm-pane" data-swm="pane-phase">
            <div data-swm="phase-mount" style="width:100%;height:100%;"></div>
            <div class="slx-swm-hud-bl">
              <span><i class="slx-swm-legend-dot" style="background:#38bdf8;"></i>P1 TX</span>
              <span><i class="slx-swm-legend-dot" style="background:#fbbf24;"></i>P2 VOTE</span>
              <span><i class="slx-swm-legend-dot" style="background:#c084fc;"></i>P3 PROP</span>
              <span><i class="slx-swm-legend-dot" style="background:#34d399;"></i>P4 FINALIZE</span>
              <span style="color:#94a3b8;">‹ Swipe ⇄ back to Map</span>
            </div>
          </div>
        </div>
      </div>

      <div class="slx-swm-strip" data-swm="strip"></div>
      <div class="slx-swm-inspector" data-swm="inspector"></div>
    </div>
  `;

  const elSummaryPill = mountContainer.querySelector('[data-swm="summary-pill"]');
  const elHfsBadge = mountContainer.querySelector('[data-swm="hfs-badge"]');
  const elCoords = mountContainer.querySelector('[data-swm="coords"]');
  const elMapTools = mountContainer.querySelector('[data-swm="map-tools"]');
  const elStage = mountContainer.querySelector('[data-swm="stage"]');
  const elTrack = mountContainer.querySelector('[data-swm="track"]');
  const elSwipeToggle = mountContainer.querySelector('[data-swm="swipe-toggle"]');
  const elPhaseMount = mountContainer.querySelector('[data-swm="phase-mount"]');
  const elSvg = mountContainer.querySelector('[data-swm="svg"]');
  const elMcSvg = mountContainer.querySelector('[data-swm="mc-svg"]');
  const elStrip = mountContainer.querySelector('[data-swm="strip"]');
  const elInspector = mountContainer.querySelector('[data-swm="inspector"]');
  const btnGlobal = mountContainer.querySelector('[data-swm-act="global"]');
  const btnCluster = mountContainer.querySelector('[data-swm-act="cluster"]');
  const viewTabBtns = Array.from(mountContainer.querySelectorAll('[data-swm-view]'));

  const phaseDiagramInst = elPhaseMount
    ? mountSlxSubnetPhaseDiagram({
        mountContainer: elPhaseMount,
        isVisibleFn: () => !state.destroyed && state.view === 'phase',
      })
    : null;

  function applyActiveView(nextView) {
    state.view = nextView === 'phase' ? 'phase' : 'map';
    if (elTrack) {
      elTrack.classList.remove('swiping');
      elTrack.style.transform = state.view === 'phase' ? 'translate3d(-50%, 0, 0)' : 'translate3d(0%, 0, 0)';
    }
    viewTabBtns.forEach((b) => {
      const act = b.getAttribute('data-swm-view') === state.view;
      b.classList.toggle('active', act);
      b.setAttribute('aria-selected', act ? 'true' : 'false');
    });
    if (elMapTools) {
      elMapTools.style.display = state.view === 'map' ? 'inline-flex' : 'none';
    }
    if (elCoords) {
      elCoords.style.display = state.view === 'map' ? '' : 'none';
    }
    if (elSwipeToggle) {
      elSwipeToggle.innerHTML =
        state.view === 'map'
          ? '● ○ &nbsp;Swipe ⇄ Phase &amp; Bridge Live ›'
          : '‹ ● &nbsp;Swipe ⇄ Global World Map';
    }
    elStage?.classList.toggle('zoomed', state.view === 'map' && state.zoom > 1.03);
  }

  viewTabBtns.forEach((b) => {
    b.addEventListener('click', () => {
      applyActiveView(b.getAttribute('data-swm-view'));
    });
  });
  elSwipeToggle?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    applyActiveView(state.view === 'map' ? 'phase' : 'map');
  });

  // Preload check for world_map.jpg so external SDK hosts fall back cleanly if absent
  if (typeof Image !== 'undefined' && backgroundImgUrl) {
    const probe = new Image();
    probe.onload = () => {
      if (!state.destroyed && state.bgFailed) {
        state.bgFailed = false;
        renderAll();
      }
    };
    probe.onerror = () => {
      if (!state.destroyed) {
        state.bgFailed = true;
        renderAll();
      }
    };
    probe.src = backgroundImgUrl;
  }

  function clampCamera(cx, cy, zoom) {
    const z = Math.max(1, Math.min(12, zoom));
    const vw = MAP_BASE_W / z;
    const vh = MAP_BASE_H / z;
    const clampedX = Math.max(vw / 2, Math.min(MAP_BASE_W - vw / 2, cx));
    const clampedY = Math.max(vh / 2, Math.min(MAP_BASE_H - vh / 2, cy));
    return { cx: clampedX, cy: clampedY, zoom: z, vw, vh };
  }

  function applyViewBoxImmediate() {
    const cam = clampCamera(state.cx, state.cy, state.zoom);
    state.cx = cam.cx;
    state.cy = cam.cy;
    state.zoom = cam.zoom;
    const vx = (cam.cx - cam.vw / 2).toFixed(2);
    const vy = (cam.cy - cam.vh / 2).toFixed(2);
    elSvg?.setAttribute('viewBox', `${vx} ${vy} ${cam.vw.toFixed(2)} ${cam.vh.toFixed(2)}`);
    if (elMcSvg) {
      const b = Math.max(0, Math.min(1, state.mcBlend));
      elMcSvg.style.opacity = b.toFixed(3);
      elMcSvg.style.pointerEvents = b > 0.65 ? 'auto' : 'none';
      const sc = 0.88 + 0.12 * b;
      elMcSvg.style.transform = `scale(${sc.toFixed(4)})`;
    }
    if (elSvg) {
      elSvg.style.opacity = (1 - Math.max(0, Math.min(1, state.mcBlend)) * 0.92).toFixed(3);
    }
    btnGlobal?.classList.toggle('active', state.mode === 'global');
    btnCluster?.classList.toggle('active', state.mode === 'marine' || state.mode === 'cluster');
    elStage?.classList.toggle(
      'zoomed',
      state.view === 'map' && state.mode === 'custom' && state.zoom > 1.05 && state.mcBlend < 0.5
    );
  }

  function flyIntoMarineCrescent(animate = true, durMs = 1750) {
    if (state.animFrame) cancelAnimationFrame(state.animFrame);
    const sgWorld = latLonToMapXY(1.30308, 103.9128);
    const targetZ = 11.5;

    if (!animate) {
      state.cx = sgWorld.x;
      state.cy = sgWorld.y;
      state.zoom = targetZ;
      state.mcBlend = 1;
      state.mode = 'marine';
      applyViewBoxImmediate();
      renderMarineCrescentSvg();
      return;
    }

    state.mode = 'marine';
    renderMarineCrescentSvg();
    const startCx = state.cx;
    const startCy = state.cy;
    const startZ = state.zoom;
    const startBlend = state.mcBlend;
    const dest = clampCamera(sgWorld.x, sgWorld.y, targetZ);
    const startMs = performance.now();

    const tick = (now) => {
      if (state.destroyed) return;
      const t = Math.min(1, (now - startMs) / durMs);
      // Smooth easeInOutCubic orbital dive
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // Exponential zoom feel so global -> regional -> street glides naturally
      state.zoom = startZ * Math.pow(dest.zoom / Math.max(1, startZ), ease);
      const panEase = 1 - Math.pow(1 - t, 2.6);
      state.cx = startCx + (dest.cx - startCx) * panEase;
      state.cy = startCy + (dest.cy - startCy) * panEase;
      // Cross-fade into high-res Marine Crescent tactical estate layer over second half of dive
      const blendRaw = t <= 0.44 ? 0 : (t - 0.44) / 0.56;
      const blendEase = blendRaw * blendRaw * (3 - 2 * blendRaw);
      state.mcBlend = startBlend + (1 - startBlend) * blendEase;

      applyViewBoxImmediate();
      if (state.mcBlend < 0.98) {
        renderSvgContent();
      }
      if (t < 1) {
        state.animFrame = requestAnimationFrame(tick);
      } else {
        state.animFrame = 0;
        state.mcBlend = 1;
        applyViewBoxImmediate();
        renderMarineCrescentSvg();
      }
    };
    state.animFrame = requestAnimationFrame(tick);
  }

  function flyOutToGlobal(animate = true, durMs = 920) {
    if (state.animFrame) cancelAnimationFrame(state.animFrame);
    state.mode = 'global';
    if (!animate) {
      state.cx = MAP_BASE_W / 2;
      state.cy = MAP_BASE_H / 2;
      state.zoom = 1;
      state.mcBlend = 0;
      applyViewBoxImmediate();
      renderSvgContent();
      return;
    }

    renderSvgContent();
    const startCx = state.cx;
    const startCy = state.cy;
    const startZ = state.zoom;
    const startBlend = state.mcBlend;
    const startMs = performance.now();

    const tick = (now) => {
      if (state.destroyed) return;
      const t = Math.min(1, (now - startMs) / durMs);
      const ease = 1 - Math.pow(1 - t, 3);
      state.mcBlend = startBlend * Math.max(0, 1 - t * 2.3);
      state.zoom = startZ + (1 - startZ) * ease;
      state.cx = startCx + (MAP_BASE_W / 2 - startCx) * ease;
      state.cy = startCy + (MAP_BASE_H / 2 - startCy) * ease;
      applyViewBoxImmediate();
      renderSvgContent();
      if (t < 1) {
        state.animFrame = requestAnimationFrame(tick);
      } else {
        state.animFrame = 0;
        state.mcBlend = 0;
        state.zoom = 1;
        applyViewBoxImmediate();
        renderSvgContent();
      }
    };
    state.animFrame = requestAnimationFrame(tick);
  }

  function animateCameraTo(targetCx, targetCy, targetZoom, modeLabel = 'custom') {
    if (state.animFrame) cancelAnimationFrame(state.animFrame);
    state.mode = modeLabel;
    const startCx = state.cx;
    const startCy = state.cy;
    const startZ = state.zoom;
    const startBlend = state.mcBlend;
    const dest = clampCamera(targetCx, targetCy, targetZoom);
    const startMs = performance.now();
    const durMs = 420;

    const tick = (now) => {
      if (state.destroyed) return;
      const t = Math.min(1, (now - startMs) / durMs);
      const ease = 1 - Math.pow(1 - t, 3);
      state.cx = startCx + (dest.cx - startCx) * ease;
      state.cy = startCy + (dest.cy - startCy) * ease;
      state.zoom = startZ + (dest.zoom - startZ) * ease;
      state.mcBlend = startBlend * (1 - ease);
      applyViewBoxImmediate();
      renderSvgContent();
      if (t < 1) {
        state.animFrame = requestAnimationFrame(tick);
      } else {
        state.animFrame = 0;
      }
    };
    state.animFrame = requestAnimationFrame(tick);
  }

  function getEnrichedSubnets() {
    const list = SlxSubnetManager.listSubnets();
    return list.map((s) => {
      const liveH = state.heightsByKey.get(s.key) || Number(s.tipHeight || 0);
      return {
        ...s,
        liveHeight: liveH,
        lat: Number.isFinite(Number(s.lat)) ? Number(s.lat) : 1.30308,
        lon: Number.isFinite(Number(s.lon)) ? Number(s.lon) : 103.9128,
      };
    });
  }

  function focusActiveCluster(animate = true) {
    flyIntoMarineCrescent(animate);
  }

  function replayFlyIn() {
    if (state.autoFlyTimer) clearTimeout(state.autoFlyTimer);
    applyActiveView('map');
    flyOutToGlobal(false);
    state.autoFlyTimer = setTimeout(() => {
      if (!state.destroyed && state.view === 'map') {
        flyIntoMarineCrescent(true, 1850);
      }
    }, 550);
  }

  function renderMarineCrescentSvg() {
    if (!elMcSvg) return;
    const subs = getEnrichedSubnets();
    const activeKey = SlxSubnetManager.getActiveSubnetKey();
    const s1 = subs.find((s) => s.key === 'subnet1') || subs[0];
    const s2 = subs.find((s) => s.key === 'subnet2') || subs[1];
    const s1Probe = s1 ? state.nodeStatsByKey.get(s1.key) : null;
    const s2Probe = s2 ? state.nodeStatsByKey.get(s2.key) : null;

    // Map block number -> node badges hosted at that physical HDB block
    const nodesByBlk = new Map();
    const addNodeToBlk = (blk, entry) => {
      if (!nodesByBlk.has(blk)) nodesByBlk.set(blk, []);
      nodesByBlk.get(blk).push(entry);
    };

    const defaultBlkOrderS1 = ['28', '29', '33', '35'];
    (s1?.validatorNodes || []).forEach((vn, i) => {
      const blk = String(vn.blk || defaultBlkOrderS1[i] || '28');
      const pr = s1Probe?.nodes?.[i] || null;
      addNodeToBlk(blk, {
        subnetKey: s1.key,
        transport: 'flrc',
        icon: '📡',
        label: (vn.name || `node${i + 1}`).replace(/^(RF |Validator )/i, ''),
        online: pr ? pr.online : true,
        height: pr?.blockHeight || s1?.liveHeight || 0,
        rttMs: pr?.rttMs || 0,
      });
    });

    const defaultBlkOrderS2 = ['28', '29', '35'];
    (s2?.validatorNodes || []).forEach((vn, i) => {
      const blk = String(vn.blk || defaultBlkOrderS2[i] || '28');
      const pr = s2Probe?.nodes?.[i] || null;
      addNodeToBlk(blk, {
        subnetKey: s2.key,
        transport: 'tcp',
        icon: '🔌',
        label: (vn.name || `node2${i + 1}`).replace(/^(TCP |Validator )/i, ''),
        online: pr ? pr.online : true,
        height: pr?.blockHeight || s2?.liveHeight || 0,
        rttMs: pr?.rttMs || 0,
      });
    });

    // Project all HDB blocks onto (1200 x 675)
    const blkPos = new Map();
    for (const b of MARINE_CRESCENT_HDB_BLOCKS) {
      blkPos.set(b.blk, { ...b, ...marineCrescentLatLonToXY(b.lat, b.lon) });
    }

    // Subtle WGS84 tactical gridlines
    let gridSvg = '';
    for (const la of [1.304, 1.3035, 1.303, 1.3025, 1.302]) {
      const { y } = marineCrescentLatLonToXY(la, MC_LON_WEST);
      gridSvg += `
        <line x1="0" y1="${y.toFixed(1)}" x2="${MAP_BASE_W}" y2="${y.toFixed(1)}" stroke="rgba(56,189,248,0.08)" stroke-width="1" />
        <text x="14" y="${(y - 4).toFixed(1)}" fill="rgba(148,163,184,0.45)" font-size="9" font-family="JetBrains Mono, monospace">${la.toFixed(4)}°N</text>
      `;
    }
    for (const lo of [103.9115, 103.9125, 103.9135, 103.9142]) {
      const { x } = marineCrescentLatLonToXY(MC_LAT_NORTH, lo);
      gridSvg += `
        <line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${MAP_BASE_H}" stroke="rgba(56,189,248,0.08)" stroke-width="1" />
        <text x="${(x + 4).toFixed(1)}" y="18" fill="rgba(148,163,184,0.42)" font-size="8.8" font-family="JetBrains Mono, monospace">${lo.toFixed(4)}°E</text>
      `;
    }

    // Authentic Marine Crescent roads, ECP expressway, East Coast Park & Singapore Strait coastline
    const yMarineParade = marineCrescentLatLonToXY(1.30414, MC_LON_WEST).y;
    const yEcp = marineCrescentLatLonToXY(1.30203, MC_LON_WEST).y;
    const yCoast = marineCrescentLatLonToXY(1.30184, MC_LON_WEST).y;
    const mcLoopPts = [
      marineCrescentLatLonToXY(1.30414, 103.91195),
      marineCrescentLatLonToXY(1.30252, 103.91188),
      marineCrescentLatLonToXY(1.30242, 103.91278),
      marineCrescentLatLonToXY(1.30255, 103.91368),
      marineCrescentLatLonToXY(1.30414, 103.91376),
    ];
    const loopPath = `M ${mcLoopPts[0].x.toFixed(1)} ${mcLoopPts[0].y.toFixed(1)} Q ${mcLoopPts[1].x.toFixed(1)} ${mcLoopPts[1].y.toFixed(1)} ${mcLoopPts[2].x.toFixed(1)} ${mcLoopPts[2].y.toFixed(1)} Q ${mcLoopPts[3].x.toFixed(1)} ${mcLoopPts[3].y.toFixed(1)} ${mcLoopPts[4].x.toFixed(1)} ${mcLoopPts[4].y.toFixed(1)}`;

    const roadsAndCoastSvg = `
      <!-- East Coast Park Greenbelt & Singapore Strait Water -->
      <rect x="0" y="${yEcp.toFixed(1)}" width="${MAP_BASE_W}" height="${(yCoast - yEcp).toFixed(1)}" fill="rgba(16, 48, 44, 0.42)" />
      <rect x="0" y="${yCoast.toFixed(1)}" width="${MAP_BASE_W}" height="${(MAP_BASE_H - yCoast).toFixed(1)}" fill="#040d1d" />
      <line x1="0" y1="${yCoast.toFixed(1)}" x2="${MAP_BASE_W}" y2="${yCoast.toFixed(1)}" stroke="#22d3ee" stroke-width="2" opacity="0.68" />
      <text x="600" y="${(yCoast + 24).toFixed(1)}" text-anchor="middle" fill="rgba(56,189,248,0.55)" font-size="10.5" font-weight="800" letter-spacing="3" font-family="JetBrains Mono, monospace">SINGAPORE STRAIT  •  EAST COAST BEACH</text>

      <!-- Marine Parade Road (North) -->
      <line x1="0" y1="${yMarineParade.toFixed(1)}" x2="${MAP_BASE_W}" y2="${yMarineParade.toFixed(1)}" stroke="#1e293b" stroke-width="18" />
      <line x1="0" y1="${yMarineParade.toFixed(1)}" x2="${MAP_BASE_W}" y2="${yMarineParade.toFixed(1)}" stroke="rgba(148,163,184,0.35)" stroke-width="1" stroke-dasharray="8 6" />
      <text x="220" y="${(yMarineParade + 3.5).toFixed(1)}" fill="rgba(203,213,225,0.65)" font-size="9.2" font-weight="700" letter-spacing="1.5" font-family="JetBrains Mono, monospace">MARINE PARADE ROAD</text>

      <!-- Marine Crescent Loop Road -->
      <path d="${loopPath}" fill="none" stroke="#17243a" stroke-width="14" stroke-linecap="round" />
      <path d="${loopPath}" fill="none" stroke="rgba(125,211,252,0.28)" stroke-width="1.1" stroke-dasharray="5 5" />
      <text x="${mcLoopPts[2].x.toFixed(1)}" y="${(mcLoopPts[2].y + 22).toFixed(1)}" text-anchor="middle" fill="rgba(186,230,253,0.62)" font-size="9" font-weight="700" letter-spacing="1.4" font-family="JetBrains Mono, monospace">MARINE CRESCENT</text>

      <!-- East Coast Parkway (ECP) -->
      <line x1="0" y1="${yEcp.toFixed(1)}" x2="${MAP_BASE_W}" y2="${yEcp.toFixed(1)}" stroke="#1e293b" stroke-width="20" />
      <line x1="0" y1="${yEcp.toFixed(1)}" x2="${MAP_BASE_W}" y2="${yEcp.toFixed(1)}" stroke="rgba(251,191,36,0.35)" stroke-width="1.2" stroke-dasharray="10 6" />
      <text x="930" y="${(yEcp + 3.5).toFixed(1)}" fill="rgba(253,230,138,0.68)" font-size="9.2" font-weight="700" letter-spacing="1.5" font-family="JetBrains Mono, monospace">EAST COAST PARKWAY (ECP)</text>
    `;

    // RF Subnet 1 Mesh Links (Blks 35 - 28 - 29 - 33 - 35 + diagonals) & TCP Subnet 2 Mesh Links (Blks 35 - 28 - 29)
    const b28 = blkPos.get('28');
    const b29 = blkPos.get('29');
    const b33 = blkPos.get('33');
    const b34 = blkPos.get('34');
    const b35 = blkPos.get('35');

    const rfPairs = [
      [b35, b28],
      [b28, b29],
      [b29, b33],
      [b33, b35],
      [b35, b29],
      [b28, b33],
    ];
    const tcpPairs = [
      [b35, b28],
      [b28, b29],
      [b29, b35],
    ];

    const s1Sel = state.selectedKey === 'subnet1';
    const s2Sel = state.selectedKey === 'subnet2';

    let meshLinksSvg = '';
    rfPairs.forEach(([a, b], idx) => {
      if (!a || !b) return;
      const pid = `mcRfLink_${idx}`;
      meshLinksSvg += `
        <path id="${pid}" d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}"
          stroke="#38bdf8" stroke-width="${s1Sel ? '2.4' : '1.5'}" opacity="${s2Sel ? '0.28' : '0.62'}" stroke-dasharray="6 4" />
        ${
          idx < 4
            ? `<circle r="3.2" fill="#38bdf8" filter="url(#mcGlow)"><animateMotion dur="${(2.1 + idx * 0.35).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${pid}" /></animateMotion></circle>`
            : ''
        }
      `;
    });

    tcpPairs.forEach(([a, b], idx) => {
      if (!a || !b) return;
      // Slight 6px offset so parallel RF & TCP links between Blk 28/29/35 are both distinctly visible!
      const pid = `mcTcpLink_${idx}`;
      meshLinksSvg += `
        <path id="${pid}" d="M ${(a.x + 6).toFixed(1)} ${(a.y + 6).toFixed(1)} L ${(b.x + 6).toFixed(1)} ${(b.y + 6).toFixed(1)}"
          stroke="#c084fc" stroke-width="${s2Sel ? '2.5' : '1.7'}" opacity="${s1Sel ? '0.35' : '0.78'}" />
        <circle r="3.2" fill="#c084fc" filter="url(#mcGlow)"><animateMotion dur="${(1.7 + idx * 0.3).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${pid}" /></animateMotion></circle>
      `;
    });

    // Hybrid Repeater (Blk 34) cross-subnet relay beams to Blk 28, 29, 33, 35
    if (b34) {
      [b28, b29, b33, b35].forEach((target, idx) => {
        if (!target) return;
        const pid = `mcRepBeam_${idx}`;
        meshLinksSvg += `
          <path id="${pid}" d="M ${b34.x.toFixed(1)} ${b34.y.toFixed(1)} L ${target.x.toFixed(1)} ${target.y.toFixed(1)}"
            stroke="#fbbf24" stroke-width="1.4" stroke-dasharray="3 4" opacity="0.58" />
          <circle r="2.8" fill="#fbbf24"><animateMotion dur="${(1.9 + idx * 0.25).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${pid}" /></animateMotion></circle>
        `;
      });
    }

    // Draw HDB buildings & per-block live validator callout cards
    let blocksSvg = '';
    for (const b of blkPos.values()) {
      if (b.role === 'context') {
        blocksSvg += `
          <g transform="translate(${b.x.toFixed(1)}, ${b.y.toFixed(1)}) rotate(${b.angle})">
            <rect x="${-b.w / 2}" y="${-b.h / 2}" width="${b.w}" height="${b.h}" rx="3"
              fill="#0f1b2e" stroke="rgba(71,85,105,0.45)" stroke-width="1" />
            <text x="0" y="3.5" text-anchor="middle" fill="rgba(148,163,184,0.5)" font-size="8" font-weight="700" font-family="JetBrains Mono, monospace">BLK ${b.blk}</text>
          </g>
        `;
        continue;
      }

      if (b.role === 'repeater') {
        blocksSvg += `
          <g transform="translate(${b.x.toFixed(1)}, ${b.y.toFixed(1)})">
            <circle class="slx-swm-rf-ring" cx="0" cy="0" r="18" fill="none" stroke="#fbbf24" stroke-width="1.3" />
            <rect x="${-b.w / 2}" y="${-b.h / 2}" width="${b.w}" height="${b.h}" rx="4"
              fill="#171524" stroke="#fbbf24" stroke-width="2" />
            <polygon points="0,-13 13,0 0,13 -13,0" fill="#0f172a" stroke="#fbbf24" stroke-width="1.8" />
            <circle r="3.5" fill="#fbbf24" />
            <g transform="translate(-88, 17)">
              <rect width="176" height="34" rx="7" fill="rgba(4,9,20,0.94)" stroke="rgba(251,191,36,0.75)" stroke-width="1.3" />
              <text x="88" y="13.5" text-anchor="middle" fill="#fde68a" font-size="9.4" font-weight="800" font-family="JetBrains Mono, monospace">🛰️ BLK 34 (${b.host}) • REPEATER</text>
              <text x="88" y="26.5" text-anchor="middle" fill="#cbd5e1" font-size="8.2" font-family="JetBrains Mono, monospace">Bridges 915 MHz RF ⇄ TCP/IP</text>
            </g>
          </g>
        `;
        continue;
      }

      const hosted = nodesByBlk.get(b.blk) || [];
      const hasRf = hosted.some((h) => h.transport !== 'tcp');
      const hasTcp = hosted.some((h) => h.transport === 'tcp');
      const strokeCol = hasRf && hasTcp ? '#38bdf8' : hasTcp ? '#c084fc' : '#38bdf8';

      // Place callout above northern blocks (28, 35) and below southern blocks (29, 33) for zero overlap!
      const isNorth = b.blk === '28' || b.blk === '35';
      const cardW = 192;
      const cardH = 18 + hosted.length * 15;
      const cardY = isNorth ? -b.h / 2 - cardH - 12 : b.h / 2 + 12;

      const rowsSvg = hosted
        .map((nd, rIdx) => {
          const ry = 28 + rIdx * 14.5;
          const col = nd.transport === 'tcp' ? '#e9d5ff' : '#bae6fd';
          const isSubActive = nd.subnetKey === activeKey;
          const statTxt = nd.height > 0 ? `#${fmtNum(nd.height)}${nd.rttMs ? ` • ${nd.rttMs}ms` : ''}` : 'ONLINE';
          return `
            <g class="slx-swm-pin-group" data-mc-sub="${escHtml(nd.subnetKey)}">
              <text x="8" y="${ry}" fill="${col}" font-size="8.6" font-weight="800" font-family="JetBrains Mono, monospace">${escHtml(nd.icon)} ${escHtml(nd.label)}${isSubActive ? ' ★' : ''}</text>
              <text x="${cardW - 8}" y="${ry}" text-anchor="end" fill="#6ee7b7" font-size="8.3" font-weight="700" font-family="JetBrains Mono, monospace">${escHtml(statTxt)}</text>
            </g>
          `;
        })
        .join('');

      blocksSvg += `
        <g transform="translate(${b.x.toFixed(1)}, ${b.y.toFixed(1)})">
          ${hasRf ? `<circle class="slx-swm-rf-ring" cx="0" cy="0" r="16" fill="none" stroke="#38bdf8" stroke-width="1.3" />` : ''}
          ${hasTcp ? `<circle cx="0" cy="0" r="20" fill="none" stroke="#c084fc" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.85" />` : ''}
          <g transform="rotate(${b.angle})">
            <rect x="${-b.w / 2}" y="${-b.h / 2}" width="${b.w}" height="${b.h}" rx="4"
              fill="#0d213a" stroke="${strokeCol}" stroke-width="2" />
          </g>
          <circle r="4.2" fill="#34d399" />

          <g transform="translate(${-cardW / 2}, ${cardY})">
            <rect width="${cardW}" height="${cardH}" rx="7" fill="rgba(4,10,22,0.94)" stroke="${strokeCol}" stroke-width="1.35" />
            <text x="8" y="13.5" fill="#f8fafc" font-size="9.2" font-weight="800" font-family="JetBrains Mono, monospace">🏢 BLK ${b.blk} MARINE CRES (${b.host})</text>
            <line x1="6" y1="17.5" x2="${cardW - 6}" y2="17.5" stroke="rgba(71,85,105,0.55)" stroke-width="0.8" />
            ${rowsSvg}
          </g>
        </g>
      `;
    }

    // Top-left Location Cartouche & 50m Scale Bar
    const pxPer50m = ((50 / 111_320) / (MC_LON_EAST - MC_LON_WEST)) * MAP_BASE_W;
    const hudOverlaySvg = `
      <g transform="translate(16, 42)">
        <rect width="346" height="40" rx="8" fill="rgba(3,8,18,0.9)" stroke="rgba(56,189,248,0.55)" stroke-width="1.2" />
        <text x="12" y="16.5" fill="#f8fafc" font-size="10.5" font-weight="800" font-family="JetBrains Mono, monospace">🇸🇬 MARINE CRESCENT, SINGAPORE (S440028–35)</text>
        <text x="12" y="31" fill="#7dd3fc" font-size="8.6" font-family="JetBrains Mono, monospace">Closely Co-Located RF Subnet 1 + TCP Subnet 2 + Repeater</text>
      </g>
      <g transform="translate(${(MAP_BASE_W - pxPer50m - 26).toFixed(1)}, ${(yEcp - 22).toFixed(1)})">
        <line x1="0" y1="0" x2="${pxPer50m.toFixed(1)}" y2="0" stroke="#cbd5e1" stroke-width="2" />
        <line x1="0" y1="-4" x2="0" y2="4" stroke="#cbd5e1" stroke-width="2" />
        <line x1="${pxPer50m.toFixed(1)}" y1="-4" x2="${pxPer50m.toFixed(1)}" y2="4" stroke="#cbd5e1" stroke-width="2" />
        <text x="${(pxPer50m / 2).toFixed(1)}" y="-6" text-anchor="middle" fill="#cbd5e1" font-size="8.8" font-weight="700" font-family="JetBrains Mono, monospace">50 m</text>
      </g>
    `;

    elMcSvg.innerHTML = `
      <defs>
        <filter id="mcGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="0" y="0" width="${MAP_BASE_W}" height="${MAP_BASE_H}" fill="#071120" />
      ${gridSvg}
      ${roadsAndCoastSvg}
      ${meshLinksSvg}
      ${blocksSvg}
      ${hudOverlaySvg}
    `;

    elMcSvg.querySelectorAll('[data-mc-sub]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = el.getAttribute('data-mc-sub');
        if (k) {
          state.selectedKey = k;
          renderAll();
        }
      });
    });
  }

  function renderSvgContent() {
    if (!elSvg) return;
    const subs = getEnrichedSubnets();
    const activeKey = SlxSubnetManager.getActiveSubnetKey();
    if (!subs.some((s) => s.key === state.selectedKey)) {
      state.selectedKey = activeKey || subs[0]?.key || 'subnet1';
    }

    const { nodes, clusters, uiScale } = layoutMapNodes(subs, state.zoom);

    // Graticule grid lines
    const latLines = [60, 30, 0, -30, -60];
    const lonLines = [-120, -60, 0, 60, 120];
    let graticuleSvg = '';

    for (const la of latLines) {
      const { y } = latLonToMapXY(la, 0);
      const isEq = la === 0;
      const lbl = la === 0 ? '0° EQUATOR' : la > 0 ? `${la}°N` : `${Math.abs(la)}°S`;
      graticuleSvg += `
        <line x1="0" y1="${y.toFixed(1)}" x2="${MAP_BASE_W}" y2="${y.toFixed(1)}"
          stroke="${isEq ? 'rgba(56,189,248,0.28)' : 'rgba(148,163,184,0.12)'}"
          stroke-width="${(isEq ? 1.2 : 0.8) * uiScale}"
          stroke-dasharray="${isEq ? `${6 * uiScale} ${4 * uiScale}` : 'none'}" />
        <text x="${(10 * uiScale).toFixed(1)}" y="${(y - 4 * uiScale).toFixed(1)}"
          fill="rgba(148,163,184,0.58)" font-size="${(9.5 * uiScale).toFixed(2)}"
          font-family="JetBrains Mono, monospace">${lbl}</text>
      `;
    }
    for (const lo of lonLines) {
      const { x } = latLonToMapXY(0, lo);
      const isPm = lo === 0;
      const lbl = lo === 0 ? '0° UTC' : lo > 0 ? `${lo}°E` : `${Math.abs(lo)}°W`;
      graticuleSvg += `
        <line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${MAP_BASE_H}"
          stroke="${isPm ? 'rgba(56,189,248,0.2)' : 'rgba(148,163,184,0.1)'}"
          stroke-width="${0.8 * uiScale}" />
        <text x="${(x + 4 * uiScale).toFixed(1)}" y="${(MAP_BASE_H - 8 * uiScale).toFixed(1)}"
          fill="rgba(148,163,184,0.5)" font-size="${(9 * uiScale).toFixed(2)}"
          font-family="JetBrains Mono, monospace">${lbl}</text>
      `;
    }

    // Cross-Subnet Roaming / Hybrid Repeater Arcs between Subnet 1 and all other discovered/custom subnets
    let arcsSvg = '';
    if (nodes.length >= 2) {
      const primary = nodes[0];
      for (let i = 1; i < nodes.length; i++) {
        const peer = nodes[i];
        const mx = (primary.px + peer.px) / 2;
        const my = (primary.py + peer.py) / 2;
        const dist = Math.hypot(peer.px - primary.px, peer.py - primary.py);
        // Orthogonal arc lift
        const arcLift = Math.max(26 * uiScale, Math.min(120 * uiScale, dist * 0.28));
        const ctrlX = mx;
        const ctrlY = my - arcLift;
        const pathId = `slxSwmArc_${i}`;
        const revPathId = `slxSwmArcRev_${i}`;
        // Quadratic Bezier midpoint at t = 0.5
        const repX = 0.25 * primary.px + 0.5 * ctrlX + 0.25 * peer.px;
        const repY = 0.25 * primary.py + 0.5 * ctrlY + 0.25 * peer.py;

        arcsSvg += `
          <path id="${pathId}" d="M ${primary.px.toFixed(1)} ${primary.py.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${peer.px.toFixed(1)} ${peer.py.toFixed(1)}"
            fill="none" stroke="url(#slxSwmBridgeGrad)" stroke-width="${(2.3 * uiScale).toFixed(2)}"
            stroke-dasharray="${(6 * uiScale).toFixed(1)} ${(4 * uiScale).toFixed(1)}" opacity="0.92" />
          <path id="${revPathId}" d="M ${peer.px.toFixed(1)} ${peer.py.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${primary.px.toFixed(1)} ${primary.py.toFixed(1)}"
            fill="none" stroke="transparent" />
          <circle r="${(3.6 * uiScale).toFixed(2)}" fill="#38bdf8" filter="url(#slxSwmGlow)">
            <animateMotion dur="2.6s" repeatCount="indefinite"><mpath href="#${pathId}" /></animateMotion>
          </circle>
          <circle r="${(3.4 * uiScale).toFixed(2)}" fill="#c084fc" filter="url(#slxSwmGlow)">
            <animateMotion dur="3.1s" repeatCount="indefinite"><mpath href="#${revPathId}" /></animateMotion>
          </circle>
          ${
            i === 1
              ? `
              <g transform="translate(${repX.toFixed(1)}, ${repY.toFixed(1)})">
                <polygon points="0,${(-7 * uiScale).toFixed(1)} ${(7 * uiScale).toFixed(1)},0 0,${(7 * uiScale).toFixed(1)} ${(-7 * uiScale).toFixed(1)},0"
                  fill="#0f172a" stroke="#fbbf24" stroke-width="${(1.8 * uiScale).toFixed(2)}" />
                <circle r="${(2.4 * uiScale).toFixed(2)}" fill="#fbbf24" />
                <rect x="${(-52 * uiScale).toFixed(1)}" y="${(-23 * uiScale).toFixed(1)}" width="${(104 * uiScale).toFixed(1)}" height="${(13.5 * uiScale).toFixed(1)}"
                  rx="${(4 * uiScale).toFixed(1)}" fill="rgba(3,7,18,0.88)" stroke="rgba(251,191,36,0.65)" stroke-width="${(0.9 * uiScale).toFixed(2)}" />
                <text x="0" y="${(-13.6 * uiScale).toFixed(1)}" text-anchor="middle" fill="#fde68a"
                  font-size="${(8.2 * uiScale).toFixed(2)}" font-weight="800" font-family="JetBrains Mono, monospace">🛰️ ROAMER RF⇄TCP</text>
              </g>
            `
              : ''
          }
        `;
      }
    }

    // Cluster geographic anchor beacons (when multiple subnets share a metro cluster like Singapore)
    let clusterBeaconsSvg = '';
    for (const group of clusters) {
      if (group.length <= 1) continue;
      const gx = group.reduce((a, n) => a + n.ax, 0) / group.length;
      const gy = group.reduce((a, n) => a + n.ay, 0) / group.length;
      clusterBeaconsSvg += `
        <g>
          <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${(5.2 * uiScale).toFixed(2)}"
            fill="rgba(16,185,129,0.28)" stroke="#34d399" stroke-width="${(1.5 * uiScale).toFixed(2)}" />
          <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${(2.2 * uiScale).toFixed(2)}" fill="#ecfdf5" />
        </g>
      `;
    }

    // Individual Subnet Pins & Callout Pills
    let pinsSvg = '';
    for (const item of nodes) {
      const s = item.subnet;
      const isTcp = s.transport === 'tcp';
      const isSelected = s.key === state.selectedKey;
      const isActive = s.key === activeKey;
      const mainCol = isTcp ? '#c084fc' : '#38bdf8';
      const glowCol = isTcp ? 'rgba(192,132,252,0.32)' : 'rgba(56,189,248,0.32)';
      const badgeW = 136 * uiScale;
      const badgeH = 33 * uiScale;
      const blkTxt = s.liveHeight > 0 ? `#${fmtNum(s.liveHeight)}` : 'LIVE';
      const titleShort =
        s.key === 'subnet1'
          ? 'SUBNET 1 • RF'
          : s.key === 'subnet2'
            ? 'SUBNET 2 • TCP'
            : (s.shortLabel || s.name || 'SUBNET').slice(0, 15);

      // Leader line from true GPS anchor (ax, ay) to spiderfied node (px, py)
      const leaderSvg = item.clustered
        ? `
          <line x1="${item.ax.toFixed(1)}" y1="${item.ay.toFixed(1)}" x2="${item.px.toFixed(1)}" y2="${item.py.toFixed(1)}"
            stroke="${mainCol}" stroke-width="${(1.35 * uiScale).toFixed(2)}" stroke-dasharray="${(3.5 * uiScale).toFixed(1)} ${(2.5 * uiScale).toFixed(1)}" opacity="0.88" />
        `
        : '';

      // Propagation waves (RF concentric circles vs TCP hex ring)
      const waveSvg = !isTcp
        ? `
          <circle class="slx-swm-rf-ring" cx="${item.px.toFixed(1)}" cy="${item.py.toFixed(1)}" r="${(13 * uiScale).toFixed(2)}"
            fill="none" stroke="#38bdf8" stroke-width="${(1.4 * uiScale).toFixed(2)}" />
          <circle class="slx-swm-rf-ring delay" cx="${item.px.toFixed(1)}" cy="${item.py.toFixed(1)}" r="${(13 * uiScale).toFixed(2)}"
            fill="none" stroke="#38bdf8" stroke-width="${(1.1 * uiScale).toFixed(2)}" />
        `
        : `
          <circle cx="${item.px.toFixed(1)}" cy="${item.py.toFixed(1)}" r="${(15 * uiScale).toFixed(2)}"
            fill="none" stroke="#c084fc" stroke-width="${(1.2 * uiScale).toFixed(2)}"
            stroke-dasharray="${(4 * uiScale).toFixed(1)} ${(3 * uiScale).toFixed(1)}" opacity="0.8" />
        `;

      const pillY = item.py < MAP_BASE_H * 0.22 ? item.py + 14 * uiScale : item.py - badgeH - 13 * uiScale;

      pinsSvg += `
        ${leaderSvg}
        <g class="slx-swm-pin-group" data-swm-pin="${escHtml(s.key)}">
          ${waveSvg}
          <circle cx="${item.px.toFixed(1)}" cy="${item.py.toFixed(1)}" r="${((isSelected ? 11.5 : 9) * uiScale).toFixed(2)}"
            fill="${glowCol}" stroke="${isSelected ? '#f8fafc' : mainCol}" stroke-width="${((isSelected ? 2.2 : 1.6) * uiScale).toFixed(2)}" />
          <circle cx="${item.px.toFixed(1)}" cy="${item.py.toFixed(1)}" r="${(4.3 * uiScale).toFixed(2)}"
            fill="${isActive ? '#34d399' : mainCol}" />

          <g transform="translate(${(item.px - badgeW / 2).toFixed(1)}, ${pillY.toFixed(1)})">
            <rect width="${badgeW.toFixed(1)}" height="${badgeH.toFixed(1)}" rx="${(6.5 * uiScale).toFixed(1)}"
              fill="rgba(4, 10, 22, 0.93)"
              stroke="${isSelected ? '#f8fafc' : mainCol}"
              stroke-width="${((isSelected ? 1.8 : 1.15) * uiScale).toFixed(2)}" />
            <text x="${(7 * uiScale).toFixed(1)}" y="${(13.2 * uiScale).toFixed(1)}"
              fill="${isTcp ? '#e9d5ff' : '#bae6fd'}" font-size="${(8.8 * uiScale).toFixed(2)}"
              font-weight="800" font-family="JetBrains Mono, monospace">${escHtml(s.icon || (isTcp ? '🔌' : '📡'))} ${escHtml(titleShort)}</text>
            <text x="${(badgeW - 7 * uiScale).toFixed(1)}" y="${(13.2 * uiScale).toFixed(1)}" text-anchor="end"
              fill="#6ee7b7" font-size="${(8.4 * uiScale).toFixed(2)}"
              font-weight="800" font-family="JetBrains Mono, monospace">${escHtml(blkTxt)}</text>
            <text x="${(7 * uiScale).toFixed(1)}" y="${(25.8 * uiScale).toFixed(1)}"
              fill="#94a3b8" font-size="${(7.7 * uiScale).toFixed(2)}"
              font-family="JetBrains Mono, monospace">ID:${escHtml(s.subnetId || '—')} • ${fmtNum(s.validatorCount || s.validatorNodes?.length || 1)} Val${isActive ? ' • ★' : ''}</text>
          </g>
        </g>
      `;
    }

    elSvg.innerHTML = `
      <defs>
        <linearGradient id="slxSwmBridgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="50%" stop-color="#fbbf24" />
          <stop offset="100%" stop-color="#c084fc" />
        </linearGradient>
        <filter id="slxSwmGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      ${
        !state.bgFailed && backgroundImgUrl
          ? `<image href="${escHtml(backgroundImgUrl)}" x="0" y="0" width="${MAP_BASE_W}" height="${MAP_BASE_H}" preserveAspectRatio="none" opacity="0.96" />`
          : `<rect x="0" y="0" width="${MAP_BASE_W}" height="${MAP_BASE_H}" fill="#061021" />`
      }
      ${graticuleSvg}
      ${clusterBeaconsSvg}
      ${arcsSvg}
      ${pinsSvg}
    `;

    elSvg.querySelectorAll('[data-swm-pin]').forEach((g) => {
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = g.getAttribute('data-swm-pin');
        if (k) {
          state.selectedKey = k;
          renderAll();
        }
      });
    });
  }

  function renderCardsAndInspector() {
    const subs = getEnrichedSubnets();
    const activeKey = SlxSubnetManager.getActiveSubnetKey();
    const rfCount = subs.filter((s) => s.transport !== 'tcp').length;
    const tcpCount = subs.filter((s) => s.transport === 'tcp').length;

    if (elSummaryPill) {
      const crossTxt =
        state.bridge.confirmedCrossTxns > 0
          ? ` • ${fmtNum(state.bridge.confirmedCrossTxns)} Cross-Subnet Txns`
          : ' • RF ⇄ TCP Roaming Live';
      elSummaryPill.textContent = `${subs.length} Subnets (${rfCount} RF • ${tcpCount} TCP)${crossTxt}`;
    }

    if (elStrip) {
      elStrip.innerHTML = subs
        .map((s) => {
          const isSel = s.key === state.selectedKey;
          const isAct = s.key === activeKey;
          const isTcp = s.transport === 'tcp';
          const freqOrProto = isTcp ? 'TLS / TCP Mesh' : '915 MHz LR2021 FLRC';
          return `
            <div class="slx-swm-node-card ${isSel ? 'selected' : ''} ${isTcp ? 'tcp' : ''}" data-swm-card="${escHtml(s.key)}">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                <strong style="font-family:'JetBrains Mono',monospace;font-size:0.74rem;color:${isTcp ? '#e9d5ff' : '#bae6fd'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${escHtml(s.icon || '🌐')} ${escHtml(s.name)}
                </strong>
                ${
                  isAct
                    ? `<span style="padding:1px 7px;border-radius:999px;background:rgba(16,185,129,0.2);border:1px solid rgba(52,211,153,0.6);color:#6ee7b7;font-family:'JetBrains Mono',monospace;font-size:0.6rem;font-weight:800;flex-shrink:0;">ACTIVE</span>`
                    : `<span style="font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:#94a3b8;flex-shrink:0;">${s.liveHeight > 0 ? `#${fmtNum(s.liveHeight)}` : 'LIVE'}</span>`
                }
              </div>
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:#94a3b8;">
                <span>ID: <code style="color:#f8fafc;">${escHtml(s.subnetId || '—')}</code> • ${escHtml(freqOrProto)}</span>
                <span style="color:#6ee7b7;">${s.liveHeight > 0 ? `Blk #${fmtNum(s.liveHeight)}` : `${fmtNum(s.validatorCount || 3)} Validators`}</span>
              </div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.63rem;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                📍 ${escHtml(formatLatLon(s.lat, s.lon))} — ${escHtml(s.locationLabel || 'SuperLexicon Mesh Node')}
              </div>
            </div>
          `;
        })
        .join('');

      elStrip.querySelectorAll('[data-swm-card]').forEach((card) => {
        card.addEventListener('click', () => {
          const k = card.getAttribute('data-swm-card');
          if (!k) return;
          state.selectedKey = k;
          const target = subs.find((x) => x.key === k);
          if (target && state.zoom > 1.35) {
            const pt = latLonToMapXY(target.lat, target.lon);
            animateCameraTo(pt.x, pt.y, state.zoom, state.mode);
          } else {
            renderAll();
          }
        });
      });
    }

    if (elHfsBadge) {
      const regAddr =
        SlxSubnetManager.getOnChainRegistryAddress?.() || SUBNET1_SUBNET_REGISTRY_ADDRESS || '';
      if (Date.now() < state.regAddrCopiedUntil) {
        elHfsBadge.textContent = '✓ Copied HFS Addr!';
      } else if (regAddr) {
        elHfsBadge.textContent = `⛓️ SubnetRegistry HFS: ${regAddr.slice(0, 6)}…${regAddr.slice(-4)}`;
        elHfsBadge.dataset.addr = regAddr;
      }
    }

    const sel = subs.find((s) => s.key === state.selectedKey) || subs[0];
    if (elInspector && sel) {
      const isAct = sel.key === activeKey;
      const isTcp = sel.transport === 'tcp';
      const valCnt = Number(sel.validatorCount || sel.validatorNodes?.length || 1);
      const nodeProbe = state.nodeStatsByKey.get(sel.key) || null;
      const nodePillsHtml =
        nodeProbe && Array.isArray(nodeProbe.nodes) && nodeProbe.nodes.length
          ? `
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;">
              ${nodeProbe.nodes
                .map(
                  (nd) => `
                  <span title="${escHtml(nd.url)}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:6px;background:rgba(15,23,42,0.92);border:1px solid ${nd.online ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)'};font-size:0.62rem;color:${nd.online ? '#a7f3d0' : '#fca5a5'};">
                    <span>${nd.online ? '🟢' : '🔴'}</span>
                    <strong style="color:#f8fafc;">${escHtml(nd.name)}</strong>
                    <span>${nd.online ? `#${fmtNum(nd.blockHeight)} (${nd.rttMs}ms)` : 'offline'}</span>
                  </span>
                `
                )
                .join('')}
            </div>
          `
          : '';

      elInspector.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="color:${isTcp ? '#e9d5ff' : '#7dd3fc'};font-size:0.76rem;">${escHtml(sel.icon || '🌐')} ${escHtml(sel.name)}</strong>
            <span style="color:#cbd5e1;">Subnet ID: <code style="color:#fcd34d;">${escHtml(sel.subnetId || '—')}</code></span>
            <span style="color:#6ee7b7;">${sel.liveHeight > 0 ? `Block #${fmtNum(sel.liveHeight)}` : 'Online'} • ${fmtNum(valCnt)} BFT Validator${valCnt === 1 ? '' : 's'}</span>
            ${sel.onChainRegistered ? `<span style="font-size:0.6rem;padding:1px 6px;border-radius:999px;background:rgba(56,189,248,0.16);border:1px solid rgba(56,189,248,0.45);color:#bae6fd;">⛓️ Stored in SubnetRegistry HFS</span>` : ''}
          </div>
          <div style="color:#94a3b8;font-size:0.66rem;word-break:break-all;">
            📍 ${escHtml(formatLatLon(sel.lat, sel.lon))} (${escHtml(sel.locationLabel || 'Mesh Cluster')}) • Stats Nodes: <code style="color:#bae6fd;">${escHtml((sel.statsRpcUrls || [sel.rpcUrl]).filter(Boolean).join(', ') || 'Auto-Discovered')}</code>
          </div>
          ${nodePillsHtml}
        </div>
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex-shrink:0;">
          <button type="button" class="slx-swm-btn" data-swm-focus="${escHtml(sel.key)}">🎯 Zoom Here</button>
          <button type="button" class="slx-swm-btn" data-swm-edit-hfs="${escHtml(sel.key)}" title="Update node URLs &amp; metadata on-chain (requires subnet owner wallet)">✎ Edit Nodes</button>
          ${
            isAct
              ? `<span class="slx-swm-pill">✓ Currently Connected Subnet</span>`
              : `<button type="button" class="slx-swm-btn cta" data-swm-switch="${escHtml(sel.key)}">⚡ Switch to ${escHtml(sel.shortLabel || sel.name)} →</button>`
          }
        </div>
      `;

      elInspector.querySelector('[data-swm-focus]')?.addEventListener('click', () => {
        state.userInterruptedAutoFly = true;
        applyActiveView('map');
        const isSg = Math.abs(sel.lat - 1.303) < 0.25 && Math.abs(sel.lon - 103.913) < 0.25;
        if (isSg) {
          flyIntoMarineCrescent(true);
        } else {
          const pt = latLonToMapXY(sel.lat, sel.lon);
          animateCameraTo(pt.x, pt.y, 3.6, 'custom');
        }
      });

      elInspector.querySelector('[data-swm-edit-hfs]')?.addEventListener('click', () => {
        openSlxSubnetRegistryModal({
          initialSubnet: sel,
          onSaved: () => {
            SlxSubnetManager.refreshDiscoveryMetadata().then(() => pollSubnetHeights());
          },
        });
      });

      elInspector.querySelector('[data-swm-switch]')?.addEventListener('click', () => {
        if (typeof onSelectSubnet === 'function') {
          onSelectSubnet(sel);
        } else {
          SlxSubnetManager.setActiveSubnetKey(sel.key, { reload: true });
        }
      });
    }
  }

  function renderAll() {
    if (state.destroyed) return;
    applyViewBoxImmediate();
    if (state.mcBlend < 1) renderSvgContent();
    if (state.mcBlend > 0) renderMarineCrescentSvg();
    renderCardsAndInspector();
  }

  // Toolbar buttons
  mountContainer.querySelector('[data-swm-act="global"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    flyOutToGlobal(true);
  });
  mountContainer.querySelector('[data-swm-act="cluster"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    flyIntoMarineCrescent(true);
  });
  mountContainer.querySelector('[data-swm-act="replay-fly"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    replayFlyIn();
  });
  elHfsBadge?.addEventListener('click', () => {
    const addr =
      elHfsBadge.dataset.addr ||
      SlxSubnetManager.getOnChainRegistryAddress?.() ||
      SUBNET1_SUBNET_REGISTRY_ADDRESS;
    if (addr && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(addr).catch(() => {});
      state.regAddrCopiedUntil = Date.now() + 1600;
      renderCardsAndInspector();
      setTimeout(() => {
        if (!state.destroyed) renderCardsAndInspector();
      }, 1650);
    }
  });
  mountContainer.querySelector('[data-swm-act="register-hfs"]')?.addEventListener('click', () => {
    openSlxSubnetRegistryModal({
      onSaved: () => {
        SlxSubnetManager.refreshDiscoveryMetadata().then(() => pollSubnetHeights());
      },
    });
  });
  mountContainer.querySelector('[data-swm-act="close"]')?.addEventListener('click', () => {
    if (typeof onClose === 'function') onClose();
  });

  // Pointer drag-to-pan (when custom-zoomed on World Map) OR horizontal swipe between View 1 (Map) & View 2 (Phase & Bridge Diagram)
  let drag = null;
  elStage?.addEventListener('pointerdown', (ev) => {
    if (
      ev.target.closest('[data-swm-pin]') ||
      ev.target.closest('[data-mc-sub]') ||
      ev.target.closest('[data-swm="swipe-toggle"]') ||
      ev.target.closest('[data-spd-send]')
    ) {
      return;
    }
    const isSwipeMode =
      state.view === 'phase' || state.mode === 'marine' || state.zoom <= 1.03;
    drag = {
      pointerId: ev.pointerId,
      mode: isSwipeMode ? 'swipe' : 'pan',
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      startCx: state.cx,
      startCy: state.cy,
      lockedHoriz: false,
      abortedVert: false,
    };
    if (!isSwipeMode) {
      state.userInterruptedAutoFly = true;
      elStage.classList.add('dragging');
      try {
        elStage.setPointerCapture(ev.pointerId);
      } catch (_) {}
    }
  });

  elStage?.addEventListener('pointermove', (ev) => {
    const rect = elStage.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (state.view === 'map') {
        if (state.mcBlend > 0.6) {
          const mx = ((ev.clientX - rect.left) / rect.width) * MAP_BASE_W;
          const my = ((ev.clientY - rect.top) / rect.height) * MAP_BASE_H;
          const geo = marineCrescentXYToLatLon(mx, my);
          if (elCoords) elCoords.textContent = formatLatLon(geo.lat, geo.lon, 4);
        } else {
          const cam = clampCamera(state.cx, state.cy, state.zoom);
          const svgX = cam.cx - cam.vw / 2 + ((ev.clientX - rect.left) / rect.width) * cam.vw;
          const svgY = cam.cy - cam.vh / 2 + ((ev.clientY - rect.top) / rect.height) * cam.vh;
          const geo = mapXYToLatLon(svgX, svgY);
          if (elCoords) elCoords.textContent = formatLatLon(geo.lat, geo.lon, 2);

          if (drag && ev.pointerId === drag.pointerId && drag.mode === 'pan') {
            const dxSvg = ((ev.clientX - drag.startX) / rect.width) * cam.vw;
            const dySvg = ((ev.clientY - drag.startY) / rect.height) * cam.vh;
            state.cx = drag.startCx - dxSvg;
            state.cy = drag.startCy - dySvg;
            if (state.zoom > 1.02) state.mode = 'custom';
            applyViewBoxImmediate();
            return;
          }
        }
      }

      if (drag && ev.pointerId === drag.pointerId && drag.mode === 'swipe' && !drag.abortedVert) {
        drag.lastX = ev.clientX;
        drag.lastY = ev.clientY;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.lockedHoriz) {
          if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
            drag.abortedVert = true;
            return;
          }
          if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            drag.lockedHoriz = true;
            state.userInterruptedAutoFly = true;
            elTrack?.classList.add('swiping');
            try {
              elStage.setPointerCapture(ev.pointerId);
            } catch (_) {}
          }
        }
        if (drag.lockedHoriz && elTrack) {
          const basePct = state.view === 'phase' ? -50 : 0;
          const deltaPct = (dx / rect.width) * 50;
          const clampedPct = Math.max(-54, Math.min(4, basePct + deltaPct));
          elTrack.style.transform = `translate3d(${clampedPct.toFixed(2)}%, 0, 0)`;
        }
      }
    }
  });

  const endDrag = (ev) => {
    if (drag && (!ev || ev.pointerId === drag.pointerId)) {
      if (drag.mode === 'swipe') {
        elTrack?.classList.remove('swiping');
        const dx = (ev?.clientX ?? drag.lastX) - drag.startX;
        const dy = (ev?.clientY ?? drag.lastY) - drag.startY;
        if (!drag.abortedVert && Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          applyActiveView(state.view === 'map' ? 'phase' : 'map');
        } else {
          applyActiveView(state.view);
        }
      }
      drag = null;
      elStage?.classList.remove('dragging');
    }
  };
  elStage?.addEventListener('pointerup', endDrag);
  elStage?.addEventListener('pointercancel', endDrag);

  elStage?.addEventListener(
    'wheel',
    (ev) => {
      if (state.view !== 'map') return;
      if (!showCloseButton && state.mode === 'global' && !ev.ctrlKey && !ev.metaKey) return;
      if (state.mode === 'marine' && !ev.ctrlKey && !ev.metaKey && !showCloseButton) return;
      ev.preventDefault();
      state.userInterruptedAutoFly = true;
      if (ev.deltaY > 0 && state.mcBlend > 0.5) {
        flyOutToGlobal(true);
      } else if (ev.deltaY < 0 && state.mcBlend < 0.5) {
        flyIntoMarineCrescent(true);
      }
    },
    { passive: false }
  );

  // Live per-node stats probe using the validator RPC URLs registered in SubnetRegistry HFS
  async function pollSubnetHeights() {
    if (state.destroyed) return;
    const subs = SlxSubnetManager.listSubnets();
    await Promise.allSettled(
      subs.map(async (s) => {
        const probe = await probeSubnetNodeStats(s, { timeoutMs: 2600 }).catch(() => null);
        if (probe) {
          state.nodeStatsByKey.set(s.key, probe);
          if (probe.maxHeight > 0) {
            state.heightsByKey.set(s.key, probe.maxHeight);
          }
        }
      })
    );
    if (!state.destroyed) renderAll();
  }

  const onSubnetsUpdated = () => renderAll();
  if (typeof window !== 'undefined') {
    window.addEventListener('slx:subnets-updated', onSubnetsUpdated);
    window.addEventListener('slx:subnet-changed', onSubnetsUpdated);
  }

  let io = null;
  function scheduleInitialAutoZoom() {
    if (state.autoFlyDone || state.userInterruptedAutoFly || state.view !== 'map') return;
    state.autoFlyDone = true;
    state.autoFlyTimer = setTimeout(() => {
      if (!state.destroyed && !state.userInterruptedAutoFly && state.view === 'map') {
        flyIntoMarineCrescent(true, 1850);
      }
    }, 950);
  }

  if (initialMode === 'cluster' || initialMode === 'marine') {
    flyIntoMarineCrescent(false);
    state.autoFlyDone = true;
  } else if (initialMode !== 'global-only') {
    if (typeof IntersectionObserver !== 'undefined' && elStage) {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && e.intersectionRatio >= 0.25) {
              io?.disconnect();
              io = null;
              scheduleInitialAutoZoom();
              break;
            }
          }
        },
        { threshold: [0.25] }
      );
      io.observe(elStage);
    } else {
      scheduleInitialAutoZoom();
    }
  }

  applyActiveView(state.view);
  renderAll();
  SlxSubnetManager.refreshDiscoveryMetadata().catch(() => {});
  pollSubnetHeights();
  const pollTimer = setInterval(pollSubnetHeights, 4000);

  return {
    updateTelemetry({ s1Tip, s2Tip, confirmedCrossTxns, inFlightCrossTxns, lane, rows } = {}) {
      if (state.destroyed) return;
      if (Number(s1Tip) > 0) state.heightsByKey.set('subnet1', Number(s1Tip));
      if (Number(s2Tip) > 0) state.heightsByKey.set('subnet2', Number(s2Tip));
      if (confirmedCrossTxns !== undefined) {
        state.bridge.confirmedCrossTxns = Number(confirmedCrossTxns || 0);
      }
      if (inFlightCrossTxns !== undefined) {
        state.bridge.inFlightCrossTxns = Number(inFlightCrossTxns || 0);
      }
      if (lane) state.bridge.lane = String(lane);
      phaseDiagramInst?.ingestExternalBridgeData({
        s1Tip,
        s2Tip,
        confirmedCrossTxns,
        rows,
      });
      renderAll();
    },
    setView: (v) => applyActiveView(v),
    focusCluster: () => {
      applyActiveView('map');
      flyIntoMarineCrescent(true);
    },
    resetGlobal: () => {
      applyActiveView('map');
      flyOutToGlobal(true);
    },
    replayFlyIn,
    destroy() {
      state.destroyed = true;
      if (state.animFrame) cancelAnimationFrame(state.animFrame);
      if (state.autoFlyTimer) clearTimeout(state.autoFlyTimer);
      io?.disconnect();
      clearInterval(pollTimer);
      phaseDiagramInst?.destroy();
      if (typeof window !== 'undefined') {
        window.removeEventListener('slx:subnets-updated', onSubnetsUpdated);
        window.removeEventListener('slx:subnet-changed', onSubnetsUpdated);
      }
    },
  };
}

let _activeMapModal = null;

/**
 * Open a full-bleed interactive Subnet World Map & Phase Sync modal from any page's top Chain Bar.
 */
export function openSlxSubnetWorldMapModal({ initialMode = 'global', initialView = 'map' } = {}) {
  if (typeof document === 'undefined') return null;
  injectSubnetWorldMapStyles();

  if (_activeMapModal) {
    _activeMapModal.close();
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'slx-swm-modal-backdrop';
  const box = document.createElement('div');
  box.className = 'slx-swm-modal-box';
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  let mapInst = null;
  const close = () => {
    if (mapInst) mapInst.destroy();
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (_activeMapModal?.backdrop === backdrop) _activeMapModal = null;
  };

  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });

  mapInst = mountSlxSubnetWorldMap({
    mountContainer: box,
    initialMode,
    initialView,
    showCloseButton: true,
    onClose: close,
  });

  _activeMapModal = { backdrop, close, mapInst };
  return _activeMapModal;
}

function derivePubSubFromRpcUrl(rpcUrl) {
  const s = String(rpcUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s.replace(/^http/, 'ws') : s);
    if (u.pathname === '/rpc' || u.pathname === '/rpc/') {
      u.pathname = '/';
    } else if (u.port) {
      const p = Number(u.port);
      if (Number.isFinite(p) && p % 100 === 45) u.port = String(p + 21);
    }
    return u.toString().replace(/\/$/, '');
  } catch (_) {
    return s.replace(/\/rpc\/?$/, '');
  }
}

/**
 * Interactive modal to register a new Subnet or update an owned Subnet's validator stats/RPC URLs
 * directly on-chain inside the `SubnetRegistry` HFS ($0.00 gas).
 */
export function openSlxSubnetRegistryModal({
  initialSubnet = null,
  wallet = null,
  rpcUrl = '',
  onSaved = null,
} = {}) {
  if (typeof document === 'undefined') return null;
  injectSubnetWorldMapStyles();

  const effWallet =
    wallet ||
    (typeof window !== 'undefined' && window.__SLX_WALLET__) ||
    new SlxWalletManager();
  const myAddr = String(effWallet?.keypair?.address || '').toLowerCase();
  const isEdit = Boolean(initialSubnet && initialSubnet.subnetId);
  const ownerMismatch =
    isEdit &&
    initialSubnet.ownerEoa &&
    myAddr &&
    String(initialSubnet.ownerEoa).toLowerCase() !== myAddr;

  const regAddr =
    SlxSubnetManager.getOnChainRegistryAddress?.() || SUBNET1_SUBNET_REGISTRY_ADDRESS || '';

  const initPubUrls = isEdit
    ? (initialSubnet.publicRpcUrls || initialSubnet.statsRpcUrls || [initialSubnet.rpcUrl])
        .filter(Boolean)
        .join('\n')
    : '';
  const initLanUrls = isEdit ? (initialSubnet.lanRpcUrls || []).filter(Boolean).join('\n') : '';

  const backdrop = document.createElement('div');
  backdrop.className = 'slx-swm-modal-backdrop';
  backdrop.style.zIndex = '10080';

  const card = document.createElement('div');
  card.style.cssText =
    'width:min(580px,100%);max-height:90dvh;overflow-y:auto;border-radius:15px;border:1.5px solid rgba(56,189,248,0.52);background:linear-gradient(180deg,#060d1d,#091326);padding:16px 18px;box-shadow:0 20px 50px rgba(0,0,0,0.65);color:#f8fafc;font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;gap:11px;';

  const fieldStyle =
    'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(71,85,105,0.75);background:#040915;color:#f8fafc;font-family:"JetBrains Mono",monospace;font-size:16px;outline:none;';
  const lblStyle =
    'display:flex;flex-direction:column;gap:4px;font-size:0.7rem;font-weight:700;color:#cbd5e1;font-family:"JetBrains Mono",monospace;';

  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid rgba(51,65,85,0.6);padding-bottom:9px;">
      <div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.86rem;font-weight:800;color:#7dd3fc;">
          ⛓️ ${isEdit ? `Update On-Chain Subnet (${escHtml(initialSubnet.subnetId)})` : 'Register Subnet & Stats Nodes in SubnetRegistry HFS'}
        </div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.64rem;color:#94a3b8;margin-top:2px;">
          HFS: <code style="color:#fcd34d;">${escHtml(regAddr || 'Auto-Discover')}</code> • Signer: <code style="color:#6ee7b7;">${escHtml(myAddr ? `${myAddr.slice(0, 8)}…${myAddr.slice(-4)}` : '—')}</code> • $0.00 Gas
        </div>
      </div>
      <button type="button" class="slx-swm-btn" data-srm-close>✕</button>
    </div>

    ${
      ownerMismatch
        ? `<div style="padding:8px 10px;border-radius:8px;background:rgba(245,158,11,0.14);border:1px solid rgba(251,191,36,0.45);color:#fde68a;font-family:'JetBrains Mono',monospace;font-size:0.66rem;">
            ⚠️ Subnet <code>${escHtml(initialSubnet.subnetId)}</code> is owned on-chain by <code>${escHtml(initialSubnet.ownerEoa.slice(0, 10))}…</code>. Change Subnet ID below to register a new subnet under your wallet, or switch to the owner keypair to update this record.
          </div>`
        : ''
    }

    <form data-srm-form style="display:flex;flex-direction:column;gap:9px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="${lblStyle}">
          <span>Subnet ID (BLAKE3 Hex / Slug) *</span>
          <input name="subnetId" required maxlength="32" value="${escHtml(isEdit ? initialSubnet.subnetId : '')}" placeholder="e.g. 9f31a8c2" style="${fieldStyle}" />
        </label>
        <label style="${lblStyle}">
          <span>Transport Layer *</span>
          <select name="transport" style="${fieldStyle}">
            <option value="tcp" ${!isEdit || initialSubnet.transport === 'tcp' ? 'selected' : ''}>🔌 Encrypted TCP/IP Mesh</option>
            <option value="flrc" ${isEdit && initialSubnet.transport === 'flrc' ? 'selected' : ''}>📡 915 MHz LR2021 Sub-GHz RF</option>
          </select>
        </label>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
        <label style="${lblStyle}">
          <span>Display Name *</span>
          <input name="name" required maxlength="80" value="${escHtml(isEdit ? initialSubnet.name : '')}" placeholder="e.g. Subnet 3 — Geneva Alpine Mesh" style="${fieldStyle}" />
        </label>
        <label style="${lblStyle}">
          <span>Short Badge</span>
          <input name="shortLabel" maxlength="20" value="${escHtml(isEdit ? initialSubnet.shortLabel || '' : '')}" placeholder="SUBNET 3 • TCP" style="${fieldStyle}" />
        </label>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <label style="${lblStyle}">
          <span>Latitude (°) *</span>
          <input type="number" step="any" name="lat" required value="${escHtml(isEdit ? initialSubnet.lat : '46.2044')}" placeholder="46.2044" style="${fieldStyle}" />
        </label>
        <label style="${lblStyle}">
          <span>Longitude (°) *</span>
          <input type="number" step="any" name="lon" required value="${escHtml(isEdit ? initialSubnet.lon : '6.1432')}" placeholder="6.1432" style="${fieldStyle}" />
        </label>
        <label style="${lblStyle}">
          <span>Validators</span>
          <input type="number" min="1" max="128" name="validatorCount" value="${escHtml(isEdit ? initialSubnet.validatorCount || 3 : 3)}" style="${fieldStyle}" />
        </label>
      </div>

      <label style="${lblStyle}">
        <span>Geographic Location Label</span>
        <input name="locationLabel" maxlength="80" value="${escHtml(isEdit ? initialSubnet.locationLabel || '' : '')}" placeholder="e.g. Geneva Quantum Clearinghouse, Switzerland" style="${fieldStyle}" />
      </label>

      <label style="${lblStyle}">
        <span>Public WSS Validator RPC &amp; Stats URLs (1 per line) *</span>
        <textarea name="publicRpcUrls" rows="3" required placeholder="wss://node31.superlexicon.com/rpc&#10;wss://node32.superlexicon.com/rpc&#10;wss://node33.superlexicon.com/rpc" style="${fieldStyle}font-size:13px;">${escHtml(initPubUrls)}</textarea>
      </label>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <label style="${lblStyle}">
          <span>Optional LAN WS RPC URLs (1/line)</span>
          <textarea name="lanRpcUrls" rows="2" placeholder="ws://192.168.50.91:28545" style="${fieldStyle}font-size:13px;">${escHtml(initLanUrls)}</textarea>
        </label>
        <label style="${lblStyle}">
          <span>Optional Target HfsRegistry (0x…)</span>
          <input name="hfsRegistry" value="${escHtml(isEdit ? initialSubnet.hfsRegistry || '' : '')}" placeholder="0x…" style="${fieldStyle}font-size:13px;" />
        </label>
      </div>

      <div data-srm-status style="display:none;padding:7px 10px;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:0.68rem;"></div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:2px;">
        <button type="button" class="slx-swm-btn" data-srm-close>Cancel</button>
        <button type="submit" class="slx-swm-btn cta" data-srm-submit style="padding:7px 14px;">⛓️ Sign &amp; Save to SubnetRegistry HFS ($0.00 Gas)</button>
      </div>
    </form>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });
  card.querySelectorAll('[data-srm-close]').forEach((b) => b.addEventListener('click', close));

  const form = card.querySelector('[data-srm-form]');
  const statusEl = card.querySelector('[data-srm-status]');
  const submitBtn = card.querySelector('[data-srm-submit]');

  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const pubList = String(fd.get('publicRpcUrls') || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const lanList = String(fd.get('lanRpcUrls') || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!pubList.length) return;
    const transport = String(fd.get('transport') || 'tcp');
    const pubWsUrls = pubList.map(derivePubSubFromRpcUrl).filter(Boolean);
    const lanWsUrls = lanList.map(derivePubSubFromRpcUrl).filter(Boolean);
    const validatorNodes = pubList.map((u, idx) => ({
      name: `${transport === 'flrc' ? 'RF' : 'TCP'} Validator #${idx + 1}`,
      url: u,
      ...(lanList[idx] ? { lanUrl: lanList[idx] } : {}),
    }));

    submitBtn.disabled = true;
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(14,165,233,0.16)';
    statusEl.style.border = '1px solid rgba(56,189,248,0.45)';
    statusEl.style.color = '#bae6fd';
    statusEl.textContent = '⏳ Signing & finalizing upsertSubnet() on SubnetRegistry HFS…';

    try {
      const targetRpc =
        rpcUrl ||
        SlxSubnetManager.getActiveSubnetProfile()?.rpcUrl ||
        'wss://node1.superlexicon.com/rpc';

      const res = await upsertSubnetOnChain({
        wallet: effWallet,
        rpcUrl: targetRpc,
        subnet: {
          subnetId: String(fd.get('subnetId') || '').trim(),
          name: String(fd.get('name') || '').trim(),
          transport,
          channelHz: transport === 'flrc' ? 915_000_000 : 1,
          validatorCount: Number(fd.get('validatorCount') || pubList.length || 3),
          lat: Number(fd.get('lat') || 0),
          lon: Number(fd.get('lon') || 0),
          hfsRegistry: String(fd.get('hfsRegistry') || '').trim(),
          endpoints: {
            shortLabel: String(fd.get('shortLabel') || '').trim(),
            locationLabel: String(fd.get('locationLabel') || '').trim(),
            publicRpcUrls: pubList,
            publicWsUrls: pubWsUrls,
            lanRpcUrls: lanList,
            lanWsUrls,
            validatorNodes,
          },
        },
      });

      statusEl.style.background = 'rgba(16,185,129,0.18)';
      statusEl.style.border = '1px solid rgba(52,211,153,0.55)';
      statusEl.style.color = '#a7f3d0';
      statusEl.textContent = `✓ Confirmed in SubnetRegistry HFS (${res.txHash.slice(0, 12)}…)! Refreshing subnets…`;

      await SlxSubnetManager.refreshDiscoveryMetadata();
      if (typeof onSaved === 'function') onSaved(res);
      setTimeout(close, 650);
    } catch (err) {
      submitBtn.disabled = false;
      statusEl.style.background = 'rgba(239,68,68,0.18)';
      statusEl.style.border = '1px solid rgba(248,113,113,0.55)';
      statusEl.style.color = '#fecaca';
      statusEl.textContent = `✕ Failed: ${err?.message || String(err)}`;
    }
  });

  return { close };
}
