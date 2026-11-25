/**
 * @superlexicon/sdk/subnet-registry
 *
 * On-Chain Global Subnet & Validator Stats Endpoint Registry (`subnet_registry.wasm`, HPS #23).
 *
 * Stores all SuperLexicon subnets (`subnetId`, `name`, `transport`, `channelHz`, `validatorCount`,
 * signed `lat_e7` / `lon_e7`, target `hfsRegistry`, operator `Identity`, and structured public WSS
 * + LAN WS validator RPC/PubSub/Stats endpoints) directly on-chain so web clients and SDK consumers
 * never depend on external config servers or hardcoded `subnets.json` files.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  computeAddress,
  signOrderedLexiconTx,
} from './crypto.js';
import {
  ZERO_ADDR,
  readU16BE,
  readU32BE,
  readU64BE,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
} from './abi.js';
import { slxNodeRpc, getDefaultNodeWsUrl, SlxHfsCache, SlxSubnetManager } from './rpc.js';
import { slxWaitForReceipt } from './events.js';
import { fetchRegisteredHfsByType, SUBNET1_HFS_REGISTRY_ADDRESS } from './identity.js';

export const SUBNET_REGISTRY_CODE_HASH =
  '0x5365ed423586cdd689b264c188f9230b2ba4e1562d8d1a76f802e04ff6547e0f';

// Live deployed SubnetRegistry HFS instances on Subnet 1 & Subnet 2 (also discoverable via HfsRegistry "SUBNET_REGISTRY")
export let SUBNET1_SUBNET_REGISTRY_ADDRESS = '0xd7983d631634bb6d1dea4318a25dd413066ad5fc';
export let SUBNET2_SUBNET_REGISTRY_ADDRESS = '0x160c3cb57486da472efeb15f3f637cc7d6a3d58a';

export function setDefaultSubnetRegistryAddresses({ subnet1 = '', subnet2 = '' } = {}) {
  if (subnet1) SUBNET1_SUBNET_REGISTRY_ADDRESS = String(subnet1).toLowerCase();
  if (subnet2) SUBNET2_SUBNET_REGISTRY_ADDRESS = String(subnet2).toLowerCase();
}

const FIXED_REC_HDR = 102;
const MAX_ENDPOINTS_BYTES = 1536;

export const SUBNET_STATUS = Object.freeze({
  ACTIVE: 1,
  ARCHIVED: 2,
  FORMING: 3,
});

/**
 * Format an RF frequency in Hz (or TCP placeholder `1`) into a crisp human-readable label.
 */
export function formatChannelFrequencyHz(channelHz, transport = 'flrc') {
  const hz = Number(channelHz || 0);
  if (String(transport || '').toLowerCase() === 'tcp' || hz <= 1) {
    return 'Encrypted TCP/IP';
  }
  if (hz >= 1_000_000) {
    const mhz = hz / 1_000_000;
    const fixed = mhz % 1 === 0 ? mhz.toFixed(1) : mhz.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
    return `${fixed} MHz`;
  }
  if (hz >= 1_000) {
    return `${(hz / 1_000).toFixed(1)} kHz`;
  }
  return `${hz} Hz`;
}

/**
 * Round `(lat, lon)` to a neighborhood grid of `fuzzyMeters` (matching Rust `apply_gps_fuzzy_e7`)
 * so waiting operators can advertise approximate RF coverage without exposing exact home coordinates.
 */
