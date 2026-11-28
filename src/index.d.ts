export interface KeypairInfo {
  privateKey: string;
  compressedPubKey: string;
  uncompressedPubKey: string;
  address: string;
  source?: string;
}

export interface SignLexiconTxParams {
  privateKey: string;
  nonce: bigint | number;
  to?: string | null;
  value?: bigint | number;
  data?: string | Uint8Array;
  gasLimit?: bigint | number;
  gasPrice?: bigint | number;
  chainId?: bigint | number;
  extraTargets?: string[];
  lowerBoundHashHex?: string | null;
}

export interface OrderedSignedTx {
  raw: string;
  txHash: string;
  gasLimitUsed: bigint;
}

export interface LogsFilter {
  address?: string | string[];
  topics?: Array<string | string[] | null>;
}

export interface NormalizedLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string | null;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  blockNumberNum: number;
  txIndexNum: number;
  logIndexNum: number;
  isBackfill: boolean;
  dedupKey: string;
}

export interface NormalizedHead {
  hash: string;
  parentHash: string;
  number: string;
  timestamp: string;
  blockNumberNum: number;
  timestampNum: number;
  txCountNum: number;
}

export interface IdentityRecord {
  identityAddr: string;
  nickname: string;
  handle: string;
  registryAddr: string;
}

export type AbiTypedArg =
  | ['uint8' | 'uint16' | 'uint32' | 'uint64' | 'uint256', number | bigint]
  | ['bool', boolean]
  | ['address' | 'bytes32', string]
  | ['string', string]
  | ['bytes', string | Uint8Array];

// crypto
export function hexToBytes(hex: string): Uint8Array;
export function bytesToHex(bytes: Uint8Array, prefix?: boolean): string;
export function utf8ToBytes(str: string): Uint8Array;
export function bytesToUtf8(bytes: Uint8Array): string;
export function concatBytes(...arrays: Uint8Array[]): Uint8Array;
export function randomBytes(len: number): Uint8Array;
export function keccak256Bytes(input: string | Uint8Array): Uint8Array;
export function keccak256Hex(input: string | Uint8Array): string;
export function selectorBytes(signature: string): Uint8Array;
export function selectorHex(signature: string): string;
export function eventTopic(signature: string): string;
export function generatePrivateKeyHex(): string;
export function normalizePrivateKeyHex(rawInput: string): string;
export function deriveKeypairInfo(privateKeyHex: string): KeypairInfo;
export function computeAddress(privateKeyHex: string): string;
export function computeCreateAddress(senderAddr: string, nonce?: bigint | number): string;
export function ecdhSharedSecretBytes(
  privateKeyHex: string,
  peerUncompressedPubHex: string | Uint8Array,
  domain?: string
): Uint8Array;
export function ecdhXorTransform(
  sharedSecret32: string | Uint8Array,
  contextBytes: string | Uint8Array,
  payloadBytes: string | Uint8Array
): Uint8Array;
export function signSecp256k1(
  privateKeyHex: string,
  digest32: string | Uint8Array
): { r: bigint; s: bigint; yParity: number };
export function encodeRlpBytes(item: unknown): Uint8Array;
export function computeRawTxHash(rawTxHex: string): string;
export function signOrderedLexiconTx(params: SignLexiconTxParams): OrderedSignedTx;
export function signLexiconTx(params: SignLexiconTxParams): string;

// abi
export const ZERO_ADDR: string;
export const ZERO_BYTES32: string;
export function shortHex(hex: string, lead?: number, tail?: number): string;
export function shortAddr(addr: string): string;
export function truncAddr4(addrHex: string): string;
export function u16BEBytes(n: number): Uint8Array;
export function u64BEBytes(n: number | bigint): Uint8Array;
export function readU16BE(b: Uint8Array, off?: number): number;
export function readU32BE(b: Uint8Array, off?: number): number;
export function readU64BE(b: Uint8Array, off?: number): number;
export function wordU64(n: number | bigint): Uint8Array;
export function wordAddress(addrHex: string): Uint8Array;
export function wordBytes32(hex32: string): Uint8Array;
export function encodeAbi(sig: string, typedArgs?: AbiTypedArg[]): string;
export function decodeUintWord(hex: string, wordIdx?: number): number;
export function decodeAddrWord(hex: string, wordIdx?: number): string;
export function decodeAbiStringHex(hex: string): string;
export function encodeBytes32Label(str: string): string;
export function decodeBytes32LabelHex(hex32: string): string;

// rpc
export const PUBLIC_SUBNET1_WSS_RPC_NODES: string[];
export const PUBLIC_SUBNET1_WSS_RPC: string;
export const BYTECODE_STORE_ADDRESS: string;
export function getDefaultNodeWsUrl(): string;
export function toWsEndpoint(urlStr?: string): string;
export function slxNodeRpc(
  endpointUrl: string,
  method: string,
  params?: unknown[],
  timeoutMs?: number,
  opts?: { allowFailover?: boolean }
): Promise<any>;

export class SlxNonceQueue {
  constructor(opts?: { rpcUrlFn?: () => string; inFlightTtlMs?: number });
  reset(addrHex?: string): void;
  release(addrHex: string, nonceBig: bigint | number): void;
  sendSigned(params: SignLexiconTxParams & { label?: string }): Promise<{
    txHash: string;
    rawTx: string;
    nonce: bigint;
    senderAddr: string;
  }>;
}

