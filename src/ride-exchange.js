/**
 * @superlexicon/sdk/ride-exchange
 *
 * Headless SDK for the Multi-Regime Discrete-Time All-Or-Nothing (AON) Ride Service Futures
 * Exchange Haltproof Subroutine (`ride_exchange.wasm`, Class II Multi-Parameter Matcher):
 *  - 6-Regime Singapore Metro geometry & statutory pass-through toll schedule
 *  - Exact integer planar road-distance calculator (`1.28x` tortuosity, matching `hps_sdk::spatial`)
 *  - Binary wire codecs for `getMetroOverview`, `getActiveBookSnapshot`, `getFuturesSlice`,
 *    `getActorState`, and `quoteTripPreview`
 *  - `RideExchangeClient` executing verified `Identity.execute(...)` order & futures settlement calls
 */

import {
  hexToBytes,
  bytesToHex,
  bytesToUtf8,
  computeAddress,
  eventTopic,
  signOrderedLexiconTx,
} from './crypto.js';
import {
  ZERO_ADDR,
  encodeAbi,
  decodeAbiBytesHex,
  decodeUintWord,
  readU16BE,
  readU32BE,
  readU64BE,
} from './abi.js';
import { getDefaultNodeWsUrl, SlxHfsCache, slxNodeRpc } from './rpc.js';
import { slxWaitForReceipt } from './events.js';
import { fetchRegisteredHfsByType } from './identity.js';

export const RIDE_EXCHANGE_CODE_HASH =
  '0xd92f9b0e1577d5fbe1d79970de65850d8e09911c0f0830d54c3786ad949f0ebc';

export const RIDE_ORDER_STATUS = Object.freeze({
  PENDING: 0,
  ACTIVE: 1,
  MATCHED: 2,
  CANCELLED: 3,
});

export const RIDE_FUTURES_STATUS = Object.freeze({
  MATCHED: 1,
  IN_PROGRESS: 2,
  SETTLED: 3,
  CANCELLED: 4,
});

export const RIDE_MAKER_SIDE = Object.freeze({
  RIDER: 1,
  DRIVER: 2,
});

export const RIDE_EXCHANGE_TOPICS = Object.freeze({
  METRO_INITIALIZED: eventTopic('RideExchangeInitialized(address,address,address)'),
  DRIVER_ASK_POSTED: eventTopic('DriverAskPosted(uint64,address,uint64,uint64,uint64)'),
  DRIVER_LOC_UPDATED: eventTopic('DriverLocationUpdated(uint64,address,uint64,uint64)'),
  RIDER_BID_POSTED: eventTopic('RiderBidPosted(uint64,address,uint64,uint64,uint64)'),
  ORDER_CANCELLED: eventTopic('RideOrderCancelled(uint64,address,uint64)'),
  RIDE_MATCHED: eventTopic('RideFuturesMatched(uint64,address,address,uint64,uint64)'),
  RIDE_PICKUP: eventTopic('RidePickupConfirmed(uint64,address,uint64)'),
  RIDE_COMPLETED: eventTopic('RideFuturesSettled(uint64,address,address,uint64)'),
  RIDE_CANCELLED: eventTopic('RideFuturesCancelled(uint64,address,uint64,uint64)'),
  BLOCK_MATCHED: eventTopic('RideBlockMatched(uint64,uint64,uint64,uint64)'),
});

export const SG_COS_LAT_BPS = 9997;
export const SG_ROAD_FACTOR_BPS = 12800;

