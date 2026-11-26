/**
 * @superlexicon/sdk/rpc
 *
 * Multiplexed WebSocket JSON-RPC transport (`slxNodeRpc`), Deployment Manifest Cache (`SlxHfsCache`),
 * Collision-Free Nonce & Same-Block Ordering Queue (`SlxNonceQueue`), and High-Level `SlxClient`.
 */

import {
  bytesToHex,
  keccak256Hex,
  computeAddress,
  signOrderedLexiconTx,
} from './crypto.js';
import { encodeAbi } from './abi.js';
import { slxWaitForReceipt, slxWatchChainApp } from './events.js';
import { fetchOnChainSubnets, SUBNET1_SUBNET_REGISTRY_ADDRESS } from './subnet-registry.js';

export const PUBLIC_SUBNET1_WSS_RPC_NODES = [
  'wss://node1.superlexicon.com/rpc',
  'wss://node3.superlexicon.com/rpc',
  'wss://node4.superlexicon.com/rpc',
  'wss://node2.superlexicon.com/rpc',
  'wss://node5.superlexicon.com/rpc',
];
export const PUBLIC_SUBNET1_WSS_RPC = PUBLIC_SUBNET1_WSS_RPC_NODES[0];
let _preferredPublicWssRpc = PUBLIC_SUBNET1_WSS_RPC;

export const PUBLIC_SUBNET2_WSS_RPC_NODES = [
  'wss://node21.superlexicon.com/rpc',
  'wss://node22.superlexicon.com/rpc',
  'wss://node23.superlexicon.com/rpc',
];
export const PUBLIC_SUBNET2_PUBSUB_WS_NODES = [
  'wss://node21.superlexicon.com',
  'wss://node22.superlexicon.com',
  'wss://node23.superlexicon.com',
];
export const PUBLIC_SUBNET2_WSS_RPC = PUBLIC_SUBNET2_WSS_RPC_NODES[0];
let _preferredPublicSubnet2WssRpc = PUBLIC_SUBNET2_WSS_RPC;

function _sanitizeSubnet2PublicUrl(u, isRpc = true) {
  const clean = _httpToWs(u);
  if (!clean) return '';
  if (clean.includes('node6.superlexicon.com')) {
    return isRpc ? PUBLIC_SUBNET2_WSS_RPC : PUBLIC_SUBNET2_PUBSUB_WS_NODES[0];
  }
  return clean;
}
export const BYTECODE_STORE_ADDRESS = '0x0000000000000000000000000000000000000100';
const STORAGE_KEY_HFS_CACHE = 'slx_hfs_address_cache_v1';
const STORAGE_KEY_ACTIVE_SUBNET = 'slx_active_subnet_v1';
const STORAGE_KEY_CUSTOM_SUBNETS = 'slx_custom_subnets_v1';
const STORAGE_KEY_DISCOVERED_SUBNETS = 'slx_discovered_subnets_meta_v1';

function _httpToWs(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length);
  if (s.startsWith('http://')) return 'ws://' + s.slice('http://'.length);
  return 'ws://' + s;
}

function _getLanPrefix() {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const h = window.location.hostname.toLowerCase();
    if (h.startsWith('192.168.1.')) return '192.168.1';
  }
  return '192.168.50';
}