export class SlxCallCache {
  maxEntries: number;
  constructor(opts?: {
    rpcUrlFn?: string | (() => string);
    callFn?: ((to: string, dataHex: string) => Promise<string>) | null;
    maxEntries?: number;
  });
  call(
    to: string,
    dataHex: string,
    opts?: { blockNumber?: number; ttlMs?: number; immutable?: boolean }
  ): Promise<string>;
  callImmutable(to: string, dataHex: string): Promise<string>;
  callAbiImmutable(to: string, sig: string, typedArgs?: AbiTypedArg[]): Promise<string>;
  getOrComputeImmutable<T>(
    cacheKey: string,
    computeFn: () => Promise<T>,
    shouldFreezeFn?: (val: T) => boolean
  ): Promise<T>;
  hasFrozen(cacheKey: string): boolean;
  getFrozen<T = any>(cacheKey: string): T | undefined;
  invalidateContract(addrHex: string): void;
  clearEphemeral(): void;
  clearAll(): void;
}

export class SlxClient {
  rpcUrl: string;
  chainId: bigint;
  nonceQueue: SlxNonceQueue;
  cache: SlxCallCache;
  constructor(opts?: { rpcUrl?: string; chainId?: bigint | number });
  rpc(method: string, params?: unknown[], timeoutMs?: number): Promise<any>;
  getBlockNumber(): Promise<number>;
  getNonce(address: string): Promise<bigint>;
  callRaw(to: string, dataHex: string, blockTag?: string): Promise<string>;
  callAbi(to: string, sig: string, typedArgs?: AbiTypedArg[], blockTag?: string): Promise<string>;
  callCached(
    to: string,
    sig: string,
    typedArgs?: AbiTypedArg[],
    opts?: { blockNumber?: number; ttlMs?: number; immutable?: boolean }
  ): Promise<string>;
  callImmutable(to: string, sig: string, typedArgs?: AbiTypedArg[]): Promise<string>;
  waitForReceipt(txHash: string, opts?: { timeoutMs?: number; fallbackPollMs?: number }): Promise<any>;
  sendAndConfirm(params: {
    privateKey: string;
    to?: string | null;
    data?: string;
    gasLimit?: bigint | number;
    extraTargets?: string[];
    label?: string;
  }): Promise<{ txHash: string; rawTx: string; nonce: bigint; senderAddr: string; receipt: any }>;
  deployHfsWasm(params: {
    privateKey: string;
    wasmBytes: Uint8Array | ArrayBuffer;
    skipStoreIfUploaded?: boolean;
  }): Promise<{ codeHash: string; contractAddress: string; receipt: any }>;
  watch(opts?: Parameters<typeof slxWatchChainApp>[0]): ReturnType<typeof slxWatchChainApp>;
}

export const SlxHfsCache: {
  load(): Record<string, any>;
  save(patch: Record<string, any>): Record<string, any>;
  hydrateWithManifest(manifestUrl?: string): Promise<{ cache: Record<string, any>; manifest: any }>;
};

// events
export const PUBLIC_PUBSUB_WS_NODES: string[];
export function toPubSubWsUrl(inputUrl?: string): string;
export function derivePubSubWsCandidates(rpcUrl?: string): string[];
export function getCanonicalLogKey(log: any): string;
export function compileLogsFilter(rawFilter?: LogsFilter | null): any;
export function matchesCompiledFilter(log: any, compiled: any): boolean;
export function slxSubscribeNewHeads(
  rpcUrlOrFn: string | (() => string),
  onHead: (head: NormalizedHead) => void,
  options?: Record<string, any>
): { id: number; isConnected: () => boolean; unsubscribe: () => void };
export function slxSubscribeLogs(
  rpcUrlOrFn: string | (() => string),
  filterOrFn: LogsFilter | (() => LogsFilter),
  onLog: (log: NormalizedLog) => void,
  options?: { sortBackfill?: boolean }
): {
  id: number;
  isConnected: () => boolean;
  markReceiptSeen: (receipt: any) => void;
  refreshFilter: () => Promise<void>;
  unsubscribe: () => void;
};
export function slxSubscribeStats(
  rpcUrlOrFn: string | (() => string),
  onStats: (stats: any) => void,
  options?: Record<string, any>
): { id: number; isConnected: () => boolean; unsubscribe: () => void };
export function slxOnAnyNewHead(listener: (head: NormalizedHead) => void): () => void;
export function slxWaitForReceipt(
  rpcCallFn: (method: string, params?: unknown[]) => Promise<any>,
  txHash: string,
  opts?: { timeoutMs?: number; fallbackPollMs?: number }
): Promise<any>;
export type SingleFlightRefresh<TMeta = any> = ((meta?: TMeta) => Promise<void>) & {
  _isSlxSingleFlight: true;
  isRunning: () => boolean;
  cancelQueued: () => void;
};

export function createSingleFlightRefresh<TMeta = any>(
  fn: (meta: TMeta) => Promise<void> | void,
  opts?: { onError?: ((err: unknown) => void) | null }
): SingleFlightRefresh<TMeta>;

export function slxWatchChainApp(opts?: {
  rpcUrl?: string | (() => string);
  filter?: LogsFilter | (() => LogsFilter) | null;
  onHead?: ((head: NormalizedHead) => void) | null;
  onLog?: ((log: NormalizedLog) => void) | null;
  onRefresh?: ((meta: { source: string; blockNumber: number; head?: NormalizedHead }) => Promise<void> | void) | null;
  offlineFallbackMs?: number;
  sortBackfill?: boolean;
}): {
  refresh: (meta?: { source?: string; blockNumber?: number }) => Promise<void>;
  triggerRefresh: (meta?: { source?: string; blockNumber?: number }) => Promise<void>;
  isConnected: () => boolean;
  refreshFilter: () => Promise<void> | undefined;
  markReceiptSeen: (receipt: any) => void;
  unsubscribe: () => void;
};