export const SG_REGIMES = Object.freeze([
  {
    id: 0,
    code: 'CBD',
    name: 'CBD & Marina Bay',
    shortLabel: 'CBD · ERP',
    icon: '🏙️',
    color: '#f59e0b',
    tollNote: '+$3.00 ERP Gantry Pass-Through',
    center: { lat: 1.2834, lon: 103.8545 },
    box: { minLat: 1.268, maxLat: 1.298, minLon: 103.838, maxLon: 103.868 },
  },
  {
    id: 1,
    code: 'FRG',
    name: 'City Fringe & Orchard',
    shortLabel: 'City Fringe',
    icon: '🛍️',
    color: '#38bdf8',
    tollNote: 'Standard Clean-Rate Zone ($0 Toll)',
    center: { lat: 1.3048, lon: 103.8318 },
    box: { minLat: 1.27, maxLat: 1.328, minLon: 103.782, maxLon: 103.888 },
  },
  {
    id: 2,
    code: 'CHG',
    name: 'Changi Airport & East',
    shortLabel: 'Changi · East',
    icon: '✈️',
    color: '#10b981',
    tollNote: '+$4.00 Airport Pickup Surcharge',
    center: { lat: 1.345, lon: 103.955 },
    box: { minLat: 1.298, maxLat: 1.395, minLon: 103.892, maxLon: 104.03 },
  },
  {
    id: 3,
    code: 'REM',
    name: 'Tuas & Sentosa Remote',
    shortLabel: 'Remote · Basis',
    icon: '⚓',
    color: '#f43f5e',
    tollNote: '+$4.00 Gate + Driver Remote Basis $/km',
    center: { lat: 1.295, lon: 103.642 },
    box: { minLat: 1.235, maxLat: 1.36, minLon: 103.61, maxLon: 103.688 },
  },
  {
    id: 4,
    code: 'JRG',
    name: 'Jurong & West Hub',
    shortLabel: 'Jurong · West',
    icon: '🏭',
    color: '#a855f7',
    tollNote: 'Standard Clean-Rate Zone ($0 Toll)',
    center: { lat: 1.3329, lon: 103.7436 },
    box: { minLat: 1.295, maxLat: 1.395, minLon: 103.688, maxLon: 103.782 },
  },
  {
    id: 5,
    code: 'HRT',
    name: 'Heartland North & NE',
    shortLabel: 'Heartland N/NE',
    icon: '🌳',
    color: '#22d3ee',
    tollNote: 'Standard Clean-Rate Zone ($0 Toll)',
    center: { lat: 1.368, lon: 103.852 },
    box: { minLat: 1.328, maxLat: 1.445, minLon: 103.75, maxLon: 103.92 },
  },
]);

export const SG_LANDMARKS = Object.freeze([
  { id: 'mbs', label: 'Marina Bay Sands', regime: 0, lat: 1.2834, lon: 103.8607 },
  { id: 'raffles', label: 'Raffles Place MRT', regime: 0, lat: 1.284, lon: 103.8513 },
  { id: 'tanjong', label: 'Tanjong Pagar Guoco', regime: 0, lat: 1.2764, lon: 103.846 },
  { id: 'orchard', label: 'ION Orchard', regime: 1, lat: 1.304, lon: 103.8318 },
  { id: 'bugis', label: 'Bugis Junction', regime: 1, lat: 1.2993, lon: 103.8555 },
  { id: 'onenorth', label: 'One-North / Fusionopolis', regime: 1, lat: 1.2996, lon: 103.7874 },
  { id: 'novena', label: 'Novena Square', regime: 1, lat: 1.3204, lon: 103.8438 },
  { id: 'changi_t3', label: 'Changi Airport T3', regime: 2, lat: 1.3562, lon: 103.9885 },
  { id: 'tampines', label: 'Tampines Regional Hub', regime: 2, lat: 1.3533, lon: 103.9452 },
  { id: 'marine_cresc', label: 'Marine Crescent RF Mesh', regime: 2, lat: 1.3031, lon: 103.9128 },
  { id: 'sentosa', label: 'Sentosa Cove / RWS', regime: 3, lat: 1.2541, lon: 103.8231 },
  { id: 'tuas_port', label: 'Tuas South Mega Port', regime: 3, lat: 1.295, lon: 103.636 },
  { id: 'jurong_jem', label: 'Jurong East JEM', regime: 4, lat: 1.3329, lon: 103.7436 },
  { id: 'clementi', label: 'Clementi Mall / NUS West', regime: 4, lat: 1.3151, lon: 103.7649 },
  { id: 'bishan', label: 'Bishan Junction 8', regime: 5, lat: 1.3508, lon: 103.8485 },
  { id: 'serangoon', label: 'Serangoon NEX', regime: 5, lat: 1.3507, lon: 103.8722 },
  { id: 'punggol', label: 'Punggol Digital District', regime: 5, lat: 1.4085, lon: 103.9065 },
  { id: 'woodlands', label: 'Woodlands Civic Centre', regime: 5, lat: 1.436, lon: 103.7865 },
]);