export function applyGpsPrivacyRounding(lat, lon, fuzzyMeters = 0) {
  const rawLat = Math.max(-90, Math.min(90, Number(lat || 0)));
  const rawLon = Math.max(-180, Math.min(180, Number(lon || 0)));
  const fm = Math.max(0, Math.round(Number(fuzzyMeters || 0)));
  if (!fm || (rawLat === 0 && rawLon === 0)) {
    return { lat: rawLat, lon: rawLon };
  }
  const latE7 = Math.round(rawLat * 1e7);
  const lonE7 = Math.round(rawLon * 1e7);
  const latStepE7 = Math.max(1, Math.round(fm * (1e7 / 111_320.0)));
  const cosLat = Math.max(0.1, Math.abs(Math.cos((rawLat * Math.PI) / 180)));
  const lonStepE7 = Math.max(1, Math.round(fm * (1e7 / (111_320.0 * cosLat))));

  const roundGrid = (v, step) => {
    const half = Math.floor(step / 2);
    const shifted = v >= 0 ? v + half : v - half;
    return Math.trunc(shifted / step) * step;
  };
  return {
    lat: Math.max(-90, Math.min(90, roundGrid(latE7, latStepE7) / 1e7)),
    lon: Math.max(-180, Math.min(180, roundGrid(lonE7, lonStepE7) / 1e7)),
  };
}

export function degToE7UnsignedBits(deg) {
  const n = Number(deg || 0);
  const clamped = Math.max(-180, Math.min(180, Number.isFinite(n) ? n : 0));
  const i32 = Math.round(clamped * 1e7) | 0;
  return BigInt(i32 >>> 0);
}

export function readSignedI32BE(bytes, offset) {
  const u = readU32BE(bytes, offset);
  return u | 0;
}

export const SubnetRegistryAbi = {
  initialize(adminAddr) {
    return encodeAbi('initialize(address)', [['address', adminAddr]]);
  },

  rotateAdmin(nextAdminAddr) {
    return encodeAbi('rotateAdmin(address)', [['address', nextAdminAddr]]);
  },

  upsertSubnet({
    subnetId,
    name,
    transport = 'tcp',
    channelHz = 1,
    validatorCount = 3,
    lat = 0,
    lon = 0,
    hfsRegistry = ZERO_ADDR,
    operatorIdentity = ZERO_ADDR,
    endpoints = {},
  }) {
    const cleanSid = String(subnetId || '')
      .trim()
      .toLowerCase()
      .slice(0, 32);
    if (!cleanSid) throw new Error('subnetId is required');
    const cleanName = String(name || cleanSid).trim().slice(0, 80);
    const cleanTransport = String(transport || 'tcp')
      .trim()
      .toLowerCase()
      .slice(0, 16);

    const epBytes =
      endpoints instanceof Uint8Array
        ? endpoints
        : utf8ToBytes(typeof endpoints === 'string' ? endpoints : JSON.stringify(endpoints || {}));
    if (epBytes.length > MAX_ENDPOINTS_BYTES) {
      throw new Error(
        `Subnet endpoints payload (${epBytes.length}B) exceeds 1536B on-chain limit`
      );
    }

    return encodeAbi(
      'upsertSubnet(string,string,string,uint64,uint64,uint64,uint64,address,address,bytes)',
      [
        ['string', cleanSid],
        ['string', cleanName],
        ['string', cleanTransport],
        ['uint64', BigInt(Math.max(0, Math.round(Number(channelHz || 0))))],
        ['uint64', BigInt(Math.max(0, Math.round(Number(validatorCount || 0))))],
        ['uint64', degToE7UnsignedBits(lat)],
        ['uint64', degToE7UnsignedBits(lon)],
        ['address', hfsRegistry && /^0x[0-9a-fA-F]{40}$/.test(hfsRegistry) ? hfsRegistry : ZERO_ADDR],
        [
          'address',
          operatorIdentity && /^0x[0-9a-fA-F]{40}$/.test(operatorIdentity)
            ? operatorIdentity
            : ZERO_ADDR,
        ],
        ['bytes', epBytes],
      ]
    );
  },

  setSubnetStatus(subnetId, status = 1) {
    return encodeAbi('setSubnetStatus(string,uint64)', [
      ['string', String(subnetId || '').trim().toLowerCase()],
      ['uint64', BigInt(status)],
    ]);
  },

  transferSubnetOwnership(subnetId, newOwnerAddr) {
    return encodeAbi('transferSubnetOwnership(string,address)', [
      ['string', String(subnetId || '').trim().toLowerCase()],
      ['address', newOwnerAddr],
    ]);
  },

  getSubnets(offset = 0, limit = 16) {
    return encodeAbi('getSubnets(uint64,uint64)', [
      ['uint64', BigInt(offset)],
      ['uint64', BigInt(limit)],
    ]);
  },

  getSubnetById(subnetId) {
    return encodeAbi('getSubnetById(string)', [
      ['string', String(subnetId || '').trim().toLowerCase()],
    ]);
  },

  totalCount() {
    return encodeAbi('totalCount()');
  },

  admin() {
    return encodeAbi('admin()');
  },
};

