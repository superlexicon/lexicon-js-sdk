/**
 * Zero-dependency test suite for `@superlexicon/sdk`.
 */
import assert from 'node:assert/strict';
import {
  hexToBytes,
  bytesToHex,
  keccak256Hex,
  selectorHex,
  eventTopic,
  generatePrivateKeyHex,
  deriveKeypairInfo,
  computeAddress,
  ecdhSharedSecretBytes,
  ecdhXorTransform,
  signSecp256k1,
  SECP256K1_N,
  signLexiconTx,
  signOrderedLexiconTx,
  computeRawTxHash,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
  decodeAbiStringHex,
  compileLogsFilter,
  matchesCompiledFilter,
  toPubSubWsUrl,
  derivePubSubWsCandidates,
  SlxWalletManager,
  SUBNET1_FLEET_SOCIAL_DEFAULT,
  deterministicEncounterNonce,
  computeEncounterCommit,
  appChannelHash,
  SlxSocialAbi,
} from '../src/index.js';

// 1. Official Keccak-256 & Solidity Selector Vectors
assert.equal(
  keccak256Hex(''),
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  'Keccak-256("") mismatch'
);
assert.equal(selectorHex('transfer(address,uint256)'), '0xa9059cbb', 'Selector mismatch');
assert.equal(
  eventTopic('OrderPlaced(uint64,address,uint8,uint64,uint64,uint64)'),
  '0x1727a123198d41e7137095361ec1c05fea9bec3007650f953d8a22ea8894270e',
  'Event topic mismatch'
);

// 2. Known secp256k1 Private Key -> Address Vector (priv = 1)
const kp1 = deriveKeypairInfo('0x0000000000000000000000000000000000000000000000000000000000000001');
assert.equal(
  kp1.address.toLowerCase(),
  '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
  'secp256k1 G*1 address vector mismatch'
);
assert.equal(computeAddress(kp1.privateKey), kp1.address);

// 3. Canonical Low-S ECDSA & Ordered Intra-Block txHash Grinding
const freshPriv = generatePrivateKeyHex();
const sig = signSecp256k1(freshPriv, keccak256Hex('hello superlexicon'));
assert.ok(sig.s > 0n && sig.s <= SECP256K1_N >> 1n, 'ECDSA S must be low-S canonical');
assert.ok(sig.yParity === 0 || sig.yParity === 1, 'yParity must be 0 or 1');

const ordered1 = signOrderedLexiconTx({
  privateKey: freshPriv,
  nonce: 0n,
  to: '0x1111111111111111111111111111111111111111',
  data: encodeAbi('approve(address,uint64)', [
    ['address', kp1.address],
    ['uint64', 5000],
  ]),
  extraTargets: ['0x2222222222222222222222222222222222222222'],
});
const ordered2 = signOrderedLexiconTx({
  privateKey: freshPriv,
  nonce: 1n,
  to: '0x2222222222222222222222222222222222222222',
  data: '0x12345678',
  lowerBoundHashHex: ordered1.txHash,
});
assert.ok(ordered2.txHash > ordered1.txHash, 'Ordered tx2 hash must strictly exceed tx1 hash');
assert.equal(computeRawTxHash(signLexiconTx({
  privateKey: freshPriv,
  nonce: 1n,
  to: '0x2222222222222222222222222222222222222222',
  data: '0x12345678',
  lowerBoundHashHex: ordered1.txHash,
})), ordered2.txHash);

// 4. ABI Round-Trips
const encodedStrCall = encodeAbi('setNickname(string)', [['string', 'AdmiralVex']]);
const fakeReturnHex = '0x' + encodedStrCall.slice(10); // Strip 4-byte selector => ABI-encoded `(string)` tuple!
assert.equal(decodeAbiStringHex(fakeReturnHex), 'AdmiralVex');