export const SlxSubnetManager = {
  _hydratedDiscovery: false,
  _refreshInFlight: null,

  getOnChainRegistryAddress() {
    if (typeof localStorage !== 'undefined') {
      try {
        const meta = JSON.parse(localStorage.getItem(STORAGE_KEY_DISCOVERED_SUBNETS) || '{}') || {};
        if (meta.onChainRegistryAddr) return String(meta.onChainRegistryAddr).toLowerCase();
      } catch (_) {}
    }
    return SUBNET1_SUBNET_REGISTRY_ADDRESS || '';
  },

  getBuiltInSubnets() {
    const isHttps =
      typeof window !== 'undefined' &&
      (window.location?.protocol === 'https:' ||
        String(window.location?.hostname || '').toLowerCase().endsWith('superlexicon.com'));
    const lanPrefix = _getLanPrefix();
    const host =
      typeof window !== 'undefined' && window.location?.hostname
        ? window.location.hostname
        : `${lanPrefix}.91`;
    const localHostRpc =
      host === 'localhost' || host === '127.0.0.1'
        ? `ws://${lanPrefix}.91:8545`
        : `ws://${host}:8545`;

    let meta = {};
    if (typeof localStorage !== 'undefined') {
      try {
        meta = JSON.parse(localStorage.getItem(STORAGE_KEY_DISCOVERED_SUBNETS) || '{}') || {};
      } catch (_) {}
    }

    const s1Meta = meta.thisSubnet || null;
    const s1DefaultId = 'e40af3dd';
    const s1GpsLat = Number(s1Meta?.detected_lat_e7 || 0) !== 0 ? Number(s1Meta.detected_lat_e7) / 1e7 : null;
    const s1GpsLon = Number(s1Meta?.detected_lon_e7 || 0) !== 0 ? Number(s1Meta.detected_lon_e7) / 1e7 : null;
    const onChainList = Array.isArray(meta.onChainSubnets) ? meta.onChainSubnets : [];
    const s1IdCandidate = String(
      s1Meta?.subnet_id ||
        (meta.subnet1?.subnetId && meta.subnet1.subnetId !== '00000001'
          ? meta.subnet1.subnetId
          : s1DefaultId)
    ).toLowerCase();
    const s1OnChain =
      onChainList.find((o) => String(o?.subnetId || '').toLowerCase() === s1IdCandidate) || null;

    const s1Lat =
      s1GpsLat ??
      (s1OnChain && Number.isFinite(Number(s1OnChain.lat))
        ? Number(s1OnChain.lat)
        : Number.isFinite(Number(meta.subnet1?.lat))
          ? Number(meta.subnet1.lat)
          : 1.3031);
    const s1Lon =
      s1GpsLon ??
      (s1OnChain && Number.isFinite(Number(s1OnChain.lon))
        ? Number(s1OnChain.lon)
        : Number.isFinite(Number(meta.subnet1?.lon))
          ? Number(meta.subnet1.lon)
          : 103.9128);

    const s1PubRpcs =
      s1OnChain?.publicRpcUrls?.length
        ? s1OnChain.publicRpcUrls.map(_httpToWs)
        : [s1Meta?.public_rpc_url ? _httpToWs(s1Meta.public_rpc_url) : _preferredPublicWssRpc];
    const s1LanRpcs =
      s1OnChain?.lanRpcUrls?.length
        ? s1OnChain.lanRpcUrls.map(_httpToWs)
        : [localHostRpc];

    const s1 = {
      key: 'subnet1',
      name: s1OnChain?.name || s1Meta?.name || 'Subnet 1 — 915 MHz LR2021 RF',
      shortLabel: s1OnChain?.shortLabel || 'SUBNET 1 • RF',
      icon: (s1OnChain?.transport || s1Meta?.transport || 'flrc') === 'tcp' ? '🔌' : '📡',
      transport: s1OnChain?.transport || s1Meta?.transport || 'flrc',
      subnetId: s1IdCandidate,
      tipHeight: Number(s1Meta?.tip_height || 0),
      validatorCount: Number(s1OnChain?.validatorCount || s1Meta?.validator_count || 4),
      channelHz: Number(s1OnChain?.channelHz || s1Meta?.last_channel_hz || 915_000_000),
      lat: s1Lat,
      lon: s1Lon,
      gpsDetected: s1GpsLat !== null && s1GpsLon !== null,
      locationLabel:
        s1OnChain?.locationLabel ||
        meta.subnet1?.locationLabel ||
        'Marine Crescent (Blks 28–35), Singapore',
      hfsRegistry: s1OnChain?.hfsRegistry || s1Meta?.hfs_registry || '',
      manifestUrl: s1OnChain?.manifestUrl || s1Meta?.manifest_url || '/contracts/subnet1-deployments.json',
      rpcUrl: isHttps ? s1PubRpcs[0] || _preferredPublicWssRpc : localHostRpc,
      publicRpcUrls: s1OnChain?.publicRpcUrls || PUBLIC_SUBNET1_WSS_RPC_NODES,
      lanRpcUrls: s1LanRpcs,
      statsRpcUrls: isHttps
        ? s1OnChain?.statsRpcUrls?.length
          ? s1OnChain.statsRpcUrls
          : PUBLIC_SUBNET1_WSS_RPC_NODES.slice(0, 4)
        : s1OnChain?.lanStatsRpcUrls?.length
          ? s1OnChain.lanStatsRpcUrls
          : [
              `ws://${lanPrefix}.91:8545`,
              `ws://${lanPrefix}.92:8555`,
              `ws://${lanPrefix}.93:8545`,
              `ws://${lanPrefix}.94:8545`,
            ],
      pubsubWsUrls: isHttps
        ? s1OnChain?.publicWsUrls?.length
          ? s1OnChain.publicWsUrls.map(_httpToWs)
          : [
              ...(s1Meta?.public_ws_url ? [_httpToWs(s1Meta.public_ws_url)] : []),
              'wss://node1.superlexicon.com',
              'wss://node3.superlexicon.com',
              'wss://node4.superlexicon.com',
              'wss://node2.superlexicon.com',
            ]
        : s1OnChain?.lanWsUrls?.length
          ? [...s1OnChain.lanWsUrls.map(_httpToWs), `ws://${host}:8566`, `ws://${host}:8546`]
          : [
              `ws://${lanPrefix}.91:8566`,
              `ws://${lanPrefix}.93:8566`,
              `ws://${lanPrefix}.94:8566`,
              `ws://${lanPrefix}.92:8566`,
              `ws://${host}:8566`,
              `ws://${host}:8546`,
            ],
      validatorNodes:
        s1OnChain?.validatorNodes?.length
          ? s1OnChain.validatorNodes.map((v) => ({
              name: v.name,
              blk: v.blk || '',
              lat: Number.isFinite(Number(v.lat)) ? Number(v.lat) : undefined,
              lon: Number.isFinite(Number(v.lon)) ? Number(v.lon) : undefined,
              url: isHttps ? _httpToWs(v.url) : _httpToWs(v.lanUrl || v.url),
              lanUrl: v.lanUrl ? _httpToWs(v.lanUrl) : '',
              pubkeyPrefix: v.pubkeyPrefix || null,
            }))
          : isHttps
            ? [
                { name: 'RF node1', blk: '28', lat: 1.30344, lon: 103.91335, url: 'wss://node1.superlexicon.com/rpc', pubkeyPrefix: 'c8692b6e' },
                { name: 'RF node2', blk: '29', lat: 1.30285, lon: 103.91320, url: 'wss://node2.superlexicon.com/rpc', pubkeyPrefix: '75c9f6e5' },
                { name: 'RF node3', blk: '33', lat: 1.30265, lon: 103.91218, url: 'wss://node3.superlexicon.com/rpc', pubkeyPrefix: '33b12ce4' },
                { name: 'RF node4', blk: '35', lat: 1.30337, lon: 103.91252, url: 'wss://node4.superlexicon.com/rpc', pubkeyPrefix: 'fbfc4fee' },
              ]
            : [
                { name: 'RF node1 (.91)', blk: '28', lat: 1.30344, lon: 103.91335, url: `ws://${lanPrefix}.91:8545`, pubkeyPrefix: 'c8692b6e' },
                { name: 'RF node2 (.92)', blk: '29', lat: 1.30285, lon: 103.91320, url: `ws://${lanPrefix}.92:8555`, pubkeyPrefix: '75c9f6e5' },
                { name: 'RF node3 (.93)', blk: '33', lat: 1.30265, lon: 103.91218, url: `ws://${lanPrefix}.93:8545`, pubkeyPrefix: '33b12ce4' },
                { name: 'RF node4 (.94)', blk: '35', lat: 1.30337, lon: 103.91252, url: `ws://${lanPrefix}.94:8545`, pubkeyPrefix: 'fbfc4fee' },
              ],
      ownerEoa: s1OnChain?.ownerEoa || '',
      operatorIdentity: s1OnChain?.operatorIdentity || '',
      onChainRegistered: Boolean(s1OnChain),
      onChainRegistryAddr: meta.onChainRegistryAddr || SUBNET1_SUBNET_REGISTRY_ADDRESS || '',
      contracts: s1OnChain?.contracts || {},
      builtin: true,
    };

    const result = [s1];
    const seenIds = new Set([String(s1.subnetId || '').toLowerCase()]);
    const roamingList = Array.isArray(meta.roamingSubnets) ? meta.roamingSubnets : [];
    const roamingById = new Map(
      roamingList.map((r) => [String(r?.subnet_id || '').trim().toLowerCase(), r])
    );

    // 1. Hydrate all subnets registered on-chain in SubnetRegistry HFS
    for (const oc of onChainList) {
      const sid = String(oc?.subnetId || '').trim().toLowerCase();
      if (!sid || seenIds.has(sid)) continue;
      seenIds.add(sid);

      const rm = roamingById.get(sid) || null;
      const isKnownS2 = sid === String(meta.subnet2?.subnetId || '6eaa3da4').toLowerCase();
      const transport = oc.transport || rm?.transport || 'tcp';
      const isTcp = transport === 'tcp';
      const key = isKnownS2 ? 'subnet2' : `subnet_${sid}`;

      const pubRpcs = (oc.publicRpcUrls || [])
        .map((u) => _sanitizeSubnet2PublicUrl(u, true))
        .filter(Boolean);
      const pubWs = (oc.publicWsUrls || [])
        .map((u) => _sanitizeSubnet2PublicUrl(u, false))
        .filter(Boolean);
      const lanRpcs = (oc.lanRpcUrls || []).map(_httpToWs).filter(Boolean);
      const lanWs = (oc.lanWsUrls || []).map(_httpToWs).filter(Boolean);

      const rpcUrls = isHttps
        ? pubRpcs.length
          ? pubRpcs
          : isKnownS2
            ? [...PUBLIC_SUBNET2_WSS_RPC_NODES]
            : []
        : lanRpcs.length
          ? lanRpcs
          : pubRpcs;

      const pubsubUrls = isHttps
        ? pubWs.length
          ? pubWs
          : isKnownS2
            ? [...PUBLIC_SUBNET2_PUBSUB_WS_NODES]
            : []
        : lanWs.length
          ? lanWs
          : pubWs;

      const statsUrls = isHttps
        ? (oc.statsRpcUrls || []).length
          ? oc.statsRpcUrls.map((u) => _sanitizeSubnet2PublicUrl(u, true))
          : rpcUrls
        : (oc.lanStatsRpcUrls || []).length
          ? oc.lanStatsRpcUrls.map(_httpToWs)
          : rpcUrls;

      const rmGpsLat =
        rm && Number(rm.detected_lat_e7 || 0) !== 0 ? Number(rm.detected_lat_e7) / 1e7 : null;
      const rmGpsLon =
        rm && Number(rm.detected_lon_e7 || 0) !== 0 ? Number(rm.detected_lon_e7) / 1e7 : null;

      const isForming = !isKnownS2 && Boolean(oc.forming || oc.status === 3);
      result.push({
        key,
        name: oc.name || rm?.name || `Subnet ${sid}`,
        shortLabel:
          oc.shortLabel ||
          (isForming
            ? `FORMING ${oc.haveValidators || oc.validatorCount || 1}/${oc.minValidators || 3}`
            : isKnownS2
              ? `SUBNET 2 • ${isTcp ? 'TCP' : 'RF'}`
              : `SUBNET ${sid.slice(0, 4).toUpperCase()} • ${isTcp ? 'TCP' : 'RF'}`),
        icon: isForming ? '⏳' : isTcp ? '🔌' : '📡',
        status: Number(oc.status || (isForming ? 3 : 1)),
        forming: isForming,
        minValidators: Number(oc.minValidators || 3),
        haveValidators: Number(oc.haveValidators || oc.validatorCount || 1),
        callingChannelHz: Number(oc.callingChannelHz || 0),
        fuzzyRadiusM: Number(oc.fuzzyRadiusM || 0),
        waitingNodePubkey: oc.waitingNodePubkey || '',
        transport,
        subnetId: sid,
        tipHeight: Number(rm?.tip_height || 0),
        validatorCount: Number(
          oc.validatorCount || rm?.validator_count || statsUrls.length || (isForming ? 1 : 3)
        ),
        channelHz: Number(oc.channelHz || rm?.last_channel_hz || (isTcp ? 1 : 915_000_000)),
        lat: rmGpsLat ?? Number(oc.lat ?? 1.30322),
        lon: rmGpsLon ?? Number(oc.lon ?? 103.91302),
        gpsDetected: rmGpsLat !== null && rmGpsLon !== null,
        locationLabel: oc.locationLabel || 'Registered in On-Chain SubnetRegistry HFS',
        hfsRegistry: oc.hfsRegistry || rm?.hfs_registry || '',
        manifestUrl: oc.manifestUrl || rm?.manifest_url || '',
        rpcUrl: rpcUrls[0] || '',
        publicRpcUrls: pubRpcs,
        lanRpcUrls: lanRpcs,
        statsRpcUrls: statsUrls,
        pubsubWsUrls: pubsubUrls,
        validatorNodes:
          Array.isArray(oc.validatorNodes) && oc.validatorNodes.length
            ? oc.validatorNodes.map((v) => ({
                name: v.name,
                blk: v.blk || '',
                lat: Number.isFinite(Number(v.lat)) ? Number(v.lat) : undefined,
                lon: Number.isFinite(Number(v.lon)) ? Number(v.lon) : undefined,
                url: isHttps
                  ? _sanitizeSubnet2PublicUrl(v.url, true)
                  : _httpToWs(v.lanUrl || v.url),
                lanUrl: v.lanUrl ? _httpToWs(v.lanUrl) : '',
                pubkeyPrefix: v.pubkeyPrefix || null,
              }))
            : statsUrls.map((u, idx) => ({
                name: `${isTcp ? 'TCP' : 'RF'} Validator #${idx + 1} (${u.replace(/^wss?:\/\//, '')})`,
                url: u,
                pubkeyPrefix: null,
              })),
        ownerEoa: oc.ownerEoa || '',
        operatorIdentity: oc.operatorIdentity || '',
        onChainRegistered: true,
        onChainRegistryAddr: meta.onChainRegistryAddr || SUBNET1_SUBNET_REGISTRY_ADDRESS || '',
        contracts: oc.contracts || {},
        builtin: true,
        discovered: true,
      });
    }

    for (let i = 0; i < roamingList.length; i++) {
      const rm = roamingList[i];
      const sid = String(rm?.subnet_id || '').trim().toLowerCase();
      if (!sid || sid === '00000000' || seenIds.has(sid)) continue;

      const isKnownS2 = sid === String(meta.subnet2?.subnetId || '6eaa3da4').toLowerCase();
      const rmHz = Number(rm?.last_channel_hz || 0);
      if (
        !isKnownS2 &&
        !rm?.name &&
        !rm?.lan_rpc_url &&
        !rm?.public_rpc_url &&
        rmHz > 1 &&
        result.some((r) => Number(r.channelHz) === rmHz)
      ) {
        continue;
      }
      seenIds.add(sid);
      const transport =
        rm.transport ||
        (isKnownS2 ? meta.subnet2?.transport || 'tcp' : Number(rm.last_channel_hz) === 1 ? 'tcp' : 'flrc');
      const isTcp = transport === 'tcp';
      const key = isKnownS2 ? 'subnet2' : `subnet_${sid}`;

      let rpcUrls = [];
      let pubsubUrls = [];
      let validatorNodesOverride = null;
      if (isHttps) {
        if (isKnownS2) {
          const discRpc = _sanitizeSubnet2PublicUrl(rm.public_rpc_url, true);
          const s2Cands = [
            _preferredPublicSubnet2WssRpc,
            ...(discRpc ? [discRpc] : []),
            ...PUBLIC_SUBNET2_WSS_RPC_NODES,
          ];
          rpcUrls = Array.from(new Set(s2Cands.filter(Boolean)));
          const discWs = _sanitizeSubnet2PublicUrl(rm.public_ws_url, false);
          pubsubUrls = Array.from(
            new Set([...(discWs ? [discWs] : []), ...PUBLIC_SUBNET2_PUBSUB_WS_NODES])
          );
          validatorNodesOverride = [
            { name: 'TCP node21', blk: '28', lat: 1.30344, lon: 103.91335, url: 'wss://node21.superlexicon.com/rpc', pubkeyPrefix: 'a70ed680' },
            { name: 'TCP node22', blk: '29', lat: 1.30285, lon: 103.91320, url: 'wss://node22.superlexicon.com/rpc', pubkeyPrefix: '5d5d4c68' },
            { name: 'TCP node23', blk: '35', lat: 1.30337, lon: 103.91252, url: 'wss://node23.superlexicon.com/rpc', pubkeyPrefix: '128e7754' },
          ];
        } else {
          const pubRpc = rm.public_rpc_url
            ? _sanitizeSubnet2PublicUrl(rm.public_rpc_url, true)
            : isTcp
              ? PUBLIC_SUBNET2_WSS_RPC
              : '';
          if (pubRpc) rpcUrls = [pubRpc];
          const pubWs = rm.public_ws_url
            ? _sanitizeSubnet2PublicUrl(rm.public_ws_url, false)
            : isTcp
              ? PUBLIC_SUBNET2_PUBSUB_WS_NODES[0]
              : '';
          if (pubWs) pubsubUrls = [pubWs];
        }
      } else {
        if (rm.lan_rpc_url) rpcUrls.push(_httpToWs(rm.lan_rpc_url));
        if (isKnownS2) {
          const fallbackLanRpcs =
            Array.isArray(meta.subnet2?.rpcUrls) && meta.subnet2.rpcUrls.length
              ? meta.subnet2.rpcUrls.map(_httpToWs)
              : [`ws://${lanPrefix}.91:18545`, `ws://${lanPrefix}.92:18545`, `ws://${lanPrefix}.94:18545`];
          for (const u of fallbackLanRpcs) {
            if (!rpcUrls.includes(u)) rpcUrls.push(u);
          }
        } else if (!rpcUrls.length && rm.public_rpc_url) {
          rpcUrls.push(_sanitizeSubnet2PublicUrl(rm.public_rpc_url, true));
        }

        if (rm.lan_ws_url) pubsubUrls.push(_httpToWs(rm.lan_ws_url));
        if (isKnownS2) {
          const fallbackLanWs =
            Array.isArray(meta.subnet2?.wsUrls) && meta.subnet2.wsUrls.length
              ? meta.subnet2.wsUrls.map(_httpToWs)
              : [`ws://${lanPrefix}.91:18566`, `ws://${lanPrefix}.92:18566`, `ws://${lanPrefix}.94:18566`];
          for (const u of fallbackLanWs) {
            if (!pubsubUrls.includes(u)) pubsubUrls.push(u);
          }
        } else if (!pubsubUrls.length && rm.public_ws_url) {
          pubsubUrls.push(_sanitizeSubnet2PublicUrl(rm.public_ws_url, false));
        }
      }

      const defaultName = isKnownS2
        ? meta.subnet2?.name || 'Subnet 2 — Encrypted TCP/IP Mesh'
        : isTcp
          ? `Subnet ${sid} — Encrypted TCP/IP Mesh`
          : `Subnet ${sid} — LR2021 RF`;
      const displayName = rm.name || defaultName;
      const shortLabel = isKnownS2
        ? `SUBNET 2 • ${isTcp ? 'TCP' : 'RF'}`
        : `SUBNET ${sid.slice(0, 4).toUpperCase()} • ${isTcp ? 'TCP' : 'RF'}`;

      const rmGpsLat =
        Number(rm.detected_lat_e7 || 0) !== 0 ? Number(rm.detected_lat_e7) / 1e7 : null;
      const rmGpsLon =
        Number(rm.detected_lon_e7 || 0) !== 0 ? Number(rm.detected_lon_e7) / 1e7 : null;
      const defaultS2Lat = Number.isFinite(Number(meta.subnet2?.lat))
        ? Number(meta.subnet2.lat)
        : 1.30322;
      const defaultS2Lon = Number.isFinite(Number(meta.subnet2?.lon))
        ? Number(meta.subnet2.lon)
        : 103.91302;
      const hashSeed = parseInt(sid.slice(0, 6), 16) || (i + 1) * 97;
      const autoLat = isKnownS2 ? defaultS2Lat : ((hashSeed % 80) - 32);
      const autoLon = isKnownS2 ? defaultS2Lon : (((hashSeed * 37) % 280) - 130);

      result.push({
        key,
        name: displayName,
        shortLabel,
        icon: isTcp ? '🔌' : '📡',
        transport,
        subnetId: sid,
        tipHeight: Number(rm.tip_height || 0),
        validatorCount: Number(rm.validator_count || 0),
        channelHz: Number(rm.last_channel_hz || (isTcp ? 1 : 915_000_000)),
        lat: rmGpsLat ?? autoLat,
        lon: rmGpsLon ?? autoLon,
        gpsDetected: rmGpsLat !== null && rmGpsLon !== null,
        locationLabel:
          rmGpsLat !== null && rmGpsLon !== null
            ? 'Live Roamer GPS Telemetry Fix'
            : isKnownS2
              ? meta.subnet2?.locationLabel || 'Marine Crescent (Blks 28, 29 & 35), Singapore'
              : 'Auto-Discovered via SubnetWorldMap',
        hfsRegistry: rm.hfs_registry || '',
        manifestUrl:
          rm.manifest_url || (isKnownS2 ? '/contracts/subnet2-deployments.json' : ''),
        rpcUrl: rpcUrls[0] || '',
        pubsubWsUrls: pubsubUrls,
        validatorNodes:
          validatorNodesOverride ||
          (rpcUrls.length
            ? rpcUrls.map((u, idx) => ({
                name: `${isTcp ? 'TCP' : 'RF'} Validator #${idx + 1} (${u.replace(/^wss?:\/\//, '')})`,
                url: u,
                pubkeyPrefix: null,
              }))
            : []),
        builtin: true,
        discovered: true,
      });
    }

    // Fallback before first slx_roamingStatus resolves so Subnet 2 is immediately selectable at 0ms on both HTTPS & LAN
    const defaultS2Id = String(meta.subnet2?.subnetId || '6eaa3da4').toLowerCase();
    if (!seenIds.has(defaultS2Id)) {
      const s2RpcUrls = isHttps
        ? Array.from(new Set([_preferredPublicSubnet2WssRpc, ...PUBLIC_SUBNET2_WSS_RPC_NODES]))
        : Array.isArray(meta.subnet2?.rpcUrls) && meta.subnet2.rpcUrls.length
          ? meta.subnet2.rpcUrls.map(_httpToWs)
          : [`ws://${lanPrefix}.91:18545`, `ws://${lanPrefix}.92:18545`, `ws://${lanPrefix}.94:18545`];
      const s2PubsubUrls = isHttps
        ? [...PUBLIC_SUBNET2_PUBSUB_WS_NODES]
        : Array.isArray(meta.subnet2?.wsUrls) && meta.subnet2.wsUrls.length
          ? meta.subnet2.wsUrls.map(_httpToWs)
          : [`ws://${lanPrefix}.91:18566`, `ws://${lanPrefix}.92:18566`, `ws://${lanPrefix}.94:18566`];
      result.push({
        key: 'subnet2',
        name: meta.subnet2?.name || 'Subnet 2 — Encrypted TCP/IP Mesh',
        shortLabel: 'SUBNET 2 • TCP',
        icon: '🔌',
        transport: meta.subnet2?.transport || 'tcp',
        subnetId: defaultS2Id,
        tipHeight: 0,
        validatorCount: 3,
        channelHz: 1,
        lat: Number.isFinite(Number(meta.subnet2?.lat)) ? Number(meta.subnet2.lat) : 1.30322,
        lon: Number.isFinite(Number(meta.subnet2?.lon)) ? Number(meta.subnet2.lon) : 103.91302,
        gpsDetected: false,
        locationLabel:
          meta.subnet2?.locationLabel || 'Marine Crescent (Blks 28, 29 & 35), Singapore',
        hfsRegistry: '',
        manifestUrl: '/contracts/subnet2-deployments.json',
        rpcUrl: s2RpcUrls[0],
        pubsubWsUrls: s2PubsubUrls,
        validatorNodes: isHttps
          ? [
              { name: 'TCP node21', blk: '28', lat: 1.30344, lon: 103.91335, url: 'wss://node21.superlexicon.com/rpc', pubkeyPrefix: 'a70ed680' },
              { name: 'TCP node22', blk: '29', lat: 1.30285, lon: 103.91320, url: 'wss://node22.superlexicon.com/rpc', pubkeyPrefix: '5d5d4c68' },
              { name: 'TCP node23', blk: '35', lat: 1.30337, lon: 103.91252, url: 'wss://node23.superlexicon.com/rpc', pubkeyPrefix: '128e7754' },
            ]
          : [
              { name: 'TCP node21 (.91)', blk: '28', lat: 1.30344, lon: 103.91335, url: s2RpcUrls[0], pubkeyPrefix: 'a70ed680' },
              { name: 'TCP node22 (.92)', blk: '29', lat: 1.30285, lon: 103.91320, url: s2RpcUrls[1] || s2RpcUrls[0], pubkeyPrefix: '5d5d4c68' },
              { name: 'TCP node23 (.94)', blk: '35', lat: 1.30337, lon: 103.91252, url: s2RpcUrls[2] || s2RpcUrls[0], pubkeyPrefix: '128e7754' },
            ],
        builtin: true,
      });
    }

    const extraFromConfig = Array.isArray(meta.configuredSubnets) ? meta.configuredSubnets : [];
    for (const ex of extraFromConfig) {
      if (!result.some((r) => r.key === ex.key || (ex.subnetId && r.subnetId === ex.subnetId))) {
        result.push(ex);
      }
    }
    return result;
  },

  getCustomSubnets() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_SUBNETS) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  },

  listSubnets({ includeForming = false } = {}) {
    const builtins = this.getBuiltInSubnets().filter((s) => includeForming || !s.forming);
    const customs = this.getCustomSubnets().map((c) => {
      const wsRpc = _httpToWs(c.rpcUrl);
      let pubsub = c.pubsubWsUrl ? [_httpToWs(c.pubsubWsUrl)] : [];
      if (!pubsub.length && wsRpc) {
        try {
          const u = new URL(wsRpc);
          const p = Number(u.port || 8545);
          const u1 = new URL(wsRpc);
          u1.port = String(p + 21); // 8545 -> 8566, 18545 -> 18566
          const u2 = new URL(wsRpc);
          u2.port = String(p + 1); // 8545 -> 8546
          pubsub = [u1.toString().replace(/\/$/, ''), u2.toString().replace(/\/$/, '')];
        } catch (_) {}
      }
      return {
        key: c.key,
        name: c.name || `Custom Subnet (${wsRpc})`,
        shortLabel: c.shortLabel || (c.name ? c.name.slice(0, 16).toUpperCase() : 'CUSTOM SUBNET'),
        icon: c.transport === 'flrc' ? '📡' : '🌐',
        transport: c.transport || 'tcp',
        subnetId: c.subnetId || 'custom',
        lat: Number.isFinite(Number(c.lat)) ? Number(c.lat) : 46.2044,
        lon: Number.isFinite(Number(c.lon)) ? Number(c.lon) : 6.1432,
        gpsDetected: false,
        locationLabel: c.locationLabel || 'Custom Connected Subnet Gateway',
        manifestUrl: c.manifestUrl || '',
        rpcUrl: wsRpc,
        pubsubWsUrls: pubsub,
        validatorNodes: [{ name: c.name || 'Subnet Validator', url: wsRpc, pubkeyPrefix: null }],
        builtin: false,
      };
    });
    return [...builtins, ...customs];
  },

  getActiveSubnetKey() {
    if (typeof window !== 'undefined' && window.location?.search) {
      try {
        const q = new URLSearchParams(window.location.search).get('subnet');
        if (q && this.listSubnets().some((s) => s.key === q || s.subnetId === q)) {
          const matched = this.listSubnets().find((s) => s.key === q || s.subnetId === q);
          if (matched && typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY_ACTIVE_SUBNET, matched.key);
          }
          return matched ? matched.key : 'subnet1';
        }
      } catch (_) {}
    }
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_SUBNET);
      if (saved && this.listSubnets().some((s) => s.key === saved)) {
        return saved;
      }
    }
    return 'subnet1';
  },

  getActiveSubnetProfile() {
    const key = this.getActiveSubnetKey();
    const list = this.listSubnets();
    const prof = list.find((s) => s.key === key) || list[0];
    if (typeof window !== 'undefined' && prof) {
      window.__SLX_ACTIVE_SUBNET__ = prof;
      window.__SLX_ACTIVE_PUBSUB_WS_URLS__ = prof.pubsubWsUrls || [];
    }
    return prof;
  },

  setActiveSubnetKey(key, { reload = true } = {}) {
    const list = this.listSubnets();
    const target = list.find((s) => s.key === key) || list[0];
    if (!target) return null;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_SUBNET, target.key);
      } catch (_) {}
    }
    if (typeof window !== 'undefined') {
      window.__SLX_ACTIVE_SUBNET__ = target;
      window.__SLX_ACTIVE_PUBSUB_WS_URLS__ = target.pubsubWsUrls || [];
      try {
        const u = new URL(window.location.href);
        if (target.key === 'subnet1') u.searchParams.delete('subnet');
        else u.searchParams.set('subnet', target.key);
        window.history.replaceState({}, '', u.toString());
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('slx:subnet-changed', { detail: target }));
      if (reload) {
        window.location.reload();
      }
    }
    return target;
  },

  addCustomSubnet({
    name,
    rpcUrl,
    pubsubWsUrl = '',
    manifestUrl = '',
    transport = 'tcp',
    subnetId = '',
    lat = undefined,
    lon = undefined,
    locationLabel = '',
  }) {
    const cleanRpc = _httpToWs(rpcUrl);
    if (!cleanRpc) throw new Error('RPC URL is required');
    const key = `custom_${Date.now().toString(36)}`;
    const list = this.getCustomSubnets();
    const parsedLat = lat !== undefined && lat !== '' && Number.isFinite(Number(lat)) ? Number(lat) : undefined;
    const parsedLon = lon !== undefined && lon !== '' && Number.isFinite(Number(lon)) ? Number(lon) : undefined;
    list.push({
      key,
      name: String(name || cleanRpc).trim(),
      shortLabel: String(name || 'CUSTOM').trim().slice(0, 16).toUpperCase(),
      rpcUrl: cleanRpc,
      pubsubWsUrl: pubsubWsUrl ? _httpToWs(pubsubWsUrl) : '',
      manifestUrl: String(manifestUrl || '').trim(),
      transport,
      subnetId: String(subnetId || '').trim(),
      ...(parsedLat !== undefined ? { lat: parsedLat } : {}),
      ...(parsedLon !== undefined ? { lon: parsedLon } : {}),
      ...(locationLabel ? { locationLabel: String(locationLabel).trim() } : {}),
    });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CUSTOM_SUBNETS, JSON.stringify(list));
    }
    return key;
  },

  removeCustomSubnet(key) {
    const next = this.getCustomSubnets().filter((c) => c.key !== key);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CUSTOM_SUBNETS, JSON.stringify(next));
    }
    if (this.getActiveSubnetKey() === key) {
      this.setActiveSubnetKey('subnet1', { reload: true });
    }
  },

  async refreshDiscoveryMetadata(seedRpcOverride = '') {
    if (!seedRpcOverride && this._refreshInFlight) {
      return this._refreshInFlight;
    }
    const runPromise = (async () => {
      let meta = {};
      if (typeof localStorage !== 'undefined') {
        try {
          meta = JSON.parse(localStorage.getItem(STORAGE_KEY_DISCOVERED_SUBNETS) || '{}') || {};
        } catch (_) {}
      }

    const isHttps =
      typeof window !== 'undefined' &&
      (window.location?.protocol === 'https:' ||
        String(window.location?.hostname || '').toLowerCase().endsWith('superlexicon.com'));
    const lanPrefix = _getLanPrefix();
    const host =
      typeof window !== 'undefined' && window.location?.hostname
        ? window.location.hostname
        : `${lanPrefix}.91`;
    const localSeedRpc =
      host === 'localhost' || host === '127.0.0.1'
        ? `ws://${lanPrefix}.91:8545`
        : `ws://${host}:8545`;
    const seedRpc = seedRpcOverride
      ? _httpToWs(seedRpcOverride)
      : isHttps
        ? _preferredPublicWssRpc
        : localSeedRpc;

    const tasks = [];
    if (typeof WebSocket !== 'undefined' && seedRpc) {
      tasks.push(
        fetchOnChainSubnets({ rpcUrl: seedRpc })
          .then((res) => {
            if (res && res.registryAddr) {
              meta.onChainRegistryAddr = res.registryAddr;
            }
            if (res && Array.isArray(res.subnets) && res.subnets.length > 0) {
              meta.onChainSubnets = res.subnets;
            }
          })
          .catch(() => {})
      );
      tasks.push(
        slxNodeRpc(seedRpc, 'slx_roamingStatus', [], 3500)
          .then((roam) => {
            if (!roam || typeof roam !== 'object') return;
            if (roam.this_subnet && typeof roam.this_subnet === 'object') {
              meta.thisSubnet = roam.this_subnet;
            } else if (roam.subnet_id && roam.subnet_id !== '00000000') {
              meta.subnet1 = { subnetId: roam.subnet_id };
            }
            if (Array.isArray(roam.world_map_subnets)) {
              const prevById = new Map(
                (Array.isArray(meta.roamingSubnets) ? meta.roamingSubnets : []).map((x) => [
                  String(x?.subnet_id || '').toLowerCase(),
                  x,
                ])
              );
              const nextList = [];
              const ownSid = String(roam.this_subnet?.subnet_id || roam.subnet_id || '').toLowerCase();
              for (const item of roam.world_map_subnets) {
                const sid = String(item?.subnet_id || '').trim().toLowerCase();
                if (!sid || sid === '00000000' || sid === '00000001' || sid === ownSid) continue;
                const prev = prevById.get(sid) || {};
                nextList.push({
                  subnet_id: sid,
                  last_channel_hz: Number(item.last_channel_hz ?? prev.last_channel_hz ?? 0),
                  tip_height: Number(item.tip_height ?? prev.tip_height ?? 0),
                  validator_count: Number(item.validator_count ?? prev.validator_count ?? 0),
                  detected_lat_e7: Number(item.detected_lat_e7 ?? prev.detected_lat_e7 ?? 0),
                  detected_lon_e7: Number(item.detected_lon_e7 ?? prev.detected_lon_e7 ?? 0),
                  phases_observed_mask: Number(item.phases_observed_mask ?? prev.phases_observed_mask ?? 0),
                  name: item.name || prev.name || '',
                  transport: item.transport || prev.transport || '',
                  public_rpc_url: item.public_rpc_url || prev.public_rpc_url || '',
                  public_ws_url: item.public_ws_url || prev.public_ws_url || '',
                  lan_rpc_url: item.lan_rpc_url || prev.lan_rpc_url || '',
                  lan_ws_url: item.lan_ws_url || prev.lan_ws_url || '',
                  manifest_url: item.manifest_url || prev.manifest_url || '',
                  hfs_registry: item.hfs_registry || prev.hfs_registry || '',
                });
              }
              meta.roamingSubnets = nextList;
            }
          })
          .catch(() => {})
      );
    }

    if (typeof fetch !== 'undefined') {
      tasks.push(
        fetch('/contracts/subnet2-deployments.json', { cache: 'no-store' })
          .then(async (r2) => {
            if (!r2.ok) return;
            const j2 = await r2.json();
            meta.subnet2 = {
              name: j2.name || meta.subnet2?.name || '',
              subnetId: j2.subnetId || '6eaa3da4',
              transport: j2.transport || 'tcp',
              rpcUrls: j2.rpcUrls || [],
              wsUrls: j2.wsUrls || [],
              ...(Number.isFinite(Number(j2.lat)) ? { lat: Number(j2.lat) } : {}),
              ...(Number.isFinite(Number(j2.lon)) ? { lon: Number(j2.lon) } : {}),
              ...(j2.locationLabel ? { locationLabel: String(j2.locationLabel) } : {}),
            };
            if (j2.subnet1Id) {
              meta.subnet1 = {
                subnetId: j2.subnet1Id,
                ...(Number.isFinite(Number(j2.subnet1Lat)) ? { lat: Number(j2.subnet1Lat) } : {}),
                ...(Number.isFinite(Number(j2.subnet1Lon)) ? { lon: Number(j2.subnet1Lon) } : {}),
                ...(j2.subnet1LocationLabel
                  ? { locationLabel: String(j2.subnet1LocationLabel) }
                  : {}),
              };
            }
          })
          .catch(() => {})
      );
      tasks.push(
        fetch('/contracts/subnets.json', { cache: 'no-store' })
          .then(async (rs) => {
            if (!rs.ok) return;
            const js = await rs.json();
            if (Array.isArray(js?.subnets)) {
              meta.configuredSubnets = js.subnets
                .filter((x) => x && x.key && x.key !== 'subnet1' && x.key !== 'subnet2' && x.rpcUrl)
                .map((x) => ({
                  key: String(x.key),
                  name: x.name || String(x.key),
                  shortLabel: x.shortLabel || String(x.name || x.key).slice(0, 16).toUpperCase(),
                  icon: x.transport === 'flrc' ? '📡' : '🔌',
                  transport: x.transport || 'tcp',
                  subnetId: x.subnetId || '',
                  lat: Number.isFinite(Number(x.lat)) ? Number(x.lat) : 51.5074,
                  lon: Number.isFinite(Number(x.lon)) ? Number(x.lon) : -0.1278,
                  locationLabel: x.locationLabel || 'Configured Regional Subnet',
                  manifestUrl: x.manifestUrl || '',
                  rpcUrl: _httpToWs(x.rpcUrl),
                  pubsubWsUrls: Array.isArray(x.pubsubWsUrls) ? x.pubsubWsUrls.map(_httpToWs) : [],
                  validatorNodes: Array.isArray(x.validatorNodes)
                    ? x.validatorNodes
                    : [{ name: x.name || 'Validator', url: _httpToWs(x.rpcUrl), pubkeyPrefix: null }],
                  builtin: true,
                }));
            }
          })
          .catch(() => {})
      );
    }

    if (tasks.length) {
      await Promise.allSettled(tasks);
    }

    if (typeof localStorage !== 'undefined' && Object.keys(meta).length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY_DISCOVERED_SUBNETS, JSON.stringify(meta));
      } catch (_) {}
    }
      this._hydratedDiscovery = true;
      const prof = this.getActiveSubnetProfile();
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('slx:subnets-updated', { detail: this.listSubnets() }));
        } catch (_) {}
      }
      return prof;
    })();
    if (!seedRpcOverride) {
      this._refreshInFlight = runPromise.finally(() => {
        if (this._refreshInFlight === runPromise) this._refreshInFlight = null;
      });
      return this._refreshInFlight;
    }
    return runPromise;
  },
};

