import type { KeypairInfo, IdentityRecord, SlxWalletManager, SlxSocialClient } from '../index.js';

export function injectSlxUiStyles(): void;

export function openIdentityCreateModal(
  wallet: SlxWalletManager,
  opts?: { rpcUrl?: string; appName?: string }
): Promise<IdentityRecord>;

export function mountSlxWalletHeader(opts: {
  wallet: SlxWalletManager;
  mountContainer: HTMLElement | null;
  appTitle?: string;
  onWalletSwitch?: ((kp: KeypairInfo) => Promise<void> | void) | null;
}): { refresh: () => void } | null;

export function registerHfsTypeDeployer(
  typeName: string,
  deployerFn: (opts: {
    wallet: SlxWalletManager;
    label: string;
    rpcUrl: string;
    onStatus?: (msg: string) => void;
  }) => Promise<any>
): void;

export function mountHfsRegistryDropdown(opts: {
  mountContainer: HTMLElement | null;
  wallet: SlxWalletManager;
  typeName: string;
  rpcUrlFn?: () => string;
  getCurrentPrimaryAddr?: () => string;
  onSelectInstance?: ((entry: any) => Promise<void> | void) | null;
  customDeployFn?: ((opts: any) => Promise<any>) | null;
  onCustomDeployClick?: ((ctx: any) => void) | null;
}): {
  refreshList: (opts?: { selectKey?: string | null; triggerCallbackIfUrlMatched?: boolean }) => Promise<any[]>;
  getInstances: () => any[];
  openDeployModal: () => void;
  setSelectedAddr: (addrHex: string) => void;
} | null;

export function mountSlxChainBar(opts?: {
  mountContainer?: HTMLElement | null;
  rpcUrlFn?: () => string;
  getContractAddr?: () => string;
  getContractLabel?: () => string;
  onToggleNodeDrawer?: (() => void) | null;
  explorerHref?: string;
  embedded?: boolean;
}): {
  refresh: () => void;
  destroy: () => void;
} | null;

export function mountSlxSocialWidgets(opts: {
  wallet: SlxWalletManager;
  mountContainer: HTMLElement | null;
  appId?: string;
  appTitle?: string;
  rpcUrlFn?: () => string;
  getAppPeers?: (() => Array<{ identityAddr: string; label?: string; role?: string }>) | null;
  socialClient?: SlxSocialClient | null;
}): {
  client: SlxSocialClient;
  refresh: () => Promise<SlxSocialClient>;
  openNetwork: () => Promise<void>;
  openMessages: (peerIdentityAddr?: string) => Promise<void>;
  destroy: () => void;
} | null;

export const SLX_PLATFORM_APPS: Array<{
  id: string;
  icon: string;
  label: string;
  shortLabel: string;
  sub: string;
  href: string;
  group: string;
}>;

export function mountSlxUnifiedHeader(opts?: {
  mountContainer?: HTMLElement | null;
  wallet?: SlxWalletManager | null;
  activeAppId?: string;
  title?: string;
  subtitle?: string;
  logoSrc?: string;
  logoHref?: string;
  rpcUrlFn?: () => string;
  getContractAddr?: () => string;
  getContractLabel?: () => string;
  onToggleNodeDrawer?: (() => void) | null;
  explorerHref?: string;
  onWalletSwitch?: ((kp: KeypairInfo) => Promise<void> | void) | null;
  getAppPeers?: (() => Array<{ identityAddr: string; label?: string; role?: string }>) | null;
  socialClient?: SlxSocialClient | null;
  contextElements?: Array<HTMLElement | null>;
  extraElements?: Array<HTMLElement | null>;
  mobileElements?: Array<HTMLElement | null>;
  appsList?: typeof SLX_PLATFORM_APPS;
}): {
  headerEl: HTMLElement;
  contextSlot: HTMLElement | null;
  extraSlot: HTMLElement | null;
  walletUi: ReturnType<typeof mountSlxWalletHeader>;
  socialUi: ReturnType<typeof mountSlxSocialWidgets>;
  chainBar: ReturnType<typeof mountSlxChainBar>;
  setTitle: (nextTitle?: string, nextSub?: string) => void;
  refresh: () => void;
  destroy: () => void;
} | null;

