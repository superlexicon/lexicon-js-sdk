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

console.log('✅ @superlexicon/sdk unit test suite passed (13/13 test groups)!');
process.exit(0);