const addrCall = encodeAbi('setOwner(address,uint64)', [
  ['address', kp1.address],
  ['uint64', 987654321],
]);
const argsHex = '0x' + addrCall.slice(10);
assert.equal(decodeAddrWord(argsHex, 0), kp1.address.toLowerCase());
assert.equal(decodeUintWord(argsHex, 1), 987654321);
assert.equal(bytesToHex(hexToBytes('0xdeadbeef')), '0xdeadbeef');

// 5. Pub/Sub URL Mapping & Multi-Topic / Multi-Address Filter Compilation
assert.equal(toPubSubWsUrl('wss://node1.superlexicon.com/rpc'), 'wss://node1.superlexicon.com');
assert.equal(toPubSubWsUrl('ws://127.0.0.1:8545'), 'ws://127.0.0.1:8546');
assert.equal(toPubSubWsUrl('http://localhost:8555'), 'ws://localhost:8556');
assert.ok(derivePubSubWsCandidates('ws://127.0.0.1:8545').includes('wss://node1.superlexicon.com'));

const tA = '0x' + '11'.repeat(32);
const tB = '0x' + '22'.repeat(32);
const cA = '0x' + 'aa'.repeat(20);
const compiled = compileLogsFilter({ address: [cA], topics: [[tA, tB]] });
assert.equal(compiled.serverFilters.length, 2);
assert.equal(matchesCompiledFilter({ address: cA, topics: [tB] }, compiled), true);
assert.equal(matchesCompiledFilter({ address: cA, topics: ['0x' + '33'.repeat(32)] }, compiled), false);

// 6. Headless Wallet Manager & secp256k1 ECDH Round-Trip
const kp2 = deriveKeypairInfo(freshPriv);
const sharedAB = ecdhSharedSecretBytes(kp1.privateKey, kp2.uncompressedPubKey);
const sharedBA = ecdhSharedSecretBytes(kp2.privateKey, kp1.uncompressedPubKey);
assert.equal(bytesToHex(sharedAB), bytesToHex(sharedBA), 'ECDH symmetry failed');
const secretClue = new Uint8Array([1, 14, 99, 204, 77]);
const cipher = ecdhXorTransform(sharedAB, 'CASE_42', secretClue);
assert.notEqual(bytesToHex(cipher), bytesToHex(secretClue));
const plain = ecdhXorTransform(sharedBA, 'CASE_42', cipher);
assert.equal(bytesToHex(plain), bytesToHex(secretClue), 'ECDH stream decrypt failed');

const w = new SlxWalletManager({ privateKey: kp1.privateKey });
assert.equal(w.keypair.address, kp1.address);
w.saveIdentityRecord({ identityAddr: cA, nickname: 'Valkyrie' });
assert.equal(w.getIdentityRecord().nickname, 'Valkyrie');

// 7. Unified Social Graph & Handshake Vectors
assert.equal(
  SUBNET1_FLEET_SOCIAL_DEFAULT.charter,
  '0xdc68f6666864931d83a85f14189489679d5ef0ee',
  'Default SocialCharter must point to Unified Fleet/Subnet Guild'
);
const idA = '0x' + '12'.repeat(20);
const idB = '0x' + '34'.repeat(20);
const encNonce = deterministicEncounterNonce(SUBNET1_FLEET_SOCIAL_DEFAULT.charter, idA, idB);
const encCommit = computeEncounterCommit(SUBNET1_FLEET_SOCIAL_DEFAULT.charter, idA, idB, encNonce);
assert.equal(encNonce.length, 66);
assert.equal(encCommit.length, 66);
assert.notEqual(
  deterministicEncounterNonce(SUBNET1_FLEET_SOCIAL_DEFAULT.charter, idB, idA),
  encNonce,
  'Handshake nonce must be directional (initiator -> target)'
);
assert.equal(appChannelHash('DEX'), appChannelHash('dex'));
assert.ok(SlxSocialAbi.sendDirectMessage(idB, 'Hello ally').startsWith(selectorHex('sendDirectMessage(address,bytes)')));

console.log('✅ @superlexicon/sdk unit test suite passed (7/7 test groups)!');
process.exit(0);