export function getDefaultNodeWsUrl() {
  const active = SlxSubnetManager.getActiveSubnetProfile();
  if (active && active.key !== 'subnet1' && active.rpcUrl) {
    return active.rpcUrl;
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const host = window.location.hostname.toLowerCase();
    if (window.location.protocol === 'https:' || host.endsWith('superlexicon.com')) {
      return _preferredPublicWssRpc;
    }
    return `ws://${window.location.hostname}:8545`;
  }
  return _preferredPublicWssRpc;
}

function _scopedCacheStorageKey() {
  const key = SlxSubnetManager.getActiveSubnetKey();
  return key === 'subnet1' ? STORAGE_KEY_HFS_CACHE : `${STORAGE_KEY_HFS_CACHE}:${key}`;
}

export const SlxHfsCache = {
  load() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(_scopedCacheStorageKey());
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  },
  save(patch) {
    const next = { ...this.load(), ...patch };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(_scopedCacheStorageKey(), JSON.stringify(next));
      } catch (_) {}
    }
    return next;
  },
  async hydrateWithManifest(manifestUrl = undefined) {
    await SlxSubnetManager.refreshDiscoveryMetadata().catch(() => null);
    const activeProf = SlxSubnetManager.getActiveSubnetProfile();
    const effectiveManifestUrl =
      manifestUrl !== undefined
        ? manifestUrl
        : activeProf?.manifestUrl || '/contracts/subnet1-deployments.json';

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('slx_inst_wasm_snapshot_v1');
      } catch (_) {}
    }
    let cached = this.load();
    let manifest = null;
    if (typeof fetch !== 'undefined' && effectiveManifestUrl) {
      try {
        const res = await fetch(effectiveManifestUrl, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
      } catch (_) {}
    }
    const manifestReg = String(manifest?.hfsRegistry || '').toLowerCase();
    const cachedReg = String(cached.hfsRegistry || '').toLowerCase();
    if (activeProf?.key === 'subnet1' && manifestReg && cachedReg !== manifestReg) {
      if (typeof localStorage !== 'undefined') {
        try {
          // Preserve returning users' chosen nicknames before purging stale pre-reset chain caches
          const prevIdsRaw = localStorage.getItem('slx_unified_identities_v1');
          if (prevIdsRaw) {
            const prevIds = JSON.parse(prevIdsRaw);
            const prefRaw = localStorage.getItem('slx_preferred_nicknames_v1');
            const prefMap = prefRaw ? JSON.parse(prefRaw) : {};
            for (const [eoaKey, rec] of Object.entries(prevIds || {})) {
              if (rec?.nickname && !prefMap[eoaKey.toLowerCase()]) {
                prefMap[eoaKey.toLowerCase()] = String(rec.nickname).trim().slice(0, 24);
              }
            }
            localStorage.setItem('slx_preferred_nicknames_v1', JSON.stringify(prefMap));
          }
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (
              k &&
              k.startsWith('slx_') &&
              k !== 'slx_wallet_keypair_v1' &&
              k !== 'slx_preferred_nicknames_v1' &&
              k !== 'slx_legal_consent_v1' &&
              !k.startsWith('slx_game_guide_seen_')
            ) {
              keysToRemove.push(k);
            }
          }
          for (const k of keysToRemove) localStorage.removeItem(k);
        } catch (_) {}
      }
      cached = {};
    }
    const defaultWs = getDefaultNodeWsUrl();
    const isHttpsPage =
      typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const cachedRpc = String(cached.rpcUrl || '');
    const isStaleCachedRpc =
      (activeProf && activeProf.key !== 'subnet1') ||
      !cachedRpc.startsWith('ws') ||
      cachedRpc.includes('superlexicon.com:8545') ||
      (isHttpsPage && cachedRpc.startsWith('ws://')) ||
      (PUBLIC_SUBNET1_WSS_RPC_NODES.includes(cachedRpc) && cachedRpc !== _preferredPublicWssRpc);
    const useRpc = isStaleCachedRpc ? defaultWs : cachedRpc;
    const LEGACY_COMMONS_CHARTER = '0x24707a2b8115992bc864c014b2f5e71e831ab8d5';
    const cachedSocialCharter =
      cached.socialCharterAddr &&
      String(cached.socialCharterAddr).toLowerCase() !== LEGACY_COMMONS_CHARTER
        ? cached.socialCharterAddr
        : '';
    const merged = {
      subnetKey: activeProf?.key || 'subnet1',
      subnetId: manifest?.subnetId || activeProf?.subnetId || '00000001',
      rpcUrl: useRpc,
      hfsRegistry: manifest?.hfsRegistry || activeProf?.hfsRegistry || cached.hfsRegistry || '',
      messagingAddr:
        manifest?.messaging || manifest?.commonsRf?.messaging || cached.messagingAddr || '',
      deployedAt: manifest?.deployedAt || cached.deployedAt || '',
      battleshipAddr: manifest?.battleship?.contractAddr || cached.battleshipAddr || '',
      battleId: manifest?.battleship?.battleId || cached.battleId || '',
      socialCharterAddr:
        manifest?.fleetSocial?.charter ||
        cachedSocialCharter ||
        manifest?.commonsRf?.charter ||
        '',
      fleetSocial: manifest?.fleetSocial || cached.fleetSocial || null,
      personaIdentities: manifest?.commonsRf?.personaIdentities || [],
      personaPrivs: manifest?.commonsRf?.personaPrivs || [],
      citizenOnboardingPool: manifest?.commonsRf?.citizenOnboardingPool || [],
      poolSlotPrivs: manifest?.commonsRf?.poolSlotPrivs || [],
      faucetPriv: manifest?.commonsRf?.faucetPriv || '',
      dexClobAddr: manifest?.institutional?.dexClob || cached.dexClobAddr || '',
      corporateCharterAddr: manifest?.institutional?.corporateCharter || cached.corporateCharterAddr || '',
      corpProductLedgerAddr: manifest?.institutional?.productLedger || cached.corpProductLedgerAddr || '',
      fiatLedgerAddr: manifest?.institutional?.fiatLedger || cached.fiatLedgerAddr || '',
      shareLedgerAddr: manifest?.institutional?.shareLedger || cached.shareLedgerAddr || '',
      accountingLedgerAddr: manifest?.institutional?.accountingLedger || cached.accountingLedgerAddr || '',
      institutional: manifest?.institutional || null,
      codeHashes: manifest?.codeHashes || {},
    };
    this.save(merged);
    return { cache: merged, manifest, subnet: activeProf };
  },
};

