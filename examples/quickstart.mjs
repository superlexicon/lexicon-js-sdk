/**
 * Runnable 25-line quickstart demonstrating `@superlexicon/sdk` against live Subnet 1!
 */
import {
  SlxClient,
  SlxWalletManager,
  fetchRegisteredHfsByType,
  eventTopic,
} from '../src/index.js';

const rpcUrl = process.env.SLX_RPC_URL || 'wss://node1.superlexicon.com/rpc';
const wallet = new SlxWalletManager();
const client = new SlxClient({ rpcUrl });

console.log('Generated Ephemeral Keypair:', wallet.keypair.address);
console.log('Current Subnet 1 Height:    ', await client.getBlockNumber());

const dexMarkets = await fetchRegisteredHfsByType('DEX_CLOB', { rpcUrl });
console.log(`Active DEX_CLOB Markets:     ${dexMarkets.length}`);

const TOPIC_BLOCK_MATCHED = eventTopic('BlockMatched(uint64,uint64,uint64,uint64,uint64,uint64)');
const watcher = client.watch({
  filter: { topics: [TOPIC_BLOCK_MATCHED] },
  onLog: (lg) => {
    if (!lg.isBackfill) {
      console.log(`[LIVE Block #${lg.blockNumberNum}] DEX Clear @ ${lg.address}`);
    }
  },
  onHead: (h) => console.log(`[NEW HEAD] Block #${h.blockNumberNum} (${h.txCountNum} txs)`),
});

setTimeout(() => {
  watcher.unsubscribe();
  process.exit(0);
}, 5500);