function parseRecordAt(b, startPos) {
  if (startPos + 8 + FIXED_REC_HDR > b.length) return null;
  const entryIdx = readU64BE(b, startPos);
  const pos = startPos + 8;

  const status = b[pos];
  const sidLen = b[pos + 1];
  const nameLen = b[pos + 2];
  const trLen = b[pos + 3];
  const epLen = readU16BE(b, pos + 4);
  const validatorCount = readU32BE(b, pos + 6);
  const latE7 = readSignedI32BE(b, pos + 10);
  const lonE7 = readSignedI32BE(b, pos + 14);
  const channelHz = readU64BE(b, pos + 18);
  const createdBlock = readU64BE(b, pos + 26);
  const updatedBlock = readU64BE(b, pos + 34);
  const ownerEoa = bytesToHex(b.slice(pos + 42, pos + 62)).toLowerCase();
  const rawOpId = bytesToHex(b.slice(pos + 62, pos + 82)).toLowerCase();
  const operatorIdentity = /^0x0{40}$/.test(rawOpId) ? '' : rawOpId;
  const rawHfsReg = bytesToHex(b.slice(pos + 82, pos + 102)).toLowerCase();
  const hfsRegistry = /^0x0{40}$/.test(rawHfsReg) ? '' : rawHfsReg;

  const totalRecBytes = FIXED_REC_HDR + sidLen + nameLen + trLen + epLen;
  if (pos + totalRecBytes > b.length) return null;

  let cur = pos + FIXED_REC_HDR;
  const subnetId = bytesToUtf8(b.slice(cur, cur + sidLen));
  cur += sidLen;
  const name = bytesToUtf8(b.slice(cur, cur + nameLen));
  cur += nameLen;
  const transport = bytesToUtf8(b.slice(cur, cur + trLen));
  cur += trLen;
  const epRaw = bytesToUtf8(b.slice(cur, cur + epLen));
  cur += epLen;

  let endpoints = {};
  if (epRaw) {
    try {
      endpoints = JSON.parse(epRaw) || {};
    } catch (_) {
      endpoints = {};
    }
  }

  return {
    nextPos: cur,
    record: {
      entryIdx,
      status,
      subnetId,
      name,
      transport,
      validatorCount,
      channelHz,
      latE7,
      lonE7,
      lat: latE7 / 1e7,
      lon: lonE7 / 1e7,
      createdBlock,
      updatedBlock,
      ownerEoa,
      operatorIdentity,
      hfsRegistry,
      shortLabel: endpoints.shortLabel || '',
      locationLabel: endpoints.locationLabel || '',
      forming: status === SUBNET_STATUS.FORMING || Boolean(endpoints.forming),
      minValidators: Math.max(1, Number(endpoints.minValidators || 3)),
      haveValidators: Math.max(1, Number(endpoints.haveValidators || validatorCount || 1)),
      callingChannelHz: Number(endpoints.callingChannelHz || 0),
      fuzzyRadiusM: Math.max(0, Number(endpoints.fuzzyRadiusM || 0)),
      waitingNodePubkey: String(endpoints.waitingNodePubkey || ''),
      frequencyLabel: formatChannelFrequencyHz(channelHz, transport),
      manifestUrl: endpoints.manifestUrl || '',
      publicRpcUrls: Array.isArray(endpoints.publicRpcUrls) ? endpoints.publicRpcUrls : [],
      publicWsUrls: Array.isArray(endpoints.publicWsUrls) ? endpoints.publicWsUrls : [],
      lanRpcUrls: Array.isArray(endpoints.lanRpcUrls) ? endpoints.lanRpcUrls : [],
      lanWsUrls: Array.isArray(endpoints.lanWsUrls) ? endpoints.lanWsUrls : [],
      statsRpcUrls: Array.isArray(endpoints.statsRpcUrls)
        ? endpoints.statsRpcUrls
        : Array.isArray(endpoints.publicRpcUrls)
          ? endpoints.publicRpcUrls
          : [],
      lanStatsRpcUrls: Array.isArray(endpoints.lanStatsRpcUrls)
        ? endpoints.lanStatsRpcUrls
        : Array.isArray(endpoints.lanRpcUrls)
          ? endpoints.lanRpcUrls
          : [],
      validatorNodes: Array.isArray(endpoints.validatorNodes) ? endpoints.validatorNodes : [],
      contracts: endpoints.contracts && typeof endpoints.contracts === 'object' ? endpoints.contracts : {},
      endpoints,
    },
  };
}