const _wsPools = new Map();
const MAX_WS_POOL_SIZE = 4;

export function toWsEndpoint(urlStr) {
  const s = String(urlStr || '').trim() || getDefaultNodeWsUrl();
  if (s.startsWith('ws://') || s.startsWith('wss://')) return s;
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length);
  if (s.startsWith('http://')) return 'ws://' + s.slice('http://'.length);
  return 'ws://' + s;
}

function createWsPoolEntry(wsUrl, pool, connectTimeoutMs = 12000) {
  if (typeof WebSocket === 'undefined') return null;

  const pending = new Map();
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (_) {
    return null;
  }

  const entry = {
    ws,
    reqSeq: 1,
    inflight: 0,
    pending,
    openPromise: null,
  };

  const removeSelf = () => {
    const idx = pool.indexOf(entry);
    if (idx !== -1) pool.splice(idx, 1);
  };

  entry.openPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch (_) {}
      removeSelf();
      reject(new Error(`WebSocket connect timeout (${wsUrl})`));
    }, connectTimeoutMs);

    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      removeSelf();
      reject(new Error(`WebSocket unreachable (${wsUrl})`));
    };
    ws.onclose = () => {
      removeSelf();
      for (const [, p] of pending.entries()) {
        p.reject(new Error('WebSocket closed'));
      }
      pending.clear();
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (msg && msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          const detail = msg.error.data ? ` (${msg.error.data})` : '';
          const rpcErr = new Error(
            msg.error.message ? `${msg.error.message}${detail}` : JSON.stringify(msg.error)
          );
          rpcErr.isJsonRpcError = true;
          rpcErr.code = msg.error.code;
          rpcErr.data = msg.error.data;
          p.reject(rpcErr);
        } else {
          p.resolve(msg.result);
        }
      }
    };
  });

  pool.push(entry);
  return entry;
}

