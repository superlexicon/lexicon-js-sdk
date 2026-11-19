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
