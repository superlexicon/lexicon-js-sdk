/**
 * @superlexicon/sdk/ui — Generic Multi-Scale Global Subnet World Map (`subnet-world-map.js`)
 *
 * 100% generic Web-Mercator multi-scale map + swipeable Phase & Bridge carousel:
 * - Starts at Global World View, then automatically computes the exact geographic bounding box
 *   across all active subnets & validator nodes (`computeAutoFitCamera`) and animates a smooth
 *   orbital zoom + pan so all subnets maximally fill the viewport — whether 100 meters apart
 *   in one neighborhood, 20 km across a city, or 10,000 km across continents.
 * - Streams high-DPI `@2x` dark-matter slippy map tiles (`z = 2..18`) over a local world map
 *   backdrop with parent-tile underlay (zero blank flashes during zoom and full offline fallback).
 * - Automatically expands individual validator meshes when zoomed in and groups co-located
 *   multi-subnet nodes cleanly with zero hardcoded locations.
 */

import { SlxSubnetManager } from '../rpc.js';
import { SlxWalletManager } from '../identity.js';
import { slxSubscribeStats } from '../events.js';
import {
  upsertSubnetOnChain,
  probeSubnetNodeStats,
  SUBNET1_SUBNET_REGISTRY_ADDRESS,
} from '../subnet-registry.js';
import { mountSlxSubnetPhaseDiagram } from './subnet-phase-diagram.js';

export const MAP_BASE_W = 1200;
export const MAP_BASE_H = 675; // 16:9 viewport

const MIN_Z = 1.55;
const MAX_Z = 17.8;
const GLOBAL_DEFAULT_LAT = 16;
const GLOBAL_DEFAULT_LON = 24;
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];

// Pixel-calibrated static world_map.jpg constants kept for `latLonToMapXY` / offline backdrop
const PRIME_MERIDIAN_X_FRAC = 0.4848;
const LON_FRAC_PER_DEG = 0.0028593;
const EQUATOR_Y_FRAC = 0.6045;
const LAT_LIN_COEFF = 0.00555;
const LAT_QUAD_COEFF = 0.000016;

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
 * Pixel-calibrated projection onto the static 16:9 `/assets/hegemony/world_map.jpg` asset.
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
  return {
    lat: Math.max(-85, Math.min(85, sign * absLat)),
    lon: Math.max(-180, Math.min(180, lon)),
  };
}

// ---------------------------------------------------------------------------
// Generic Web Mercator (EPSG:3857) Continuous Zoom Projection
// ---------------------------------------------------------------------------

export function lonToMercX(lon, z = 0) {
  const worldPx = 256 * Math.pow(2, z);
  return ((Number(lon || 0) + 180) / 360) * worldPx;
}

