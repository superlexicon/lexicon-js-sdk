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
  computeCreateAddress,
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
  SlxSubnetManager,
  SlxWalletManager,
  SlxCallCache,
  SlxIdentityDirectory,
  createSingleFlightRefresh,
  fetchRegisteredHolders,
  isTerminalAuthStatus,
  HFS_ASSOC_STATUS,
  encodeHfsTypeId,
  decodeHfsTypeIdHex,
  packHfsAssociationBatch,
  decodeIdentityHfsSliceHex,
  IdentityHfsWhitelistAbi,
  classifyHfsInstancesForIdentity,
  u64BEBytes,
  u16BEBytes,
  concatBytes,
  utf8ToBytes,
  wordU64,
  wordAddress,
  SUBNET1_FLEET_SOCIAL_DEFAULT,
  deterministicEncounterNonce,
  computeEncounterCommit,
  appChannelHash,
  SlxSocialAbi,
  sha512Bytes,
  CONF_CAT_IDS,
  IDENTITY_CIPHERTEXT_64,
  deriveIdentityEncryptionKeys,
  deriveCompanyAuditKeypair,
  deriveCategoryPeriodSubkey,
  wrapSecretForRecipientSecp,
  unwrapSecretWithPrivKey,
  encryptJsonWithSubkey,
  decryptJsonWithSubkey,
  heAddCiphertexts,
  decryptElGamalU24,
  proveHeRangeU24,
  verifyHeRangeU24,
  proveHeSumEqualsU64,
  verifyHeSumEqualsU64,
  proveStealthNonInsider,
  verifyStealthNonInsider,
  proveEd25519Schnorr,
  verifyEd25519Schnorr,
  randomEdScalar,
  buildConfidentialPayableBatchTx,
  deriveIdentityMasterSeedBytes32,
  wrapMasterSeedForDevice,
  unwrapMasterSeedWithDeviceKey,
  encryptShareWithPassphrase,
  decryptShareWithPassphrase,
  splitSecretPedersenVss,
  proveBlindedRecoveryShare,
  unblindAndRecoverMasterSeed,
  deriveRecoverySessionKeypair,
  GUARDIAN_SHARE_WRAP_TAG,
  computeCanonicalRosterHashes,
  generateChannelAesKey256,
  wrapChannelKeyForMembers,
  unwrapChannelKeyForEpoch,
  buildTopicMessageAad,
  encryptTopicMessageAesGcm,
  decryptTopicMessageAesGcm,
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
// Official Ethereum CREATE RLP vector: sender 0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0, nonce 0 & nonce 1
assert.equal(
  computeCreateAddress('0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0', 0n),
  '0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d'
);
assert.equal(
  computeCreateAddress('0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0', 1n),
  '0x343c43a37d37dff08ae8c4a11544c718abb4fcf8'
);

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
  '0x56205f6cade15085906ff1def11fb03ab40a8eb8',
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

// 8. Single-Flight Refresh Coalescing (`createSingleFlightRefresh`)
{
  const seenBlocks = [];
  let activeCount = 0;
  let maxConcurrent = 0;
  const sf = createSingleFlightRefresh(async (meta) => {
    activeCount++;
    maxConcurrent = Math.max(maxConcurrent, activeCount);
    seenBlocks.push(meta?.blockNumber || 0);
    await new Promise((r) => setTimeout(r, 15));
    activeCount--;
  });
  await Promise.all([
    sf({ blockNumber: 100 }),
    sf({ blockNumber: 101 }),
    sf({ blockNumber: 105 }),
    sf({ blockNumber: 103 }),
  ]);
  assert.equal(maxConcurrent, 1, 'Single-flight refresh must never overlap');
  assert.deepEqual(seenBlocks, [100, 105], 'Coalesced follow-up must keep highest blockNumber');
}

// 9. `SlxCallCache` In-Flight Deduplication, Block Memoization & Conditional Terminal Freeze
{
  let rpcCalls = 0;
  const cache = new SlxCallCache({
    callFn: async (_to, dataHex) => {
      rpcCalls++;
      await new Promise((r) => setTimeout(r, 8));
      return '0x' + dataHex.slice(2, 10).padStart(64, '0');
    },
  });
  const [r1, r2, r3] = await Promise.all([
    cache.call(cA, '0x95d89b41', { immutable: true }),
    cache.call(cA, '0x95d89b41', { immutable: true }),
    cache.call(cA, '0x95d89b41', { immutable: true }),
  ]);
  assert.equal(r1, r2);
  assert.equal(r2, r3);
  assert.equal(rpcCalls, 1, 'Concurrent identical calls must deduplicate into 1 RPC');
  await cache.callImmutable(cA, '0x95d89b41');
  assert.equal(rpcCalls, 1, 'Immutable call must remain permanently cached');

  let authQueries = 0;
  let simStatus = 1;
  const queryRes = () =>
    cache.getOrComputeImmutable(
      'auth:0xabc',
      async () => {
        authQueries++;
        return { status: simStatus };
      },
      (v) => isTerminalAuthStatus(v.status)
    );
  assert.equal((await queryRes()).status, 1);
  assert.equal(authQueries, 1);
  simStatus = 4; // Enacted!
  assert.equal((await queryRes()).status, 4);
  assert.equal(authQueries, 2);
  simStatus = 99; // Should never be read again once frozen at status=4!
  assert.equal((await queryRes()).status, 4);
  assert.equal(authQueries, 2, 'Terminal Authorization must be frozen at 0 repeat RPCs');
  assert.equal(isTerminalAuthStatus(4, { pendingClaims: 2 }), false);
  assert.equal(isTerminalAuthStatus(4, { pendingClaims: 0 }), true);
  assert.equal(isTerminalAuthStatus(1, { failedBidsStage: true }), true);
}