export function decodeSubnetRegistrySliceHex(hex) {
  if (!hex || hex === '0x') return { totalCount: 0, items: [] };
  const b = hexToBytes(hex);
  if (b.length < 16) return { totalCount: 0, items: [] };

  const totalCount = readU64BE(b, 0);
  const returnedCount = readU64BE(b, 8);
  let pos = 16;
  const items = [];

  for (let i = 0; i < returnedCount && pos < b.length; i++) {
    const parsed = parseRecordAt(b, pos);
    if (!parsed) break;
    items.push(parsed.record);
    pos = parsed.nextPos;
  }
  return { totalCount, items };
}

export function decodeSingleSubnetHex(hex) {
  if (!hex || hex === '0x') return null;
  const b = hexToBytes(hex);
  if (b.length < 8 + FIXED_REC_HDR) return null;
  const parsed = parseRecordAt(b, 0);
  return parsed ? parsed.record : null;
}

const _resolvedRegByRpc = new Map();

export async function resolveSubnetRegistryAddress({
  rpcUrl = getDefaultNodeWsUrl(),
  registryAddr = '',
  hfsRegistryAddr = '',
} = {}) {
  if (registryAddr && /^0x[0-9a-fA-F]{40}$/.test(registryAddr)) {
    return registryAddr.toLowerCase();
  }
  const cacheKey = String(rpcUrl || '');
  if (_resolvedRegByRpc.has(cacheKey)) {
    return _resolvedRegByRpc.get(cacheKey);
  }

  // 1. Check synchronous HFS cache (`subnetRegistry`) if already saved
  try {
    const cached = SlxHfsCache.load();
    if (cached?.subnetRegistry && /^0x[0-9a-fA-F]{40}$/.test(cached.subnetRegistry)) {
      const addr = String(cached.subnetRegistry).toLowerCase();
      _resolvedRegByRpc.set(cacheKey, addr);
      return addr;
    }
  } catch (_) {}

  // 2. Check built-in Subnet 1 / Subnet 2 SubnetRegistry addresses
  const isS2Rpc =
    cacheKey.includes('node21.') ||
    cacheKey.includes('node22.') ||
    cacheKey.includes('node23.') ||
    cacheKey.includes(':18545');
  const candidate = isS2Rpc
    ? SUBNET2_SUBNET_REGISTRY_ADDRESS || SUBNET1_SUBNET_REGISTRY_ADDRESS
    : SUBNET1_SUBNET_REGISTRY_ADDRESS;
  if (candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate)) {
    _resolvedRegByRpc.set(cacheKey, candidate);
    return candidate;
  }

  // 3. Discover dynamically via on-chain `HfsRegistry` (`typeName = "SUBNET_REGISTRY"`)
  try {
    const instances = await fetchRegisteredHfsByType('SUBNET_REGISTRY', {
      rpcUrl,
      registryAddr: hfsRegistryAddr || SUBNET1_HFS_REGISTRY_ADDRESS,
    });
    if (instances.length > 0 && instances[0].primaryAddr) {
      const addr = instances[0].primaryAddr.toLowerCase();
      _resolvedRegByRpc.set(cacheKey, addr);
      return addr;
    }
  } catch (_) {}

  return '';
}