// identity & registry
export function readOnChainIdentityNickname(rpcUrl: string, identityAddr: string): Promise<string>;
export function readOnChainIdentityOwner(rpcUrl: string, identityAddr: string): Promise<string>;
export function readOnChainIdentityEncryptionKeys(
  rpcUrl: string,
  identityAddr: string
): Promise<{
  secpPub64Bytes: Uint8Array;
  secpPub64Hex: string;
  edPub32Bytes: Uint8Array;
  edPub32Hex: string;
} | null>;
export function checkIdentityDeployedOnChain(
  rpcUrl: string,
  identityAddr: string
): Promise<{ reachable: boolean; deployed: boolean; owner: string }>;
export function lookupCachedSignedTx(txHash: string): Record<string, any> | null;

export class SlxWalletManager {
  keypair: KeypairInfo;
  txHistory: any[];
  lastClearedIdentityNotice: { identityAddr: string; nickname: string } | null;
  constructor(opts?: { privateKey?: string | null });
  getIdentityRecord(eoaAddr?: string): IdentityRecord | null;
  getPreferredNickname(eoaAddr?: string): string;
  setPreferredNickname(nickname: string, eoaAddr?: string): void;
  saveIdentityRecord(record: Partial<IdentityRecord>, eoaAddr?: string): IdentityRecord;
  clearIdentityRecord(eoaAddr?: string): void;
  awaitRegistrySeal(identityAddr?: string): Promise<void>;
  resolveVerifiedIdentity(
    rpcUrl?: string,
    opts?: { force?: boolean }
  ): Promise<IdentityRecord | null>;
  deployUnifiedIdentityWithNickname(
    rawNickname: string,
    opts?: {
      rpcUrl?: string;
      manifest?: any;
      waitForRegistrySeal?: boolean;
      onStatus?: ((msg: string, meta?: Record<string, any>) => void) | null;
    }
  ): Promise<IdentityRecord>;
  updateIdentityNickname(rawNickname: string, opts?: { rpcUrl?: string }): Promise<IdentityRecord>;
  ensureIdentityWithPrompt(opts?: {
    rpcUrl?: string;
    appName?: string;
    forcePrompt?: boolean;
    defaultNickname?: string;
  }): Promise<IdentityRecord>;
  onChange(fn: (kp: KeypairInfo, txHistory: any[]) => void): () => void;
  generateNewKeypair(): KeypairInfo;
  importPrivateKey(inputStr: string): KeypairInfo;
  recordExternalRpcTx(entry: Record<string, any>): any;
}

export const HFS_TYPES: Record<string, any>;
export function encodeHfsTypeId(typeName: string): string;
export const HfsRegistryAbi: {
  getInstancesByType(typeName: string, offset?: number, limit?: number): string;
  registerInstance(
    typeName: string,
    primaryAddr: string,
    creatorIdentity: string,
    label: string,
    metaObj?: Record<string, any> | string | Uint8Array
  ): string;
};
export function makeHfsSelectionKey(primaryAddr: string, meta?: Record<string, any>): string;
export function decodeHfsInstancesSliceHex(hex: string): { totalCount: number; items: any[] };
export function fetchRegisteredHfsByType(
  typeName: string,
  opts?: { rpcUrl?: string; registryAddr?: string | null }
): Promise<any[]>;
export function registerHfsInstanceOnChain(opts: {
  wallet: SlxWalletManager;
  rpcUrl?: string;
  registryAddr?: string | null;
  typeName: string;
  primaryAddr: string;
  label: string;
  meta?: Record<string, any>;
}): Promise<any>;
export function getUrlHfsParam(): string;
export function setUrlHfsParam(primaryAddr: string, push?: boolean): void;
export function clearUrlHfsParam(push?: boolean): void;

export class SlxIdentityDirectory {
  labels: Map<string, string>;
  myIdentityAddr: string;
  myIdentityHandle: string;
  constructor(opts?: {
    rpcUrlFn?: string | (() => string);
    wallet?: SlxWalletManager | null;
    debounceMs?: number;
    onLabelsUpdated?: ((labels: Map<string, string>) => void) | null;
    persistToStorage?: boolean;
    onlineFn?: () => boolean;
    resolverFn?: ((addrLow: string, rpcUrl: string) => Promise<{ nick: string; owner?: string }>) | null;
  });
  onChange(fn: (labels: Map<string, string>) => void): () => void;
  setMyIdentity(identityAddr: string, handle?: string): void;
  seed(addrHex: string, labelStr: string, opts?: { persist?: boolean }): void;
  seedMany(
    entries: Array<[string, string] | { addr: string; label: string }>,
    opts?: { persist?: boolean }
  ): void;
  invalidate(addrHex: string): void;
  labelFor(addrHex: string, opts?: { resolveIfMissing?: boolean }): string;
}

export function fetchRegisteredHolders(
  rpcUrl: string,
  ledgerAddr: string,
  opts?: { limit?: number; callFn?: ((to: string, data: string) => Promise<string>) | null }
): Promise<string[]>;

export function isTerminalAuthStatus(
  statusNum: number,
  opts?: { failedBidsStage?: boolean; pendingClaims?: number }
): boolean;