// 10. `SlxIdentityDirectory` Debounced Batch Repaint + `fetchRegisteredHolders`
{
  let notifyCount = 0;
  let lookupCount = 0;
  const dir = new SlxIdentityDirectory({
    wallet: w,
    debounceMs: 25,
    persistToStorage: false,
    onLabelsUpdated: () => {
      notifyCount++;
    },
    resolverFn: async (addrLow) => {
      lookupCount++;
      await new Promise((r) => setTimeout(r, 5));
      return { nick: `Handle_${addrLow.slice(2, 6)}`, owner: kp1.address };
    },
  });
  dir.setMyIdentity(idA, 'Founder');
  assert.ok(dir.labelFor(idA).includes('(You)'));

  const idC = '0x' + '56'.repeat(20);
  // Trigger 6 synchronous renders for 2 uncached identities
  for (let i = 0; i < 3; i++) {
    dir.labelFor(idB);
    dir.labelFor(idC);
  }
  assert.equal(lookupCount, 2, 'Directory must deduplicate per-address RPC lookups');
  await new Promise((r) => setTimeout(r, 55));
  assert.equal(notifyCount, 1, 'Debounced directory must batch multiple resolved handles into 1 repaint');
  assert.ok(dir.labelFor(idB).startsWith('Handle_3434'));

  const cntSel = selectorHex('registeredHolderCount()');
  const holders = await fetchRegisteredHolders('ws://127.0.0.1:8545', cA, {
    callFn: async (_to, data) => {
      if (data.startsWith(cntSel)) return bytesToHex(wordU64(2));
      const idx = decodeUintWord('0x' + data.slice(10), 0);
      return bytesToHex(wordAddress(idx === 0 ? idA : idB));
    },
  });
  assert.deepEqual(holders, [idA, idB]);
}

// 11. Identity HFS Subroutine Whitelist Binary Slice & Spam Classification
{
  const chrTypeHex = encodeHfsTypeId('CORPORATE_CHARTER');
  assert.equal(decodeHfsTypeIdHex(chrTypeHex), 'CORPORATE_CHARTER');

  const hfsValid = '0x' + 'c1'.repeat(20);
  const hfsPending = '0x' + 'c2'.repeat(20);
  const hfsSpam = '0x' + 'c3'.repeat(20);
  const hfsPublic = '0x' + 'c4'.repeat(20);
  const hfsSpoof = '0x' + 'c5'.repeat(20);

  const batchPacked = packHfsAssociationBatch([
    { hfsAddr: hfsValid, typeName: 'CORPORATE_CHARTER', status: HFS_ASSOC_STATUS.WHITELISTED, label: 'Aegis Corp' },
    { hfsAddr: hfsSpam, typeName: 'CORPORATE_CHARTER', status: HFS_ASSOC_STATUS.SPAM, label: 'Phishing Corp' },
  ]);
  assert.ok(batchPacked.length > 100);
  assert.ok(
    IdentityHfsWhitelistAbi.setHfsAssociation(hfsValid, chrTypeHex, 2, 'Aegis').startsWith(
      selectorHex('setHfsAssociation(address,bytes32,uint64,string)')
    )
  );

  // Build binary slice matching `identity.wasm` v2 `getHfsAssociationsSlice`
  const buildRec = (idx, status, addr, typeHex, blk, actor, lblStr) => {
    const lblB = utf8ToBytes(lblStr);
    return concatBytes(
      u64BEBytes(idx),
      new Uint8Array([status]),
      hexToBytes(addr),
      hexToBytes(typeHex),
      u64BEBytes(blk),
      hexToBytes(actor),
      u16BEBytes(lblB.length),
      lblB
    );
  };
  const sliceBytes = concatBytes(
    u64BEBytes(3),
    u64BEBytes(3),
    buildRec(0, HFS_ASSOC_STATUS.WHITELISTED, hfsValid, chrTypeHex, 91001, kp1.address, 'Aegis Corp'),
    buildRec(1, HFS_ASSOC_STATUS.PENDING, hfsPending, chrTypeHex, 91002, kp2.address, 'Invited Venture'),
    buildRec(2, HFS_ASSOC_STATUS.SPAM, hfsSpam, chrTypeHex, 91003, kp2.address, 'Phishing Corp')
  );
  const decoded = decodeIdentityHfsSliceHex(bytesToHex(sliceBytes));
  assert.equal(decoded.totalCount, 3);
  assert.equal(decoded.items.length, 3);
  assert.equal(decoded.items[0].status, HFS_ASSOC_STATUS.WHITELISTED);
  assert.equal(decoded.items[0].typeName, 'CORPORATE_CHARTER');
  assert.equal(decoded.items[0].label, 'Aegis Corp');
  assert.equal(decoded.items[1].status, HFS_ASSOC_STATUS.PENDING);
  assert.equal(decoded.items[2].status, HFS_ASSOC_STATUS.SPAM);

  const byAddr = new Map(decoded.items.map((x) => [x.hfsAddr, x]));
  const classified = await classifyHfsInstancesForIdentity(
    [
      { primaryAddr: hfsValid, selectionKey: hfsValid, label: 'Aegis Corp', creatorEoa: kp1.address, creatorIdentity: idA, meta: {} },
      { primaryAddr: hfsPending, selectionKey: hfsPending, label: 'Invited Venture', creatorEoa: kp2.address, creatorIdentity: idB, meta: {} },
      { primaryAddr: hfsSpam, selectionKey: hfsSpam, label: 'Phishing Corp', creatorEoa: kp2.address, creatorIdentity: idB, meta: {} },
      { primaryAddr: hfsSpoof, selectionKey: hfsSpoof, label: 'Spoofed Creator Corp', creatorEoa: kp2.address, creatorIdentity: idA, meta: {} },
      { primaryAddr: hfsPublic, selectionKey: hfsPublic, label: 'Public Showcase Corp', creatorEoa: kp2.address, creatorIdentity: idB, meta: {} },
    ],
    {
      typeName: 'CORPORATE_CHARTER',
      identityAddr: idA,
      myEoa: kp1.address,
      assocByAddr: byAddr,
      manifest: {},
      callFn: async () => '0x0',
    }
  );
  assert.deepEqual(
    classified.whitelistedItems.map((x) => x.primaryAddr),
    [hfsValid],
    'Whitelisted subroutine must appear in whitelistedItems'
  );
  assert.deepEqual(
    classified.publicItems.map((x) => x.primaryAddr),
    [hfsPublic],
    'Unassociated public subroutine must appear in publicItems'
  );
  assert.deepEqual(
    classified.spamItems.map((x) => x.primaryAddr),
    [hfsPending, hfsSpam, hfsSpoof],
    'Pending, Blocked Spam, and Spoofed-Creator subroutines must be quarantined in spamItems'
  );
}