function acquireWsEntry(wsUrl, connectTimeoutMs = 12000) {
  let pool = _wsPools.get(wsUrl);
  if (!pool) {
    pool = [];
    _wsPools.set(wsUrl, pool);
  }
  for (let i = pool.length - 1; i >= 0; i--) {
    const st = pool[i].ws?.readyState;
    if (st !== 0 && st !== 1) pool.splice(i, 1);
  }
  const idle = pool.find((e) => e.ws.readyState === 1 && e.inflight === 0 && e.pending.size === 0);
  if (idle) return idle;
  if (pool.length < MAX_WS_POOL_SIZE) {
    const created = createWsPoolEntry(wsUrl, pool, connectTimeoutMs);
    if (created) return created;
  }
  if (pool.length === 0) return null;
  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].inflight < best.inflight) best = pool[i];
  }
  return best;
}

async function sendSingleWsRpc(wsUrl, method, params, timeoutMs) {
  const entry = acquireWsEntry(wsUrl, Math.min(timeoutMs, 6500));
  if (!entry) throw new Error(`WebSocket unavailable (${wsUrl})`);
  entry.inflight++;
  try {
    const ws = await entry.openPromise;
    const id = entry.reqSeq++;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error(`RPC timeout on ${method}`));
      }, timeoutMs);
      entry.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  } finally {
    entry.inflight = Math.max(0, entry.inflight - 1);
  }
}