export interface SlxBootLoaderHandle {
  el: HTMLElement;
  setStage: (pct: number, title?: string, sub?: string) => void;
  reset: (pct?: number, title?: string, sub?: string) => void;
  complete: (doneTitle?: string, doneSub?: string) => void;
  hide: () => void;
  isComplete: () => boolean;
}

export function mountSlxBootLoader(opts?: {
  existingElement?: HTMLElement | null;
  mountContainer?: HTMLElement | null;
  insertAfterElement?: HTMLElement | null;
  initialPct?: number;
  initialTitle?: string;
  initialSub?: string;
  autoHideDelayMs?: number;
}): SlxBootLoaderHandle | null;

export const USECASE_DESCRIPTIONS: Record<string, any>;
export const USECASE_INSTRUCTIONS: Record<string, any>;

export function openSlxUseCaseDescription(
  appId: string,
  tabKey?: string,
  opts?: { currentPageAppId?: string }
): boolean;

export function openSlxUseCaseInstructions(appId: string, tabKey?: string): boolean;

export function mountSlxUseCaseHeaderDocs(opts: {
  activeAppId: string;
  extraContainer: HTMLElement | null;
}): { descBtn: HTMLButtonElement; instBtn: HTMLButtonElement | null } | null;

export function formatLatLon(lat: number, lon: number, decimals?: number): string;
export function latLonToMapXY(
  lat: number,
  lon: number,
  width?: number,
  height?: number
): { x: number; y: number };
export function mapXYToLatLon(
  x: number,
  y: number,
  width?: number,
  height?: number
): { lat: number; lon: number };
export function lonToMercX(lon: number, z?: number): number;
export function latToMercY(lat: number, z?: number): number;
export function mercXToLon(wx: number, z?: number): number;
export function mercYToLat(wy: number, z?: number): number;
export function computeAutoFitCamera(
  subnets: any[],
  width?: number,
  height?: number
): { lat: number; lon: number; zoom: number };
export function extractLiveGpsFromStats(stats: any): {
  ownGps: { lat: number; lon: number } | null;
  peerGpsByPrefix: Map<string, { lat: number; lon: number }>;
  subnetGpsById: Map<string, { lat: number; lon: number }>;
};

export function mountSlxSubnetWorldMap(opts: {
  mountContainer: HTMLElement | null;
  backgroundImgUrl?: string;
  tileApiKey?: string;
  initialMode?: 'auto-fit' | 'fit-immediate' | 'global-only' | 'global' | 'cluster';
  initialView?: 'map' | 'phase';
  showCloseButton?: boolean;
  onClose?: (() => void) | null;
  onSelectSubnet?: ((subnetProfile: any) => void) | null;
}): {
  updateTelemetry: (stats?: {
    s1Tip?: number;
    s2Tip?: number;
    confirmedCrossTxns?: number;
    inFlightCrossTxns?: number;
    lane?: string;
    rows?: any[];
  }) => void;
  setView: (view: 'map' | 'phase') => void;
  focusCluster: () => void;
  fitAllSubnets: () => void;
  resetGlobal: () => void;
  replayFlyIn: () => void;
  destroy: () => void;
} | null;

export function openSlxSubnetWorldMapModal(opts?: {
  initialMode?: 'auto-fit' | 'fit-immediate' | 'global-only' | 'global' | 'cluster';
  initialView?: 'map' | 'phase';
}): {
  backdrop: HTMLElement;
  close: () => void;
  mapInst: ReturnType<typeof mountSlxSubnetWorldMap>;
} | null;

export function mountSlxSubnetPhaseDiagram(opts: {
  mountContainer: HTMLElement | null;
  isVisibleFn?: () => boolean;
}): {
  ingestExternalBridgeData: (data?: Record<string, any>) => void;
  refreshTopology: () => void;
  destroy: () => void;
} | null;

export function openSlxSubnetRegistryModal(opts?: {
  initialSubnet?: any;
  wallet?: SlxWalletManager | null;
  rpcUrl?: string;
  onSaved?: ((res: any) => void) | null;
}): {
  close: () => void;
} | null;