// 12. Stale / Post-Reset Identity Cache Eviction & Preferred Nickname Preservation
{
  const wReset = new SlxWalletManager({ privateKey: kp2.privateKey });
  wReset.saveIdentityRecord({
    identityAddr: '0x2222222222222222222222222222222222222222',
    nickname: 'CaptainSable',
  });
  assert.equal(wReset.getPreferredNickname(), 'CaptainSable');
  wReset.clearIdentityRecord();
  assert.equal(wReset.getIdentityRecord(), null, 'Cleared identity record must return null');
  assert.equal(
    wReset.getPreferredNickname(),
    'CaptainSable',
    'Preferred nickname must survive identity cache eviction for 1-click redeploy'
  );
}

// 13. Confidential Accounting & Shielded Settlement Cryptography (SHA-512, u24 Range, DLEQ Sum, IAS 24 Stealth, ECDH/KDF)
{
  // FIPS 180-4 SHA-512("abc") vector
  assert.equal(
    bytesToHex(sha512Bytes('abc'), false),
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
      '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    'FIPS 180-4 SHA-512("abc") vector mismatch'
  );

  const charterAddr = '0x9999999999999999999999999999999999999999';
  const auditKey = deriveCompanyAuditKeypair('0x' + '42'.repeat(32), charterAddr, 1);
  const cfoId = '0x1111111111111111111111111111111111111111';
  const empId = '0x2222222222222222222222222222222222222222';
  const clientId = '0x3333333333333333333333333333333333333333';
  const cfoKeys = deriveIdentityEncryptionKeys(kp1.privateKey, cfoId);
  const empKeys = deriveIdentityEncryptionKeys(kp2.privateKey, empId);
  const clientPriv = generatePrivateKeyHex();
  const clientKeys = deriveIdentityEncryptionKeys(clientPriv, clientId);

  // Officer ECDH audit key wrap / unwrap + wrong-key rejection
  const wrappedAudit = wrapSecretForRecipientSecp(auditKey.secretLeBytes32, cfoKeys.secpPub64Bytes);
  const unwrappedAudit = unwrapSecretWithPrivKey(wrappedAudit, kp1.privateKey);
  assert.equal(bytesToHex(unwrappedAudit), auditKey.secretHex32);
  assert.equal(unwrapSecretWithPrivKey(wrappedAudit, kp2.privateKey), null);

  // Scoped (Category, Period) KDF subkey JSON cipher
  const subkey = deriveCategoryPeriodSubkey(unwrappedAudit, CONF_CAT_IDS.PAYROLL, 'FY2026-M11');
  const encJson = encryptJsonWithSubkey(subkey, { total: 42500, lines: [18000, 24500] });
  assert.deepEqual(decryptJsonWithSubkey(subkey, encJson), { total: 42500, lines: [18000, 24500] });

  // 24-bit non-negative ZK range proofs + homomorphic sum DLEQ + BSGS ElGamal decryption
  const ctxPrefix = utf8ToBytes('TEST_CONF_PAYROLL');
  const rowVals = [18000, 24500, 0, 0];
  let cSum = IDENTITY_CIPHERTEXT_64;
  let rSum = 0n;
  for (let s = 0; s < rowVals.length; s++) {
    const prf = proveHeRangeU24(auditKey.pub32Bytes, rowVals[s], ctxPrefix, s);
    const recCt = verifyHeRangeU24(auditKey.pub32Bytes, ctxPrefix, s, prf.proof4608);
    assert.ok(recCt, `Slot ${s} 24-bit range proof must verify`);
    assert.equal(bytesToHex(recCt), bytesToHex(prf.ct64));
    assert.equal(decryptElGamalU24(auditKey.secretScalar, recCt), rowVals[s]);
    cSum = heAddCiphertexts(cSum, recCt);
    rSum += prf.rScalar;
  }
  const sumCtx = utf8ToBytes('TEST_SUM_CTX');
  const sumDleq = proveHeSumEqualsU64(auditKey.pub32Bytes, rSum, sumCtx);
  assert.equal(verifyHeSumEqualsU64(auditKey.pub32Bytes, cSum, 42500, sumCtx, sumDleq), true);
  assert.equal(verifyHeSumEqualsU64(auditKey.pub32Bytes, cSum, 42501, sumCtx, sumDleq), false);

  // IAS 24 Stealth Bilateral Co-Sign & Charter Insider Non-Membership Proof
  const rho = randomEdScalar();
  const iasCtx = utf8ToBytes('IAS24_CONTRACT_0');
  const stealth = proveStealthNonInsider(
    rho,
    clientKeys.edPub32Bytes,
    [cfoKeys.edPub32Bytes],
    iasCtx
  );
  assert.equal(
    verifyStealthNonInsider(
      stealth.stealthH32,
      stealth.blindedClientPk32,
      [cfoKeys.edPub32Bytes],
      iasCtx,
      stealth.proofBlob
    ),
    true
  );
  const cosignSig = proveEd25519Schnorr(clientKeys.edSecretScalar, stealth.stealthH32, utf8ToBytes('COSIGN_0'));
  assert.equal(verifyEd25519Schnorr(stealth.stealthH32, stealth.blindedClientPk32, utf8ToBytes('COSIGN_0'), cosignSig), true);
  assert.throws(() =>
    proveStealthNonInsider(rho, cfoKeys.edPub32Bytes, [cfoKeys.edPub32Bytes], iasCtx)
  );

  // High-level Confidential Payable Batch builder (auto-pads 1 employee -> 4 slots)
  const built = buildConfidentialPayableBatchTx({
    confLedgerAddr: '0x4444444444444444444444444444444444444444',
    accountingLedgerAddr: '0x5555555555555555555555555555555555555555',
    treasuryIdentityAddr: '0x6666666666666666666666666666666666666666',
    batchId: 0,
    auditPub32Hex: auditKey.pub32Hex,
    subkey32: subkey,
    items: [
      {
        recipientIdentity: empId,
        recipientLabel: 'Employee #1',
        recipientSecpPub64Hex: empKeys.secpPub64Hex,
        amount: 16500,
        memo: 'Nov Salary',
      },
    ],
  });
  assert.equal(built.slotCount, 4);
  assert.equal(built.totalAmount, 16500);
  assert.ok(built.calldata.startsWith('0x') && built.calldata.length > 36000);
}

