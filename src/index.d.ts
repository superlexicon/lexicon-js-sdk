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
export const PUBLIC_SUBNET1_WSS_RPC: string;
export const BYTECODE_STORE_ADDRESS: string;
export function getDefaultNodeWsUrl(): string;
export function toWsEndpoint(urlStr?: string): string;
export function slxNodeRpc(
  endpointUrl: string,
  method: string,
  params?: unknown[],
  timeoutMs?: number
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

export class SlxClient {
  rpcUrl: string;
  chainId: bigint;
  nonceQueue: SlxNonceQueue;
  constructor(opts?: { rpcUrl?: string; chainId?: bigint | number });
  rpc(method: string, params?: unknown[], timeoutMs?: number): Promise<any>;
  getBlockNumber(): Promise<number>;
  getNonce(address: string): Promise<bigint>;
  callRaw(to: string, dataHex: string, blockTag?: string): Promise<string>;
  callAbi(to: string, sig: string, typedArgs?: AbiTypedArg[], blockTag?: string): Promise<string>;
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
export function slxWatchChainApp(opts?: {
  rpcUrl?: string | (() => string);
  filter?: LogsFilter | (() => LogsFilter) | null;
  onHead?: ((head: NormalizedHead) => void) | null;
  onLog?: ((log: NormalizedLog) => void) | null;
  onRefresh?: ((meta: { source: string; blockNumber: number; head?: NormalizedHead }) => Promise<void> | void) | null;
  offlineFallbackMs?: number;
  sortBackfill?: boolean;
}): {
  triggerRefresh: (meta?: { source?: string; blockNumber?: number }) => Promise<void>;
  isConnected: () => boolean;
  refreshFilter: () => Promise<void> | undefined;
  markReceiptSeen: (receipt: any) => void;
  unsubscribe: () => void;
};

// identity & registry
export function readOnChainIdentityNickname(rpcUrl: string, identityAddr: string): Promise<string>;
export function readOnChainIdentityOwner(rpcUrl: string, identityAddr: string): Promise<string>;

export class SlxWalletManager {
  keypair: KeypairInfo;
  txHistory: any[];
  constructor(opts?: { privateKey?: string | null });
  getIdentityRecord(eoaAddr?: string): IdentityRecord | null;
  saveIdentityRecord(record: Partial<IdentityRecord>, eoaAddr?: string): IdentityRecord;
  clearIdentityRecord(eoaAddr?: string): void;
  resolveVerifiedIdentity(rpcUrl?: string): Promise<IdentityRecord | null>;
  deployUnifiedIdentityWithNickname(
    rawNickname: string,
    opts?: { rpcUrl?: string; manifest?: any; onStatus?: ((msg: string) => void) | null }
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