export async function fetchOnChainSubnets({
  rpcUrl = getDefaultNodeWsUrl(),
  registryAddr = '',
  includeArchived = false,
} = {}) {
  const reg = await resolveSubnetRegistryAddress({ rpcUrl, registryAddr });
  if (!reg) return { registryAddr: '', subnets: [] };

  const all = [];
  let offset = 0;
  let totalCount = Infinity;
  while (offset < totalCount && offset < 128) {
    const rawHex = await slxNodeRpc(
      rpcUrl,
      'eth_call',
      [{ to: reg, data: SubnetRegistryAbi.getSubnets(offset, 16) }, 'latest'],
      4000
    );
    const page = decodeSubnetRegistrySliceHex(rawHex);
    totalCount = page.totalCount || 0;
    if (!page.items.length) break;
    all.push(...page.items);
    offset += 16;
  }

  const subnets = includeArchived
    ? all
    : all.filter((s) => s.status === SUBNET_STATUS.ACTIVE || s.status === SUBNET_STATUS.FORMING);
  return { registryAddr: reg, subnets };
}

export async function fetchSubnetRegistryMeta({
  rpcUrl = getDefaultNodeWsUrl(),
  registryAddr = '',
} = {}) {
  const reg = await resolveSubnetRegistryAddress({ rpcUrl, registryAddr });
  if (!reg) return { registryAddr: '', admin: '', totalCount: 0 };
  const [adminHex, countHex] = await Promise.all([
    slxNodeRpc(rpcUrl, 'eth_call', [{ to: reg, data: SubnetRegistryAbi.admin() }, 'latest'], 3500).catch(
      () => '0x'
    ),
    slxNodeRpc(rpcUrl, 'eth_call', [{ to: reg, data: SubnetRegistryAbi.totalCount() }, 'latest'], 3500).catch(
      () => '0x0'
    ),
  ]);
  return {
    registryAddr: reg,
    admin: decodeAddrWord(adminHex),
    totalCount: Number(decodeUintWord(countHex)),
  };
}

/**
 * Register a new subnet or update an existing owned subnet directly on-chain in `SubnetRegistry` HFS ($0.00 gas).
 */