// 14. Zero-Trusted-Setup Bulletproofs Range + Sparse R1CS + Cipher Noir ZK Suite
{
  const {
    BP_H_BLIND_HEX,
    bpGenerators,
    bpProveRangeU64Batch,
    bpVerifyRangeU64Batch,
    BpCsBuilder,
    BP_WIRE_A_L,
    BP_WIRE_A_R,
    BP_WIRE_A_O,
    BP_WIRE_VAR,
    bpProveR1cs,
    bpVerifyR1cs,
    edEncode,
    edMul,
    ED_BASE_PT,
    deriveNoirSeatSecrets,
    proveNoirInitialShuffle,
    proveNoirPassAlibi,
    proveNoirWhisperOr3,
    decryptNoirWhisper,
  } = await import('../src/index.js');

  // Verify H_bp generator matches Rust `BP_H_BLIND_BYTES` byte-for-byte!
  assert.equal(bytesToHex(edEncode(bpGenerators(0).hBlind)), BP_H_BLIND_HEX);

  // Batch u64 range proof roundtrip & tamper rejection
  const { commits: rComms, proof: rPrf } = bpProveRangeU64Batch(
    [0n, 42n, 999999n, 18446744073709551615n],
    [11n, 22n, 33n, 44n],
    64,
    'js-range-ctx'
  );
  assert.equal(bpVerifyRangeU64Batch(rComms, 64, 'js-range-ctx', rPrf), true);
  assert.equal(bpVerifyRangeU64Batch(rComms, 64, 'wrong-ctx', rPrf), false);

  // Sparse R1CS `x * y = 42`
  const cs = new BpCsBuilder(2, 2)
    .addConstraint(0n, [
      [BP_WIRE_A_L, 0, 1n],
      [BP_WIRE_VAR, 0, -1n],
    ])
    .addConstraint(0n, [
      [BP_WIRE_A_R, 0, 1n],
      [BP_WIRE_VAR, 1, -1n],
    ])
    .addConstraint(42n, [[BP_WIRE_A_O, 0, 1n]]);
  const { commits: cComms, proof: cPrf } = bpProveR1cs(
    cs,
    [6n, 7n],
    [101n, 202n],
    [6n, 0n],
    [7n, 0n],
    [42n, 0n],
    'js-r1cs'
  );
  assert.equal(bpVerifyR1cs(cs, cComms, 'js-r1cs', cPrf), true);

  // Cipher Noir deterministic seat keys, initial 18-card ZK shuffle, passAlibi R1CS & 1-of-3 whisper
  const fakeEpochPk = edEncode(edMul(123456789n, ED_BASE_PT));
  const cid = '0x' + '42'.repeat(32);
  const s0 = deriveNoirSeatSecrets(freshPriv, cid, kp1.address, fakeEpochPk);
  const s1 = deriveNoirSeatSecrets(
    '0x0000000000000000000000000000000000000000000000000000000000000002',
    cid,
    kp1.address,
    fakeEpochPk
  );
  assert.equal(s0.seatKeyBlob.length, 512);

  const shuf1 = proveNoirInitialShuffle(cid, fakeEpochPk);
  assert.equal(shuf1.length, 3616);

  const passPrf = proveNoirPassAlibi({
    caseId: cid,
    probeIdx: 0,
    responderSeat: 0,
    cards3: [1, 6, 12],
    wSk3: s0.wSk,
    probes3: [2, 7, 14],
  });
  assert.equal(passPrf.length, 672);
  assert.throws(() =>
    proveNoirPassAlibi({
      caseId: cid,
      probeIdx: 0,
      responderSeat: 0,
      cards3: [1, 7, 12],
      wSk3: s0.wSk,
      probes3: [2, 7, 14],
    })
  );

  const whisperPrf = proveNoirWhisperOr3({
    caseId: cid,
    probeIdx: 0,
    responderSeat: 0,
    proberSeat: 1,
    slotIdx: 1,
    card: 6,
    wBlind: s0.wSk[1],
    proberEdPk: s1.edPkBytes,
    probes3: [2, 6, 14],
  });
  assert.equal(whisperPrf.length, 352);
  assert.equal(decryptNoirWhisper(whisperPrf.slice(0, 64), s1.edSk), 6);
}