const _deadWsCooldownUntil = new Map();
const DEAD_WS_COOLDOWN_MS = 45_000;

export async function slxNodeRpc(endpointUrl, method, params = [], timeoutMs = 15000, opts = {}) {
  const allowFailover = opts?.allowFailover !== false;
  let wsUrl = toWsEndpoint(endpointUrl);

  if (wsUrl.includes('node6.superlexicon.com')) {
    wsUrl = PUBLIC_SUBNET2_WSS_RPC;
  }

  // Automatically route public validator calls to the currently healthy TLS validator first (strictly per-subnet!)
  if (
    allowFailover &&
    PUBLIC_SUBNET1_WSS_RPC_NODES.includes(wsUrl) &&
    _preferredPublicWssRpc &&
    wsUrl !== _preferredPublicWssRpc
  ) {
    wsUrl = _preferredPublicWssRpc;
  } else if (
    allowFailover &&
    PUBLIC_SUBNET2_WSS_RPC_NODES.includes(wsUrl) &&
    _preferredPublicSubnet2WssRpc &&
    wsUrl !== _preferredPublicSubnet2WssRpc
  ) {
    wsUrl = _preferredPublicSubnet2WssRpc;
  }

  try {
    const res = await sendSingleWsRpc(wsUrl, method, params, timeoutMs);
    _deadWsCooldownUntil.delete(wsUrl);
    if (PUBLIC_SUBNET1_WSS_RPC_NODES.includes(wsUrl)) {
      _preferredPublicWssRpc = wsUrl;
    } else if (PUBLIC_SUBNET2_WSS_RPC_NODES.includes(wsUrl)) {
      _preferredPublicSubnet2WssRpc = wsUrl;
    }
    return res;
  } catch (primaryErr) {
    // IMPORTANT: A JSON-RPC application error (e.g. VM revert `Call failed` on an optional HFS view probe)
    // proves the validator WebSocket IS healthy and answered — NEVER fail over across other validators!
    if (primaryErr?.isJsonRpcError) {
      throw primaryErr;
    }
    _deadWsCooldownUntil.set(wsUrl, Date.now() + DEAD_WS_COOLDOWN_MS);

    if (allowFailover) {
      const now = Date.now();
      const isPublicSubnet1Target = PUBLIC_SUBNET1_WSS_RPC_NODES.includes(wsUrl);
      const isPublicSubnet2Target = PUBLIC_SUBNET2_WSS_RPC_NODES.includes(wsUrl);
      let sameSubnetCandidates = [];
      if (isPublicSubnet1Target) {
        sameSubnetCandidates = PUBLIC_SUBNET1_WSS_RPC_NODES;
      } else if (isPublicSubnet2Target) {
        sameSubnetCandidates = PUBLIC_SUBNET2_WSS_RPC_NODES;
      } else {
        const matchingSub = SlxSubnetManager.listSubnets().find(
          (s) =>
            s.rpcUrl === wsUrl ||
            (Array.isArray(s.validatorNodes) && s.validatorNodes.some((v) => v.url === wsUrl))
        );
        if (matchingSub && Array.isArray(matchingSub.validatorNodes)) {
          sameSubnetCandidates = matchingSub.validatorNodes.map((v) => v.url).filter(Boolean);
        }
      }
      const fallbackNodes = sameSubnetCandidates.filter(
        (u) => u !== wsUrl && (_deadWsCooldownUntil.get(u) || 0) <= now
      );
      for (const cand of fallbackNodes) {
        try {
          const res = await sendSingleWsRpc(cand, method, params, Math.min(timeoutMs, 4500));
          _deadWsCooldownUntil.delete(cand);
          if (isPublicSubnet1Target) {
            _preferredPublicWssRpc = cand;
            SlxHfsCache.save({ rpcUrl: cand });
          } else if (isPublicSubnet2Target) {
            _preferredPublicSubnet2WssRpc = cand;
            SlxHfsCache.save({ rpcUrl: cand });
          }
          return res;
        } catch (candErr) {
          if (candErr?.isJsonRpcError) {
            if (isPublicSubnet1Target) {
              _preferredPublicWssRpc = cand;
            } else if (isPublicSubnet2Target) {
              _preferredPublicSubnet2WssRpc = cand;
            }
            throw candErr;
          }
          _deadWsCooldownUntil.set(cand, Date.now() + DEAD_WS_COOLDOWN_MS);
        }
      }
    }
    if (!String(endpointUrl || '').startsWith('http')) {
      throw primaryErr;
    }
  }

  const r = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) {
    const detail = j.error.data ? ` (${j.error.data})` : '';
    const rpcErr = new Error(
      j.error.message ? `${j.error.message}${detail}` : JSON.stringify(j.error)
    );
    rpcErr.isJsonRpcError = true;
    rpcErr.code = j.error.code;
    rpcErr.data = j.error.data;
    throw rpcErr;
  }
  return j.result;
}