/** Convert decimal degrees -> unsigned 32-bit two's-complement `BigInt` for `uint64` ABI words. */
export function degToMicrodegU64(deg) {
  const e6 = Math.round(Number(deg) * 1_000_000) | 0;
  return BigInt(e6 >>> 0);
}

export function readSignedI32(bytes, offset) {
  const u = readU32BE(bytes, offset);
  return u >= 0x80000000 ? u - 0x100000000 : u;
}

/** Exact JS mirror of `hps_sdk::spatial::singapore::classify_sg_regime`. */
export function classifySgRegime(lat, lon) {
  const la = Math.round(Number(lat) * 1_000_000);
  const lo = Math.round(Number(lon) * 1_000_000);
  const inBox = (minLa, maxLa, minLo, maxLo) =>
    la >= minLa && la <= maxLa && lo >= minLo && lo <= maxLo;

  if (
    inBox(1_235_000, 1_266_500, 103_805_000, 103_842_000) ||
    inBox(1_200_000, 1_360_000, 103_600_000, 103_688_000) ||
    inBox(1_395_000, 1_460_000, 103_660_000, 103_745_000)
  ) {
    return 3; // REMOTE
  }
  if (inBox(1_268_000, 1_298_000, 103_838_000, 103_868_000)) return 0; // CBD
  if (inBox(1_298_000, 1_395_000, 103_892_000, 104_030_000)) return 2; // CHANGI_EAST
  if (inBox(1_270_000, 1_328_000, 103_782_000, 103_888_000)) return 1; // FRINGE
  if (inBox(1_295_000, 1_395_000, 103_688_001, 103_781_999)) return 4; // JURONG_WEST
  return 5; // HEARTLAND
}

