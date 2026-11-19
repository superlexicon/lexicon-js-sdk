/**
 * @superlexicon/sdk
 *
 * Zero-dependency JavaScript/TypeScript SDK for SuperLexicon Subnet 1 & Halt-Free Subroutines (HFS).
 *
 * Headless core exports:
 *  - `./crypto.js`   — Keccak-256, secp256k1 keypairs & ECDSA, RLP, `signLexiconTx`, `signOrderedLexiconTx`
 *  - `./abi.js`      — `encodeAbi`, binary big-endian readers/writers, `decodeUintWord`, `decodeAddrWord`, `decodeAbiStringHex`
 *  - `./rpc.js`      — Multiplexed WebSocket JSON-RPC (`slxNodeRpc`), `SlxNonceQueue`, `SlxClient`, `SlxHfsCache`
 *  - `./events.js`   — Multiplexed `eth_subscribe` (`slxSubscribeNewHeads`, `slxSubscribeLogs`, `slxWatchChainApp`, `slxWaitForReceipt`)
 *  - `./identity.js` — Headless `SlxWalletManager` (`identity.wasm` + `IdentityRegistry`) & `HfsRegistry` discovery
 *  - `./social.js`   — Unified Subnet 1 Social Graph & Messaging (`SlxSocialClient`, `SlxSocialAbi`)
 *
 * For optional browser header widgets (`mountSlxChainBar`, `mountSlxWalletHeader`, `mountSlxSocialWidgets`, `mountHfsRegistryDropdown`), import `@superlexicon/sdk/ui`.
 */

export * from './crypto.js';
export * from './abi.js';
export * from './rpc.js';
export * from './events.js';
export * from './identity.js';
export * from './social.js';