/**
 * Per-EOA serialized nonce & intra-block `lowerBoundHashHex` pipelining manager.
 * Prevents nonce collisions when an app dispatches multiple concurrent transactions in the same round!
 */
export class SlxNonceQueue {
  constructor({ rpcUrlFn = () => getDefaultNodeWsUrl(), inFlightTtlMs = 22_000 } = {}) {
    this.rpcUrlFn = rpcUrlFn;
    this.inFlightTtlMs = inFlightTtlMs;
    this.nextNonceByAddr = new Map();
    this.inFlightByAddr = new Map();
    this.mutexByAddr = new Map();
  }

  reset(addrHex) {
    if (!addrHex) {
      this.nextNonceByAddr.clear();
      this.inFlightByAddr.clear();
      return;
    }
    const low = String(addrHex).toLowerCase();
    this.nextNonceByAddr.delete(low);
    this.inFlightByAddr.delete(low);
  }

  release(addrHex, nonceBig) {
    if (!addrHex) return;
    const low = String(addrHex).toLowerCase();
    this.inFlightByAddr.get(low)?.delete(BigInt(nonceBig));
  }

  async sendSigned({
    privateKey,
    to = null,
    data = '0x',
    gasLimit = 5_000_000n,
    gasPrice = 50_000_000_000n,
    chainId = 1337n,
    extraTargets = [],
    label = 'tx',
  }) {
    const senderAddr = computeAddress(privateKey);
    const key = senderAddr.toLowerCase();
    const prevLock = this.mutexByAddr.get(key) || Promise.resolve();

    let releaseLock;
    const nextLock = new Promise((r) => {
      releaseLock = r;
    });
    this.mutexByAddr.set(
      key,
      prevLock.catch(() => {}).then(() => nextLock)
    );

    await prevLock.catch(() => {});
    try {
      const rpcUrl = this.rpcUrlFn();
      const chainNonce = BigInt(
        await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [senderAddr, 'latest'])
      );
      let inFlight = this.inFlightByAddr.get(key);
      if (!inFlight) {
        inFlight = new Map();
        this.inFlightByAddr.set(key, inFlight);
      }
      const now = Date.now();
      for (const [n, entry] of inFlight.entries()) {
        if (n < chainNonce || now - entry.sentAt > this.inFlightTtlMs) {
          inFlight.delete(n);
        }
      }

      let localNext = this.nextNonceByAddr.get(key) ?? chainNonce;
      if (localNext < chainNonce) localNext = chainNonce;
      if (inFlight.size === 0 && localNext > chainNonce) localNext = chainNonce;

      const nonce = localNext;
      this.nextNonceByAddr.set(key, nonce + 1n);

      let lowerBoundHashHex = null;
      for (const [, entry] of inFlight.entries()) {
        if (!lowerBoundHashHex || entry.txHash > lowerBoundHashHex) {
          lowerBoundHashHex = entry.txHash;
        }
      }

      const signed = signOrderedLexiconTx({
        privateKey,
        nonce,
        to,
        data,
        gasLimit,
        gasPrice,
        chainId,
        extraTargets,
        lowerBoundHashHex,
      });

      const txHash = String(
        await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [signed.raw])
      ).toLowerCase();
      inFlight.set(nonce, { txHash, label, sentAt: Date.now() });