// social & messaging
export const SUBNET1_FLEET_SOCIAL_DEFAULT: {
  identityRegistry: string;
  messaging: string;
  charter: string;
  relationships: string;
  feed: string;
  events: string;
};
export function deterministicEncounterNonce(
  charterAddr: string,
  initiatorIdAddr: string,
  targetIdAddr: string
): string;
export function computeEncounterCommit(
  charterAddr: string,
  initiatorIdAddr: string,
  targetIdAddr: string,
  secretNonceHex: string
): string;
export function appChannelHash(appId?: string): string;
export const SlxSocialAbi: Record<string, (...args: any[]) => string>;
export function decodeSocialMessagesHex(hex: string): Array<{
  block: number;
  authorAddr: string;
  text: string;
}>;
export function decodeSocialCharterSnapshotHex(hex: string): any;
export function decodeSocialRelSnapshotHex(hex: string): { edges: any[]; handshakes: any[] };
export function decodeSocialFeedSnapshotHex(hex: string): { totalPosts: number; posts: any[] };

export class SlxSocialClient {
  rpcUrlFn: () => string;
  appId: string;
  myIdentityAddr: string;
  charterSnap: any;
  relSnap: { edges: any[]; handshakes: any[] };
  feedSnap: { totalPosts: number; posts: any[] };
  appChannelMsgs: any[];
  dmMsgs: any[];
  activeDmPeerId: string;
  connectedIds: Set<string>;
  incomingHandshakes: any[];
  outgoingIds: Set<string>;
  constructor(opts?: { rpcUrlFn?: () => string; appId?: string; suiteOverride?: any });
  onChange(fn: (client: SlxSocialClient) => void): () => void;
  ensureSuite(): Promise<any>;
  resolveDisplayTag(identityAddr: string, onResolved?: ((tag: string) => void) | null): string;
  resolveWalletIdentity(wallet: SlxWalletManager): Promise<string>;
  refresh(wallet?: SlxWalletManager | null): Promise<SlxSocialClient>;
  setActiveDmPeer(peerIdentityAddr: string, wallet?: SlxWalletManager | null): Promise<any[]>;
  startLiveWatch(
    wallet: SlxWalletManager,
    opts?: { onIncomingEvent?: ((log: any) => void) | null }
  ): () => void;
  connectPeer(
    wallet: SlxWalletManager,
    targetIdentityAddr: string,
    opts?: { appName?: string }
  ): Promise<boolean>;
  acceptHandshake(
    wallet: SlxWalletManager,
    initiatorIdentityAddr: string,
    opts?: { appName?: string }
  ): Promise<boolean>;
  sendDirectMessage(
    wallet: SlxWalletManager,
    peerIdentityAddr: string,
    text: string,
    opts?: { appName?: string }
  ): Promise<boolean>;
  postAppChannel(wallet: SlxWalletManager, text: string, opts?: { appName?: string }): Promise<boolean>;
  postWall(
    wallet: SlxWalletManager,
    text: string,
    opts?: { visibility?: number; appName?: string }
  ): Promise<boolean>;
  reactWallPost(wallet: SlxWalletManager, postId: number, opts?: { appName?: string }): Promise<boolean>;
}

// confidential accounting & shielded settlement
export interface Ed25519Point {
  X: bigint;
  Y: bigint;
  Z: bigint;
  T: bigint;
}

export interface Ed25519Keypair {
  secretScalar: bigint;
  secretLeBytes32: Uint8Array;
  secretHex32: string;
  pub32Bytes: Uint8Array;
  pub32Hex: string;
}

export interface IdentityEncryptionKeys {
  secpPrivHex: string;
  secpPub64Bytes: Uint8Array;
  secpPub64Hex: string;
  edSecretScalar: bigint;
  edSecretHex32: string;
  edPub32Bytes: Uint8Array;
  edPub32Hex: string;
}

export function sha512Bytes(input: string | Uint8Array | ArrayBuffer): Uint8Array;
export const ED25519_P: bigint;
export const ED25519_L: bigint;
export const CONF_RANGE_BITS: number;
export const CONF_BIT_PROOF_STRIDE: number;
export const CONF_RANGE_PROOF_BYTES: number;
export const CONF_MIN_PADDED_SLOTS: number;
export const CONF_CAT_KIND: Readonly<{
  PAYROLL: 1;
  DEFENSE_B2B: 2;
  TRADE_AR: 3;
  VENDOR_OPEX: 4;
}>;
export const CONF_ROLLUP_MODE: Readonly<{
  BATCH_OR_EPOCH: 1;
  LIVE_COUNTERPARTY_SHIELDED: 2;
}>;
export const CONF_CAT_IDS: Readonly<{
  PAYROLL: string;
  DEFENSE_B2B: string;
  DEFENSE_LIVE: string;
  TRADE_AR: string;
  VENDOR_OPEX: string;
}>;
export const ED_IDENTITY_PT: Readonly<Ed25519Point>;
export const ED_BASE_PT: Readonly<Ed25519Point>;
export const ED25519_BASEPOINT_BYTES: Uint8Array;
export const IDENTITY_POINT_BYTES: Uint8Array;
export const IDENTITY_CIPHERTEXT_64: Uint8Array;

export function edAdd(P: Ed25519Point, Q: Ed25519Point): Ed25519Point;
export function edNeg(P: Ed25519Point): Ed25519Point;
export function edMul(scalar: bigint | number, P: Ed25519Point): Ed25519Point;
export function edEncode(P: Ed25519Point): Uint8Array;
export function edDecode(bytesOrHex: string | Uint8Array): Ed25519Point | null;
export function edIsIdentity(P: Ed25519Point): boolean;
export function leBytesToBigInt(bytes: Uint8Array): bigint;
export function scalarToLeBytes32(s: bigint | number): Uint8Array;
export function randomEdScalar(): bigint;
export function encodePeriodTagBytes32(labelStr: string): Uint8Array;
export function decodePeriodTagBytes32(bytesOrHex: string | Uint8Array): string;