// 15. Multi-Device Seed Wrapping + 2-of-3 Lossless 256-Bit Pedersen-VSS Blinded Shamir Recovery
{
  const aliceId = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const dev1Priv = generatePrivateKeyHex();
  const dev2Kp = deriveKeypairInfo(generatePrivateKeyHex());
  const dev2Pub64 = hexToBytes(dev2Kp.uncompressedPubKey).slice(1, 65);
  const oracleSlotKp = deriveKeypairInfo(generatePrivateKeyHex());
  const oracleSlotPub64 = hexToBytes(oracleSlotKp.uncompressedPubKey).slice(1, 65);

  // Test full 256-bit secret with high bits >= 0xf8 (> ED25519_L!)
  const full256Seed = hexToBytes('0xfefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeddccbbaa99887766554433221100ff');
  const wrappedDev2 = wrapMasterSeedForDevice(full256Seed, dev2Pub64);
  const unwrappedDev2 = unwrapMasterSeedWithDeviceKey(wrappedDev2, dev2Kp.privateKey);
  assert.equal(bytesToHex(unwrappedDev2), bytesToHex(full256Seed));

  const mSeed = deriveIdentityMasterSeedBytes32(dev1Priv, aliceId);
  assert.equal(mSeed.length, 32);

  // Split 2-of-3: Share #0 = Oracle Slot ECIES, Share #1 = Friend, Share #2 = Passphrase AES-256-GCM
  const vss = splitSecretPedersenVss(full256Seed, 2, 3);
  assert.equal(vss.vssCommitsPacked.length, 128);
  assert.equal(vss.shares.length, 3);

  const oracleEnv = wrapSecretForRecipientSecp(
    vss.shares[0].plainShare128,
    oracleSlotPub64,
    GUARDIAN_SHARE_WRAP_TAG
  );
  const passEnv = await encryptShareWithPassphrase(
    vss.shares[2].plainShare128,
    'Sovereign-Horse-Battery-Staple-2026!',
    aliceId
  );
  const passDecrypted = await decryptShareWithPassphrase(
    passEnv,
    'Sovereign-Horse-Battery-Staple-2026!',
    aliceId
  );
  assert.equal(bytesToHex(passDecrypted), bytesToHex(vss.shares[2].plainShare128));
  await assert.rejects(() =>
    decryptShareWithPassphrase(passEnv, 'Wrong-Passphrase', aliceId)
  );

  // Replacement device initiates session #7 and unblinds shares #0 + #2 in local RAM!
  const newDevPriv = generatePrivateKeyHex();
  const newSessionKeys = deriveRecoverySessionKeypair(newDevPriv, aliceId);
  const oracleSharePlain = unwrapSecretWithPrivKey(
    oracleEnv,
    oracleSlotKp.privateKey,
    GUARDIAN_SHARE_WRAP_TAG
  );
  const p0 = proveBlindedRecoveryShare({
    identityAddr: aliceId,
    sessionId: 7,
    shareIdx: 0,
    newOwnerEoa: newSessionKeys.eoa,
    newDeviceEdPub32: newSessionKeys.edPub32Bytes,
    p0Bytes: vss.shares[0].p0Bytes,
    p1Bytes: vss.shares[0].p1Bytes,
    plainShare128: oracleSharePlain,
  });
  const p2 = proveBlindedRecoveryShare({
    identityAddr: aliceId,
    sessionId: 7,
    shareIdx: 2,
    newOwnerEoa: newSessionKeys.eoa,
    newDeviceEdPub32: newSessionKeys.edPub32Bytes,
    p0Bytes: vss.shares[2].p0Bytes,
    p1Bytes: vss.shares[2].p1Bytes,
    plainShare128: passDecrypted,
  });
  assert.equal(p0.proofBytes.length, 416);
  assert.equal(p2.proofBytes.length, 416);

  const toStored96 = (prf) => {
    const out = new Uint8Array(96);
    out.set(prf.slice(0, 32), 0); // R_i
    out.set(prf.slice(64, 96), 32); // z_0
    out.set(prf.slice(160, 192), 64); // z_1
    return out;
  };

  const recovered = unblindAndRecoverMasterSeed({
    identityAddr: aliceId,
    sessionId: 7,
    newDeviceEdSecretScalar: newSessionKeys.edSecretScalar,
    newDeviceEdPub32: newSessionKeys.edPub32Bytes,
    threshold: 2,
    submittedShares: [
      { shareIdx: 0, hasBlinded: true, blinded96Bytes: toStored96(p0.proofBytes) },
      { shareIdx: 2, hasBlinded: true, blinded96Bytes: toStored96(p2.proofBytes) },
    ],
  });
  assert.equal(bytesToHex(recovered.masterSeedBytes32), bytesToHex(full256Seed));
}

// 16. ECIES Roster Deduplication + AES-256-GCM Topic Message AEAD & Key-Epoch Wrapping
{
  const msgHfs = '0xa6f1c6069dab07f854fd707cf68fcc413874e944';
  const idA = '0x00000000000000000000000000000000000000a1';
  const idB = '0x00000000000000000000000000000000000000b2';
  const idC = '0x00000000000000000000000000000000000000c3';

  const keysA = deriveIdentityEncryptionKeys(generatePrivateKeyHex(), idA);
  const keysB = deriveIdentityEncryptionKeys(generatePrivateKeyHex(), idB);
  const keysC = deriveIdentityEncryptionKeys(generatePrivateKeyHex(), idC);

  // Order-independent canonical public-key roster hash ([B, C, A] === [A, B, C])
  const r1 = computeCanonicalRosterHashes([
    { identityAddr: idB, secpPub64Bytes: keysB.secpPub64Bytes },
    { identityAddr: idC, secpPub64Bytes: keysC.secpPub64Bytes },
    { identityAddr: idA, secpPub64Bytes: keysA.secpPub64Bytes },
  ]);
  const r2 = computeCanonicalRosterHashes([
    { identityAddr: idA, secpPub64Bytes: keysA.secpPub64Bytes },
    { identityAddr: idB, secpPub64Bytes: keysB.secpPub64Bytes },
    { identityAddr: idC, secpPub64Bytes: keysC.secpPub64Bytes },
  ]);
  assert.equal(r1.pkRosterHash, r2.pkRosterHash);
  assert.equal(r1.idRosterHash, r2.idRosterHash);

  const aesKey = generateChannelAesKey256();
  const packedWraps = wrapChannelKeyForMembers(aesKey, [
    { identityAddr: idA, secpPub64Bytes: keysA.secpPub64Bytes },
    { identityAddr: idB, secpPub64Bytes: keysB.secpPub64Bytes },
  ]);
  // First entry: [count=2(1B)][idA(20B)][wrapLen(2B)][wrapBytes]
  const wLenA = (packedWraps[21] << 8) | packedWraps[22];
  const envA = packedWraps.slice(23, 23 + wLenA);
  const unwrappedByA = unwrapChannelKeyForEpoch(envA, keysA.secpPrivHex);
  assert.equal(bytesToHex(unwrappedByA), bytesToHex(aesKey));
  assert.equal(unwrapChannelKeyForEpoch(envA, keysC.secpPrivHex), null);

  const cid = r1.pkRosterHash;
  const aad = buildTopicMessageAad(msgHfs, cid, 1, 2, idA);
  const frame = await encryptTopicMessageAesGcm(aesKey, 'Confidential Q4 treasury allocation ready.', aad);
  const dec = await decryptTopicMessageAesGcm(unwrappedByA, frame, aad);
  assert.equal(dec.text, 'Confidential Q4 treasury allocation ready.');

  // Author spoofing or cross-topic replay (`topicId = 0` instead of `1`) MUST fail GCM tag check!
  const spoofedAuthorAad = buildTopicMessageAad(msgHfs, cid, 1, 2, idB);
  assert.equal(await decryptTopicMessageAesGcm(unwrappedByA, frame, spoofedAuthorAad), null);
  const wrongTopicAad = buildTopicMessageAad(msgHfs, cid, 0, 2, idA);
  assert.equal(await decryptTopicMessageAesGcm(unwrappedByA, frame, wrongTopicAad), null);
}