      return { txHash, rawTx: signed.raw, nonce, senderAddr };
    } finally {
      releaseLock();
    }
  }
}

/**
 * Deduplicating & Immutable HFS Read Memoizer (`SlxCallCache`).
 * - Coalesces identical concurrent `(to, dataHex)` `eth_call`s in flight.
 * - Optionally caches ephemeral reads by `blockNumber` or short `ttlMs`.
 * - Permanently memoizes immutable contract metadata (`symbol()`, `decimals()`, etc.)
 *   and terminal state objects (e.g. enacted/expired `Authorization` contracts) via `getOrComputeImmutable`.
 */
export class SlxCallCache {
  constructor({
    rpcUrlFn = () => getDefaultNodeWsUrl(),
    callFn = null,
    maxEntries = 512,
  } = {}) {
    this.rpcUrlFn = typeof rpcUrlFn === 'function' ? rpcUrlFn : () => String(rpcUrlFn || getDefaultNodeWsUrl());
    this.callFn = callFn;
    this.maxEntries = maxEntries;
    this._immutable = new Map();
    this._ephemeral = new Map();
    this._inFlight = new Map();
    this._frozenObjects = new Map();
  }

  _trimMap(map) {
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  _rawCall(to, dataHex) {
    if (typeof this.callFn === 'function') {
      return this.callFn(to, dataHex);
    }
    return slxNodeRpc(this.rpcUrlFn(), 'eth_call', [{ to, data: dataHex }, 'latest']);
  }

  async call(to, dataHex, { blockNumber = 0, ttlMs = 900, immutable = false } = {}) {
    const addr = String(to || '').toLowerCase();
    const data = String(dataHex || '0x').toLowerCase();
    const key = `${addr}:${data}`;

    if (this._immutable.has(key)) {
      return this._immutable.get(key);
    }

    if (!immutable) {
      const hit = this._ephemeral.get(key);
      if (hit) {
        const blockMatch = blockNumber > 0 && hit.blockNumber === blockNumber;
        const ttlMatch = blockNumber === 0 && ttlMs > 0 && Date.now() < hit.expiresAt;
        if (blockMatch || ttlMatch) return hit.value;
      }
    }

    if (this._inFlight.has(key)) {
      return this._inFlight.get(key);
    }

    const p = Promise.resolve()
      .then(() => this._rawCall(addr, dataHex))
      .then((res) => {
        if (immutable && res && res !== '0x') {
          this._immutable.set(key, res);
          this._trimMap(this._immutable);
        } else if (blockNumber > 0 || ttlMs > 0) {
          this._ephemeral.set(key, {
            value: res,
            blockNumber,
            expiresAt: Date.now() + Math.max(0, ttlMs),
          });
          this._trimMap(this._ephemeral);
        }
        return res;
      })
      .finally(() => {
        this._inFlight.delete(key);
      });

    this._inFlight.set(key, p);
    return p;
  }

  callImmutable(to, dataHex) {
    return this.call(to, dataHex, { immutable: true });
  }

  callAbiImmutable(to, sig, typedArgs = []) {
    return this.callImmutable(to, encodeAbi(sig, typedArgs));
  }

  async getOrComputeImmutable(cacheKey, computeFn, shouldFreezeFn = (v) => Boolean(v)) {
    const key = String(cacheKey || '');
    if (this._frozenObjects.has(key)) {
      return this._frozenObjects.get(key);
    }
    const val = await computeFn();
    if (shouldFreezeFn(val)) {
      this._frozenObjects.set(key, val);
      this._trimMap(this._frozenObjects);
    }
    return val;
  }

  hasFrozen(cacheKey) {
    return this._frozenObjects.has(String(cacheKey || ''));
  }

  getFrozen(cacheKey) {
    return this._frozenObjects.get(String(cacheKey || ''));
  }

  invalidateContract(addrHex) {
    const prefix = `${String(addrHex || '').toLowerCase()}:`;
    for (const k of this._ephemeral.keys()) {
      if (k.startsWith(prefix)) this._ephemeral.delete(k);
    }
  }

  clearEphemeral() {
    this._ephemeral.clear();
  }

  clearAll() {
    this._immutable.clear();
    this._ephemeral.clear();
    this._frozenObjects.clear();
  }
}

/**
 * High-level ergonomic SuperLexicon Client for building web apps, bots, and scripts in a few lines!
 *
 * Example:
 * ```js
 * const client = new SlxClient({ rpcUrl: 'wss://node1.superlexicon.com/rpc' });
 * const supplyHex = await client.callAbi(ledgerAddr, 'totalSupply()');
 * const watcher = client.watch({ filter: { address: dexAddr }, onLog: console.log });
 * ```
 */
export class SlxClient {
  constructor({ rpcUrl = getDefaultNodeWsUrl(), chainId = 1337n } = {}) {
    this.rpcUrl = rpcUrl;
    this.chainId = BigInt(chainId);
    this.nonceQueue = new SlxNonceQueue({ rpcUrlFn: () => this.rpcUrl });
    this.cache = new SlxCallCache({ rpcUrlFn: () => this.rpcUrl });
  }

  rpc(method, params = [], timeoutMs = 15000) {
    return slxNodeRpc(this.rpcUrl, method, params, timeoutMs);
  }

  async getBlockNumber() {
    const hex = await this.rpc('eth_blockNumber');
    return Number(BigInt(hex));
  }

  async getNonce(address) {
    const hex = await this.rpc('eth_getTransactionCount', [address, 'latest']);
    return BigInt(hex);
  }

  callRaw(to, dataHex, blockTag = 'latest') {
    return this.rpc('eth_call', [{ to, data: dataHex }, blockTag]);
  }

  callAbi(to, sig, typedArgs = [], blockTag = 'latest') {
    return this.callRaw(to, encodeAbi(sig, typedArgs), blockTag);
  }

  callCached(to, sig, typedArgs = [], opts = {}) {
    return this.cache.call(to, encodeAbi(sig, typedArgs), opts);
  }

  callImmutable(to, sig, typedArgs = []) {
    return this.cache.callAbiImmutable(to, sig, typedArgs);
  }

  waitForReceipt(txHash, opts = {}) {
    return slxWaitForReceipt((m, p) => this.rpc(m, p), txHash, opts);
  }

  async sendAndConfirm({
    privateKey,
    to = null,
    data = '0x',
    gasLimit = 5_000_000n,
    extraTargets = [],
    label = 'tx',
  }) {
    const sent = await this.nonceQueue.sendSigned({
      privateKey,
      to,
      data,
      gasLimit,
      chainId: this.chainId,
      extraTargets,
      label,
    });
    try {
      const receipt = await this.waitForReceipt(sent.txHash);
      if (!receipt) {
        throw new Error(`Timeout waiting for confirmation of ${label} (${sent.txHash})`);
      }
      if (receipt.status !== '0x1') {
        throw new Error(`Transaction reverted on-chain during ${label} (${sent.txHash})`);
      }
      return { ...sent, receipt };
    } finally {
      this.nonceQueue.release(sent.senderAddr, sent.nonce);
    }
  }

  /**
   * Store WASM HFS bytecode at `0x...0100` (if needed) and instantiate a fresh contract instance!
   */
  async deployHfsWasm({ privateKey, wasmBytes, skipStoreIfUploaded = false }) {
    const bytes = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    const codeHash = keccak256Hex(bytes);
    if (!skipStoreIfUploaded) {
      await this.sendAndConfirm({
        privateKey,
        to: BYTECODE_STORE_ADDRESS,
        data: codeHash + bytesToHex(bytes, false),
        gasLimit: 9_500_000n,
        label: 'storeBytecode',
      });
    }
    const inst = await this.sendAndConfirm({
      privateKey,
      to: null,
      data: codeHash,
      gasLimit: 4_500_000n,
      label: 'instantiateHfs',
    });
    return {
      codeHash,
      contractAddress: String(inst.receipt.contractAddress || '').toLowerCase(),
      receipt: inst.receipt,
    };
  }

  watch(opts = {}) {
    return slxWatchChainApp({
      rpcUrl: () => this.rpcUrl,
      ...opts,
    });
  }
}