export function deriveEd25519Keypair(
  seed32Input: string | Uint8Array,
  ctxInput: string | Uint8Array
): Ed25519Keypair;
export function deriveIdentityEncryptionKeys(
  privateKeyHex: string,
  identityAddrHex: string
): IdentityEncryptionKeys;
export function deriveCompanyAuditKeypair(
  seedBytesOrHex: string | Uint8Array | null | undefined,
  charterAddrHex: string,
  epoch?: number
): Ed25519Keypair;
export function deriveCategoryPeriodSubkey(
  auditSecretInput: string | Uint8Array,
  categoryIdHex: string,
  periodTagInput: string | Uint8Array
): Uint8Array;
export function wrapSecretForRecipientSecp(
  secretBytes: string | Uint8Array,
  recipientSecpPub64: string | Uint8Array,
  contextTag?: string
): Uint8Array;
export function unwrapSecretWithPrivKey(
  envelopeInput: string | Uint8Array,
  recipientPrivateKeyHex: string,
  contextTag?: string
): Uint8Array | null;
export function encryptJsonForRecipientSecp(
  obj: any,
  recipientSecpPub64: string | Uint8Array,
  contextTag?: string
): Uint8Array;
export function decryptJsonWithPrivKey<T = any>(
  envelopeInput: string | Uint8Array,
  recipientPrivateKeyHex: string,
  contextTag?: string
): T | null;
export function encryptJsonWithSubkey(
  subkey32Input: string | Uint8Array,
  obj: any,
  contextTag?: string
): Uint8Array;
export function decryptJsonWithSubkey<T = any>(
  subkey32Input: string | Uint8Array,
  cipherInput: string | Uint8Array,
  contextTag?: string
): T | null;

export function heEncryptU64(
  pkInput: string | Uint8Array,
  value: number | bigint,
  rScalar?: bigint
): { ct64: Uint8Array; rScalar: bigint };
export function heAddCiphertexts(
  caInput: string | Uint8Array,
  cbInput: string | Uint8Array
): Uint8Array | null;
export function heSubCiphertexts(
  caInput: string | Uint8Array,
  cbInput: string | Uint8Array
): Uint8Array | null;
export function heScaleCiphertext(
  ctInput: string | Uint8Array,
  weight: number | bigint
): Uint8Array | null;
export function decryptElGamalU24(
  auditSecretScalarOrLeBytes: bigint | string | Uint8Array,
  ctInput: string | Uint8Array,
  maxBound?: number
): number | null;
export function proveDleq(
  secretScalar: bigint,
  G1: Ed25519Point,
  Y1: Ed25519Point,
  G2: Ed25519Point,
  Y2: Ed25519Point,
  auxCtx: Uint8Array
): Uint8Array;
export function verifyDleq(
  G1: Ed25519Point,
  Y1: Ed25519Point,
  G2: Ed25519Point,
  Y2: Ed25519Point,
  auxCtx: Uint8Array,
  proof64Input: string | Uint8Array
): boolean;
export function proveHeZeroOrOne(
  pkInput: string | Uint8Array,
  bit: 0 | 1 | number,
  rScalar: bigint,
  auxCtx: Uint8Array
): { ct64: Uint8Array; proof128: Uint8Array };
export function verifyHeZeroOrOne(
  pkInput: string | Uint8Array,
  ct64Input: string | Uint8Array,
  auxCtx: Uint8Array,
  proof128Input: string | Uint8Array
): boolean;
export function proveHeRangeU24(
  pkInput: string | Uint8Array,
  value: number,
  ctxPrefixBytes: Uint8Array,
  slotIdx: number
): { ct64: Uint8Array; rScalar: bigint; proof4608: Uint8Array };
export function verifyHeRangeU24(
  pkInput: string | Uint8Array,
  ctxPrefixBytes: Uint8Array,
  slotIdx: number,
  proof4608Input: string | Uint8Array
): Uint8Array | null;
export function proveHeSumEqualsU64(
  pkInput: string | Uint8Array,
  rSumScalar: bigint,
  sumCtxBytes: Uint8Array
): Uint8Array;
export function verifyHeSumEqualsU64(
  pkInput: string | Uint8Array,
  cSum64Input: string | Uint8Array,
  publicAmount: number | bigint,
  sumCtxBytes: Uint8Array,
  dleq64Input: string | Uint8Array
): boolean;
export function proveEd25519Schnorr(
  secretScalar: bigint,
  base32Input: string | Uint8Array,
  msgCtxBytes: Uint8Array
): Uint8Array;
export function verifyEd25519Schnorr(
  base32Input: string | Uint8Array,
  pub32Input: string | Uint8Array,
  msgCtxBytes: Uint8Array,
  sig64Input: string | Uint8Array
): boolean;
export function proveStealthNonInsider(
  rhoScalar: bigint,
  clientEdPubInput: string | Uint8Array,
  insiderEdPubs: Array<string | Uint8Array>,
  ctxPrefixBytes: Uint8Array
): {
  stealthH32: Uint8Array;
  stealthH32Hex: string;
  blindedClientPk32: Uint8Array;
  blindedClientPk32Hex: string;
  proofBlob: Uint8Array;
};
export function verifyStealthNonInsider(
  h32Input: string | Uint8Array,
  pBlind32Input: string | Uint8Array,
  insiderEdPubs: Array<string | Uint8Array>,
  ctxPrefixBytes: Uint8Array,
  proofBlobInput: string | Uint8Array
): boolean;
export function computeConfidentialBatchTag(confLedgerAddrHex: string, batchId: number): Uint8Array;
export function buildConfidentialPayableBatchTx(params: Record<string, any>): {
  calldata: string;
  totalAmount: number;
  slotCount: number;
  periodHex: string;
  sumDleq64: Uint8Array;
};
export function buildConfidentialReceivableProposal(params: Record<string, any>): {
  calldata: string;
  buildCalldata: (finalAuthObj?: string) => string;
  actionHashCalldata: string;
  stealthH32Hex: string;
  blindedClientPk32Hex: string;
  claimLockHex: string;
  claimSecretHex: string;
  rhoScalar: bigint;
  rMonthlyScalar: bigint;
  rBacklogScalar: bigint;
  ias24ProofBlob: Uint8Array;
  cMonthly64: Uint8Array;
  periodHex: string;
};
export function buildStealthCosignTx(params: Record<string, any>): string;
export function buildConfidentialEpochRollupTx(params: Record<string, any>): {
  calldata: string;
  publicTotal: number;
  slotCount: number;
};
export function buildSpendOrRedeemShieldedNoteTx(params: Record<string, any>): {
  calldata: string;
  nullifierHex: string;
  changeAmount: number;
  changeClaimSecretHex: string | null;
};
export function decodeConfidentialCategoriesHex(rawHex: string): any[];
export function decodeConfidentialBatchesSliceHex(rawHex: string): { total: number; items: any[] };
export function decodeConfidentialReceivablesSliceHex(rawHex: string): { total: number; items: any[] };
export function decodeShieldedNotesSliceHex(rawHex: string): { total: number; items: any[] };
export function decodeAuditorGrantsSliceHex(rawHex: string): { total: number; items: any[] };
export function decodeIas24InsidersHex(rawHex: string): Array<{
  identity: string;
  edPub32Bytes: Uint8Array;
  edPub32Hex: string;
}>;