function bigIntIsqrt(n) {
  if (n <= 0n) return 0n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/** Exact JS mirror of `hps_sdk::spatial::road_distance_m` (zero drift against on-chain `trip_m`!). */
export function computeRoadDistanceM(
  latA,
  lonA,
  latB,
  lonB,
  cosLatBps = SG_COS_LAT_BPS,
  roadFactorBps = SG_ROAD_FACTOR_BPS
) {
  const aLa = BigInt(Math.round(Number(latA) * 1_000_000));
  const aLo = BigInt(Math.round(Number(lonA) * 1_000_000));
  const bLa = BigInt(Math.round(Number(latB) * 1_000_000));
  const bLo = BigInt(Math.round(Number(lonB) * 1_000_000));
  if (aLa === bLa && aLo === bLo) return 0;

  const dlat = aLa >= bLa ? aLa - bLa : bLa - aLa;
  const dlon = aLo >= bLo ? aLo - bLo : bLo - aLo;

  const dyUm = dlat * 111_132n;
  const dxUm = (dlon * 111_320n * BigInt(cosLatBps)) / 10_000n;
  const distUm = bigIntIsqrt(dxUm * dxUm + dyUm * dyUm);
  const straightM = (distUm + 500_000n) / 1_000_000n;
  const scaled = (straightM * BigInt(roadFactorBps) + 5_000n) / 10_000n;
  return Number(scaled < 100n ? 100n : scaled);
}

export function computeTripFareCeilCents(ratePerKmCents, tripM) {
  const r = BigInt(Math.max(0, Math.floor(Number(ratePerKmCents) || 0)));
  const m = BigInt(Math.max(0, Math.floor(Number(tripM) || 0)));
  if (r === 0n || m === 0n) return 0;
  return Number((r * m + 999n) / 1000n);
}

export function computeDefaultSgTollCents(origRegime, destRegime) {
  let toll = 0;
  if (origRegime === 0 || destRegime === 0) toll += 300;
  if (origRegime === 2) toll += 400;
  if (origRegime === 3 || destRegime === 3) toll += 400;
  return toll;
}

export const RideExchangeAbi = Object.freeze({
  initialize: (
    registry,
    quoteLedger,
    escrowIdentity,
    metroName = 'Singapore Metro',
    cosLatBps = SG_COS_LAT_BPS,
    roadFactorBps = SG_ROAD_FACTOR_BPS
  ) =>
    encodeAbi('initialize(address,address,address,string,uint64,uint64)', [
      ['address', registry],
      ['address', quoteLedger],
      ['address', escrowIdentity],
      ['string', metroName],
      ['uint64', BigInt(cosLatBps)],
      ['uint64', BigInt(roadFactorBps)],
    ]),
  setToll: (origRegime, destRegime, cents) =>
    encodeAbi('setToll(uint64,uint64,uint64)', [
      ['uint64', BigInt(origRegime)],
      ['uint64', BigInt(destRegime)],
      ['uint64', BigInt(cents)],
    ]),
  claimDemoMargin: () => encodeAbi('claimDemoMargin()', []),
  upsertDriverAsk: ({
    lat,
    lon,
    askPerKmCents,
    maxDistanceM,
    maxPickupM,
    destMask = 0x3f,
    remoteBasisCents = 40,
    crossBorder = true,
  }) =>
    encodeAbi('upsertDriverAsk(uint64,uint64,uint64,uint64,uint64,uint64,uint64,bool)', [
      ['uint64', degToMicrodegU64(lat)],
      ['uint64', degToMicrodegU64(lon)],
      ['uint64', BigInt(Math.round(askPerKmCents))],
      ['uint64', BigInt(Math.round(maxDistanceM))],
      ['uint64', BigInt(Math.round(maxPickupM))],
      ['uint64', BigInt(destMask & 0x3f)],
      ['uint64', BigInt(Math.round(remoteBasisCents))],
      ['bool', Boolean(crossBorder)],
    ]),
  updateDriverLocation: (lat, lon) =>
    encodeAbi('updateDriverLocation(uint64,uint64)', [
      ['uint64', degToMicrodegU64(lat)],
      ['uint64', degToMicrodegU64(lon)],
    ]),
  cancelDriverAsk: () => encodeAbi('cancelDriverAsk()', []),
  postRiderBid: ({ fromLat, fromLon, toLat, toLon, bidPerKmCents, maxPickupM }) =>
    encodeAbi('postRiderBid(uint64,uint64,uint64,uint64,uint64,uint64)', [
      ['uint64', degToMicrodegU64(fromLat)],
      ['uint64', degToMicrodegU64(fromLon)],
      ['uint64', degToMicrodegU64(toLat)],
      ['uint64', degToMicrodegU64(toLon)],
      ['uint64', BigInt(Math.round(bidPerKmCents))],
      ['uint64', BigInt(Math.round(maxPickupM))],
    ]),
  cancelRiderBid: (orderId = 0) =>
    encodeAbi('cancelRiderBid(uint64)', [['uint64', BigInt(orderId)]]),
  matchBlock: () => encodeAbi('matchBlock()', []),
  confirmPickup: (futuresId) =>
    encodeAbi('confirmPickup(uint64)', [['uint64', BigInt(futuresId)]]),
  completeRide: (futuresId) =>
    encodeAbi('completeRide(uint64)', [['uint64', BigInt(futuresId)]]),
  cancelRideFutures: (futuresId) =>
    encodeAbi('cancelRideFutures(uint64)', [['uint64', BigInt(futuresId)]]),
  getMetroOverview: () => encodeAbi('getMetroOverview()', []),
  getActiveBookSnapshot: () => encodeAbi('getActiveBookSnapshot()', []),
  getFuturesSlice: (offset = 0, limit = 32) =>
    encodeAbi('getFuturesSlice(uint64,uint64)', [
      ['uint64', BigInt(offset)],
      ['uint64', BigInt(limit)],
    ]),
  getFutures: (futuresId) =>
    encodeAbi('getFutures(uint64)', [['uint64', BigInt(futuresId)]]),
  getActorState: (identityAddr) =>
    encodeAbi('getActorState(address)', [['address', identityAddr]]),
  quoteTripPreview: (fromLat, fromLon, toLat, toLon) =>
    encodeAbi('quoteTripPreview(uint64,uint64,uint64,uint64)', [
      ['uint64', degToMicrodegU64(fromLat)],
      ['uint64', degToMicrodegU64(fromLon)],
      ['uint64', degToMicrodegU64(toLat)],
      ['uint64', degToMicrodegU64(toLon)],
    ]),
  identityExecute: (targetHps, innerCalldataHex) =>
    encodeAbi('execute(address,bytes)', [
      ['address', targetHps],
      ['bytes', typeof innerCalldataHex === 'string' ? hexToBytes(innerCalldataHex) : innerCalldataHex],
    ]),
});

export function decodeMetroOverviewHex(hex) {
  const b = decodeAbiBytesHex(hex);
  if (!b || b.length < 647) return null;

  const registry = bytesToHex(b.subarray(0, 20)).toLowerCase();
  const quoteLedger = bytesToHex(b.subarray(20, 40)).toLowerCase();
  const escrowIdentity = bytesToHex(b.subarray(40, 60)).toLowerCase();
  const lockedEscrowCents = Number(readU64BE(b, 60));
  const totalOrders = Number(readU64BE(b, 68));
  const totalFutures = Number(readU64BE(b, 76));
  const settledFuturesCount = Number(readU64BE(b, 84));
  const settledVolumeCents = Number(readU64BE(b, 92));
  const lastMatchedBlock = Number(readU64BE(b, 100));
  const cosLatBps = readU32BE(b, 108);
  const roadFactorBps = readU32BE(b, 112);
  const regimeCount = b[116];
  const nameLen = readU16BE(b, 117);

  let off = 119;
  const regimes = [];
  for (let z = 0; z < regimeCount; z += 1) {
    regimes.push({
      regimeId: b[off],
      bidCount: readU16BE(b, off + 1),
      askCount: readU16BE(b, off + 3),
      pendingCount: readU16BE(b, off + 5),
      bestBidPerKmCents: Number(readU64BE(b, off + 8)),
      bestAskPerKmCents: Number(readU64BE(b, off + 16)),
      lastClearingPerKmCents: Number(readU64BE(b, off + 24)),
      matchedRides: Number(readU64BE(b, off + 32)),
    });
    off += 40;
  }

  const tollMatrix = [];
  for (let o = 0; o < regimeCount; o += 1) {
    const row = [];
    for (let d = 0; d < regimeCount; d += 1) {
      row.push(Number(readU64BE(b, off)));
      off += 8;
    }
    tollMatrix.push(row);
  }

  const metroName =
    nameLen > 0 && off + nameLen <= b.length
      ? bytesToUtf8(b.subarray(off, off + nameLen))
      : 'Singapore Metro';

  return {
    metroName,
    registry,
    quoteLedger,
    escrowIdentity,
    lockedEscrowCents,
    totalOrders,
    totalFutures,
    settledFuturesCount,
    settledVolumeCents,
    lastMatchedBlock,
    cosLatBps,
    roadFactorBps,
    regimes,
    tollMatrix,
  };
}

export function decodeActiveBookSnapshotHex(hex) {
  const b = decodeAbiBytesHex(hex);
  if (!b || b.length < 4) return { asks: [], bids: [] };

  const askCount = readU16BE(b, 0);
  const bidCount = readU16BE(b, 2);
  let off = 4;

  const asks = [];
  for (let i = 0; i < askCount && off + 84 <= b.length; i += 1) {
    asks.push({
      orderId: Number(readU64BE(b, off)),
      driverIdentity: bytesToHex(b.subarray(off + 8, off + 28)).toLowerCase(),
      status: b[off + 28],
      regime: b[off + 29],
      crossBorder: b[off + 30] === 1,
      lat: readSignedI32(b, off + 32) / 1_000_000,
      lon: readSignedI32(b, off + 36) / 1_000_000,
      askPerKmCents: Number(readU64BE(b, off + 40)),
      maxDistanceM: Number(readU64BE(b, off + 48)),
      maxPickupM: Number(readU64BE(b, off + 56)),
      remoteBasisCents: Number(readU64BE(b, off + 64)),
      destMask: readU32BE(b, off + 72),
      seniorityBlock: Number(readU64BE(b, off + 76)),
    });
    off += 84;
  }

  const bids = [];
  for (let i = 0; i < bidCount && off + 96 <= b.length; i += 1) {
    bids.push({
      orderId: Number(readU64BE(b, off)),
      riderIdentity: bytesToHex(b.subarray(off + 8, off + 28)).toLowerCase(),
      status: b[off + 28],
      origRegime: b[off + 29],
      destRegime: b[off + 30],
      fromLat: readSignedI32(b, off + 32) / 1_000_000,
      fromLon: readSignedI32(b, off + 36) / 1_000_000,
      toLat: readSignedI32(b, off + 40) / 1_000_000,
      toLon: readSignedI32(b, off + 44) / 1_000_000,
      tripM: Number(readU64BE(b, off + 48)),
      bidPerKmCents: Number(readU64BE(b, off + 56)),
      maxPickupM: Number(readU64BE(b, off + 64)),
      escrowedCents: Number(readU64BE(b, off + 72)),
      tollCents: Number(readU64BE(b, off + 80)),
      seniorityBlock: Number(readU64BE(b, off + 88)),
    });
    off += 96;
  }

  return { asks, bids };
}

function decodeFuturesRecordAt(b, off) {
  const cleanFareCents = Number(readU64BE(b, off + 116));
  const tollCents = Number(readU64BE(b, off + 124));
  return {
    futuresId: Number(readU64BE(b, off)),
    bidOrderId: Number(readU64BE(b, off + 8)),
    askOrderId: Number(readU64BE(b, off + 16)),
    riderIdentity: bytesToHex(b.subarray(off + 24, off + 44)).toLowerCase(),
    driverIdentity: bytesToHex(b.subarray(off + 44, off + 64)).toLowerCase(),
    status: b[off + 64],
    origRegime: b[off + 65],
    destRegime: b[off + 66],
    makerSide: b[off + 67],
    driverStartLat: readSignedI32(b, off + 68) / 1_000_000,
    driverStartLon: readSignedI32(b, off + 72) / 1_000_000,
    fromLat: readSignedI32(b, off + 76) / 1_000_000,
    fromLon: readSignedI32(b, off + 80) / 1_000_000,
    toLat: readSignedI32(b, off + 84) / 1_000_000,
    toLon: readSignedI32(b, off + 88) / 1_000_000,
    pickupM: Number(readU64BE(b, off + 92)),
    tripM: Number(readU64BE(b, off + 100)),
    clearingRateCents: Number(readU64BE(b, off + 108)),
    cleanFareCents,
    tollCents,
    totalCents: cleanFareCents + tollCents,
    matchedBlock: Number(readU64BE(b, off + 132)),
    settledBlock: Number(readU64BE(b, off + 140)),
  };
}

export function decodeFuturesSliceHex(hex) {
  const b = decodeAbiBytesHex(hex);
  if (!b || b.length < 10) return { totalFutures: 0, items: [] };
  const totalFutures = Number(readU64BE(b, 0));
  const count = readU16BE(b, 8);
  let off = 10;
  const items = [];
  for (let i = 0; i < count && off + 148 <= b.length; i += 1) {
    items.push(decodeFuturesRecordAt(b, off));
    off += 148;
  }
  return { totalFutures, items };
}

export function decodeActorStateHex(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  if (clean.length < 384) {
    return {
      activeAskId: 0,
      activeBidId: 0,
      activeDriverFuturesId: 0,
      activeRiderFuturesId: 0,
      completedRides: 0,
      driverEarnedCents: 0,
    };
  }
  const word = (idx) => decodeUintWord('0x' + clean.slice(idx * 64, (idx + 1) * 64));
  return {
    activeAskId: word(0),
    activeBidId: word(1),
    activeDriverFuturesId: word(2),
    activeRiderFuturesId: word(3),
    completedRides: word(4),
    driverEarnedCents: word(5),
  };
}

export class RideExchangeClient {
  constructor({ rpcUrlFn = () => getDefaultNodeWsUrl(), exchangeAddr = '' } = {}) {
    this.rpcUrlFn = rpcUrlFn;
    this.exchangeAddr = String(exchangeAddr || '').toLowerCase();
    this.overview = null;
  }

  async resolveAddress() {
    if (this.exchangeAddr && this.exchangeAddr !== ZERO_ADDR) return this.exchangeAddr;
    const { manifest } = await SlxHfsCache.hydrateWithManifest();
    const fromManifest = String(manifest?.rideExchange?.contractAddr || '').toLowerCase();
    if (fromManifest && fromManifest !== ZERO_ADDR) {
      this.exchangeAddr = fromManifest;
      return this.exchangeAddr;
    }
    const found = await fetchRegisteredHfsByType('RIDE_EXCHANGE', { rpcUrl: this.rpcUrlFn() });
    if (found.length > 0) {
      this.exchangeAddr = found[0].primaryAddr.toLowerCase();
      return this.exchangeAddr;
    }
    return '';
  }

  async fetchFullState(myIdentityAddr = '') {
    const addr = await this.resolveAddress();
    if (!addr) return null;
    const rpc = this.rpcUrlFn();

    const calls = [
      slxNodeRpc(rpc, 'eth_call', [{ to: addr, data: RideExchangeAbi.getMetroOverview() }, 'latest']),
      slxNodeRpc(rpc, 'eth_call', [{ to: addr, data: RideExchangeAbi.getActiveBookSnapshot() }, 'latest']),
      slxNodeRpc(rpc, 'eth_call', [{ to: addr, data: RideExchangeAbi.getFuturesSlice(0, 32) }, 'latest']),
    ];

    if (myIdentityAddr && myIdentityAddr !== ZERO_ADDR) {
      calls.push(
        slxNodeRpc(rpc, 'eth_call', [{ to: addr, data: RideExchangeAbi.getActorState(myIdentityAddr) }, 'latest'])
      );
    }

    const [ovHex, bookHex, futHex, actorHex] = await Promise.all(calls);
    const overview = decodeMetroOverviewHex(ovHex);
    this.overview = overview;
    const book = decodeActiveBookSnapshotHex(bookHex);
    const futures = decodeFuturesSliceHex(futHex);
    const actor = actorHex ? decodeActorStateHex(actorHex) : decodeActorStateHex('');

    let myBalanceCents = 0;
    let escrowPoolBalanceCents = 0;
    if (overview?.quoteLedger && overview.quoteLedger !== ZERO_ADDR) {
      const balCalls = [
        slxNodeRpc(rpc, 'eth_call', [
          { to: overview.quoteLedger, data: encodeAbi('balanceOf(address)', [['address', overview.escrowIdentity]]) },
          'latest',
        ]),
      ];
      if (myIdentityAddr && myIdentityAddr !== ZERO_ADDR) {
        balCalls.push(
          slxNodeRpc(rpc, 'eth_call', [
            { to: overview.quoteLedger, data: encodeAbi('balanceOf(address)', [['address', myIdentityAddr]]) },
            'latest',
          ])
        );
      }
      const [escBalHex, myBalHex] = await Promise.all(balCalls);
      escrowPoolBalanceCents = decodeUintWord(escBalHex);
      if (myBalHex) myBalanceCents = decodeUintWord(myBalHex);
    }

    return {
      exchangeAddr: addr,
      overview,
      asks: book.asks,
      bids: book.bids,
      futures: futures.items,
      totalFutures: futures.totalFutures,
      actor,
      myBalanceCents,
      faucetReserveCents: Math.max(0, escrowPoolBalanceCents - (overview?.lockedEscrowCents || 0)),
    };
  }

  async executeViaIdentity(wallet, innerCalldataHex, { extraIdentityTargets = [], gasLimit = 6_000_000n } = {}) {
    const rpc = this.rpcUrlFn();
    const addr = await this.resolveAddress();
    if (!addr) throw new Error('RideExchange HFS address not resolved');
    if (!this.overview) {
      const ovHex = await slxNodeRpc(rpc, 'eth_call', [
        { to: addr, data: RideExchangeAbi.getMetroOverview() },
        'latest',
      ]);
      this.overview = decodeMetroOverviewHex(ovHex);
    }

    const idRec = await wallet.ensureIdentityWithPrompt({
      rpcUrl: rpc,
      appName: 'TransitDEX Ride Futures',
    });
    const myId = idRec.identityAddr.toLowerCase();
    const myPriv = wallet.keypair.privateKey;
    const myEoa = computeAddress(myPriv);
    const nonce = BigInt(await slxNodeRpc(rpc, 'eth_getTransactionCount', [myEoa, 'latest']));

    const targets = [
      myId,
      addr,
      this.overview?.registry,
      this.overview?.quoteLedger,
      this.overview?.escrowIdentity,
      ...extraIdentityTargets,
    ].filter((x) => x && x !== ZERO_ADDR);

    const signed = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: myId,
      data: RideExchangeAbi.identityExecute(addr, innerCalldataHex),
      gasLimit,
      extraTargets: targets,
    });

    const txHash = await slxNodeRpc(rpc, 'eth_sendRawTransaction', [signed.raw]);
    const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(rpc, m, p), txHash, {
      timeoutMs: 35_000,
      fallbackPollMs: 350,
    });
    if (!rcpt || rcpt.status !== '0x1') {
      throw new Error(`RideExchange transaction reverted (${txHash.slice(0, 12)}…)`);
    }
    return { txHash, receipt: rcpt, identityAddr: myId };
  }

  async triggerMatchBlock(wallet) {
    const rpc = this.rpcUrlFn();
    const addr = await this.resolveAddress();
    if (!addr) throw new Error('RideExchange HFS address not resolved');
    if (!this.overview) {
      const ovHex = await slxNodeRpc(rpc, 'eth_call', [
        { to: addr, data: RideExchangeAbi.getMetroOverview() },
        'latest',
      ]);
      this.overview = decodeMetroOverviewHex(ovHex);
    }
    const myPriv = wallet.keypair.privateKey;
    const myEoa = computeAddress(myPriv);
    const nonce = BigInt(await slxNodeRpc(rpc, 'eth_getTransactionCount', [myEoa, 'latest']));

    const targets = [
      addr,
      this.overview?.registry,
      this.overview?.quoteLedger,
      this.overview?.escrowIdentity,
    ].filter((x) => x && x !== ZERO_ADDR);

    const signed = signOrderedLexiconTx({
      privateKey: myPriv,
      nonce,
      to: addr,
      data: RideExchangeAbi.matchBlock(),
      gasLimit: 7_500_000n,
      extraTargets: targets,
    });

    const txHash = await slxNodeRpc(rpc, 'eth_sendRawTransaction', [signed.raw]);
    const rcpt = await slxWaitForReceipt((m, p) => slxNodeRpc(rpc, m, p), txHash, {
      timeoutMs: 35_000,
      fallbackPollMs: 350,
    });
    if (!rcpt || rcpt.status !== '0x1') {
      throw new Error(`matchBlock reverted (already matched in current block or no crossing orders)`);
    }
    return { txHash, receipt: rcpt };
  }
}