// 17. Protocol-Native SubnetWorldMap Auto-Discovery on HTTPS & LAN (`SlxSubnetManager`)
{
  const store = new Map();
  const prevLs = globalThis.localStorage;
  const prevWin = globalThis.window;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  try {
    store.set(
      'slx_discovered_subnets_meta_v1',
      JSON.stringify({
        thisSubnet: {
          subnet_id: '00000001',
          name: 'Subnet 1 — 915 MHz LR2021 RF',
          transport: 'flrc',
          tip_height: 3250,
          validator_count: 4,
          public_rpc_url: 'wss://node1.superlexicon.com/rpc',
          public_ws_url: 'wss://node1.superlexicon.com',
          hfs_registry: '0xe1dc7648205c3704eba81797325e6163a9404d64',
        },
        roamingSubnets: [
          {
            subnet_id: '6eaa3da4',
            last_channel_hz: 1,
            tip_height: 88,
            validator_count: 3,
            name: 'Subnet 2 — Encrypted TCP/IP Mesh',
            transport: 'tcp',
            public_rpc_url: 'wss://node6.superlexicon.com/rpc',
            public_ws_url: 'wss://node6.superlexicon.com',
            lan_rpc_url: 'ws://192.168.50.91:18545',
            lan_ws_url: 'ws://192.168.50.91:18566',
            manifest_url: '/contracts/subnet2-deployments.json',
            hfs_registry: '',
          },
          {
            subnet_id: 'a1b2c3d4',
            last_channel_hz: 917_000_000,
            tip_height: 512,
            validator_count: 4,
            name: 'Subnet 3 — Alpine RF Relay',
            transport: 'flrc',
            public_rpc_url: 'wss://node9.superlexicon.com/rpc',
            public_ws_url: 'wss://node9.superlexicon.com',
            lan_rpc_url: 'ws://192.168.50.99:8545',
            lan_ws_url: 'ws://192.168.50.99:8566',
            manifest_url: '',
            hfs_registry: '0x1111111111111111111111111111111111111111',
          },
        ],
      })
    );

    // Simulate HTTPS deployment (`https://superlexicon.com`): all 3 subnets appear with WSS endpoints!
    globalThis.window = {
      location: { protocol: 'https:', hostname: 'superlexicon.com', href: 'https://superlexicon.com/' },
      dispatchEvent: () => {},
    };
    const httpsSubs = SlxSubnetManager.listSubnets();
    assert.equal(httpsSubs.length, 3);
    assert.equal(httpsSubs[0].subnetId, '00000001');
    assert.equal(httpsSubs[0].rpcUrl, 'wss://node1.superlexicon.com/rpc');
    assert.equal(httpsSubs[1].key, 'subnet2');
    assert.equal(httpsSubs[1].subnetId, '6eaa3da4');
    assert.equal(httpsSubs[1].transport, 'tcp');
    assert.equal(httpsSubs[1].rpcUrl, 'wss://node21.superlexicon.com/rpc');
    assert.deepEqual(httpsSubs[1].pubsubWsUrls, [
      'wss://node21.superlexicon.com',
      'wss://node22.superlexicon.com',
      'wss://node23.superlexicon.com',
    ]);
    assert.equal(httpsSubs[1].validatorNodes.length, 3);
    assert.equal(httpsSubs[2].key, 'subnet_a1b2c3d4');
    assert.equal(httpsSubs[2].rpcUrl, 'wss://node9.superlexicon.com/rpc');
    assert.equal(httpsSubs[2].hfsRegistry, '0x1111111111111111111111111111111111111111');

    // Verify strict cross-subnet isolation: when Subnet 2 is active, pub/sub candidates use node21..node23 and NEVER fall back to Subnet 1's node1..node5!
    globalThis.window.__SLX_ACTIVE_SUBNET__ = httpsSubs[1];
    const s2PubSubCands = derivePubSubWsCandidates('wss://node6.superlexicon.com/rpc');
    assert.deepEqual(s2PubSubCands, [
      'wss://node21.superlexicon.com',
      'wss://node22.superlexicon.com',
      'wss://node23.superlexicon.com',
    ]);
    assert.ok(!s2PubSubCands.includes('wss://node1.superlexicon.com'));

    // Also verify simultaneous multi-subnet phase subscription isolation: while Subnet 1 is active, subscribing to Subnet 2's RPC uses ONLY node21..node23!
    globalThis.window.__SLX_ACTIVE_SUBNET__ = httpsSubs[0];
    const simultaneousS2Cands = derivePubSubWsCandidates('wss://node21.superlexicon.com/rpc');
    assert.deepEqual(simultaneousS2Cands, [
      'wss://node21.superlexicon.com',
      'wss://node22.superlexicon.com',
      'wss://node23.superlexicon.com',
    ]);
    assert.ok(!simultaneousS2Cands.includes('wss://node1.superlexicon.com'));

    // Simulate LAN deployment (`http://192.168.50.93:5173`): all 3 subnets use LAN WS endpoints!
    globalThis.window = {
      location: { protocol: 'http:', hostname: '192.168.50.93', href: 'http://192.168.50.93:5173/' },
      dispatchEvent: () => {},
    };
    const lanSubs = SlxSubnetManager.listSubnets();
    assert.equal(lanSubs.length, 3);
    assert.equal(lanSubs[1].rpcUrl, 'ws://192.168.50.91:18545');
    assert.equal(lanSubs[2].rpcUrl, 'ws://192.168.50.99:8545');
  } finally {
    globalThis.localStorage = prevLs;
    globalThis.window = prevWin;
  }
}