// Bulletproofs & Zero-Knowledge Cipher Noir (`./bulletproofs.js`)
export const BP_WIRE_A_L: number;
export const BP_WIRE_A_R: number;
export const BP_WIRE_A_O: number;
export const BP_WIRE_VAR: number;
export const BP_H_BLIND_HEX: string;
export const NOIR_PHASES: Record<string, number>;

export function edHashToCurve(alphaInput: string | Uint8Array): Ed25519Point;
export function bpGenerators(minVecLen?: number): {
  bVal: Ed25519Point;
  hBlind: Ed25519Point;
  uIpa: Ed25519Point;
  gVec: Ed25519Point[];
  hVec: Ed25519Point[];
};
export function bpPedersenCommit(valScalar: bigint, blindScalar: bigint): Uint8Array;
export function bpPedersenCommitU64(valU64: number | bigint, blindScalar: bigint): Uint8Array;
export function bpProveRangeU64Batch(
  values: Array<number | bigint>,
  blindings: bigint[],
  bitWidth?: number,
  ctx?: string | Uint8Array,
  entropy32?: string | Uint8Array | null
): { commits: Uint8Array[]; proof: Uint8Array };
export function bpVerifyRangeU64Batch(
  commits: Array<string | Uint8Array>,
  bitWidth: number,
  ctx: string | Uint8Array,
  proofInput: string | Uint8Array
): boolean;

export class BpCsBuilder {
  numGates: number;
  numVars: number;
  constructor(numGates: number, numVars: number);
  addConstraint(constantScalar: bigint, terms: Array<[number, number, bigint]>): this;
  encode(): Uint8Array;
}

export function bpProveR1cs(
  csInput: BpCsBuilder | Uint8Array | string,
  varValues: bigint[],
  varBlindings: bigint[],
  aLIn: bigint[],
  aRIn: bigint[],
  aOIn: bigint[],
  ctx?: string | Uint8Array,
  entropy32?: string | Uint8Array | null
): { commits: Uint8Array[]; proof: Uint8Array };
export function bpVerifyR1cs(
  csInput: BpCsBuilder | Uint8Array | string,
  commits: Array<string | Uint8Array>,
  ctx: string | Uint8Array,
  proofInput: string | Uint8Array
): boolean;

export function canonicalNoirInitialDeck(): Uint8Array;
export function deriveNoirSeatSecrets(
  walletPrivateKeyHex: string,
  caseIdHex: string,
  seatEoaHex: string,
  epochPkInput: string | Uint8Array
): {
  edSk: bigint;
  edPkBytes: Uint8Array;
  uSk: bigint[];
  wSk: bigint[];
  seatKeyBlob: Uint8Array;
};
export function decryptNoirHandCards(
  blindedDecrypts3: Array<string | Uint8Array>,
  uSk3: bigint[],
  epochPkInput: string | Uint8Array
): Array<{ slot: number; dossierId: number }>;
export function proveNoirShuffleStep(params: Record<string, any>): Uint8Array;
export function proveNoirInitialShuffle(
  caseIdHex: string,
  epochPkInput: string | Uint8Array
): Uint8Array;
export function proveNoirPassAlibi(params: Record<string, any>): Uint8Array;
export function proveNoirWhisperOr3(params: Record<string, any>): Uint8Array;
export function decryptNoirWhisper(
  whisperCt64Input: string | Uint8Array,
  myEdSk: bigint
): number | null;
export function computeNoirIndictmentDelta0(
  caseIdHex: string,
  vaultCiphertexts192Input: string | Uint8Array,
  guesses3: number[]
): Uint8Array;
export function proveNoirIndictmentBlind(params: Record<string, any>): Uint8Array;
export function decodeNoirCaseState(rawHexOrBytes: string | Uint8Array): any;