export function latToMercY(lat, z = 0) {
  const clamped = Math.max(-85.0511, Math.min(85.0511, Number(lat || 0)));
  const sinLat = Math.sin((clamped * Math.PI) / 180);
  const worldPx = 256 * Math.pow(2, z);
  return (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldPx;
}

export function mercXToLon(wx, z = 0) {
  const worldPx = 256 * Math.pow(2, z);
  let lon = (wx / worldPx) * 360 - 180;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

export function mercYToLat(wy, z = 0) {
  const worldPx = 256 * Math.pow(2, z);
  const n = Math.PI - (2 * Math.PI * wy) / worldPx;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Generic bounding-box camera solver: computes `{ lat, lon, zoom }` so ALL subnets and
 * their validator nodes are centered and maximally fit inside `(width x height)` with clean
 * margin for callout badges — works identically for a 100m courtyard, a 30km city, or the globe.
 */
export function computeAutoFitCamera(subnets, width = MAP_BASE_W, height = MAP_BASE_H) {
  const pts = [];
  for (const s of subnets || []) {
    if (Array.isArray(s?.validatorNodes)) {
      for (const v of s.validatorNodes) {
        const vLat = Number(v?.lat);
        const vLon = Number(v?.lon);
        if (Number.isFinite(vLat) && Number.isFinite(vLon) && (vLat !== 0 || vLon !== 0)) {
          pts.push({ lat: vLat, lon: vLon });
        }
      }
    }
    const sLat = Number(s?.lat);
    const sLon = Number(s?.lon);
    if (Number.isFinite(sLat) && Number.isFinite(sLon) && (sLat !== 0 || sLon !== 0)) {
      pts.push({ lat: sLat, lon: sLon });
    }
  }

  if (pts.length === 0) {
    return { lat: GLOBAL_DEFAULT_LAT, lon: GLOBAL_DEFAULT_LON, zoom: MIN_Z };
  }

  // Project all points at z = 0 (256x256 world)
  const xs = pts.map((p) => lonToMercX(p.lon, 0));
  const ys = pts.map((p) => latToMercY(p.lat, 0));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const centerLat = mercYToLat(midY, 0);
  const centerLon = mercXToLon(midX, 0);

  // Leave generous margin around nodes so callout badges & RF rings fit comfortably inside the frame
  const usableW = Math.max(240, width * 0.56);
  const usableH = Math.max(160, height * 0.48);

  // Enforce a sensible minimum span (~160m) when all nodes sit at a single point
  const minSpanZ0 = (0.00145 / 360) * 256;
  const dx = Math.max(maxX - minX, minSpanZ0);
  const dy = Math.max(maxY - minY, minSpanZ0 * 0.75);

  const zX = Math.log2(usableW / dx);
  const zY = Math.log2(usableH / dy);
  const zoom = Math.max(MIN_Z, Math.min(17.45, Math.min(zX, zY)));

  return { lat: centerLat, lon: centerLon, zoom };
}

/**
 * Extract any live non-zero GPS coordinates reported inside a validator's `eth_subscribe("stats")`
 * `StatsNotification` payload (`roamingStatus.world_map_subnets`, `node_lat_e7`/`lat_e7`,
 * `nodes.nodes[]`, or `linkMetrics.peers`). Zero `(0, 0)` coordinates (no GNSS fix) are ignored.
 */
export function extractLiveGpsFromStats(stats) {
  const peerGpsByPrefix = new Map();
  const subnetGpsById = new Map();
  let ownGps = null;
  if (!stats || typeof stats !== 'object') {
    return { ownGps, peerGpsByPrefix, subnetGpsById };
  }

  const parsePair = (obj, latKeys, lonKeys, scale = 1) => {
    if (!obj || typeof obj !== 'object') return null;
    for (let i = 0; i < latKeys.length; i++) {
      const la = Number(obj[latKeys[i]]);
      const lo = Number(obj[lonKeys[i]]);
      if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) {
        const lat = la / scale;
        const lon = lo / scale;
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
      }
    }
    return null;
  };

  ownGps =
    parsePair(
      stats,
      ['node_lat_e7', 'lat_e7', 'nodeLatE7', 'latE7'],
      ['node_lon_e7', 'lon_e7', 'nodeLonE7', 'lonE7'],
      1e7
    ) ||
    parsePair(stats, ['lat', 'latitude'], ['lon', 'longitude'], 1) ||
    parsePair(stats.gps, ['lat', 'latitude'], ['lon', 'longitude'], 1) ||
    parsePair(
      stats.roamingStatus,
      ['node_lat_e7', 'lat_e7', 'detected_lat_e7'],
      ['node_lon_e7', 'lon_e7', 'detected_lon_e7'],
      1e7
    );

  const wms = stats.roamingStatus?.world_map_subnets;
  if (Array.isArray(wms)) {
    for (const item of wms) {
      const sid = String(item?.subnet_id || '').trim().toLowerCase();
      const g =
        parsePair(
          item,
          ['detected_lat_e7', 'origin_lat_e7', 'lat_e7'],
          ['detected_lon_e7', 'origin_lon_e7', 'lon_e7'],
          1e7
        ) || parsePair(item, ['lat'], ['lon'], 1);
      if (sid && g) subnetGpsById.set(sid, g);
    }
  }

  const nodesArr = Array.isArray(stats.nodes?.nodes)
    ? stats.nodes.nodes
    : Array.isArray(stats.nodes)
      ? stats.nodes
      : [];
  for (const n of nodesArr) {
    const id = String(n?.id || '').trim().toLowerCase();
    const g =
      parsePair(
        n,
        ['lat_e7', 'peer_lat_e7', 'node_lat_e7'],
        ['lon_e7', 'peer_lon_e7', 'node_lon_e7'],
        1e7
      ) ||
      parsePair(n, ['lat', 'latitude'], ['lon', 'longitude'], 1) ||
      parsePair(n?.gps, ['lat'], ['lon'], 1);
    if (id && g) peerGpsByPrefix.set(id.slice(0, 8), g);
  }

  const peersObj = stats.linkMetrics?.peers;
  if (peersObj && typeof peersObj === 'object') {
    for (const [peerId, m] of Object.entries(peersObj)) {
      const g =
        parsePair(m, ['peer_lat_e7', 'lat_e7'], ['peer_lon_e7', 'lon_e7'], 1e7) ||
        parsePair(m, ['lat'], ['lon'], 1);
      if (peerId && g) peerGpsByPrefix.set(peerId.trim().toLowerCase().slice(0, 8), g);
    }
  }

  return { ownGps, peerGpsByPrefix, subnetGpsById };
}

function chooseNiceScaleMeters(metersPerPx, maxBarPx = 150) {
  const maxMeters = metersPerPx * maxBarPx;
  const steps = [
    20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
    1_000_000, 2_500_000, 5_000_000,
  ];
  let best = steps[0];
  for (const s of steps) {
    if (s <= maxMeters) best = s;
    else break;
  }
  const px = best / metersPerPx;
  const label = best >= 1000 ? `${best / 1000} km` : `${best} m`;
  return { px, label };
}

export function chooseGraticuleStep(zoom = MIN_Z, width = MAP_BASE_W) {
  const degSpanLon = (width / (256 * Math.pow(2, Number(zoom) || MIN_Z))) * 360;
  const steps = [60, 30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005];
  let step = steps[0]; // Always default to coarsest 60° step at wide world zoom!
  if (degSpanLon / steps[0] <= 12) {
    for (const st of steps) {
      step = st;
      if (degSpanLon / st >= 2.5) {
        break;
      }
    }
  }
  return step;
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
      min-width: 152px;
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
      background: #060d1b;
      cursor: grab;
      touch-action: pan-y;
      user-select: none;
    }
    .slx-swm-stage.pan-mode {
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
      z-index: 3;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 5px 10px;
      border-radius: 8px;
      background: rgba(3, 7, 18, 0.84);
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
      .slx-swm-coords {
        display: none;
      }
      .slx-swm-stage {
        aspect-ratio: 4 / 3;
        min-height: 230px;
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
 * Mount the generic multi-scale Global Subnet World Map + swipeable Phase & Bridge diagram.
 */
export function mountSlxSubnetWorldMap({
  mountContainer,
  backgroundImgUrl = '/assets/hegemony/world_map.jpg',
  initialMode = 'auto-fit', // 'auto-fit' (World -> auto-zoom to fit all subnets) | 'fit-immediate' | 'global-only'
  initialView = 'map', // 'map' | 'phase'
  showCloseButton = false,
  onClose = null,
  onSelectSubnet = null,
} = {}) {
  if (typeof document === 'undefined' || !mountContainer) return null;
  injectSubnetWorldMapStyles();

  const state = {
    view: initialView === 'phase' ? 'phase' : 'map',
    lat: GLOBAL_DEFAULT_LAT,
    lon: GLOBAL_DEFAULT_LON,
    zoom: MIN_Z,
    mode: 'global', // 'global' | 'fit' | 'custom'
    autoFlyDone: false,
    userInterruptedAutoFly: false,
    selectedKey: SlxSubnetManager.getActiveSubnetKey(),
    bgFailed: false,
    tilesOffline: false,
    heightsByKey: new Map(),
    nodeStatsByKey: new Map(),
    liveSubnetGpsById: new Map(),
    livePeerGpsByPrefix: new Map(),
    statsSubsByKey: new Map(),
    regAddrCopiedUntil: 0,
    bridge: {
      active: true,
      lane: 'hybrid-rf+tcp',
      confirmedCrossTxns: 0,
      inFlightCrossTxns: 0,
    },
    animFrame: 0,
    autoFlyTimer: 0,
    destroyed: false,
  };

  mountContainer.innerHTML = `
    <div class="slx-swm-card" role="region" aria-label="SuperLexicon Global Subnet Map &amp; Phase Sync">
      <div class="slx-swm-hdr">
        <div class="slx-swm-title-wrap">
          <div class="slx-swm-seg" role="tablist" aria-label="Subnet Visualization View">
            <button type="button" class="slx-swm-seg-btn active" data-swm-view="map" role="tab" aria-selected="true">🌍 1. Subnet Map</button>
            <button type="button" class="slx-swm-seg-btn" data-swm-view="phase" role="tab" aria-selected="false">⚡ 2. Phase &amp; Bridge Live</button>
          </div>
          <span class="slx-swm-pill" data-swm="summary-pill">Connecting SubnetRegistry HFS…</span>
          <button type="button" class="slx-swm-btn" data-swm="hfs-badge" title="Click to copy On-Chain SubnetRegistry HFS contract address" style="padding:2px 8px;font-size:0.63rem;color:#7dd3fc;border-color:rgba(56,189,248,0.45);">⛓️ HFS Registry</button>
        </div>
        <div class="slx-swm-controls">
          <span class="slx-swm-coords" data-swm="coords">—</span>
          <span data-swm="map-tools" style="display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;">
            <button type="button" class="slx-swm-btn active" data-swm-act="global" title="Zoom out to Full World Map">🌍 World</button>
            <button type="button" class="slx-swm-btn" data-swm-act="fit" title="Auto-zoom &amp; center so all subnets maximally fill the map">🎯 Fit All Subnets</button>
            <button type="button" class="slx-swm-btn" data-swm-act="zoom-in" title="Zoom In">➕</button>
            <button type="button" class="slx-swm-btn" data-swm-act="zoom-out" title="Zoom Out">➖</button>
            <button type="button" class="slx-swm-btn" data-swm-act="replay-fly" title="Replay World Map → Fit Subnets Fly-In">🎬</button>
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
            <svg class="slx-swm-svg" data-swm="svg" viewBox="0 0 ${MAP_BASE_W} ${MAP_BASE_H}" preserveAspectRatio="xMidYMid slice">
              <defs>
                <linearGradient id="slxSwmBridgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#38bdf8" />
                  <stop offset="50%" stop-color="#fbbf24" />
                  <stop offset="100%" stop-color="#c084fc" />
                </linearGradient>
                <filter id="slxSwmGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="2.4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect x="0" y="0" width="${MAP_BASE_W}" height="${MAP_BASE_H}" fill="#060d1b" />
              <g data-swm="world-backdrop"></g>
              <g data-swm="tiles-coarse"></g>
              <g data-swm="tiles-fine"></g>
              <g data-swm="graticule"></g>
              <g data-swm="vectors"></g>
              <g data-swm="hud-svg"></g>
            </svg>
            <div class="slx-swm-hud-bl">
              <span><i class="slx-swm-legend-dot" style="background:#38bdf8;box-shadow:0 0 6px #38bdf8;"></i>LR2021 Sub-GHz RF</span>
              <span><i class="slx-swm-legend-dot" style="background:#c084fc;box-shadow:0 0 6px #c084fc;"></i>Encrypted TCP/IP</span>
              <span><i class="slx-swm-legend-dot" style="background:#fbbf24;box-shadow:0 0 6px #fbbf24;"></i>Cross-Subnet Bridge</span>
              <span style="color:#94a3b8;">🌍 World ⇄ 🎯 Auto-Fit • Swipe ⇄ Phase Diagram</span>
            </div>
          </div>
          <div class="slx-swm-pane" data-swm="pane-phase">
            <div data-swm="phase-mount" style="width:100%;height:100%;"></div>
            <div class="slx-swm-hud-bl">
              <span><i class="slx-swm-legend-dot" style="background:#38bdf8;"></i>P1 TX</span>
              <span><i class="slx-swm-legend-dot" style="background:#fbbf24;"></i>P2 VOTE</span>
              <span><i class="slx-swm-legend-dot" style="background:#c084fc;"></i>P3 PROP</span>
              <span><i class="slx-swm-legend-dot" style="background:#34d399;"></i>P4 FINALIZE</span>
              <span style="color:#94a3b8;">‹ Swipe ⇄ back to Subnet Map</span>
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
  const gBackdrop = mountContainer.querySelector('[data-swm="world-backdrop"]');
  const gTilesCoarse = mountContainer.querySelector('[data-swm="tiles-coarse"]');
  const gTilesFine = mountContainer.querySelector('[data-swm="tiles-fine"]');
  const gGraticule = mountContainer.querySelector('[data-swm="graticule"]');
  const gVectors = mountContainer.querySelector('[data-swm="vectors"]');
  const gHudSvg = mountContainer.querySelector('[data-swm="hud-svg"]');
  const elStrip = mountContainer.querySelector('[data-swm="strip"]');
  const elInspector = mountContainer.querySelector('[data-swm="inspector"]');
  const btnGlobal = mountContainer.querySelector('[data-swm-act="global"]');
  const btnFit = mountContainer.querySelector('[data-swm-act="fit"]');
  const viewTabBtns = Array.from(mountContainer.querySelectorAll('[data-swm-view]'));

  function isStageVisible() {
    if (state.destroyed || !elStage) return false;
    if (showCloseButton) return true;
    return elStage.clientWidth > 0 && elStage.clientHeight > 0;
  }

  const phaseDiagramInst = elPhaseMount
    ? mountSlxSubnetPhaseDiagram({
        mountContainer: elPhaseMount,
        isVisibleFn: () => !state.destroyed && state.view === 'phase' && isStageVisible(),
      })
    : null;

  // Probe local world_map.jpg availability
  if (typeof Image !== 'undefined' && backgroundImgUrl) {
    const p = new Image();
    p.onerror = () => {
      if (!state.destroyed) {
        state.bgFailed = true;
        if (isStageVisible()) renderMap();
      }
    };
    p.src = backgroundImgUrl;
  }

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
    if (elMapTools) elMapTools.style.display = state.view === 'map' ? 'inline-flex' : 'none';
    if (elCoords) elCoords.style.display = state.view === 'map' ? '' : 'none';
    if (elSwipeToggle) {
      elSwipeToggle.innerHTML =
        state.view === 'map'
          ? '● ○ &nbsp;Swipe ⇄ Phase &amp; Bridge Live ›'
          : '‹ ● &nbsp;Swipe ⇄ Subnet Map';
    }
    elStage?.classList.toggle('pan-mode', state.view === 'map' && state.mode === 'custom');
    if (state.view === 'phase') {
      phaseDiagramInst?.wake?.();
    } else if (isStageVisible()) {
      renderMap();
    }
  }

  viewTabBtns.forEach((b) => {
    b.addEventListener('click', () => applyActiveView(b.getAttribute('data-swm-view')));
  });
  elSwipeToggle?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    applyActiveView(state.view === 'map' ? 'phase' : 'map');
  });

  function getEnrichedSubnets() {
    const list = SlxSubnetManager.listSubnets();
    return list.map((s) => {
      const sid = String(s.subnetId || '').trim().toLowerCase();
      const liveSubGps = sid ? state.liveSubnetGpsById.get(sid) : null;
      const validatorNodes = Array.isArray(s.validatorNodes)
        ? s.validatorNodes.map((v) => {
            const pfx = String(v?.pubkeyPrefix || '').trim().toLowerCase().slice(0, 8);
            const livePeer = pfx ? state.livePeerGpsByPrefix.get(pfx) : null;
            return livePeer ? { ...v, lat: livePeer.lat, lon: livePeer.lon } : v;
          })
        : s.validatorNodes;
      return {
        ...s,
        validatorNodes,
        liveHeight: state.heightsByKey.get(s.key) || Number(s.tipHeight || 0),
        lat: liveSubGps?.lat ?? (Number.isFinite(Number(s.lat)) ? Number(s.lat) : 1.30308),
        lon: liveSubGps?.lon ?? (Number.isFinite(Number(s.lon)) ? Number(s.lon) : 103.9128),
      };
    });
  }

  // Project arbitrary (lat, lon) into current camera's (1200 x 675) SVG viewport
  function geoToScreen(lat, lon) {
    const cxW = lonToMercX(state.lon, state.zoom);
    const cyW = latToMercY(state.lat, state.zoom);
    const worldW = 256 * Math.pow(2, state.zoom);
    let dx = lonToMercX(lon, state.zoom) - cxW;
    if (dx > worldW / 2) dx -= worldW;
    if (dx < -worldW / 2) dx += worldW;
    const dy = latToMercY(lat, state.zoom) - cyW;
    return {
      x: MAP_BASE_W / 2 + dx,
      y: MAP_BASE_H / 2 + dy,
    };
  }

  function screenToGeo(sx, sy) {
    const cxW = lonToMercX(state.lon, state.zoom);
    const cyW = latToMercY(state.lat, state.zoom);
    const wx = cxW + (sx - MAP_BASE_W / 2);
    const wy = cyW + (sy - MAP_BASE_H / 2);
    return {
      lat: mercYToLat(wy, state.zoom),
      lon: mercXToLon(wx, state.zoom),
    };
  }

  // Smooth Web-Mercator orbital flight between any two `(lat, lon, zoom)` states
  function animateToCamera(targetLat, targetLon, targetZ, modeLabel = 'fit', durMs = 1550) {
    if (state.animFrame) cancelAnimationFrame(state.animFrame);
    state.mode = modeLabel;
    const destZ = Math.max(MIN_Z, Math.min(MAX_Z, targetZ));
    const destLat = Math.max(-82, Math.min(82, targetLat));
    const destLon = targetLon;

    if (durMs <= 0) {
      state.lat = destLat;
      state.lon = destLon;
      state.zoom = destZ;
      renderAll();
      return;
    }

    // Interpolate center in z=0 Web-Mercator space so high-zoom targets don't overshoot
    const startU = lonToMercX(state.lon, 0);
    const startV = latToMercY(state.lat, 0);
    let endU = lonToMercX(destLon, 0);
    if (endU - startU > 128) endU -= 256;
    if (endU - startU < -128) endU += 256;
    const endV = latToMercY(destLat, 0);
    const startZ = state.zoom;
    const startMs = performance.now();
    const zoomingIn = destZ >= startZ;

    const tick = (now) => {
      if (state.destroyed) return;
      const t = Math.min(1, (now - startMs) / durMs);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // When zooming deeply in, pan toward target early so target stays centered throughout zoom
      const panT = zoomingIn ? 1 - Math.pow(1 - t, 3.4) : Math.pow(t, 2.2);
      const curU = startU + (endU - startU) * panT;
      const curV = startV + (endV - startV) * panT;
      state.lon = mercXToLon(curU, 0);
      state.lat = mercYToLat(curV, 0);
      state.zoom = startZ + (destZ - startZ) * ease;

      renderMap();
      if (t < 1) {
        state.animFrame = requestAnimationFrame(tick);
      } else {
        state.animFrame = 0;
        state.lat = destLat;
        state.lon = destLon;
        state.zoom = destZ;
        renderAll();
      }
    };
    state.animFrame = requestAnimationFrame(tick);
  }

  function fitAllSubnets(animate = true, durMs = 1850) {
    const subs = getEnrichedSubnets();
    const target = computeAutoFitCamera(subs, MAP_BASE_W, MAP_BASE_H);
    animateToCamera(target.lat, target.lon, target.zoom, 'fit', animate ? durMs : 0);
  }

  function flyToWorld(animate = true) {
    animateToCamera(GLOBAL_DEFAULT_LAT, GLOBAL_DEFAULT_LON, MIN_Z, 'global', animate ? 950 : 0);
  }

  function replayFlyIn() {
    if (state.autoFlyTimer) clearTimeout(state.autoFlyTimer);
    applyActiveView('map');
    flyToWorld(false);
    state.autoFlyTimer = setTimeout(() => {
      if (!state.destroyed && state.view === 'map') {
        fitAllSubnets(true, 1950);
      }
    }, 600);
  }

  // Build SVG `<image>` tile grid for integer zoom `tz` in tile-pixel space + fast `<g transform>`
  let lastCoarseKey = '';
  let lastFineKey = '';

  function updateTileGroupLayer(gEl, tz, prevKey) {
    if (!gEl) return '';
    const maxTile = 1 << tz;
    const scale = Math.pow(2, state.zoom - tz);
    const cxTile = lonToMercX(state.lon, tz);
    const cyTile = latToMercY(state.lat, tz);

    const halfW = MAP_BASE_W / 2;
    const halfH = MAP_BASE_H / 2;
    const txMin = Math.floor((cxTile - halfW / scale) / 256);
    const txMax = Math.floor((cxTile + halfW / scale) / 256);
    const tyMin = Math.max(0, Math.floor((cyTile - halfH / scale) / 256));
    const tyMax = Math.min(maxTile - 1, Math.floor((cyTile + halfH / scale) / 256));

    if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 48) {
      if (prevKey !== '') gEl.innerHTML = '';
      return '';
    }

    // Update GPU/SVG transform on every frame without recreating `<image>` DOM nodes!
    const transX = halfW - cxTile * scale;
    const transY = halfH - cyTile * scale;
    gEl.setAttribute(
      'transform',
      `translate(${transX.toFixed(2)}, ${transY.toFixed(2)}) scale(${scale.toFixed(6)})`
    );

    const nextKey = `${tz}:${txMin}..${txMax}:${tyMin}..${tyMax}`;
    if (nextKey !== prevKey) {
      let html = '';
      for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
          const wrappedTx = ((tx % maxTile) + maxTile) % maxTile;
          const sub = TILE_SUBDOMAINS[(wrappedTx + ty) & 3];
          const url = `https://${sub}.basemaps.cartocdn.com/dark_all/${tz}/${wrappedTx}/${ty}@2x.png`;
          html += `<image href="${url}" x="${tx * 256}" y="${ty * 256}" width="256.6" height="256.6" preserveAspectRatio="none" />`;
        }
      }
      gEl.innerHTML = html;
    }
    return nextKey;
  }

  function renderMap() {
    if (state.destroyed) return;
    btnGlobal?.classList.toggle('active', state.mode === 'global');
    btnFit?.classList.toggle('active', state.mode === 'fit');
    elStage?.classList.toggle('pan-mode', state.view === 'map' && state.mode === 'custom');

    const dec = state.zoom >= 13 ? 4 : state.zoom >= 7 ? 3 : 2;
    if (elCoords) {
      elCoords.textContent = `${formatLatLon(state.lat, state.lon, dec)} • z${state.zoom.toFixed(1)}`;
    }

    // 1. Static local world_map.jpg backdrop at low zoom (and offline fallback)
    if (gBackdrop) {
      if (!state.bgFailed && backgroundImgUrl && state.zoom < 5.5) {
        const tl = geoToScreen(82, -169);
        const br = geoToScreen(-68, 180);
        const w = Math.max(100, br.x - tl.x);
        const h = Math.max(60, br.y - tl.y);
        const op = state.zoom <= 2.3 ? 0.96 : Math.max(0, 1 - (state.zoom - 2.3) / 2.2);
        gBackdrop.innerHTML = `<image href="${escHtml(backgroundImgUrl)}" x="${tl.x.toFixed(1)}" y="${tl.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="none" opacity="${op.toFixed(2)}" />`;
      } else if (gBackdrop.innerHTML) {
        gBackdrop.innerHTML = '';
      }
    }

    // 2. Multi-scale Carto Dark Matter `@2x` slippy tiles (coarse underlay + sharp current zoom)
    if (!state.tilesOffline && state.zoom > 2.05) {
      const fineZ = Math.max(2, Math.min(18, Math.round(state.zoom)));
      const coarseZ = Math.max(2, fineZ - 3);
      if (gTilesCoarse && coarseZ < fineZ) {
        lastCoarseKey = updateTileGroupLayer(gTilesCoarse, coarseZ, lastCoarseKey);
      } else if (gTilesCoarse && lastCoarseKey) {
        gTilesCoarse.innerHTML = '';
        lastCoarseKey = '';
      }
      if (gTilesFine) {
        lastFineKey = updateTileGroupLayer(gTilesFine, fineZ, lastFineKey);
      }
    } else {
      if (gTilesCoarse && lastCoarseKey) gTilesCoarse.innerHTML = '';
      if (gTilesFine && lastFineKey) gTilesFine.innerHTML = '';
      lastCoarseKey = '';
      lastFineKey = '';
    }

    // 3. Adaptive WGS84 Tactical Graticule Lines (bounded to <= 20 lines at every zoom!)
    if (gGraticule) {
      const degSpanLon = (MAP_BASE_W / (256 * Math.pow(2, state.zoom))) * 360;
      const step = chooseGraticuleStep(state.zoom, MAP_BASE_W);
      const tlGeo = screenToGeo(0, 0);
      const brGeo = screenToGeo(MAP_BASE_W, MAP_BASE_H);
      const gDec = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 0;

      let grat = '';
      const startLat = Math.floor(Math.min(tlGeo.lat, brGeo.lat) / step) * step;
      const endLat = Math.ceil(Math.max(tlGeo.lat, brGeo.lat) / step) * step;
      let latGuards = 0;
      for (let la = startLat; la <= endLat + step * 0.1 && latGuards < 20; la += step, latGuards++) {
        if (la < -82 || la > 82) continue;
        const { y } = geoToScreen(la, state.lon);
        if (y < 0 || y > MAP_BASE_H) continue;
        const isEq = Math.abs(la) < 1e-7;
        grat += `
          <line x1="0" y1="${y.toFixed(1)}" x2="${MAP_BASE_W}" y2="${y.toFixed(1)}"
            stroke="${isEq ? 'rgba(56,189,248,0.28)' : 'rgba(56,189,248,0.08)'}" stroke-width="${isEq ? '1.2' : '0.8'}" />
          <text x="10" y="${(y - 4).toFixed(1)}" fill="rgba(148,163,184,0.48)" font-size="9" font-family="JetBrains Mono, monospace">${Math.abs(la).toFixed(gDec)}°${la >= 0 ? 'N' : 'S'}</text>
        `;
      }
      const startLon = Math.floor((state.lon - degSpanLon * 0.55) / step) * step;
      const endLon = Math.ceil((state.lon + degSpanLon * 0.55) / step) * step;
      let lonGuards = 0;
      for (let lo = startLon; lo <= endLon + step * 0.1 && lonGuards < 20; lo += step, lonGuards++) {
        const { x } = geoToScreen(state.lat, lo);
        if (x < 0 || x > MAP_BASE_W) continue;
        grat += `
          <line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${MAP_BASE_H}"
            stroke="rgba(56,189,248,0.08)" stroke-width="0.8" />
          <text x="${(x + 4).toFixed(1)}" y="18" fill="rgba(148,163,184,0.42)" font-size="8.8" font-family="JetBrains Mono, monospace">${Math.abs(lo).toFixed(gDec)}°${lo >= 0 ? 'E' : 'W'}</text>
        `;
      }
      gGraticule.innerHTML = grat;
    }

    // 4. Generic Multi-Subnet & Validator Mesh Vector Overlay
    renderVectorsAndHud();
  }

  function renderVectorsAndHud() {
    if (!gVectors || !gHudSvg) return;
    const subs = getEnrichedSubnets();
    const activeKey = SlxSubnetManager.getActiveSubnetKey();
    if (!subs.some((s) => s.key === state.selectedKey)) {
      state.selectedKey = activeKey || subs[0]?.key || 'subnet1';
    }

    // Decide per-subnet whether individual validator nodes are resolved at the current zoom!
    const rawItems = []; // { kind: 'validator'|'subnet', subnet, label, blk, sx, sy, lat, lon, online, height, rttMs }
    const subnetScreenCenters = [];
    let meshLinksHtml = '';

    subs.forEach((s, sIdx) => {
      const isTcp = s.transport === 'tcp';
      const probe = state.nodeStatsByKey.get(s.key) || null;
      const valCoords = (s.validatorNodes || [])
        .map((vn, i) => {
          const la = Number(vn?.lat);
          const lo = Number(vn?.lon);
          if (!Number.isFinite(la) || !Number.isFinite(lo) || (la === 0 && lo === 0)) return null;
          const scr = geoToScreen(la, lo);
          const pr = probe?.nodes?.[i] || null;
          return {
            vn,
            i,
            lat: la,
            lon: lo,
            sx: scr.x,
            sy: scr.y,
            online: pr ? pr.online : true,
            height: pr?.blockHeight || s.liveHeight || 0,
            rttMs: pr?.rttMs || 0,
          };
        })
        .filter(Boolean);

      // Measure screen spread of this subnet's validators
      let spreadPx = 0;
      for (let a = 0; a < valCoords.length; a++) {
        for (let b = a + 1; b < valCoords.length; b++) {
          spreadPx = Math.max(
            spreadPx,
            Math.hypot(valCoords[a].sx - valCoords[b].sx, valCoords[a].sy - valCoords[b].sy)
          );
        }
      }

      if (valCoords.length >= 2 && spreadPx >= 58) {
        // Camera is zoomed in enough to show individual validator nodes & intra-subnet mesh links!
        const cx = valCoords.reduce((acc, v) => acc + v.sx, 0) / valCoords.length;
        const cy = valCoords.reduce((acc, v) => acc + v.sy, 0) / valCoords.length;
        subnetScreenCenters.push({ subnet: s, cx, cy, expanded: true });

        const isSel = s.key === state.selectedKey;
        const col = isTcp ? '#c084fc' : '#38bdf8';
        const offsetPx = sIdx * 4; // tiny parallel offset when two subnets share identical node pairs

        for (let a = 0; a < valCoords.length; a++) {
          for (let b = a + 1; b < valCoords.length; b++) {
            const va = valCoords[a];
            const vb = valCoords[b];
            const pid = `swmMesh_${s.key}_${a}_${b}`;
            meshLinksHtml += `
              <path id="${pid}" d="M ${(va.sx + offsetPx).toFixed(1)} ${(va.sy + offsetPx).toFixed(1)} L ${(vb.sx + offsetPx).toFixed(1)} ${(vb.sy + offsetPx).toFixed(1)}"
                stroke="${col}" stroke-width="${isSel ? '2.4' : '1.5'}" opacity="${isSel ? '0.82' : '0.48'}"
                ${isTcp ? '' : 'stroke-dasharray="6 4"'} />
              ${
                b === a + 1
                  ? `<circle r="3" fill="${col}" filter="url(#slxSwmGlow)"><animateMotion dur="${(1.8 + a * 0.35).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${pid}" /></animateMotion></circle>`
                  : ''
              }
            `;
          }
        }

        for (const vc of valCoords) {
          rawItems.push({
            kind: 'validator',
            subnet: s,
            label: (vc.vn.name || `node${vc.i + 1}`).replace(/^(RF |TCP |Validator )/i, ''),
            blk: vc.vn.blk || '',
            sx: vc.sx,
            sy: vc.sy,
            lat: vc.lat,
            lon: vc.lon,
            online: vc.online,
            height: vc.height,
            rttMs: vc.rttMs,
          });
        }
      } else {
        // Subnet-level marker at regional / continental / world zoom
        const scr = geoToScreen(s.lat, s.lon);
        subnetScreenCenters.push({ subnet: s, cx: scr.x, cy: scr.y, expanded: false });
        rawItems.push({
          kind: 'subnet',
          subnet: s,
          label: s.shortLabel || s.name || s.subnetId,
          blk: '',
          sx: scr.x,
          sy: scr.y,
          lat: s.lat,
          lon: s.lon,
          online: true,
          height: s.liveHeight,
          rttMs: 0,
        });
      }
    });

    // Cross-subnet bridge arcs between subnet centers
    let bridgeArcsHtml = '';
    if (subnetScreenCenters.length >= 2) {
      const p0 = subnetScreenCenters[0];
      for (let i = 1; i < subnetScreenCenters.length; i++) {
        const pi = subnetScreenCenters[i];
        const dist = Math.hypot(pi.cx - p0.cx, pi.cy - p0.cy);
        if (dist > 36) {
          const mx = (p0.cx + pi.cx) / 2;
          const my = (p0.cy + pi.cy) / 2 - Math.min(110, Math.max(28, dist * 0.25));
          const aid = `swmBrArc_${i}`;
          bridgeArcsHtml += `
            <path id="${aid}" d="M ${p0.cx.toFixed(1)} ${p0.cy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${pi.cx.toFixed(1)} ${pi.cy.toFixed(1)}"
              fill="none" stroke="url(#slxSwmBridgeGrad)" stroke-width="2.2" stroke-dasharray="6 4" opacity="0.9" />
            <circle r="3.6" fill="#fbbf24" filter="url(#slxSwmGlow)">
              <animateMotion dur="2.4s" repeatCount="indefinite"><mpath href="#${aid}" /></animateMotion>
            </circle>
          `;
        } else if (i === 1 && p0.expanded) {
          // Co-located expanded subnets: place the Roamer / Bridge beacon cleanly at their shared centroid!
          bridgeArcsHtml += `
            <g transform="translate(${p0.cx.toFixed(1)}, ${p0.cy.toFixed(1)})">
              <circle class="slx-swm-rf-ring" cx="0" cy="0" r="16" fill="none" stroke="#fbbf24" stroke-width="1.3" />
              <polygon points="0,-12 12,0 0,12 -12,0" fill="#0f172a" stroke="#fbbf24" stroke-width="2" />
              <circle r="3" fill="#fbbf24" />
              <rect x="-76" y="15" width="152" height="20" rx="6" fill="rgba(3,7,18,0.92)" stroke="rgba(251,191,36,0.72)" stroke-width="1.1" />
              <text x="0" y="28.5" text-anchor="middle" fill="#fde68a" font-size="8.6" font-weight="800" font-family="JetBrains Mono, monospace">🛰️ ROAMER BRIDGE (RF⇄TCP)</text>
            </g>
          `;
        }
      }
    }

    // Group co-located items within 28px into unified multi-node host sites (zero overlap!)
    const sites = [];
    const used = new Set();
    for (let i = 0; i < rawItems.length; i++) {
      if (used.has(i)) continue;
      const members = [rawItems[i]];
      used.add(i);
      for (let j = i + 1; j < rawItems.length; j++) {
        if (used.has(j)) continue;
        if (Math.hypot(rawItems[i].sx - rawItems[j].sx, rawItems[i].sy - rawItems[j].sy) < 28) {
          members.push(rawItems[j]);
          used.add(j);
        }
      }
      const sx = members.reduce((a, m) => a + m.sx, 0) / members.length;
      const sy = members.reduce((a, m) => a + m.sy, 0) / members.length;
      sites.push({ sx, sy, lat: members[0].lat, lon: members[0].lon, members });
    }

    // Compute overall centroid of visible sites so callout cards fan outward away from the middle!
    const allCx = sites.length ? sites.reduce((a, s) => a + s.sx, 0) / sites.length : MAP_BASE_W / 2;
    const allCy = sites.length ? sites.reduce((a, s) => a + s.sy, 0) / sites.length : MAP_BASE_H / 2;

    let pinsHtml = '';
    for (const site of sites) {
      const hasRf = site.members.some((m) => m.subnet.transport !== 'tcp');
      const hasTcp = site.members.some((m) => m.subnet.transport === 'tcp');
      const isSelected = site.members.some((m) => m.subnet.key === state.selectedKey);
      const mainCol = hasRf ? '#38bdf8' : '#c084fc';

      const cardW = 186;
      const hdrLine =
        site.members[0].kind === 'validator'
          ? site.members[0].blk
            ? `📍 BLK ${site.members[0].blk} (${formatLatLon(site.lat, site.lon, 4)})`
            : `📍 ${formatLatLon(site.lat, site.lon, 4)}`
          : `📍 ${formatLatLon(site.lat, site.lon, 2)}`;
      const cardH = 19 + site.members.length * 15.5;

      // Push callout outward from cluster centroid (above if site is in upper half, below if in lower half)
      const placeAbove = sites.length === 1 ? site.sy > 140 : site.sy <= allCy + 4;
      const rawCardX =
        sites.length > 1
          ? site.sx + (site.sx >= allCx ? 14 : -cardW - 14)
          : site.sx - cardW / 2;
      const cardX = Math.max(12, Math.min(MAP_BASE_W - cardW - 12, rawCardX));
      const cardY = Math.max(
        14,
        Math.min(MAP_BASE_H - cardH - 46, placeAbove ? site.sy - cardH - 16 : site.sy + 16)
      );
      const cardAnchorX = Math.max(cardX + 12, Math.min(cardX + cardW - 12, site.sx));
      const cardAnchorY = placeAbove ? cardY + cardH : cardY;

      const rowsSvg = site.members
        .map((m, idx) => {
          const ry = 30 + idx * 15;
          const mTcp = m.subnet.transport === 'tcp';
          const rowCol = mTcp ? '#e9d5ff' : '#bae6fd';
          const isAct = m.subnet.key === activeKey;
          const rTxt =
            m.height > 0
              ? `#${fmtNum(m.height)}${m.rttMs ? ` • ${m.rttMs}ms` : ''}`
              : `${fmtNum(m.subnet.validatorCount || 3)} Val`;
          return `
            <g class="slx-swm-pin-group" data-swm-pin="${escHtml(m.subnet.key)}">
              <text x="8" y="${ry}" fill="${rowCol}" font-size="8.6" font-weight="800" font-family="JetBrains Mono, monospace">${escHtml(m.subnet.icon || (mTcp ? '🔌' : '📡'))} ${escHtml(String(m.label).slice(0, 16))}${isAct ? ' ★' : ''}</text>
              <text x="${cardW - 8}" y="${ry}" text-anchor="end" fill="#6ee7b7" font-size="8.3" font-weight="700" font-family="JetBrains Mono, monospace">${escHtml(rTxt)}</text>
            </g>
          `;
        })
        .join('');

      pinsHtml += `
        <g>
          <line x1="${site.sx.toFixed(1)}" y1="${site.sy.toFixed(1)}" x2="${cardAnchorX.toFixed(1)}" y2="${cardAnchorY.toFixed(1)}"
            stroke="${mainCol}" stroke-width="1.3" stroke-dasharray="3 2.5" opacity="0.82" />
          ${hasRf ? `<circle class="slx-swm-rf-ring" cx="${site.sx.toFixed(1)}" cy="${site.sy.toFixed(1)}" r="15" fill="none" stroke="#38bdf8" stroke-width="1.4" />` : ''}
          ${hasTcp ? `<circle cx="${site.sx.toFixed(1)}" cy="${site.sy.toFixed(1)}" r="19" fill="none" stroke="#c084fc" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.88" />` : ''}
          <circle class="slx-swm-pin-group" data-swm-pin="${escHtml(site.members[0].subnet.key)}"
            cx="${site.sx.toFixed(1)}" cy="${site.sy.toFixed(1)}" r="${isSelected ? '9.5' : '8'}"
            fill="rgba(15,23,42,0.9)" stroke="${isSelected ? '#f8fafc' : mainCol}" stroke-width="2" />
          <circle cx="${site.sx.toFixed(1)}" cy="${site.sy.toFixed(1)}" r="3.8" fill="#34d399" pointer-events="none" />

          <g transform="translate(${cardX.toFixed(1)}, ${cardY.toFixed(1)})">
            <rect width="${cardW}" height="${cardH}" rx="7" fill="rgba(4,10,22,0.93)"
              stroke="${isSelected ? '#f8fafc' : mainCol}" stroke-width="${isSelected ? '1.8' : '1.25'}" />
            <text x="8" y="13" fill="#94a3b8" font-size="7.9" font-weight="700" font-family="JetBrains Mono, monospace">${escHtml(hdrLine)}</text>
            <line x1="6" y1="17" x2="${cardW - 6}" y2="17" stroke="rgba(71,85,105,0.55)" stroke-width="0.8" />
            ${rowsSvg}
          </g>
        </g>
      `;
    }

    gVectors.innerHTML = `${meshLinksHtml}${bridgeArcsHtml}${pinsHtml}`;
    gVectors.querySelectorAll('[data-swm-pin]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const k = el.getAttribute('data-swm-pin');
        if (k) {
          state.selectedKey = k;
          renderAll();
        }
      });
    });

    // Dynamic ground-truth scale bar (bottom-right)
    const metersPerPx =
      (156543.03392 * Math.cos((state.lat * Math.PI) / 180)) / Math.pow(2, state.zoom);
    const scaleBar = chooseNiceScaleMeters(metersPerPx, 130);
    gHudSvg.innerHTML = `
      <g transform="translate(${(MAP_BASE_W - scaleBar.px - 20).toFixed(1)}, ${(MAP_BASE_H - 22).toFixed(1)})">
        <rect x="-8" y="-18" width="${(scaleBar.px + 16).toFixed(1)}" height="24" rx="5" fill="rgba(3,7,18,0.78)" stroke="rgba(71,85,105,0.55)" stroke-width="0.9" />
        <line x1="0" y1="0" x2="${scaleBar.px.toFixed(1)}" y2="0" stroke="#e2e8f0" stroke-width="2" />
        <line x1="0" y1="-4" x2="0" y2="3" stroke="#e2e8f0" stroke-width="2" />
        <line x1="${scaleBar.px.toFixed(1)}" y1="-4" x2="${scaleBar.px.toFixed(1)}" y2="3" stroke="#e2e8f0" stroke-width="2" />
        <text x="${(scaleBar.px / 2).toFixed(1)}" y="-5" text-anchor="middle" fill="#e2e8f0" font-size="8.5" font-weight="700" font-family="JetBrains Mono, monospace">${escHtml(scaleBar.label)}</text>
      </g>
    `;
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
                📍 ${escHtml(formatLatLon(s.lat, s.lon, 4))} — ${escHtml(s.locationLabel || 'SuperLexicon Mesh Node')}
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
          renderAll();
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
            📍 ${escHtml(formatLatLon(sel.lat, sel.lon, 4))} (${escHtml(sel.locationLabel || 'Mesh Cluster')}) • Stats Nodes: <code style="color:#bae6fd;">${escHtml((sel.statsRpcUrls || [sel.rpcUrl]).filter(Boolean).join(', ') || 'Auto-Discovered')}</code>
          </div>
          ${nodePillsHtml}
        </div>
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex-shrink:0;">
          <button type="button" class="slx-swm-btn" data-swm-focus="${escHtml(sel.key)}">🎯 Fit Subnet</button>
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
        const fitOne = computeAutoFitCamera([sel], MAP_BASE_W, MAP_BASE_H);
        animateToCamera(fitOne.lat, fitOne.lon, fitOne.zoom, 'custom', 950);
      });

      elInspector.querySelector('[data-swm-edit-hfs]')?.addEventListener('click', () => {
        openSlxSubnetRegistryModal({
          initialSubnet: sel,
          onSaved: () => {
            SlxSubnetManager.refreshDiscoveryMetadata().then(() => {
              pollSubnetHeights();
              fitAllSubnets(true, 1100);
            });
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
    if (state.destroyed || !isStageVisible()) return;
    renderMap();
    renderCardsAndInspector();
  }

  // Toolbar buttons
  mountContainer.querySelector('[data-swm-act="global"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    flyToWorld(true);
  });
  mountContainer.querySelector('[data-swm-act="fit"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    fitAllSubnets(true, 1300);
  });
  mountContainer.querySelector('[data-swm-act="zoom-in"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    animateToCamera(state.lat, state.lon, Math.min(MAX_Z, state.zoom + 1.4), 'custom', 320);
  });
  mountContainer.querySelector('[data-swm-act="zoom-out"]')?.addEventListener('click', () => {
    state.userInterruptedAutoFly = true;
    const nextZ = Math.max(MIN_Z, state.zoom - 1.4);
    if (nextZ <= MIN_Z + 0.1) flyToWorld(true);
    else animateToCamera(state.lat, state.lon, nextZ, 'custom', 320);
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
        SlxSubnetManager.refreshDiscoveryMetadata().then(() => {
          pollSubnetHeights();
          fitAllSubnets(true, 1200);
        });
      },
    });
  });
  mountContainer.querySelector('[data-swm-act="close"]')?.addEventListener('click', () => {
    if (typeof onClose === 'function') onClose();
  });

  // Pointer gestures:
  // - In `global` or `fit` preset (or `phase` view), horizontal swipe switches cleanly between Map & Phase Diagram!
  // - In `custom` zoom mode (`➕` / `➖` / wheel), dragging pans the map anywhere on Earth!
  let drag = null;
  elStage?.addEventListener('pointerdown', (ev) => {
    if (
      ev.target.closest('[data-swm-pin]') ||
      ev.target.closest('[data-swm="swipe-toggle"]') ||
      ev.target.closest('[data-spd-send]')
    ) {
      return;
    }
    const isPanMode = state.view === 'map' && state.mode === 'custom';
    drag = {
      pointerId: ev.pointerId,
      mode: isPanMode ? 'pan' : 'swipe',
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      startMercX: lonToMercX(state.lon, state.zoom),
      startMercY: latToMercY(state.lat, state.zoom),
      lockedHoriz: false,
      abortedVert: false,
    };
    if (isPanMode) {
      state.userInterruptedAutoFly = true;
      elStage.classList.add('dragging');
      try {
        elStage.setPointerCapture(ev.pointerId);
      } catch (_) {}
    }
  });

  elStage?.addEventListener('pointermove', (ev) => {
    const rect = elStage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (state.view === 'map') {
      const svgX = ((ev.clientX - rect.left) / rect.width) * MAP_BASE_W;
      const svgY = ((ev.clientY - rect.top) / rect.height) * MAP_BASE_H;
      const g = screenToGeo(svgX, svgY);
      const dec = state.zoom >= 13 ? 4 : state.zoom >= 7 ? 3 : 2;
      if (elCoords) elCoords.textContent = `${formatLatLon(g.lat, g.lon, dec)} • z${state.zoom.toFixed(1)}`;

      if (drag && ev.pointerId === drag.pointerId && drag.mode === 'pan') {
        const dxSvg = ((ev.clientX - drag.startX) / rect.width) * MAP_BASE_W;
        const dySvg = ((ev.clientY - drag.startY) / rect.height) * MAP_BASE_H;
        state.lon = mercXToLon(drag.startMercX - dxSvg, state.zoom);
        state.lat = Math.max(-82, Math.min(82, mercYToLat(drag.startMercY - dySvg, state.zoom)));
        renderMap();
        return;
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
      if (!showCloseButton && state.mode !== 'custom' && !ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      state.userInterruptedAutoFly = true;
      const step = ev.deltaY < 0 ? 0.65 : -0.65;
      const nextZ = Math.max(MIN_Z, Math.min(MAX_Z, state.zoom + step));
      state.zoom = nextZ;
      state.mode = nextZ <= MIN_Z + 0.08 ? 'global' : 'custom';
      renderMap();
    },
    { passive: false }
  );

  // Live per-node stats probe using the validator RPC URLs registered in SubnetRegistry HFS
  async function pollSubnetHeights() {
    if (state.destroyed || !isStageVisible()) return;
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
    if (!state.destroyed && isStageVisible()) renderAll();
  }

  function syncLiveStatsSubscriptions() {
    if (state.destroyed || typeof WebSocket === 'undefined') return;
    const subs = SlxSubnetManager.listSubnets();
    const activeKeys = new Set(subs.map((s) => s.key));
    for (const [k, handle] of state.statsSubsByKey.entries()) {
      if (!activeKeys.has(k)) {
        try {
          handle?.unsubscribe?.();
        } catch (_) {}
        state.statsSubsByKey.delete(k);
      }
    }
    for (const s of subs) {
      if (state.statsSubsByKey.has(s.key) || !s.rpcUrl) continue;
      try {
        const handle = slxSubscribeStats(
          s.rpcUrl,
          (stats) => {
            if (state.destroyed || !stats) return;
            let changed = false;
            const h = Number(stats.height || stats.nodes?.height || 0);
            if (h > 0 && h !== state.heightsByKey.get(s.key)) {
              state.heightsByKey.set(s.key, h);
              changed = true;
            }
            const { ownGps, peerGpsByPrefix, subnetGpsById } = extractLiveGpsFromStats(stats);
            const ownSid = String(stats.roamingStatus?.subnet_id || s.subnetId || '')
              .trim()
              .toLowerCase();
            if (ownGps && ownSid) {
              const prev = state.liveSubnetGpsById.get(ownSid);
              if (!prev || Math.abs(prev.lat - ownGps.lat) > 1e-6 || Math.abs(prev.lon - ownGps.lon) > 1e-6) {
                state.liveSubnetGpsById.set(ownSid, ownGps);
                changed = true;
              }
            }
            for (const [sid, g] of subnetGpsById.entries()) {
              const prev = state.liveSubnetGpsById.get(sid);
              if (!prev || Math.abs(prev.lat - g.lat) > 1e-6 || Math.abs(prev.lon - g.lon) > 1e-6) {
                state.liveSubnetGpsById.set(sid, g);
                changed = true;
              }
            }
            for (const [pfx, g] of peerGpsByPrefix.entries()) {
              const prev = state.livePeerGpsByPrefix.get(pfx);
              if (!prev || Math.abs(prev.lat - g.lat) > 1e-6 || Math.abs(prev.lon - g.lon) > 1e-6) {
                state.livePeerGpsByPrefix.set(pfx, g);
                changed = true;
              }
            }
            if (changed) renderAll();
          },
          { pubsubWsUrls: s.pubsubWsUrls }
        );
        state.statsSubsByKey.set(s.key, handle);
      } catch (_) {}
    }
  }

  const onSubnetsUpdated = () => {
    if (state.destroyed) return;
    syncLiveStatsSubscriptions();
    if (state.mode === 'fit' && !state.animFrame) {
      const target = computeAutoFitCamera(getEnrichedSubnets(), MAP_BASE_W, MAP_BASE_H);
      state.lat = target.lat;
      state.lon = target.lon;
      state.zoom = target.zoom;
    }
    renderAll();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('slx:subnets-updated', onSubnetsUpdated);
    window.addEventListener('slx:subnet-changed', onSubnetsUpdated);
  }

  // Trigger World -> Auto-Fit Subnets orbital zoom once visible in the viewport
  let io = null;
  function scheduleInitialAutoZoom() {
    if (state.autoFlyDone || state.userInterruptedAutoFly || state.view !== 'map') return;
    state.autoFlyDone = true;
    state.autoFlyTimer = setTimeout(() => {
      if (!state.destroyed && !state.userInterruptedAutoFly && state.view === 'map') {
        fitAllSubnets(true, 1950);
      }
    }, 900);
  }

  if (initialMode === 'fit-immediate' || initialMode === 'cluster') {
    fitAllSubnets(false);
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

  let wasVisible = false;
  let ro = null;
  if (typeof ResizeObserver !== 'undefined' && elStage) {
    ro = new ResizeObserver(() => {
      if (state.destroyed) return;
      const nowVis = isStageVisible();
      if (nowVis && !wasVisible) {
        wasVisible = true;
        renderAll();
        pollSubnetHeights();
        if (state.view === 'phase') phaseDiagramInst?.wake?.();
        else if (initialMode !== 'global-only') scheduleInitialAutoZoom();
      } else if (!nowVis) {
        wasVisible = false;
      }
    });
    ro.observe(elStage);
  }

  applyActiveView(state.view);
  if (isStageVisible()) {
    wasVisible = true;
    renderAll();
    pollSubnetHeights();
  }
  syncLiveStatsSubscriptions();
  SlxSubnetManager.refreshDiscoveryMetadata().catch(() => {});
  const pollTimer = setInterval(pollSubnetHeights, 5000);

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
      fitAllSubnets(true, 1300);
    },
    fitAllSubnets: () => {
      applyActiveView('map');
      fitAllSubnets(true, 1300);
    },
    resetGlobal: () => {
      applyActiveView('map');
      flyToWorld(true);
    },
    replayFlyIn,
    destroy() {
      state.destroyed = true;
      if (state.animFrame) cancelAnimationFrame(state.animFrame);
      if (state.autoFlyTimer) clearTimeout(state.autoFlyTimer);
      io?.disconnect();
      ro?.disconnect();
      clearInterval(pollTimer);
      for (const handle of state.statsSubsByKey.values()) {
        try {
          handle?.unsubscribe?.();
        } catch (_) {}
      }
      state.statsSubsByKey.clear();
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
export function openSlxSubnetWorldMapModal({ initialMode = 'auto-fit', initialView = 'map' } = {}) {
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
    const baseLat = Number(fd.get('lat') || 0);
    const baseLon = Number(fd.get('lon') || 0);
    const pubWsUrls = pubList.map(derivePubSubFromRpcUrl).filter(Boolean);
    const lanWsUrls = lanList.map(derivePubSubFromRpcUrl).filter(Boolean);
    const validatorNodes = pubList.map((u, idx) => ({
      name: `${transport === 'flrc' ? 'RF' : 'TCP'} Validator #${idx + 1}`,
      url: u,
      lat: baseLat,
      lon: baseLon,
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
          lat: baseLat,
          lon: baseLon,
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