export async function upsertSubnetOnChain({
  wallet = null,
  privateKey = '',
  rpcUrl = getDefaultNodeWsUrl(),
  registryAddr = '',
  chainId = 1337n,
  subnet,
}) {
  const reg = await resolveSubnetRegistryAddress({ rpcUrl, registryAddr });
  if (!reg) throw new Error('SubnetRegistry HFS address not found on this subnet');

  const priv = privateKey || wallet?.keypair?.privateKey;
  if (!priv) throw new Error('Wallet or privateKey is required to sign upsertSubnet');
  const senderAddr = wallet?.keypair?.address || computeAddress(priv);

  let operatorIdentity = subnet?.operatorIdentity || ZERO_ADDR;
  if ((!operatorIdentity || operatorIdentity === ZERO_ADDR) && wallet) {
    const cachedId = wallet.getCachedIdentityRecord?.();
    if (cachedId?.identityAddr) {
      operatorIdentity = cachedId.identityAddr;
    }
  }

  const cd = SubnetRegistryAbi.upsertSubnet({
    ...subnet,
    operatorIdentity,
  });

  const nonce = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [senderAddr, 'latest']));
  const signed = signOrderedLexiconTx({
    privateKey: priv,
    nonce,
    to: reg,
    data: cd,
    gasLimit: 5_000_000n,
    chainId: BigInt(chainId),
    extraTargets: [reg],
  });

  const broadcastTargets = new Set([rpcUrl]);
  try {
    const activeProf = SlxSubnetManager?.getActiveSubnetProfile?.();
    if (activeProf && Array.isArray(activeProf.validatorNodes)) {
      for (const v of activeProf.validatorNodes) {
        if (v?.url) broadcastTargets.add(v.url);
      }
    }
  } catch (_) {}

  const sendResults = await Promise.allSettled(
    Array.from(broadcastTargets).map((u) => slxNodeRpc(u, 'eth_sendRawTransaction', [signed.raw], 5000))
  );
  const firstOk = sendResults.find((r) => r.status === 'fulfilled' && typeof r.value === 'string');
  const txHash = firstOk ? firstOk.value : signed.txHash;

  const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), txHash, {
    timeoutMs: 45_000,
    fallbackPollMs: 240,
  });
  if (!rcpt || rcpt.status !== '0x1') {
    throw new Error(`upsertSubnet reverted or timed out (${txHash})`);
  }

  if (wallet?.recordExternalRpcTx) {
    wallet.recordExternalRpcTx({
      txHash,
      rawTx: signed.raw,
      from: senderAddr,
      to: reg,
      contractLabel: 'SubnetRegistry HFS',
      fnLabel: `upsertSubnet(${subnet.subnetId}, "${subnet.name}")`,
      dataHex: cd,
      blockNumber: Number(BigInt(rcpt.blockNumber || 0)),
      nonce: Number(nonce),
    });
  }

  return { txHash, receipt: rcpt, registryAddr: reg };
}

/**
 * Convenience helper for a solo or partial node (`1/3` or `2/3`) waiting for peers (`--wait-for-peers`)
 * to advertise its privacy-rounded GPS coordinates & RF frequency on the Global Subnet World Map ($0.00 gas).
 */
export async function advertiseFormingNodeOnChain({
  wallet = null,
  privateKey = '',
  rpcUrl = getDefaultNodeWsUrl(),
  registryAddr = '',
  chainId = 1337n,
  beacon = {},
}) {
  const transport = beacon.transport === 'tcp' ? 'tcp' : 'flrc';
  const fuzzyRadiusM = Math.max(0, Math.round(Number(beacon.fuzzyRadiusM ?? 500)));
  const rounded = applyGpsPrivacyRounding(beacon.lat ?? 0, beacon.lon ?? 0, fuzzyRadiusM);
  const minValidators = Math.max(3, Math.round(Number(beacon.minValidators || 3)));
  const haveValidators = Math.max(1, Math.min(minValidators - 1, Math.round(Number(beacon.haveValidators || 1))));
  const channelHz =
    transport === 'tcp' ? 1 : Math.max(150_000_000, Math.round(Number(beacon.channelHz || 915_000_000)));
  const callingChannelHz = Math.max(0, Math.round(Number(beacon.callingChannelHz || 0)));
  const pubkey = String(beacon.waitingNodePubkey || '').trim();
  const autoSid =
    String(beacon.subnetId || '').trim() ||
    `wait-${pubkey ? pubkey.slice(0, 8).toLowerCase() : Date.now().toString(36).slice(-6)}`;

  return upsertSubnetOnChain({
    wallet,
    privateKey,
    rpcUrl,
    registryAddr,
    chainId,
    subnet: {
      subnetId: autoSid,
      name:
        String(beacon.name || '').trim() ||
        `Forming Mesh (${formatChannelFrequencyHz(channelHz, transport)})`,
      transport,
      channelHz,
      validatorCount: haveValidators,
      lat: rounded.lat,
      lon: rounded.lon,
      endpoints: {
        forming: true,
        minValidators,
        haveValidators,
        callingChannelHz,
        fuzzyRadiusM,
        waitingNodePubkey: pubkey,
        shortLabel: String(beacon.shortLabel || '').trim() || `FORMING ${haveValidators}/${minValidators}`,
        locationLabel: String(beacon.locationLabel || '').trim(),
        publicRpcUrls: Array.isArray(beacon.publicRpcUrls) ? beacon.publicRpcUrls : [],
        lanRpcUrls: Array.isArray(beacon.lanRpcUrls) ? beacon.lanRpcUrls : [],
      },
    },
  });
}