// 18. Generic Multi-Scale Subnet World Map Projection, Auto-Fit Camera & Protocol GPS Hydration
{
  const {
    latLonToMapXY,
    mapXYToLatLon,
    lonToMercX,
    latToMercY,
    mercXToLon,
    mercYToLat,
    computeAutoFitCamera,
    chooseGraticuleStep,
    extractLiveGpsFromStats,
    formatLatLon,
    MAP_BASE_W,
    MAP_BASE_H,
  } = await import('../src/ui/index.js');
  const { SlxSubnetManager } = await import('../src/rpc.js');

  // Regression guard: graticule step at wide world zoom (z = 1.0..18.0) must NEVER fall through to 0.0005°!
  assert.equal(chooseGraticuleStep(1.55, MAP_BASE_W), 60);
  for (let z = 1.0; z <= 18.0; z += 0.25) {
    const step = chooseGraticuleStep(z, MAP_BASE_W);
    const degSpan = (MAP_BASE_W / (256 * Math.pow(2, z))) * 360;
    assert.ok(degSpan / step <= 16, `Too many graticule lines (${degSpan / step}) at z=${z}`);
  }

  // Verify Singapore (1.3031N, 103.9128E) lands on the exact tip of Malay Peninsula (1251, 537.5) on 1600x900 world_map.jpg
  const sgPx = latLonToMapXY(1.3031, 103.9128, 1600, 900);
  assert.ok(Math.abs(sgPx.x - 1251) < 1.5);
  assert.ok(Math.abs(sgPx.y - 537.5) < 1.5);

  // Verify generic Web-Mercator multi-scale `computeAutoFitCamera` across 3 completely different geographic scales:
  // Scale A — Neighborhood (~130m across Marine Crescent Blk 28/29/33/35): auto-centers on Marine Crescent & maximizes street zoom
  const mcSubnets = [
    {
      lat: 1.30308,
      lon: 103.9128,
      validatorNodes: [
        { lat: 1.30344, lon: 103.91335 }, // Blk 28
        { lat: 1.30285, lon: 103.9132 }, // Blk 29
        { lat: 1.30265, lon: 103.91218 }, // Blk 33
        { lat: 1.30337, lon: 103.91252 }, // Blk 35
      ],
    },
    {
      lat: 1.30322,
      lon: 103.91302,
      validatorNodes: [
        { lat: 1.30344, lon: 103.91335 },
        { lat: 1.30285, lon: 103.9132 },
        { lat: 1.30337, lon: 103.91252 },
      ],
    },
  ];
  const camNeighborhood = computeAutoFitCamera(mcSubnets, MAP_BASE_W, MAP_BASE_H);
  assert.ok(Math.abs(camNeighborhood.lat - 1.303045) < 0.0002);
  assert.ok(Math.abs(camNeighborhood.lon - 103.912765) < 0.0002);
  assert.ok(camNeighborhood.zoom > 16.5 && camNeighborhood.zoom <= 17.45);

  // Scale B — City (~19 km across Singapore: Marine Crescent + Jurong): auto-centers across Singapore at city zoom
  const camCity = computeAutoFitCamera(
    [
      { lat: 1.3031, lon: 103.9128 },
      { lat: 1.3331, lon: 103.7436 },
    ],
    MAP_BASE_W,
    MAP_BASE_H
  );
  assert.ok(camCity.lat > 1.31 && camCity.lat < 1.325);
  assert.ok(camCity.lon > 103.82 && camCity.lon < 103.84);
  assert.ok(camCity.zoom > 11.2 && camCity.zoom < 13.2);

  // Scale C — Intercontinental (~10,500 km: Singapore + Geneva): auto-centers on Eurasia at continental zoom
  const camGlobal = computeAutoFitCamera(
    [
      { lat: 1.3031, lon: 103.9128 },
      { lat: 46.2044, lon: 6.1432 },
    ],
    MAP_BASE_W,
    MAP_BASE_H
  );
  assert.ok(camGlobal.lat > 20 && camGlobal.lat < 30);
  assert.ok(camGlobal.lon > 50 && camGlobal.lon < 60);
  assert.ok(camGlobal.zoom > 2.0 && camGlobal.zoom < 3.8);

  // Verify Web-Mercator round-trips & `extractLiveGpsFromStats`
  const mx = lonToMercX(103.9128, 17);
  const my = latToMercY(1.3031, 17);
  assert.ok(Math.abs(mercXToLon(mx, 17) - 103.9128) < 1e-6);
  assert.ok(Math.abs(mercYToLat(my, 17) - 1.3031) < 1e-6);

  const emptyGps = extractLiveGpsFromStats({
    roamingStatus: { world_map_subnets: [{ subnet_id: '6eaa3da4', detected_lat_e7: 0, detected_lon_e7: 0 }] },
    linkMetrics: { peers: { '33b12ce4': { gps_distance_m: null } } },
  });
  assert.equal(emptyGps.ownGps, null);
  assert.equal(emptyGps.subnetGpsById.size, 0);
  assert.equal(emptyGps.peerGpsByPrefix.size, 0);

  const liveGps = extractLiveGpsFromStats({
    node_lat_e7: 13_034_400,
    node_lon_e7: 1_039_133_500,
    roamingStatus: {
      world_map_subnets: [{ subnet_id: '6eaa3da4', detected_lat_e7: 462_044_000, detected_lon_e7: 61_432_000 }],
    },
    linkMetrics: {
      peers: { '75c9f6e58d72957a': { peer_lat_e7: 13_028_500, peer_lon_e7: 1_039_132_000 } },
    },
  });
  assert.ok(Math.abs(liveGps.ownGps.lat - 1.30344) < 1e-6);
  assert.ok(Math.abs(liveGps.subnetGpsById.get('6eaa3da4').lat - 46.2044) < 1e-6);
  assert.ok(Math.abs(liveGps.peerGpsByPrefix.get('75c9f6e5').lon - 103.9132) < 1e-6);

  // Round-trip projection check for Singapore, Geneva, Tokyo, and New York
  for (const [lat, lon] of [
    [1.3031, 103.9128],
    [46.2044, 6.1432],
    [35.6762, 139.6503],
    [40.7128, -74.006],
  ]) {
    const pt = latLonToMapXY(lat, lon, MAP_BASE_W, MAP_BASE_H);
    assert.ok(pt.x >= 12 && pt.x <= MAP_BASE_W - 12);
    assert.ok(pt.y >= 12 && pt.y <= MAP_BASE_H - 12);
    const inv = mapXYToLatLon(pt.x, pt.y, MAP_BASE_W, MAP_BASE_H);
    assert.ok(Math.abs(inv.lat - lat) < 0.05);
    assert.ok(Math.abs(inv.lon - lon) < 0.05);
  }
  assert.equal(formatLatLon(1.3031, 103.9128), '1.30° N, 103.91° E');
  assert.equal(formatLatLon(-33.8688, -70.6693), '33.87° S, 70.67° W');

  // Verify live `detected_lat_e7` / `detected_lon_e7` override static defaults & custom lat/lon roundtrips
  const prevLs = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    store.set(
      'slx_discovered_subnets_meta_v1',
      JSON.stringify({
        thisSubnet: {
          subnet_id: 'e40af3dd',
          tip_height: 6510,
          validator_count: 4,
          detected_lat_e7: 13_031_000,
          detected_lon_e7: 1_039_128_000,
        },
        roamingSubnets: [
          {
            subnet_id: 'f9e8d7c6',
            tip_height: 240,
            validator_count: 4,
            transport: 'flrc',
            detected_lat_e7: 462_044_000,
            detected_lon_e7: 61_432_000,
            name: 'Geneva Alpine RF Mesh',
          },
        ],
      })
    );
    const customKey = SlxSubnetManager.addCustomSubnet({
      name: 'Tokyo Shinkansen Subnet',
      rpcUrl: 'wss://tokyo.superlexicon.com/rpc',
      lat: 35.68,
      lon: 139.69,
    });
    const subs = SlxSubnetManager.listSubnets();
    const s1 = subs.find((s) => s.key === 'subnet1');
    const geneva = subs.find((s) => s.subnetId === 'f9e8d7c6');
    const tokyo = subs.find((s) => s.key === customKey);
    assert.equal(s1.gpsDetected, true);
    assert.ok(Math.abs(s1.lat - 1.3031) < 1e-4);
    assert.equal(geneva.gpsDetected, true);
    assert.ok(Math.abs(geneva.lat - 46.2044) < 1e-4);
    assert.ok(Math.abs(geneva.lon - 6.1432) < 1e-4);
    assert.ok(Math.abs(tokyo.lat - 35.68) < 1e-4);
    assert.ok(Math.abs(tokyo.lon - 139.69) < 1e-4);
  } finally {
    globalThis.localStorage = prevLs;
  }
}