// Multi-Device Identity v4, N-Capped Keychain & Pedersen-VSS Shamir Recovery (`./recovery.js`)
export const DEV_STATUS_ACTIVE: number;
export const DEV_STATUS_REVOKED: number;
export const SLOT_STATUS_ACTIVE: number;
export const SLOT_STATUS_SEALED_FULL: number;
export const SLOT_STATUS_RETIRED: number;
export const SHARE_KIND_GUARDIAN_SLOT: number;
export const SHARE_KIND_DIRECT_EOA: number;
export const SHARE_KIND_SELF_PASSPHRASE: number;
export const REC_STATUS_NONE: number;
export const REC_STATUS_COLLECTING: number;
export const REC_STATUS_TIMELOCKED: number;
export const REC_STATUS_FINALIZED: number;
export const REC_STATUS_CANCELLED: number;
export const DEVICE_SEED_WRAP_TAG: string;
export const GUARDIAN_SHARE_WRAP_TAG: string;

export function deriveIdentityMasterSeedBytes32(
  creatorPrivateKeyHex: string,
  identityAddrHex: string
): Uint8Array;
export function wrapMasterSeedForDevice(
  masterSeedBytes32: string | Uint8Array,
  deviceSecpPub64: string | Uint8Array
): Uint8Array;
export function unwrapMasterSeedWithDeviceKey(
  wrappedSeedEnvelope: string | Uint8Array,
  devicePrivateKeyHex: string
): Uint8Array | null;
export function resolveIdentityEncryptionKeys(
  rpcUrl: string,
  devicePrivateKeyHex: string,
  identityAddrHex: string
): Promise<{
  secpPrivHex: string;
  secpPub64Bytes: Uint8Array;
  secpPub64Hex: string;
  edSecretScalar: bigint;
  edSecretHex32: string;
  edPub32Bytes: Uint8Array;
  edPub32Hex: string;
  masterSeedBytes32: Uint8Array;
  masterSeedHex: string;
  deviceEoa: string;
  deviceSecpPub64Bytes: Uint8Array;
  unwrappedFromDeviceRing: boolean;
}>;
export function encryptShareWithPassphrase(
  plainShare128: string | Uint8Array,
  passphrase: string,
  identityAddrHex: string
): Promise<Uint8Array>;
export function decryptShareWithPassphrase(
  envelopeInput: string | Uint8Array,
  passphrase: string,
  identityAddrHex: string
): Promise<Uint8Array>;
export function splitSecretPedersenVss(
  secretBytes32: string | Uint8Array,
  threshold?: number,
  shareCount?: number
): {
  threshold: number;
  shareCount: number;
  vssCommitsPacked: Uint8Array;
  vssCommitsHex: string;
  shares: any[];
};
export function packConfiguredShamirShares(shareSpecs: Record<string, any>[]): Uint8Array;
export function proveBlindedRecoveryShare(params: Record<string, any>): {
  proofBytes: Uint8Array;
  proofHex: string;
};
export function unblindAndRecoverMasterSeed(params: Record<string, any>): {
  masterSeedBytes32: Uint8Array;
  masterSeedHex: string;
};
export function deriveRecoverySessionKeypair(
  newDevicePrivateKeyHex: string,
  identityAddrHex: string
): Record<string, any>;
export function buildStatelessOracleRecoverySubmission(
  rpcUrl: string,
  oracleSlotPrivateKeyHex: string,
  wardIdentityAddr: string
): Promise<Record<string, any>>;
export const IdentityV4RecoveryAbi: Record<string, (...args: any[]) => string>;
export function decodeOwnerDevicesHex(hex: string): any[];
export function decodeGuardianSlotDescriptorHex(hex: string): Record<string, any> | null;
export function decodeGuardianKeychainHex(hex: string): any[];
export function decodeRecoveryStateHex(hex: string): Record<string, any>;

// Sovereign ECIES + AES-256-GCM Multi-Topic Channels (`./ecies_messaging.js`)
export const ECIES_CHANNEL_KEY_WRAP_TAG: string;
export const HFS_TYPE_MESSAGING_ECIES: string;
export function packChannelMembersBytes(memberAddrs: string[]): Uint8Array;
export function computeCanonicalRosterHashes(memberEntries: Record<string, any>[]): {
  sortedMembers: string[];
  pkRosterHash: string;
  idRosterHash: string;
};
export function generateChannelAesKey256(): Uint8Array;
export function wrapChannelKeyForMembers(
  aesKey32: string | Uint8Array,
  memberPubKeys: Record<string, any>[]
): Uint8Array;
export function unwrapChannelKeyForEpoch(
  wrapEnvelopeInput: string | Uint8Array,
  identitySecpPrivHex: string
): Uint8Array | null;
export function buildTopicMessageAad(
  messagingAddr: string,
  channelIdHex: string,
  topicId: number,
  keyEpoch: number,
  authorIdentityAddr: string
): Uint8Array;
export function encryptTopicMessageAesGcm(
  aesKey32: string | Uint8Array,
  payloadOrText: string | Record<string, any>,
  aadBytes: Uint8Array
): Promise<Uint8Array>;
export function decryptTopicMessageAesGcm(
  aesKey32: string | Uint8Array,
  frameInput: string | Uint8Array,
  aadBytes: Uint8Array
): Promise<{ text: string; ts: number; payload: any } | null>;
export const SlxEciesMessagingAbi: Record<string, (...args: any[]) => string>;
export function decodeOpenChannelReturnHex(hex: string): Record<string, any> | null;
export function decodeIdentityChannelsHex(hex: string, messagingAddr?: string): any[];
export function decodeChannelDetailsHex(hex: string): Record<string, any> | null;
export function decodeTopicMessagesHex(hex: string): {
  returnedCount: number;
  totalCount: number;
  messages: any[];
};
export class SlxEciesChannelClient {
  constructor(opts?: Record<string, any>);
  discoverMessagingSubroutinesFromIdentity(identityAddr: string): Promise<string[]>;
  listIdentityChannels(identityAddr: string): Promise<any[]>;
  openOrReuseChannelWithTopic(wallet: any, myIdentityAddr: string, opts: Record<string, any>): Promise<any>;
  createTopic(wallet: any, myIdentityAddr: string, channelId: string, topicTitle: string, messagingAddr?: string): Promise<any>;
  rollChannelKey(wallet: any, myIdentityAddr: string, channelId: string, messagingAddr?: string): Promise<any>;
  addChannelMember(wallet: any, myIdentityAddr: string, channelId: string, newMemberIdentityAddr: string, messagingAddr?: string): Promise<any>;
  removeChannelMember(wallet: any, myIdentityAddr: string, channelId: string, targetMemberIdentityAddr: string, messagingAddr?: string): Promise<any>;
  leaveChannel(wallet: any, myIdentityAddr: string, channelId: string, messagingAddr?: string): Promise<any>;
  sendTopicMessage(wallet: any, myIdentityAddr: string, opts: Record<string, any>): Promise<any>;
  readDecryptedTopicMessages(wallet: any, myIdentityAddr: string, opts: Record<string, any>): Promise<any>;
}