/**
 * Probe live block height & RTT latency across a subnet's on-chain registered stats/validator RPC URLs.
 */
export async function probeSubnetNodeStats(
  subnetProfile,
  {
    isHttps = typeof window !== 'undefined' &&
      (window.location?.protocol === 'https:' ||
        String(window.location?.hostname || '').toLowerCase().endsWith('superlexicon.com')),
    timeoutMs = 2600,
  } = {}
) {
  if (!subnetProfile) return { nodes: [], maxHeight: 0, onlineCount: 0, totalCount: 0, quorumMatched: false };

  let targets = [];
  if (Array.isArray(subnetProfile.validatorNodes) && subnetProfile.validatorNodes.length) {
    targets = subnetProfile.validatorNodes.map((v, idx) => ({
      name: v.name || `Validator #${idx + 1}`,
      url: isHttps ? v.url : v.lanUrl || v.url,
      pubkeyPrefix: v.pubkeyPrefix || null,
    }));
  } else {
    const urls = isHttps
      ? subnetProfile.statsRpcUrls?.length
        ? subnetProfile.statsRpcUrls
        : subnetProfile.publicRpcUrls || (subnetProfile.rpcUrl ? [subnetProfile.rpcUrl] : [])
      : subnetProfile.lanStatsRpcUrls?.length
        ? subnetProfile.lanStatsRpcUrls
        : subnetProfile.lanRpcUrls || (subnetProfile.rpcUrl ? [subnetProfile.rpcUrl] : []);
    targets = urls.map((u, idx) => ({
      name: `Node #${idx + 1} (${String(u).replace(/^wss?:\/\//, '')})`,
      url: u,
      pubkeyPrefix: null,
    }));
  }

  const results = await Promise.all(
    targets
      .filter((t) => Boolean(t.url))
      .map(async (t) => {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try {
          const blkHex = await slxNodeRpc(t.url, 'eth_blockNumber', [], timeoutMs);
          const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const h = typeof blkHex === 'string' && blkHex.startsWith('0x') ? Number.parseInt(blkHex, 16) : 0;
          return {
            name: t.name,
            url: t.url,
            pubkeyPrefix: t.pubkeyPrefix,
            online: h > 0,
            blockHeight: h,
            rttMs: Math.max(1, Math.round(t1 - t0)),
          };
        } catch (_) {
          return {
            name: t.name,
            url: t.url,
            pubkeyPrefix: t.pubkeyPrefix,
            online: false,
            blockHeight: 0,
            rttMs: 0,
          };
        }
      })
  );

  const onlineNodes = results.filter((r) => r.online);
  const maxHeight = onlineNodes.reduce((m, r) => Math.max(m, r.blockHeight), 0);
  const withinTip = onlineNodes.filter((r) => Math.abs(maxHeight - r.blockHeight) <= 1).length;

  return {
    nodes: results,
    maxHeight,
    onlineCount: onlineNodes.length,
    totalCount: results.length,
    quorumMatched: results.length > 0 && withinTip >= Math.ceil((results.length * 2) / 3),
  };
}