// 19. On-Chain SubnetRegistry HFS ABI, Signed E7 Coords & SlxSubnetManager Hydration
{
  const {
    SubnetRegistryAbi,
    degToE7UnsignedBits,
    readSignedI32BE,
    decodeSubnetRegistrySliceHex,
    SlxSubnetManager,
    utf8ToBytes,
    bytesToHex,
    concatBytes,
    u64BEBytes,
    u16BEBytes,
    hexToBytes,
  } = await import('../src/index.js');

  const u32BE = (n) => u64BEBytes(BigInt(n) & 0xffffffffn).slice(4, 8);

  // Verify signed negative lat/lon 32-bit two's-complement packing
  const negBits = degToE7UnsignedBits(-33.8688);
  assert.ok(negBits <= 0xffffffffn);
  const b4 = u32BE(negBits);
  assert.equal(readSignedI32BE(b4, 0), -338_688_000);

  // Verify upsertSubnet calldata encodes cleanly and guards >1536B payload
  const cdHex = SubnetRegistryAbi.upsertSubnet({
    subnetId: '9f31a8c2',
    name: 'Geneva Quantum Subnet',
    transport: 'tcp',
    channelHz: 1,
    validatorCount: 3,
    lat: 46.2044,
    lon: 6.1432,
    endpoints: { publicRpcUrls: ['wss://node31.superlexicon.com/rpc'] },
  });
  assert.ok(cdHex.startsWith('0x') && cdHex.length > 680);

  // Build a synthetic binary slice matching `subnet_registry.wasm` wire format and decode
  const sidBytes = utf8ToBytes('9f31a8c2');
  const nameBytes = utf8ToBytes('Geneva Quantum Subnet');
  const trBytes = utf8ToBytes('tcp');
  const epBytes = utf8ToBytes(
    JSON.stringify({
      shortLabel: 'SUBNET 3 • TCP',
      locationLabel: 'Geneva, Switzerland',
      publicRpcUrls: ['wss://node31.superlexicon.com/rpc', 'wss://node32.superlexicon.com/rpc'],
      publicWsUrls: ['wss://node31.superlexicon.com', 'wss://node32.superlexicon.com'],
    })
  );
  const hdr = new Uint8Array(102);
  hdr[0] = 1; // STATUS_ACTIVE
  hdr[1] = sidBytes.length;
  hdr[2] = nameBytes.length;
  hdr[3] = trBytes.length;
  hdr.set(u16BEBytes(epBytes.length), 4);
  hdr.set(u32BE(2), 6);
  hdr.set(u32BE(degToE7UnsignedBits(-33.8688)), 10);
  hdr.set(u32BE(degToE7UnsignedBits(151.2093)), 14);
  hdr.set(u64BEBytes(1), 18);
  hdr.set(u64BEBytes(7000), 26);
  hdr.set(u64BEBytes(7010), 34);
  hdr.set(hexToBytes('0x1111111111111111111111111111111111111111'), 42);
  hdr.set(hexToBytes('0x2222222222222222222222222222222222222222'), 82);

  const sliceBytes = concatBytes(
    u64BEBytes(1),
    u64BEBytes(1),
    u64BEBytes(0),
    hdr,
    sidBytes,
    nameBytes,
    trBytes,
    epBytes
  );
  const decoded = decodeSubnetRegistrySliceHex(bytesToHex(sliceBytes));
  assert.equal(decoded.totalCount, 1);
  assert.equal(decoded.items.length, 1);
  assert.equal(decoded.items[0].subnetId, '9f31a8c2');
  assert.ok(Math.abs(decoded.items[0].lat - -33.8688) < 1e-4);
  assert.ok(Math.abs(decoded.items[0].lon - 151.2093) < 1e-4);
  assert.deepEqual(decoded.items[0].statsRpcUrls, [
    'wss://node31.superlexicon.com/rpc',
    'wss://node32.superlexicon.com/rpc',
  ]);

  // Verify SlxSubnetManager hydrates on-chain registered subnets & their stats node URLs
  const prevLs = globalThis.localStorage;
  const prevWin = globalThis.window;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = {
    location: { protocol: 'https:', hostname: 'superlexicon.com', href: 'https://superlexicon.com/' },
    dispatchEvent: () => {},
  };
  try {
    store.set(
      'slx_discovered_subnets_meta_v1',
      JSON.stringify({
        onChainRegistryAddr: '0xd7983d631634bb6d1dea4318a25dd413066ad5fc',
        onChainSubnets: decoded.items,
      })
    );
    const list = SlxSubnetManager.listSubnets();
    const s3 = list.find((s) => s.subnetId === '9f31a8c2');
    assert.ok(s3);
    assert.equal(s3.onChainRegistered, true);
    assert.equal(s3.rpcUrl, 'wss://node31.superlexicon.com/rpc');
    assert.deepEqual(s3.statsRpcUrls, [
      'wss://node31.superlexicon.com/rpc',
      'wss://node32.superlexicon.com/rpc',
    ]);
  } finally {
    globalThis.localStorage = prevLs;
    globalThis.window = prevWin;
  }
}

console.log('✅ @superlexicon/sdk unit test suite passed (19/19 test groups)!');
process.exit(0);