// subnet-registry HFS
export const SUBNET_REGISTRY_CODE_HASH: string;
export const SUBNET1_SUBNET_REGISTRY_ADDRESS: string;
export const SUBNET2_SUBNET_REGISTRY_ADDRESS: string;
export const SubnetRegistryAbi: Record<string, (...args: any[]) => string>;
export function degToE7UnsignedBits(deg: number): bigint;
export function readSignedI32BE(bytes: Uint8Array, offset: number): number;
export function decodeSubnetRegistrySliceHex(hex: string): {
  totalCount: number;
  items: Array<Record<string, any>>;
};
export function decodeSingleSubnetHex(hex: string): Record<string, any> | null;
export function resolveSubnetRegistryAddress(opts?: {
  rpcUrl?: string;
  registryAddr?: string;
  hfsRegistryAddr?: string;
}): Promise<string>;
export function fetchOnChainSubnets(opts?: {
  rpcUrl?: string;
  registryAddr?: string;
  includeArchived?: boolean;
}): Promise<{ registryAddr: string; subnets: Array<Record<string, any>> }>;
export function fetchSubnetRegistryMeta(opts?: {
  rpcUrl?: string;
  registryAddr?: string;
}): Promise<{ registryAddr: string; admin: string; totalCount: number }>;
export function upsertSubnetOnChain(opts: {
  wallet?: SlxWalletManager | null;
  privateKey?: string;
  rpcUrl?: string;
  registryAddr?: string;
  chainId?: bigint | number;
  subnet: Record<string, any>;
}): Promise<{ txHash: string; receipt: any; registryAddr: string }>;
export function probeSubnetNodeStats(
  subnetProfile: Record<string, any>,
  opts?: { isHttps?: boolean; timeoutMs?: number }
): Promise<{
  nodes: Array<{
    name: string;
    url: string;
    pubkeyPrefix: string | null;
    online: boolean;
    blockHeight: number;
    rttMs: number;
  }>;
  maxHeight: number;
  onlineCount: number;
  totalCount: number;
  quorumMatched: boolean;
}>;

// L1 content-addressed UI bundle store (0x0101) & pure hash-pointer AppStore HFS
export const UI_BUNDLE_STORE_ADDRESS: string;
export const APP_STORE_CODE_HASH: string;
export const UI_BUNDLE_MULTIPART_MAGIC: Uint8Array;
export const UI_BUNDLE_RADIO_SAFE_PART_BYTES: number;
export const AppStoreAbi: Record<string, (...args: any[]) => string>;
export class AppStoreClient {
  constructor(opts?: {
    rpcUrlFn?: () => string;
    appStoreAddr?: string;
    hfsRegistryAddr?: string;
    staticManifestUrl?: string;
  });
  resolveAddress(): Promise<string>;
  deployAppStoreOnChain(opts?: Record<string, any>): Promise<{
    txHash: string;
    contractAddress: string;
    codeHash: string;
  }>;
  fetchBytecode(codeHash: string): Promise<{
    codeHash: string;
    exists: boolean;
    size: number;
    bytes: Uint8Array | null;
  }>;
  fetchUiBundle(uiHash: string): Promise<{
    uiHash: string;
    exists: boolean;
    size: number;
    encoding: string;
    bytes: Uint8Array | null;
  }>;
  uploadUiBundleOnChain(opts: Record<string, any>): Promise<{
    uiHash: string;
    compressedBytes: Uint8Array;
    chunkCount: number;
    alreadyExisted: boolean;
    txHashes: string[];
  }>;
  fetchVerifiedBundleHtml(opts: Record<string, any>): Promise<{
    html: string;
    uiHash: string;
    loadedFrom: string;
    byteSize: number;
  }>;
  fetchOnChainApps(): Promise<Array<Record<string, any>>>;
  fetchAppById(appId: number): Promise<Record<string, any> | null>;
  fetchMergedDirectory(opts?: Record<string, any>): Promise<Record<string, any>>;
  publishAppOnChain(opts: Record<string, any>): Promise<{
    txHash: string;
    appStoreAddr: string;
    uiHash: string;
    wasmCodeHash: string;
  }>;
}
