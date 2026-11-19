# `@superlexicon/sdk` (`lexicon-js-sdk`)

Zero-dependency, isomorphic JavaScript & TypeScript SDK for **SuperLexicon Subnet 1** and **Halt-Free Subroutines (`HFS`)**.

Runs identically in modern browsers (`<script type="module">` / Vite / React / Vue), Node.js 20+, and edge runtimes with **0 external npm dependencies**.

---

## Package Entrypoints

| Import Path | Environment | Contents |
| :--- | :--- | :--- |
| `@superlexicon/sdk` | Browser + Node | Full headless SDK barrel (`crypto`, `abi`, `rpc`, `events`, `identity`) |
| `@superlexicon/sdk/crypto` | Browser + Node | `keccak256Hex`, `secp256k1` keypairs & ECDSA, RLP, `$0`-gas `signLexiconTx` & `signOrderedLexiconTx` |
| `@superlexicon/sdk/abi` | Browser + Node | `encodeAbi`, `eventTopic`, `decodeUintWord`, `decodeAddrWord`, `decodeAbiStringHex`, BE readers |
| `@superlexicon/sdk/rpc` | Browser + Node | `SlxClient`, `SlxNonceQueue`, multiplexed `slxNodeRpc`, `SlxHfsCache`, WASM HFS deployment |
| `@superlexicon/sdk/events` | Browser + Node | Multiplexed `eth_subscribe` (`newHeads`, `logs`, `stats`), chronological 30-block backfill, `slxWatchChainApp` |
| `@superlexicon/sdk/identity` | Browser + Node | Headless `SlxWalletManager` (`identity.wasm` + `IdentityRegistry`) & `HfsRegistry` discovery |
| `@superlexicon/sdk/ui` | Browser DOM | Optional drop-in Wallet Header Pill, Tx Inspector Modal & Global `HfsRegistry` Selector Dropdown |

---

## 10-Line Quickstart

```js
import {
  SlxClient,
  SlxWalletManager,
  encodeAbi,
  decodeUintWord,
  eventTopic,
} from '@superlexicon/sdk';

const wallet = new SlxWalletManager(); // Generates or restores persistent secp256k1 keypair
const client = new SlxClient({ rpcUrl: 'wss://node1.superlexicon.com/rpc' });

// 1. Read HFS state over multiplexed WebSocket JSON-RPC
const depthHex = await client.callAbi('0x53a6ae2fde58b6ad778e5b9a6ab41ac3124ffcf7', 'orderCount()');
console.log('Total orders:', decodeUintWord(depthHex));

// 2. Subscribe to real-time finalized blocks + contract event logs (zero polling!)
const TOPIC_BLOCK_MATCHED = eventTopic('BlockMatched(uint64,uint64,uint64,uint64,uint64,uint64)');
const watcher = client.watch({
  filter: { topics: [TOPIC_BLOCK_MATCHED] },
  onLog: (log) => console.log(log.isBackfill ? '[History]' : '[Live]', 'Match @ Blk', log.blockNumberNum),
  onRefresh: ({ blockNumber }) => console.log('Finalized Block #', blockNumber),
});
```

---

## Signing `$0`-Gas `extraTargets` & Same-Block Pipelined Transactions

SuperLexicon validators execute non-overlapping HFS state transitions in parallel using explicit `extraTargets` read/write declarations, and order same-block transactions canonically by `txHash`.

```js
import { signOrderedLexiconTx, encodeAbi } from '@superlexicon/sdk';

// Step 1 & Step 2 execute in deterministic order inside the EXACT SAME block!
const tx1 = signOrderedLexiconTx({
  privateKey: wallet.keypair.privateKey,
  nonce: 0n,
  to: authAddr,
  data: encodeAbi('approveAndFinalize(address)', [['address', myIdentity]]),
  extraTargets: [authAddr, charterAddr],
});

const tx2 = signOrderedLexiconTx({
  privateKey: wallet.keypair.privateKey,
  nonce: 1n,
  to: charterAddr,
  data: encodeAbi('activateCharter(address)', [['address', authAddr]]),
  extraTargets: [charterAddr, authAddr],
  lowerBoundHashHex: tx1.txHash, // Guarantees tx2.txHash > tx1.txHash!
});
```

---

## Optional Drop-In Browser Header Widgets (`@superlexicon/sdk/ui`)

```js
import { SlxWalletManager } from '@superlexicon/sdk';
import {
  mountSlxChainBar,
  mountSlxWalletHeader,
  mountHfsRegistryDropdown,
} from '@superlexicon/sdk/ui';

const wallet = new SlxWalletManager();

// Standardized 34px top horizontal live blockchain telemetry bar (Block #, Hash, P1-P4 Phase, TPS, Mempool, Total Txs, Active HFS)
mountSlxChainBar({
  mountContainer: document.getElementById('slxChainBarMount'),
  getContractLabel: () => 'DEX',
  getContractAddr: () => activeContractAddr,
});

mountSlxWalletHeader({
  wallet,
  mountContainer: document.getElementById('slxWalletMount'),
  appTitle: 'My SuperLexicon HFS App',
});

mountHfsRegistryDropdown({
  mountContainer: document.getElementById('slxWalletMount'),
  wallet,
  typeName: 'DEX_CLOB',
  onSelectInstance: (entry) => console.log('Switched HFS:', entry.label, entry.primaryAddr),
});
```

---

## Testing & Syncing with `lexicon/web`

```bash
# Run unit test suite (Keccak-256, secp256k1, RLP, ordered txHash, ABI, event filters)
npm test

# Sync into ../lexicon/web/packages/sdk for self-contained Docker builds
npm run sync:web
```
