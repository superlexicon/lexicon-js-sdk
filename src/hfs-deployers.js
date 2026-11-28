/**
 * SuperLexicon Subnet 1 App-Specific HFS Deployment Wizards & Registry Re-Exports (`slx-hfs-registry.js`).
 *
 * Core `HfsRegistry` client & `mountHfsRegistryDropdown` UI live in `@superlexicon/sdk` and `@superlexicon/sdk/ui`;
 * this module registers the multi-contract Subnet 1 deployers (`PHANTOM_FLEET`, `DEX_CLOB`, `CORPORATE_CHARTER`, `FRACTURED_HEGEMONY`, `CIPHER_NOIR`).
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  keccak256Hex,
  computeAddress,
  signOrderedLexiconTx,
  encodeAbi,
  shortHex,
  SlxHfsCache,
  slxNodeRpc,
  getDefaultNodeWsUrl,
  slxWaitForReceipt,
  HFS_TYPES,
  encodeHfsTypeId,
  HfsRegistryAbi,
  makeHfsSelectionKey,
  decodeHfsInstancesSliceHex,
  fetchRegisteredHfsByType,
  registerHfsInstanceOnChain,
  getUrlHfsParam,
  setUrlHfsParam,
  clearUrlHfsParam,
  deriveIdentityEncryptionKeys,
  deriveCompanyAuditKeypair,
  wrapSecretForRecipientSecp,
  SUBGROUP_ALL_MEMBERS_SLUG,
  SUBGROUP_DEVELOPERS_SLUG,
  SOVEREIGN_SUPERLEXICON_CHARTER_SPEC,
  isConfusableSuperlexiconName,
  companyGroupChannelHash,
  CharterSocialAbi,
  decodeEntityProfileHex,
  decodeCompanySocialOverviewHex,
  resolveSovereignSuperlexiconCharter,
  checkSuperlexiconDeveloperStanding,
} from "./index.js";
import {
  mountHfsRegistryDropdown,
  registerHfsTypeDeployer,
} from "./ui/index.js";

export {
  HFS_TYPES,
  encodeHfsTypeId,
  HfsRegistryAbi,
  makeHfsSelectionKey,
  decodeHfsInstancesSliceHex,
  fetchRegisteredHfsByType,
  registerHfsInstanceOnChain,
  getUrlHfsParam,
  setUrlHfsParam,
  clearUrlHfsParam,
  mountHfsRegistryDropdown,
  SUBGROUP_ALL_MEMBERS_SLUG,
  SUBGROUP_DEVELOPERS_SLUG,
  SOVEREIGN_SUPERLEXICON_CHARTER_SPEC,
  isConfusableSuperlexiconName,
  companyGroupChannelHash,
  CharterSocialAbi,
  decodeEntityProfileHex,
  decodeCompanySocialOverviewHex,
  resolveSovereignSuperlexiconCharter,
  checkSuperlexiconDeveloperStanding,
};

const encodeSimpleAbi = encodeAbi;
const signOrderedTx = signOrderedLexiconTx;

export function assertNotConfusableSuperlexiconName(candidateName) {
  if (isConfusableSuperlexiconName(candidateName)) {
    throw new Error(
      `Entity / HFS name "${candidateName}" is reserved at the protocol level (-110 / -25): "Superlexicon Pte. Ltd." and all confusable or lookalike entity names are cast in stone and cannot be created by third parties.`
    );
  }
}

export async function assertWebRpcHfsDeployAllowed({ wallet, rpcUrl = getDefaultNodeWsUrl() }) {
  const idRec = wallet?.getIdentityRecord?.() || null;
  const standing = await checkSuperlexiconDeveloperStanding({
    rpcUrl,
    identityAddr: idRec?.identityAddr || '',
    eoaAddr: wallet?.keypair?.address || '',
  });
  if (!standing.authorized) {
    throw new Error(
      standing.reason ||
        'Deploying new HFS subroutines over the public website RPC requires membership in the Superlexicon · Developers social group (governed by Superlexicon Pte. Ltd. CorporateCharter) — or connect directly via local LR2021 RF hardware.'
    );
  }
  return standing;
}

async function waitReceipts(rpcUrl, hashes) {
  const out = [];
  for (const h of hashes) {
    const r = await slxWaitForReceipt((m, p) => slxNodeRpc(rpcUrl, m, p), h, {
      timeoutMs: 56_000,
      fallbackPollMs: 850,
    });
    if (!r) throw new Error(`Timed out waiting for Subnet 1 block confirmation (${h.slice(0, 10)}…)`);
    if (r.status !== "0x1") throw new Error(`Subnet 1 transaction reverted (${h.slice(0, 10)}…)`);
    out.push(r);
  }
  return out;
}

/**
 * 2-Block Browser Deployer: Instantiates a brand-new `battleship.wasm` HFS, calls `createBattle`,
 * and registers it in `HfsRegistry` under the user's unified `Identity`!
 */
export async function deployNewPhantomFleetHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const bsCodeHash = manifest?.codeHashes?.battleship;
  const reg = manifest?.hfsRegistry;
  if (!bsCodeHash || !reg) throw new Error('Missing battleship codeHash or hfsRegistry in manifest');

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Phantom Fleet' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  if (onStatus) onStatus('Block 1/2: Instantiating fresh battleship.wasm HFS on Subnet 1…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const s0 = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: bsCodeHash,
    gasLimit: 4_500_000n,
  });
  const h0 = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s0.raw]);
  const [r0] = await waitReceipts(rpcUrl, [h0]);
  const newContractAddr = r0.contractAddress;

  const battleId = bytesToHex(concatBytes(utf8ToBytes('NAVAL_ARENA_'), randomBytes(20)));
  if (onStatus) {
    onStatus(`Block 2/2: Creating arena & registering ${shortHex(newContractAddr)} in HfsRegistry…`);
  }

  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const createCd = encodeSimpleAbi('createBattle(bytes32)', [['bytes32', battleId]]);
  const regCd = HfsRegistryAbi.registerInstance(
    'PHANTOM_FLEET',
    newContractAddr,
    idRec?.identityAddr,
    label,
    { battleId }
  );

  const txCreate = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: newContractAddr,
    data: createCd,
    gasLimit: 5_000_000n,
    extraTargets: [newContractAddr],
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: reg,
    data: regCd,
    gasLimit: 5_200_000n,
    extraTargets: [reg, newContractAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txCreate.txHash,
  });

  const hCreate = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txCreate.raw]);
  const hReg = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]);
  await waitReceipts(rpcUrl, [hCreate, hReg]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newContractAddr,
      typeName: 'PHANTOM_FLEET',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newContractAddr.toLowerCase(),
    label,
    meta: { battleId },
    selectionKey: makeHfsSelectionKey(newContractAddr, { battleId }),
  };
}

/**
 * Browser Deployer for a brand-new `DEX_CLOB` market (`dex_clob.wasm` + `asset_ledger.wasm` pair)
 * registered in `HfsRegistry`!
 */
export async function deployNewDexMarketHfs({
  wallet,
  label,
  baseSymbol = '',
  quoteSymbol = 'SGD-FIAT',
  category = '',
  anchorPrice = 0,
  rpcUrl = getDefaultNodeWsUrl(),
  manifestOverride = null,
  onStatus = null,
}) {
  const manifest = manifestOverride || (await SlxHfsCache.hydrateWithManifest()).manifest;
  const inst = manifest?.institutional;
  const chLedger = manifest?.codeHashes?.asset_ledger;
  const chDex = manifest?.codeHashes?.dex_clob;
  const reg = manifest?.hfsRegistry;
  if (!inst || !chLedger || !chDex || !reg) {
    throw new Error('Missing institutional suite or codeHashes in manifest');
  }

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'DEX CLOB' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;
  const ticker =
    String(baseSymbol || label || 'SLX-NEW')
      .toUpperCase()
      .split('/')[0]
      .trim()
      .split(/\s+/)[0]
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 12) || 'SLX-MKT';
  const qSym = String(quoteSymbol || 'SGD-FIAT').trim().toUpperCase() || 'SGD-FIAT';

  if (onStatus) onStatus(`Block 1/3: Instantiating ${ticker} AssetLedgers & dex_clob.wasm…`);
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const sFiat = signOrderedTx({ privateKey: myPriv, nonce: n0, to: null, data: chLedger, gasLimit: 1_400_000n });
  const sShare = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 1n,
    to: null,
    data: chLedger,
    gasLimit: 1_400_000n,
    lowerBoundHashHex: sFiat.txHash,
  });
  const sDex = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 2n,
    to: null,
    data: chDex,
    gasLimit: 1_400_000n,
    lowerBoundHashHex: sShare.txHash,
  });

  const rcpts1 = await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sFiat.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sShare.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sDex.raw]),
  ]);
  const newFiat = rcpts1[0].contractAddress;
  const newShare = rcpts1[1].contractAddress;
  const newDex = rcpts1[2].contractAddress;

  const u64BE = (v) => {
    const b = new Uint8Array(8);
    let x = BigInt(v);
    for (let i = 7; i >= 0; i--) {
      b[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return b;
  };
  const packAlloc = (a, amt) => concatBytes(hexToBytes(a).slice(-20), u64BE(amt));
  const packPerm = (act, chr, pol) =>
    concatBytes(hexToBytes(act).slice(0, 32), hexToBytes(chr).slice(-20), hexToBytes(pol).slice(0, 32));
  const kH = (s) => keccak256Hex(utf8ToBytes(s));
  const ZERO = '0x0000000000000000000000000000000000000000';

  const perms = concatBytes(
    packPerm(kH('SUPER'), newDex, kH('SUPER_GOVERNANCE')),
    packPerm(kH('ISSUE'), newDex, kH('BANK_ORACLE')),
    packPerm(kH('CANCEL'), newDex, kH('BANK_ORACLE')),
    packPerm(kH('TRANSFER'), ZERO, kH('HOLDER_SELF')),
    packPerm(kH('APPROVE'), ZERO, kH('HOLDER_SELF'))
  );
  const sameAsFaucet =
    idRec.identityAddr.toLowerCase() === String(inst.faucetIdentity || '').toLowerCase();
  const fiatAllocs = sameAsFaucet
    ? packAlloc(inst.faucetIdentity, 90_100_000n)
    : concatBytes(
        packAlloc(inst.faucetIdentity, 90_000_000n),
        packAlloc(idRec.identityAddr, 100_000n)
      );
  const shareAllocs = sameAsFaucet
    ? packAlloc(inst.faucetIdentity, 252_500n)
    : concatBytes(
        packAlloc(inst.faucetIdentity, 250_000n),
        packAlloc(idRec.identityAddr, 2_500n)
      );
  const targets = [
    inst.registry,
    inst.corporateCharter,
    inst.faucetIdentity,
    inst.dexEscrowIdentity,
    idRec.identityAddr,
    newFiat,
    newShare,
    newDex,
    reg,
  ];
  const execWrap = (target, innerHex) =>
    encodeSimpleAbi('execute(address,bytes)', [
      ['address', target],
      ['bytes', hexToBytes(innerHex)],
    ]);

  if (onStatus) onStatus(`Block 2/3: Initializing ${ticker} / ${qSym} Ledgers & DEX CLOB…`);
  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const b2a = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: idRec.identityAddr,
    data: execWrap(
      newFiat,
      encodeSimpleAbi('initialize(address,string,uint64,bytes,bytes)', [
        ['address', inst.registry],
        ['string', qSym],
        ['uint64', 0],
        ['bytes', fiatAllocs],
        ['bytes', perms],
      ])
    ),
    gasLimit: 1_600_000n,
    extraTargets: targets,
  });
  const b2b = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: idRec.identityAddr,
    data: execWrap(
      newShare,
      encodeSimpleAbi('initialize(address,string,uint64,bytes,bytes)', [
        ['address', inst.registry],
        ['string', ticker],
        ['uint64', 0],
        ['bytes', shareAllocs],
        ['bytes', perms],
      ])
    ),
    gasLimit: 1_600_000n,
    extraTargets: targets,
    lowerBoundHashHex: b2a.txHash,
  });
  const b2c = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 2n,
    to: idRec.identityAddr,
    data: execWrap(
      newDex,
      encodeSimpleAbi('initialize(address,address,address,address)', [
        ['address', inst.registry],
        ['address', newShare],
        ['address', newFiat],
        ['address', inst.dexEscrowIdentity],
      ])
    ),
    gasLimit: 1_500_000n,
    extraTargets: targets,
    lowerBoundHashHex: b2b.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2a.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2b.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2c.raw]),
  ]);

  if (onStatus) onStatus(`Block 3/3: Attaching settlement ledgers & registering in HfsRegistry…`);
  const meta = {
    pair: `${ticker} / ${qSym}`,
    baseSymbol: ticker,
    quoteSymbol: qSym,
    ...(category ? { category } : {}),
    ...(anchorPrice > 0 ? { anchorPrice: Number(anchorPrice) } : {}),
    shareLedger: newShare,
    fiatLedger: newFiat,
    dexEscrowIdentity: inst.dexEscrowIdentity,
  };
  const n2 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const b3a = signOrderedTx({
    privateKey: myPriv,
    nonce: n2,
    to: idRec.identityAddr,
    data: encodeSimpleAbi('setAttachedDex(address,address,address)', [
      ['address', newFiat],
      ['address', newDex],
      ['address', ZERO],
    ]),
    gasLimit: 1_100_000n,
    extraTargets: targets,
  });
  const b3b = signOrderedTx({
    privateKey: myPriv,
    nonce: n2 + 1n,
    to: idRec.identityAddr,
    data: encodeSimpleAbi('setAttachedDex(address,address,address)', [
      ['address', newShare],
      ['address', newDex],
      ['address', ZERO],
    ]),
    gasLimit: 1_100_000n,
    extraTargets: targets,
    lowerBoundHashHex: b3a.txHash,
  });
  const b3c = signOrderedTx({
    privateKey: myPriv,
    nonce: n2 + 2n,
    to: reg,
    data: HfsRegistryAbi.registerInstance('DEX_CLOB', newDex, idRec.identityAddr, label, meta),
    gasLimit: 1_100_000n,
    extraTargets: targets,
    lowerBoundHashHex: b3b.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b3a.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b3b.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b3c.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newDex,
      typeName: 'DEX_CLOB',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newDex.toLowerCase(),
    label,
    meta,
    selectionKey: makeHfsSelectionKey(newDex, meta),
  };
}

/**
 * 3-Block Sovereign CorporateCharter Incorporator:
 *  - Block 1: Instantiates `corporate_charter.wasm`, restricted `asset_ledger.wasm` (Share Class),
 *             company `asset_ledger.wasm` (`SGD-CASH`), `share_capital.wasm`, and auto-created
 *             First Shareholder Resolution `authorization.wasm`!
 *  - Block 2: Initializes `CorporateCharter` (with AI Directors/Shareholders, C-Suite roles
 *             `ROLE_CEO` / `ROLE_COO` / `ROLE_CTO` / `ROLE_TREASURY_MANAGER` / `ROLE_PRODUCT_MANAGER`,
 *             and 3-step `POLICY_SHARE_TRANSFER_AUCTION`), initializes both AssetLedgers and `ShareCapital`.
 *  - Block 3: Initializes the First Shareholder Resolution (`activateCharter`) so AI shareholders
 *             begin signing immediately in realtime, and registers the company in `HfsRegistry`!
 */
export async function deployNewCorporateCharterHfs({
  wallet,
  label,
  companyName,
  ticker,
  userShares = 40000,
  aiSelections = null,
  auctionWindowBlocks = 6,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
  manifestOverride = null,
}) {
  const { manifest: fetchedManifest } = manifestOverride
    ? { manifest: manifestOverride }
    : await SlxHfsCache.hydrateWithManifest();
  const manifest = manifestOverride || fetchedManifest;
  const inst = manifest?.institutional;
  const chCharter = manifest?.codeHashes?.corporate_charter;
  const chLedger = manifest?.codeHashes?.asset_ledger;
  const chShareCap = manifest?.codeHashes?.share_capital;
  const chAuth = manifest?.codeHashes?.authorization;
  const chAccounting = manifest?.codeHashes?.accounting_ledger || '';
  const chConfLedger = manifest?.codeHashes?.confidential_ledger || '';
  const chIdentity = manifest?.codeHashes?.identity || '';
  const reg = manifest?.hfsRegistry;
  if (!inst || !chCharter || !chLedger || !chShareCap || !chAuth || !reg) {
    throw new Error('Missing CorporateCharter suite codeHashes or hfsRegistry in manifest');
  }

  const compName = String(companyName || label || 'Aegis Naval Robotics Pte. Ltd.').trim().slice(0, 60);
  assertNotConfusableSuperlexiconName(compName);
  await assertWebRpcHfsDeployAllowed({ wallet, rpcUrl });
  const messagingAddr = (
    manifest?.fleetSocial?.messaging ||
    manifest?.commonsRf?.messaging ||
    ''
  ).toLowerCase();
  const sym =
    String(
      ticker ||
        compName
          .split(/\s+/)[0]
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '') + '-EQ'
    )
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 14) || 'CORP-EQ';
  const winBlks = Math.max(2, Math.min(25, Math.floor(Number(auctionWindowBlocks) || 6)));

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'CorporateCharter' });
  const myId = idRec.identityAddr.toLowerCase();
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  const allAiIds = (manifest?.battleship?.aiIdentities || []).map((a) => a.toLowerCase());
  const effectiveAi = Array.isArray(aiSelections) ? aiSelections : [];

  const aiDirectorAddrs = Array.from(
    new Set(
      effectiveAi
        .filter((x) => x.isDirector && x.identityAddr && x.identityAddr.toLowerCase() !== myId)
        .map((x) => x.identityAddr.toLowerCase())
    )
  );
  const aiShareEntries = effectiveAi
    .filter(
      (x) =>
        x.isShareholder &&
        Number(x.shares) > 0 &&
        x.identityAddr &&
        x.identityAddr.toLowerCase() !== myId
    )
    .map((x) => ({ addr: x.identityAddr.toLowerCase(), shares: Math.floor(Number(x.shares)) }));

  const founderShares = Math.max(0, Math.floor(Number(userShares) || 0));
  const allShareholderAddrs = Array.from(
    new Set([
      ...(founderShares > 0 ? [myId] : []),
      ...aiShareEntries.map((x) => x.addr),
    ])
  );
  if (allShareholderAddrs.length === 0) {
    throw new Error('At least one shareholder with > 0 shares is required to ratify the Charter');
  }
  const allDirectorAddrs = Array.from(new Set([myId, ...aiDirectorAddrs]));

  // Verify any custom/external participant addresses are valid Identity HFSs in IdentityRegistry
  const extraIdsToVerify = Array.from(new Set([...allDirectorAddrs, ...allShareholderAddrs])).filter(
    (a) => a !== myId && !allAiIds.includes(a)
  );
  for (const extAddr of extraIdsToVerify) {
    if (!/^0x[0-9a-f]{40}$/.test(extAddr)) {
      throw new Error(`Invalid Identity HFS address: ${extAddr}`);
    }
    const validHex = await slxNodeRpc(rpcUrl, 'eth_call', [
      { to: inst.registry, data: encodeSimpleAbi('isValidIdentity(address)', [['address', extAddr]]) },
      'latest',
    ]);
    const valid = Number(BigInt(validHex || '0x0')) === 1;
    if (!valid) {
      throw new Error(
        `Address ${shortHex(extAddr)} is not a registered Identity HFS on Subnet 1 (be sure to copy their Identity HFS address, not their EOA wallet address).`
      );
    }
  }

  if (onStatus) {
    onStatus(`Block 1/3: Instantiating CorporateCharter, ${sym} & Cash Ledgers, ShareCapital & Resolution #1…`);
  }
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const sChr = signOrderedTx({ privateKey: myPriv, nonce: n0, to: null, data: chCharter, gasLimit: 5_000_000n });
  const sSh = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 1n,
    to: null,
    data: chLedger,
    gasLimit: 4_800_000n,
    lowerBoundHashHex: sChr.txHash,
  });
  const sBk = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 2n,
    to: null,
    data: chLedger,
    gasLimit: 4_800_000n,
    lowerBoundHashHex: sSh.txHash,
  });
  const sSc = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 3n,
    to: null,
    data: chShareCap,
    gasLimit: 4_800_000n,
    lowerBoundHashHex: sBk.txHash,
  });
  const sAu = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 4n,
    to: null,
    data: chAuth,
    gasLimit: 4_800_000n,
    lowerBoundHashHex: sSc.txHash,
  });
  const hasIfrsAuto = Boolean(chAccounting && chIdentity && inst.keeperIdentity && inst.keeperPriv);
  const hasConfAuto = Boolean(hasIfrsAuto && chConfLedger);
  const sTreas = hasIfrsAuto
    ? signOrderedTx({
        privateKey: myPriv,
        nonce: n0 + 5n,
        to: null,
        data: chIdentity,
        gasLimit: 4_500_000n,
        lowerBoundHashHex: sAu.txHash,
      })
    : null;
  const sAcc = hasIfrsAuto
    ? signOrderedTx({
        privateKey: myPriv,
        nonce: n0 + 6n,
        to: null,
        data: chAccounting,
        gasLimit: 5_000_000n,
        lowerBoundHashHex: sTreas.txHash,
      })
    : null;
  const sRegAuth = hasIfrsAuto
    ? signOrderedTx({
        privateKey: myPriv,
        nonce: n0 + 7n,
        to: null,
        data: chAuth,
        gasLimit: 4_500_000n,
        lowerBoundHashHex: sAcc.txHash,
      })
    : null;
  const sConf = hasConfAuto
    ? signOrderedTx({
        privateKey: myPriv,
        nonce: n0 + 8n,
        to: null,
        data: chConfLedger,
        gasLimit: 4_800_000n,
        lowerBoundHashHex: sRegAuth.txHash,
      })
    : null;

  const block1Hashes = [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sChr.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sSh.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sBk.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sSc.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sAu.raw]),
  ];
  if (hasIfrsAuto) {
    block1Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sTreas.raw]));
    block1Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sAcc.raw]));
    block1Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sRegAuth.raw]));
  }
  if (hasConfAuto) {
    block1Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sConf.raw]));
  }
  const rcpts1 = await waitReceipts(rpcUrl, block1Hashes);

  const newCharter = rcpts1[0].contractAddress.toLowerCase();
  const newShareLedger = rcpts1[1].contractAddress.toLowerCase();
  const newBankLedger = rcpts1[2].contractAddress.toLowerCase();
  const newShareCapital = rcpts1[3].contractAddress.toLowerCase();
  const firstResAuth = rcpts1[4].contractAddress.toLowerCase();
  const newTreasuryIdentity = hasIfrsAuto ? rcpts1[5].contractAddress.toLowerCase() : '';
  const newAccountingLedger = hasIfrsAuto ? rcpts1[6].contractAddress.toLowerCase() : '';
  const treasRegAuth = hasIfrsAuto ? rcpts1[7].contractAddress.toLowerCase() : '';
  const newConfLedger = hasConfAuto ? rcpts1[8].contractAddress.toLowerCase() : '';
  const shareEscrowIdentity = (inst.dexEscrowIdentity || inst.merchantRevenueIdentity).toLowerCase();

  const u16BE = (n) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
  const u64BE = (v) => {
    const b = new Uint8Array(8);
    let x = BigInt(v);
    for (let i = 7; i >= 0; i--) {
      b[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return b;
  };
  const kH = (s) => keccak256Hex(utf8ToBytes(s));
  const ZERO = '0x0000000000000000000000000000000000000000';
  const execWrap = (target, innerHex) =>
    encodeSimpleAbi('execute(address,bytes)', [
      ['address', target],
      ['bytes', hexToBytes(innerHex)],
    ]);

  // 1. Encode rolesBlob (pre-defining C-Suite roles with 0 initial holders so Board Resolutions can grant them!)
  const roleDefs = [
    { roleId: kH('ROLE_SHAREHOLDER'), members: allShareholderAddrs },
    { roleId: kH('ROLE_DIRECTOR'), members: allDirectorAddrs },
    { roleId: kH('ROLE_CEO'), members: [] },
    { roleId: kH('ROLE_COO'), members: [] },
    { roleId: kH('ROLE_CTO'), members: [] },
    { roleId: kH('ROLE_TREASURY_MANAGER'), members: [myId] },
    { roleId: kH('ROLE_CHIEF_ACCOUNTANT'), members: [myId] },
    { roleId: kH('ROLE_PRODUCT_MANAGER'), members: [] },
    { roleId: kH('ROLE_BANK_ORACLE'), members: Array.from(new Set([myId, inst.faucetIdentity.toLowerCase()])) },
  ];
  const rolesChunks = [u16BE(roleDefs.length)];
  for (const r of roleDefs) {
    rolesChunks.push(hexToBytes(r.roleId).slice(0, 32));
    rolesChunks.push(u16BE(r.members.length));
    for (const m of r.members) rolesChunks.push(hexToBytes(m).slice(-20));
  }
  const rolesBlob = concatBytes(...rolesChunks);

  // 2. Encode policiesBlob
  const packStage = ({ reqW, exp, members = [], roles = [] }) =>
    concatBytes(
      u64BE(reqW),
      u64BE(exp),
      new Uint8Array([members.length, roles.length, 0, 0, 0, 0, 0, 0]),
      ...members.map((m) => concatBytes(hexToBytes(m.id).slice(-20), u64BE(m.w))),
      ...roles.map((rl) => concatBytes(hexToBytes(rl.id).slice(0, 32), u64BE(rl.w)))
    );
  const packPolicy = (overallExp, stages) =>
    concatBytes(new Uint8Array([1, 1, stages.length, 0]), u64BE(overallExp), ...stages.map(packStage));

  const shSuperSpec = packPolicy(100000, [
    { reqW: 75, exp: 50000, roles: [{ id: kH('ROLE_SHAREHOLDER'), w: 1 }] },
  ]);
  const boardSpec = packPolicy(100000, [
    {
      reqW: allDirectorAddrs.length,
      exp: 50000,
      members: allDirectorAddrs.map((d) => ({ id: d, w: 1 })),
    },
  ]);
  const auctionSpec = packPolicy(50000, [
    { reqW: 1, exp: winBlks, members: [{ id: myId, w: 1 }] },
    { reqW: 1, exp: winBlks, members: [{ id: myId, w: 1 }] },
    { reqW: 1, exp: winBlks, members: [{ id: myId, w: 1 }] },
  ]);
  const ratifyWinBlks = Math.max(winBlks * 3, 18);
  const issuanceAuctionSpec = packPolicy(100000, [
    { reqW: 1, exp: winBlks, roles: [{ id: kH('ROLE_SHAREHOLDER'), w: 1 }] },
    { reqW: 75, exp: ratifyWinBlks, roles: [{ id: kH('ROLE_SHAREHOLDER'), w: 1 }] },
  ]);

  const policyDefs = [
    { target: ZERO, id: kH('FIRST_SHAREHOLDER_RESOLUTION'), spec: shSuperSpec },
    { target: ZERO, id: kH('SUPER_GOVERNANCE'), spec: shSuperSpec },
    { target: ZERO, id: kH('SHAREHOLDER_SUPERMAJORITY'), spec: shSuperSpec },
    { target: ZERO, id: kH('BOARD_RESOLUTION'), spec: boardSpec },
    { target: newShareLedger, id: kH('SHARE_TRANSFER_AUCTION'), spec: auctionSpec },
    { target: ZERO, id: kH('SHARE_ISSUANCE_AUCTION'), spec: issuanceAuctionSpec },
  ];
  const polChunks = [u16BE(policyDefs.length)];
  for (const p of policyDefs) {
    polChunks.push(hexToBytes(p.target).slice(-20));
    polChunks.push(hexToBytes(p.id).slice(0, 32));
    polChunks.push(u16BE(p.spec.length));
    polChunks.push(p.spec);
  }
  const policiesBlob = concatBytes(...polChunks);

  // 3. shareClassesBlob & modulesBlob
  const shareClassesBlob = concatBytes(
    u16BE(1),
    hexToBytes(newShareLedger).slice(-20),
    u64BE(1),
    u64BE(1),
    u64BE(1)
  );
  const moduleEntries = [
    [newShareCapital, kH('CAP_EQUITY_SETTLEMENT')],
    [newShareCapital, kH('CAP_IFRS_RECORDER')],
    ...(hasConfAuto ? [[newConfLedger, kH('CAP_CONFIDENTIAL_LEDGER')]] : []),
  ];
  const modulesBlob = concatBytes(
    u16BE(moduleEntries.length),
    ...moduleEntries.flatMap(([mAddr, capHex]) => [
      hexToBytes(mAddr).slice(-20),
      hexToBytes(capHex).slice(0, 32),
    ])
  );

  // 4. Share & Bank Ledger allocations + permissions
  const packAlloc = (a, amt) => concatBytes(hexToBytes(a).slice(-20), u64BE(amt));
  const packPerm = (act, chr, pol) =>
    concatBytes(hexToBytes(act).slice(0, 32), hexToBytes(chr).slice(-20), hexToBytes(pol).slice(0, 32));

  const shareAllocChunks = [];
  if (founderShares > 0) shareAllocChunks.push(packAlloc(myId, founderShares));
  for (const se of aiShareEntries) {
    shareAllocChunks.push(packAlloc(se.addr, se.shares));
  }
  const shareAllocs = concatBytes(...shareAllocChunks);
  const sharePerms = concatBytes(
    packPerm(kH('SUPER'), newCharter, kH('SUPER_GOVERNANCE')),
    packPerm(kH('ISSUE'), newCharter, kH('SHARE_ISSUANCE_AUCTION')),
    packPerm(kH('CANCEL'), newCharter, kH('SHAREHOLDER_SUPERMAJORITY')),
    packPerm(kH('TRANSFER'), newCharter, kH('SHARE_TRANSFER_AUCTION')),
    packPerm(kH('APPROVE'), ZERO, kH('HOLDER_SELF'))
  );

  const bankAllocMap = new Map();
  bankAllocMap.set(inst.faucetIdentity.toLowerCase(), 50_000_000n);
  bankAllocMap.set(myId, 5_000_000n);
  for (const aiAddr of allAiIds) {
    if (!bankAllocMap.has(aiAddr)) bankAllocMap.set(aiAddr, 2_500_000n);
  }
  for (const extAddr of extraIdsToVerify) {
    if (!bankAllocMap.has(extAddr)) bankAllocMap.set(extAddr, 500_000n);
  }
  const bankAllocs = concatBytes(
    ...Array.from(bankAllocMap.entries()).map(([addr, bal]) => packAlloc(addr, bal))
  );
  const bankPerms = concatBytes(
    packPerm(kH('SUPER'), newCharter, kH('SUPER_GOVERNANCE')),
    packPerm(kH('ISSUE'), newCharter, kH('BANK_ORACLE')),
    packPerm(kH('CANCEL'), newCharter, kH('BANK_ORACLE')),
    packPerm(kH('TRANSFER'), ZERO, kH('HOLDER_SELF')),
    packPerm(kH('APPROVE'), ZERO, kH('HOLDER_SELF'))
  );

  const targets = Array.from(
    new Set([
      inst.registry.toLowerCase(),
      inst.faucetIdentity.toLowerCase(),
      shareEscrowIdentity,
      inst.dexEscrowIdentity.toLowerCase(),
      myId,
      ...allAiIds,
      ...extraIdsToVerify,
      newCharter,
      newShareLedger,
      newBankLedger,
      newShareCapital,
      firstResAuth,
      ...(messagingAddr ? [messagingAddr] : []),
      ...(hasIfrsAuto ? [newTreasuryIdentity, newAccountingLedger, treasRegAuth, inst.keeperIdentity.toLowerCase()] : []),
      ...(hasConfAuto ? [newConfLedger] : []),
      reg.toLowerCase(),
    ])
  );

  if (onStatus) {
    onStatus(`Block 2/3: Configuring ${compName} Charter, Directors, Cap Table & Segregated ShareEscrow…`);
  }
  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const b2Chr = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: myId,
    data: execWrap(
      newCharter,
      encodeSimpleAbi(
        'initializeEntityWithGovernance(address,string,string,string,address,address,bytes,bytes,bytes,bytes,bytes)',
        [
          ['address', inst.registry],
          ['string', compName],
          ['string', 'Singapore'],
          ['string', ''],
          ['address', reg],
          ['address', messagingAddr || ZERO],
          ['bytes', rolesBlob],
          ['bytes', policiesBlob],
          ['bytes', new Uint8Array(0)],
          ['bytes', shareClassesBlob],
          ['bytes', modulesBlob],
        ]
      )
    ),
    gasLimit: 9_600_000n,
    extraTargets: targets,
  });
  const b2Sh = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: myId,
    data: execWrap(
      newShareLedger,
      encodeSimpleAbi('initialize(address,string,uint64,bytes,bytes)', [
        ['address', inst.registry],
        ['string', sym],
        ['uint64', 0],
        ['bytes', shareAllocs],
        ['bytes', sharePerms],
      ])
    ),
    gasLimit: 9_000_000n,
    extraTargets: targets,
    lowerBoundHashHex: b2Chr.txHash,
  });
  const b2Bk = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 2n,
    to: myId,
    data: execWrap(
      newBankLedger,
      encodeSimpleAbi('initialize(address,string,uint64,bytes,bytes)', [
        ['address', inst.registry],
        ['string', 'SGD-CASH'],
        ['uint64', 0],
        ['bytes', bankAllocs],
        ['bytes', bankPerms],
      ])
    ),
    gasLimit: 9_000_000n,
    extraTargets: targets,
    lowerBoundHashHex: b2Sh.txHash,
  });
  const b2Sc = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 3n,
    to: myId,
    data: execWrap(
      newShareCapital,
      encodeSimpleAbi('initialize(address,address,address,address)', [
        ['address', inst.registry],
        ['address', newCharter],
        ['address', newBankLedger],
        ['address', shareEscrowIdentity],
      ])
    ),
    gasLimit: 8_000_000n,
    extraTargets: targets,
    lowerBoundHashHex: b2Bk.txHash,
  });

  const b2Hashes = [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2Chr.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2Sh.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2Bk.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [b2Sc.raw]),
  ];

  if (hasIfrsAuto) {
    const keeperEoa = computeAddress(inst.keeperPriv);
    const regActionHash = await slxNodeRpc(rpcUrl, 'eth_call', [
      {
        to: inst.registry,
        data: encodeSimpleAbi('hashRegisterIdentity(address)', [['address', newTreasuryIdentity]]),
      },
      'latest',
    ]);
    const kn = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [keeperEoa, 'latest']));
    const kTargets = [inst.keeperIdentity, inst.registry, treasRegAuth, newTreasuryIdentity];
    const k1 = signOrderedTx({
      privateKey: inst.keeperPriv,
      nonce: kn,
      to: inst.keeperIdentity,
      data: encodeSimpleAbi('initOracleAuth(address,address,address,address,bytes32,uint64)', [
        ['address', treasRegAuth],
        ['address', inst.registry],
        ['address', inst.keeperIdentity],
        ['address', inst.registry],
        ['bytes32', regActionHash],
        ['uint64', 100n],
      ]),
      gasLimit: 4_800_000n,
      extraTargets: kTargets,
    });
    const k2 = signOrderedTx({
      privateKey: inst.keeperPriv,
      nonce: kn + 1n,
      to: inst.keeperIdentity,
      data: encodeSimpleAbi('approveAndFinalizeAuth(address)', [['address', treasRegAuth]]),
      gasLimit: 4_800_000n,
      extraTargets: kTargets,
      lowerBoundHashHex: k1.txHash,
    });
    const regInner = encodeSimpleAbi('registerIdentity(address,address)', [
      ['address', newTreasuryIdentity],
      ['address', treasRegAuth],
    ]);
    const k3 = signOrderedTx({
      privateKey: inst.keeperPriv,
      nonce: kn + 2n,
      to: inst.keeperIdentity,
      data: encodeSimpleAbi('execute(address,bytes)', [
        ['address', inst.registry],
        ['bytes', hexToBytes(regInner)],
      ]),
      gasLimit: 5_200_000n,
      extraTargets: kTargets,
      lowerBoundHashHex: k2.txHash,
    });
    b2Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k1.raw]));
    b2Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k2.raw]));
    b2Hashes.push(await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k3.raw]));
  }

  await waitReceipts(rpcUrl, b2Hashes);

  if (onStatus) {
    onStatus(`Block 3/3: Auto-deploying First Shareholder Resolution & registering in HfsRegistry…`);
  }
  const actHashHex = await slxNodeRpc(rpcUrl, 'eth_call', [
    { to: newCharter, data: encodeSimpleAbi('hashActivateCharter()') },
    'latest',
  ]);

  const regMeta = {
    sym,
    sh: newShareLedger,
    bk: newBankLedger,
    sc: newShareCapital,
    esc: shareEscrowIdentity,
    fr: firstResAuth,
    aw: winBlks,
    ...(hasIfrsAuto ? { ac: newAccountingLedger, tr: newTreasuryIdentity } : {}),
    ...(hasConfAuto ? { cf: newConfLedger } : {}),
  };
  const meta = {
    ...regMeta,
    ...(hasIfrsAuto ? { accountingLedger: newAccountingLedger, treasuryIdentity: newTreasuryIdentity } : {}),
    ...(hasConfAuto ? { confidentialLedger: newConfLedger } : {}),
  };

  const n2 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  let curNonce = n2;
  let prevHash = null;
  const b3Txs = [];

  if (hasIfrsAuto) {
    const treasHdl = `treas_${newAccountingLedger.slice(2, 10)}`;
    const treasNick = `${compName.slice(0, 20)} Treasury`;
    const txInitAcc = signOrderedTx({
      privateKey: myPriv,
      nonce: curNonce++,
      to: myId,
      data: execWrap(
        newAccountingLedger,
        encodeSimpleAbi(
          'initialize(address,address,address,address,address,string,string)',
          [
            ['address', inst.registry],
            ['address', reg],
            ['address', newCharter],
            ['address', newBankLedger],
            ['address', newTreasuryIdentity],
            ['string', treasHdl],
            ['string', treasNick],
          ]
        )
      ),
      gasLimit: 7_200_000n,
      extraTargets: targets,
    });
    prevHash = txInitAcc.txHash;
    b3Txs.push(txInitAcc);

    const txPinAcc = signOrderedTx({
      privateKey: myPriv,
      nonce: curNonce++,
      to: myId,
      data: execWrap(
        newCharter,
        encodeSimpleAbi('setAccountingLedger(address,address,address)', [
          ['address', newAccountingLedger],
          ['address', reg],
          ['address', ZERO],
        ])
      ),
      gasLimit: 6_500_000n,
      extraTargets: targets,
      lowerBoundHashHex: prevHash,
    });
    prevHash = txPinAcc.txHash;
    b3Txs.push(txPinAcc);

    if (hasConfAuto) {
      const txBankHfsReg = signOrderedTx({
        privateKey: myPriv,
        nonce: curNonce++,
        to: myId,
        data: execWrap(
          newBankLedger,
          encodeSimpleAbi('setHfsRegistry(address)', [['address', reg]])
        ),
        gasLimit: 4_200_000n,
        extraTargets: targets,
        lowerBoundHashHex: prevHash,
      });
      prevHash = txBankHfsReg.txHash;
      b3Txs.push(txBankHfsReg);

      const txInitConf = signOrderedTx({
        privateKey: myPriv,
        nonce: curNonce++,
        to: myId,
        data: execWrap(
          newConfLedger,
          encodeSimpleAbi('initialize(address,address,address,address)', [
            ['address', inst.registry],
            ['address', reg],
            ['address', newCharter],
            ['address', newAccountingLedger],
          ])
        ),
        gasLimit: 6_500_000n,
        extraTargets: targets,
        lowerBoundHashHex: prevHash,
      });
      prevHash = txInitConf.txHash;
      b3Txs.push(txInitConf);

      const founderKeys = deriveIdentityEncryptionKeys(myPriv, myId);
      const auditKp = deriveCompanyAuditKeypair(randomBytes(32), newCharter, 1);
      const founderWrap = wrapSecretForRecipientSecp(
        auditKp.secretLeBytes32,
        founderKeys.secpPub64Bytes,
        'SLX_AUDIT_WRAP'
      );
      const wrapsBlob = concatBytes(
        u16BE(1),
        hexToBytes(myId).slice(-20),
        u16BE(founderWrap.length),
        founderWrap
      );
      const txAuditEp = signOrderedTx({
        privateKey: myPriv,
        nonce: curNonce++,
        to: myId,
        data: execWrap(
          newCharter,
          encodeSimpleAbi('initOrRotateAuditEpoch(bytes32,bytes,address)', [
            ['bytes32', auditKp.pub32Hex],
            ['bytes', wrapsBlob],
            ['address', ZERO],
          ])
        ),
        gasLimit: 5_800_000n,
        extraTargets: targets,
        lowerBoundHashHex: prevHash,
      });
      prevHash = txAuditEp.txHash;
      b3Txs.push(txAuditEp);

      const txRegConf = signOrderedTx({
        privateKey: myPriv,
        nonce: curNonce++,
        to: reg,
        data: HfsRegistryAbi.registerInstance('CONF_LEDGER', newConfLedger, myId, compName, {
          corporateCharter: newCharter,
          accountingLedger: newAccountingLedger,
          fiatLedger: newBankLedger,
        }),
        gasLimit: 5_500_000n,
        extraTargets: targets,
        lowerBoundHashHex: prevHash,
      });
      prevHash = txRegConf.txHash;
      b3Txs.push(txRegConf);
    }

    const txRegIfrs = signOrderedTx({
      privateKey: myPriv,
      nonce: curNonce++,
      to: reg,
      data: HfsRegistryAbi.registerInstance('IFRS_LEDGER', newAccountingLedger, myId, compName, {
        chr: newCharter,
        bk: newBankLedger,
        sh: newShareLedger,
        tr: newTreasuryIdentity,
        sc: newShareCapital,
        ...(hasConfAuto ? { cf: newConfLedger } : {}),
      }),
      gasLimit: 5_800_000n,
      extraTargets: targets,
      lowerBoundHashHex: prevHash,
    });
    prevHash = txRegIfrs.txHash;
    b3Txs.push(txRegIfrs);
  }

  const b3Res = signOrderedTx({
    privateKey: myPriv,
    nonce: curNonce++,
    to: myId,
    data: encodeSimpleAbi('initCharterAuth(address,address,address,address,bytes32,bytes32)', [
      ['address', firstResAuth],
      ['address', inst.registry],
      ['address', newCharter],
      ['address', newCharter],
      ['bytes32', kH('FIRST_SHAREHOLDER_RESOLUTION')],
      ['bytes32', actHashHex],
    ]),
    gasLimit: 8_200_000n,
    extraTargets: targets,
    ...(prevHash ? { lowerBoundHashHex: prevHash } : {}),
  });
  const b3Reg = signOrderedTx({
    privateKey: myPriv,
    nonce: curNonce++,
    to: reg,
    data: HfsRegistryAbi.registerInstance('CORPORATE_CHARTER', newCharter, myId, compName, regMeta),
    gasLimit: 5_800_000n,
    extraTargets: targets,
    lowerBoundHashHex: b3Res.txHash,
  });
  b3Txs.push(b3Res, b3Reg);

  await waitReceipts(
    rpcUrl,
    await Promise.all(b3Txs.map((t) => slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [t.raw])))
  );

  // Whitelist newly incorporated HFS subroutines on Founder's Identity (State = 2)
  const founderBatch = [
    { hfsAddr: newCharter, typeName: 'CORPORATE_CHARTER', status: 2, label: compName },
    ...(hasIfrsAuto
      ? [{ hfsAddr: newAccountingLedger, typeName: 'IFRS_LEDGER', status: 2, label: compName }]
      : []),
  ];
  await wallet.setHfsAssociationBatch(founderBatch, { rpcUrl }).catch(() => {});

  // Notify any invited external Identities (State = 1 Pending until they review & whitelist!)
  for (const extAddr of extraIdsToVerify) {
    await wallet
      .notifyExternalHfsAssociation({
        targetIdentityAddr: extAddr,
        hfsAddr: newCharter,
        typeName: 'CORPORATE_CHARTER',
        label: compName,
        rpcUrl,
      })
      .catch(() => {});
  }

  return {
    primaryAddr: newCharter,
    label: compName,
    meta,
    selectionKey: makeHfsSelectionKey(newCharter, meta),
  };
}

export async function deployNewFracturedHegemonyHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const codeHash = manifest?.codeHashes?.hegemony;
  const reg = manifest?.hfsRegistry;
  if (!codeHash || !reg) throw new Error('Missing hegemony codeHash or hfsRegistry in manifest');

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Fractured Hegemony' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  if (onStatus) onStatus('Block 1/2: Instantiating fresh hegemony.wasm HFS on Subnet 1…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const s0 = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: codeHash,
    gasLimit: 5_000_000n,
  });
  const [r0] = await waitReceipts(rpcUrl, [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s0.raw])]);
  const newContractAddr = r0.contractAddress.toLowerCase();

  const realmId = bytesToHex(concatBytes(utf8ToBytes('HEG_REALM_'), randomBytes(22)));
  if (onStatus) onStatus(`Block 2/2: Initializing 36-Sector Realm & registering ${shortHex(newContractAddr)}…`);

  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const txCreate = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: newContractAddr,
    data: encodeSimpleAbi('createRealm(bytes32)', [['bytes32', realmId]]),
    gasLimit: 5_000_000n,
    extraTargets: [newContractAddr],
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: reg,
    data: HfsRegistryAbi.registerInstance('FRACTURED_HEGEMONY', newContractAddr, idRec?.identityAddr, label, {
      realmId,
    }),
    gasLimit: 5_200_000n,
    extraTargets: [reg, newContractAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txCreate.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txCreate.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newContractAddr,
      typeName: 'FRACTURED_HEGEMONY',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newContractAddr,
    label,
    meta: { realmId },
    selectionKey: makeHfsSelectionKey(newContractAddr, { realmId }),
  };
}

export async function deployNewCipherNoirHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const codeHash = manifest?.codeHashes?.cipher_noir;
  const vrfBeaconAddr =
    manifest?.cipherNoir?.vrfBeaconAddr || manifest?.secretBallot?.vrfBeacon;
  const reg = manifest?.hfsRegistry;
  if (!codeHash || !vrfBeaconAddr || !reg) {
    throw new Error('Missing cipher_noir codeHash, vrfBeaconAddr, or hfsRegistry in manifest');
  }

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Cipher Noir' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  if (onStatus) onStatus('Block 1/2: Instantiating fresh Arbiter-Free cipher-noir.wasm Tribunal…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const s0 = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: codeHash,
    gasLimit: 5_000_000n,
  });
  const [r0] = await waitReceipts(rpcUrl, [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s0.raw])]);
  const newContractAddr = r0.contractAddress.toLowerCase();

  const caseId = bytesToHex(concatBytes(utf8ToBytes('NOIR_CASE_'), randomBytes(22)));
  if (onStatus) onStatus(`Block 2/2: Linking 5-Validator VRF Beacon & opening Case ${shortHex(newContractAddr)}…`);

  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const txLink = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: newContractAddr,
    data: encodeSimpleAbi('initTribunal(address)', [['address', vrfBeaconAddr]]),
    gasLimit: 2_500_000n,
    extraTargets: [newContractAddr],
  });
  const txInit = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: newContractAddr,
    data: encodeSimpleAbi('openCase(bytes32)', [['bytes32', caseId]]),
    gasLimit: 5_000_000n,
    extraTargets: [newContractAddr, vrfBeaconAddr],
    lowerBoundHashHex: txLink.txHash,
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 2n,
    to: reg,
    data: HfsRegistryAbi.registerInstance('CIPHER_NOIR', newContractAddr, idRec?.identityAddr, label, {
      caseId,
    }),
    gasLimit: 5_200_000n,
    extraTargets: [reg, newContractAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txInit.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txLink.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInit.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newContractAddr,
      typeName: 'CIPHER_NOIR',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newContractAddr,
    label,
    meta: { caseId },
    selectionKey: makeHfsSelectionKey(newContractAddr, { caseId }),
  };
}

export async function deployNewQuantumLotteryHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const lotteryCodeHash = manifest?.codeHashes?.lottery;
  const idCodeHash = manifest?.codeHashes?.identity;
  const authCodeHash = manifest?.codeHashes?.authorization;
  const reg = manifest?.hfsRegistry;
  const inst = manifest?.institutional;
  const instReg = inst?.registry;
  const fiatLedger = inst?.fiatLedger;
  const vrfBeacon = manifest?.quantumLottery?.vrfBeacon;
  const minVals = BigInt(manifest?.quantumLottery?.minValidators || 5);
  if (
    !lotteryCodeHash ||
    !idCodeHash ||
    !authCodeHash ||
    !reg ||
    !instReg ||
    !fiatLedger ||
    !vrfBeacon ||
    !inst?.keeperPriv ||
    !inst?.keeperIdentity
  ) {
    throw new Error('Missing Quantum Lottery / Institutional manifest addresses');
  }

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Quantum 4D Jackpot' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;
  const keeperEoa = computeAddress(inst.keeperPriv);

  if (onStatus) onStatus('Block 1/3: Instantiating Vault Identity, Auth & lottery.wasm on Subnet 1…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const kn0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [keeperEoa, 'latest']));
  const txVaultDep = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: idCodeHash,
    gasLimit: 4_500_000n,
  });
  const txLotDep = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 1n,
    to: null,
    data: lotteryCodeHash,
    gasLimit: 4_500_000n,
    lowerBoundHashHex: txVaultDep.txHash,
  });
  const txAuthDep = signOrderedTx({
    privateKey: inst.keeperPriv,
    nonce: kn0,
    to: null,
    data: authCodeHash,
    gasLimit: 4_500_000n,
  });
  const [rVault, rLot, rAuth] = await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txVaultDep.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txLotDep.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txAuthDep.raw]),
  ]);
  const vaultAddr = rVault.contractAddress.toLowerCase();
  const lotteryAddr = rLot.contractAddress.toLowerCase();
  const regAuthAddr = rAuth.contractAddress.toLowerCase();

  if (onStatus) onStatus('Block 2/3: Registering Vault Identity & delegating payout custody…');
  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const handle = `lotvault_${lotteryAddr.slice(2, 10)}`;
  const txInitVault = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: vaultAddr,
    data: encodeSimpleAbi('initializeWithNickname(address,string,string)', [
      ['address', myEoa],
      ['string', handle],
      ['string', `${label || 'Quantum 4D'} Vault`],
    ]),
    gasLimit: 3_500_000n,
    extraTargets: [vaultAddr],
  });
  const txDelVault = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: vaultAddr,
    data: encodeSimpleAbi('setDelegate(address,bool)', [
      ['address', lotteryAddr],
      ['bool', true],
    ]),
    gasLimit: 2_500_000n,
    extraTargets: [vaultAddr],
    lowerBoundHashHex: txInitVault.txHash,
  });

  const regActionHash = await slxNodeRpc(rpcUrl, 'eth_call', [
    {
      to: instReg,
      data: encodeSimpleAbi('hashRegisterIdentity(address)', [['address', vaultAddr]]),
    },
    'latest',
  ]);
  const kn1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [keeperEoa, 'latest']));
  const kTargets = [inst.keeperIdentity, instReg, regAuthAddr, vaultAddr];
  const k1 = signOrderedTx({
    privateKey: inst.keeperPriv,
    nonce: kn1,
    to: inst.keeperIdentity,
    data: encodeSimpleAbi('initOracleAuth(address,address,address,address,bytes32,uint64)', [
      ['address', regAuthAddr],
      ['address', instReg],
      ['address', inst.keeperIdentity],
      ['address', instReg],
      ['bytes32', regActionHash],
      ['uint64', 100n],
    ]),
    gasLimit: 4_800_000n,
    extraTargets: kTargets,
  });
  const k2 = signOrderedTx({
    privateKey: inst.keeperPriv,
    nonce: kn1 + 1n,
    to: inst.keeperIdentity,
    data: encodeSimpleAbi('approveAndFinalizeAuth(address)', [['address', regAuthAddr]]),
    gasLimit: 4_800_000n,
    extraTargets: kTargets,
    lowerBoundHashHex: k1.txHash,
  });
  const regInner = encodeSimpleAbi('registerIdentity(address,address)', [
    ['address', vaultAddr],
    ['address', regAuthAddr],
  ]);
  const k3 = signOrderedTx({
    privateKey: inst.keeperPriv,
    nonce: kn1 + 2n,
    to: inst.keeperIdentity,
    data: encodeSimpleAbi('execute(address,bytes)', [
      ['address', instReg],
      ['bytes', hexToBytes(regInner)],
    ]),
    gasLimit: 5_200_000n,
    extraTargets: kTargets,
    lowerBoundHashHex: k2.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInitVault.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txDelVault.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k1.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k2.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [k3.raw]),
  ]);

  if (onStatus) onStatus(`Block 3/3: Initializing ${shortHex(lotteryAddr)} & registering in HfsRegistry…`);
  const n2 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const cleanLabel = String(label || 'Quantum 4D Jackpot').slice(0, 64);
  const txInitLot = signOrderedTx({
    privateKey: myPriv,
    nonce: n2,
    to: lotteryAddr,
    data: encodeSimpleAbi('initialize(address,address,address,address,uint64,uint64,string)', [
      ['address', fiatLedger],
      ['address', instReg],
      ['address', vaultAddr],
      ['address', vrfBeacon],
      ['uint64', minVals],
      ['uint64', 12n],
      ['string', cleanLabel],
    ]),
    gasLimit: 4_000_000n,
    extraTargets: [lotteryAddr, instReg, vaultAddr],
  });
  const txRegHfs = signOrderedTx({
    privateKey: myPriv,
    nonce: n2 + 1n,
    to: reg,
    data: HfsRegistryAbi.registerInstance(
      'QUANTUM_LOTTERY',
      lotteryAddr,
      idRec?.identityAddr,
      cleanLabel,
      { vaultIdentity: vaultAddr, vrfBeacon }
    ),
    gasLimit: 4_500_000n,
    extraTargets: [reg, lotteryAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txInitLot.txHash,
  });
  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInitLot.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txRegHfs.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: lotteryAddr,
      typeName: 'QUANTUM_LOTTERY',
      status: 2,
      label: cleanLabel,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: lotteryAddr,
    label: cleanLabel,
    meta: { vaultIdentity: vaultAddr, vrfBeacon },
    selectionKey: makeHfsSelectionKey(lotteryAddr, {}),
  };
}

export async function deployNewSecretBallotHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const ballotCodeHash = manifest?.codeHashes?.secret_ballot;
  const reg = manifest?.hfsRegistry;
  const inst = manifest?.institutional;
  const instReg = inst?.registry;
  const shareLedger = inst?.shareLedger || '0x0000000000000000000000000000000000000000';
  const vrfBeacon =
    manifest?.secretBallot?.vrfBeacon || manifest?.quantumLottery?.vrfBeacon;
  const minVals = BigInt(manifest?.secretBallot?.minValidators || 4);
  if (!ballotCodeHash || !reg || !instReg || !vrfBeacon) {
    throw new Error('Missing CipherVote / VRF Beacon manifest addresses');
  }

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'CipherVote' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  if (onStatus) onStatus('Block 1/2: Instantiating secret_ballot.wasm HFS on Subnet 1…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const txDep = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: ballotCodeHash,
    gasLimit: 4_500_000n,
  });
  const [rDep] = await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txDep.raw]),
  ]);
  const ballotAddr = rDep.contractAddress.toLowerCase();

  if (onStatus) {
    onStatus(`Block 2/2: Initializing ${shortHex(ballotAddr)} & registering in HfsRegistry…`);
  }
  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const cleanLabel = String(label || 'CipherVote Governance Hub').slice(0, 64);
  const txInit = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: ballotAddr,
    data: encodeSimpleAbi('initialize(address,address,address,uint64,string)', [
      ['address', instReg],
      ['address', shareLedger],
      ['address', vrfBeacon],
      ['uint64', minVals],
      ['string', cleanLabel],
    ]),
    gasLimit: 4_000_000n,
    extraTargets: [ballotAddr, instReg],
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: reg,
    data: HfsRegistryAbi.registerInstance(
      'SECRET_BALLOT',
      ballotAddr,
      idRec?.identityAddr,
      cleanLabel,
      { vrfBeacon, shareLedger }
    ),
    gasLimit: 4_500_000n,
    extraTargets: [reg, ballotAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txInit.txHash,
  });
  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInit.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: ballotAddr,
      typeName: 'SECRET_BALLOT',
      status: 2,
      label: cleanLabel,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: ballotAddr,
    label: cleanLabel,
    meta: { vrfBeacon, shareLedger },
    selectionKey: makeHfsSelectionKey(ballotAddr, {}),
  };
}

export async function deployNewIfrsLedgerHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const inst = manifest?.institutional;
  const reg = manifest?.hfsRegistry;
  if (!inst || !reg) throw new Error('Missing institutional manifest');

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'IFRS Accounting Ledger' });
  const myId = idRec.identityAddr.toLowerCase();
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;
  const compName = String(label || 'Bostun Dynamix Pte. Ltd.').trim().slice(0, 60);

  // Deploy 1-Founder CorporateCharter + Cash Ledger + Virgin Treasury Identity + IFRS AccountingLedger
  const chrRes = await deployNewCorporateCharterHfs({
    wallet,
    companyName: compName,
    userShares: 100000,
    aiSelections: [
      {
        identityAddr: myId,
        isDirector: true,
        isShareholder: true,
        shares: 100000,
      },
    ],
    rpcUrl,
    manifestOverride: manifest,
    onStatus,
  });

  // Immediately ratify the 100%-founder First Shareholder Resolution so the IFRS Ledger is ACTIVE!
  const frAuth = chrRes.meta.fr;
  const newCharter = chrRes.primaryAddr;
  const newAcc = chrRes.meta.accountingLedger;
  const newConf = chrRes.meta.confidentialLedger || '';
  const newBank = chrRes.meta.bk;
  const newTreas = chrRes.meta.treasuryIdentity;
  if (frAuth && newCharter && newAcc) {
    if (onStatus) onStatus(`Activating ${compName} Charter & seeding initial Share Capital…`);
    const n3 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
    const targets = [
      myId,
      frAuth,
      newCharter,
      newAcc,
      newBank,
      newTreas,
      inst.registry,
      reg,
      ...(newConf ? [newConf] : []),
    ];
    const execWrap = (target, innerHex) =>
      encodeSimpleAbi('execute(address,bytes)', [
        ['address', target],
        ['bytes', hexToBytes(innerHex)],
      ]);
    const tCons = signOrderedTx({
      privateKey: myPriv,
      nonce: n3,
      to: myId,
      data: execWrap(newCharter, encodeSimpleAbi('consentToDirectorship()')),
      gasLimit: 4_200_000n,
      extraTargets: targets,
    });
    const tApp = signOrderedTx({
      privateKey: myPriv,
      nonce: n3 + 1n,
      to: myId,
      data: encodeSimpleAbi('approveAndFinalizeAuth(address)', [['address', frAuth]]),
      gasLimit: 5_200_000n,
      extraTargets: targets,
      lowerBoundHashHex: tCons.txHash,
    });
    const tAct = signOrderedTx({
      privateKey: myPriv,
      nonce: n3 + 2n,
      to: myId,
      data: encodeSimpleAbi('activateCharter(address,address)', [
        ['address', newCharter],
        ['address', frAuth],
      ]),
      gasLimit: 5_500_000n,
      extraTargets: targets,
      lowerBoundHashHex: tApp.txHash,
    });
    const tDepCash = signOrderedTx({
      privateKey: myPriv,
      nonce: n3 + 3n,
      to: myId,
      data: encodeSimpleAbi('transferBankBalance(address,address,uint64)', [
        ['address', newBank],
        ['address', newTreas],
        ['uint64', 500_000n],
      ]),
      gasLimit: 4_500_000n,
      extraTargets: targets,
      lowerBoundHashHex: tAct.txHash,
    });
    const tBookCap = signOrderedTx({
      privateKey: myPriv,
      nonce: n3 + 4n,
      to: myId,
      data: execWrap(
        newAcc,
        encodeSimpleAbi('recordPaidInCapital(uint64,uint64,uint64,address)', [
          ['uint64', 100_000n],
          ['uint64', 1n],
          ['uint64', 500_000n],
          ['address', '0x0000000000000000000000000000000000000000'],
        ])
      ),
      gasLimit: 5_800_000n,
      extraTargets: targets,
      lowerBoundHashHex: tDepCash.txHash,
    });
    const tSetConf = newConf
      ? signOrderedTx({
          privateKey: myPriv,
          nonce: n3 + 5n,
          to: myId,
          data: execWrap(
            newAcc,
            encodeSimpleAbi('setConfidentialLedger(address,address)', [
              ['address', newConf],
              ['address', '0x0000000000000000000000000000000000000000'],
            ])
          ),
          gasLimit: 5_200_000n,
          extraTargets: targets,
          lowerBoundHashHex: tBookCap.txHash,
        })
      : null;
    await waitReceipts(rpcUrl, [
      await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tCons.raw]),
      await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tApp.raw]),
      await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tAct.raw]),
      await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tDepCash.raw]),
      await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tBookCap.raw]),
      ...(tSetConf ? [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [tSetConf.raw])] : []),
    ]);
  }

  const outMeta = {
    corporateCharter: newCharter,
    fiatLedger: newBank,
    shareLedger: chrRes.meta.sh,
    treasuryIdentity: newTreas,
    shareCapital: chrRes.meta.sc,
    ...(newConf ? { confidentialLedger: newConf } : {}),
  };
  return {
    primaryAddr: newAcc,
    label: compName,
    meta: outMeta,
    selectionKey: makeHfsSelectionKey(newAcc, outMeta),
  };
}

export async function deployNewWebRtcSignalHfs({
  wallet,
  label,
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const rtcCodeHash =
    manifest?.codeHashes?.webrtc_signal ||
    '0x6883e5a1c75848f8d08717076d90fcf812ac280b6a2fd8d909aed95a2463100b';
  const reg = manifest?.hfsRegistry;
  if (!reg) throw new Error('Missing hfsRegistry in Subnet 1 manifest');

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'LexiCall WebRTC' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;
  const adminAddr = idRec?.identityAddr || myEoa;
  const hubLabel = String(label || 'Private LexiCall Signaling Hub').trim();

  if (onStatus) onStatus('Block 1/2: Instantiating fresh webrtc_signal.wasm HFS on Subnet 1…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const s0 = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: rtcCodeHash,
    gasLimit: 4_500_000n,
  });
  const h0 = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s0.raw]);
  const [r0] = await waitReceipts(rpcUrl, [h0]);
  const newHubAddr = r0.contractAddress.toLowerCase();

  if (onStatus) {
    onStatus(`Block 2/2: Initializing ${shortHex(newHubAddr)} & registering in HfsRegistry…`);
  }
  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const initCd = encodeSimpleAbi('initialize(address)', [['address', adminAddr]]);
  const regCd = HfsRegistryAbi.registerInstance(
    'WEBRTC_SIGNAL',
    newHubAddr,
    idRec?.identityAddr,
    hubLabel,
    {}
  );

  const txInit = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: newHubAddr,
    data: initCd,
    gasLimit: 4_800_000n,
    extraTargets: [newHubAddr],
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: reg,
    data: regCd,
    gasLimit: 5_200_000n,
    extraTargets: [reg, newHubAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txInit.txHash,
  });

  const hInit = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInit.raw]);
  const hReg = await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]);
  await waitReceipts(rpcUrl, [hInit, hReg]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newHubAddr,
      typeName: 'WEBRTC_SIGNAL',
      status: 2,
      label: hubLabel,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newHubAddr,
    label: hubLabel,
    meta: {},
    selectionKey: makeHfsSelectionKey(newHubAddr, {}),
  };
}

export async function deployNewVolatileVolesHfs({
  wallet,
  label = 'Volatile Voles Burrow Arena',
  rpcUrl = getDefaultNodeWsUrl(),
  onStatus = null,
}) {
  const { manifest } = await SlxHfsCache.hydrateWithManifest();
  const codeHash = manifest?.codeHashes?.volatile_voles;
  const reg = manifest?.hfsRegistry;
  if (!codeHash || !reg) {
    throw new Error('Missing volatile_voles codeHash or hfsRegistry in manifest');
  }

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Volatile Voles' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  if (onStatus) onStatus('Block 1/2: Instantiating fresh volatile_voles.wasm Burrow Arena…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const s0 = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: codeHash,
    gasLimit: 5_000_000n,
  });
  const [r0] = await waitReceipts(rpcUrl, [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s0.raw])]);
  const newContractAddr = r0.contractAddress.toLowerCase();

  const tableId = bytesToHex(concatBytes(utf8ToBytes('VOLES_TBL_'), randomBytes(22)));
  if (onStatus) onStatus(`Block 2/2: Opening Burrow Table & registering ${shortHex(newContractAddr)}…`);

  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const txCreate = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: newContractAddr,
    data: encodeSimpleAbi('createTable(bytes32,address,uint64)', [
      ['bytes32', tableId],
      ['address', idRec?.identityAddr || '0x0000000000000000000000000000000000000000'],
      ['uint64', 7n],
    ]),
    gasLimit: 3_500_000n,
    extraTargets: [newContractAddr],
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: reg,
    data: HfsRegistryAbi.registerInstance('VOLATILE_VOLES', newContractAddr, idRec?.identityAddr, label, {
      tableId,
    }),
    gasLimit: 5_200_000n,
    extraTargets: [reg, newContractAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txCreate.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txCreate.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newContractAddr,
      typeName: 'VOLATILE_VOLES',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newContractAddr,
    label,
    meta: { tableId },
    selectionKey: makeHfsSelectionKey(newContractAddr, { tableId }),
  };
}

export async function deployNewRideExchangeHfs({
  wallet,
  label = 'Singapore Metro Ride Exchange',
  quoteSymbol = 'SGD-RIDE',
  rpcUrl = getDefaultNodeWsUrl(),
  manifestOverride = null,
  onStatus = null,
}) {
  const manifest = manifestOverride || (await SlxHfsCache.hydrateWithManifest()).manifest;
  const inst = manifest?.institutional;
  const chLedger = manifest?.codeHashes?.asset_ledger;
  const chRide =
    manifest?.codeHashes?.ride_exchange ||
    '0xd92f9b0e1577d5fbe1d79970de65850d8e09911c0f0830d54c3786ad949f0ebc';
  const reg = manifest?.hfsRegistry;
  if (!inst || !chLedger || !reg) {
    throw new Error('Missing institutional suite or codeHashes in manifest');
  }

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Ride Exchange' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;
  const ZERO = '0x0000000000000000000000000000000000000000';

  if (onStatus) onStatus(`Block 1/2: Instantiating ${quoteSymbol} AssetLedger & ride_exchange.wasm…`);
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const sFiat = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: chLedger,
    gasLimit: 2_000_000n,
  });
  const sRide = signOrderedTx({
    privateKey: myPriv,
    nonce: n0 + 1n,
    to: null,
    data: chRide,
    gasLimit: 2_500_000n,
    lowerBoundHashHex: sFiat.txHash,
  });
  const [rFiat, rRide] = await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sFiat.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [sRide.raw]),
  ]);
  const newFiat = rFiat.contractAddress.toLowerCase();
  const newRide = rRide.contractAddress.toLowerCase();

  const u64BE = (v) => {
    const b = new Uint8Array(8);
    let x = BigInt(v);
    for (let i = 7; i >= 0; i--) {
      b[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return b;
  };
  const packAlloc = (a, amt) => concatBytes(hexToBytes(a).slice(-20), u64BE(amt));
  const packPerm = (act, chr, pol) =>
    concatBytes(
      hexToBytes(act).slice(0, 32),
      hexToBytes(chr).slice(-20),
      hexToBytes(pol).slice(0, 32)
    );
  const kH = (s) => keccak256Hex(utf8ToBytes(s));
  const perms = concatBytes(
    packPerm(kH('SUPER'), newRide, kH('SUPER_GOVERNANCE')),
    packPerm(kH('ISSUE'), newRide, kH('BANK_ORACLE')),
    packPerm(kH('CANCEL'), newRide, kH('BANK_ORACLE')),
    packPerm(kH('TRANSFER'), ZERO, kH('HOLDER_SELF')),
    packPerm(kH('APPROVE'), ZERO, kH('HOLDER_SELF'))
  );

  const sameAsEscrow =
    idRec.identityAddr.toLowerCase() === String(inst.dexEscrowIdentity || '').toLowerCase();
  const fiatAllocs = sameAsEscrow
    ? packAlloc(inst.dexEscrowIdentity, 90_050_000n)
    : concatBytes(
        packAlloc(inst.dexEscrowIdentity, 90_000_000n),
        packAlloc(idRec.identityAddr, 50_000n)
      );

  const targets = [
    inst.registry,
    inst.corporateCharter,
    inst.dexEscrowIdentity,
    idRec.identityAddr,
    newFiat,
    newRide,
    reg,
  ];
  const execWrap = (target, innerHex) =>
    encodeSimpleAbi('execute(address,bytes)', [
      ['address', target],
      ['bytes', hexToBytes(innerHex)],
    ]);

  if (onStatus) onStatus(`Block 2/2: Initializing ${label} & registering in HfsRegistry…`);
  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const txInitFiat = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: idRec.identityAddr,
    data: execWrap(
      newFiat,
      encodeSimpleAbi('initialize(address,string,uint64,bytes,bytes)', [
        ['address', inst.registry],
        ['string', quoteSymbol],
        ['uint64', 2n],
        ['bytes', fiatAllocs],
        ['bytes', perms],
      ])
    ),
    gasLimit: 2_500_000n,
    extraTargets: targets,
  });
  const txAttach = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: idRec.identityAddr,
    data: execWrap(
      newFiat,
      encodeSimpleAbi('setAttachedDex(address,address)', [
        ['address', newRide],
        ['address', ZERO],
      ])
    ),
    gasLimit: 2_000_000n,
    extraTargets: targets,
    lowerBoundHashHex: txInitFiat.txHash,
  });
  const txInitRide = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 2n,
    to: newRide,
    data: encodeSimpleAbi('initialize(address,address,address,string,uint64,uint64)', [
      ['address', inst.registry],
      ['address', newFiat],
      ['address', inst.dexEscrowIdentity],
      ['string', label],
      ['uint64', 9997n],
      ['uint64', 12800n],
    ]),
    gasLimit: 3_000_000n,
    extraTargets: targets,
    lowerBoundHashHex: txAttach.txHash,
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 3n,
    to: reg,
    data: HfsRegistryAbi.registerInstance('RIDE_EXCHANGE', newRide, idRec.identityAddr, label, {
      quoteLedger: newFiat,
      quoteSymbol,
    }),
    gasLimit: 5_000_000n,
    extraTargets: targets,
    lowerBoundHashHex: txInitRide.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInitFiat.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txAttach.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txInitRide.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newRide,
      typeName: 'RIDE_EXCHANGE',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newRide,
    label,
    meta: { quoteLedger: newFiat, quoteSymbol },
    selectionKey: makeHfsSelectionKey(newRide, {}),
  };
}

export async function deployNewJonesBlockchainHfs({
  wallet,
  label = 'Sunnyvale Family Town Board',
  rpcUrl = getDefaultNodeWsUrl(),
  manifestOverride = null,
  onStatus = null,
}) {
  const manifest = manifestOverride || (await SlxHfsCache.hydrateWithManifest()).manifest;
  const codeHash =
    manifest?.codeHashes?.jones_blockchain ||
    '0xec36f6ca98b7f8e7eb55f0bc279066d3f02070dffd50768a26654d3038695dcf';
  const reg = manifest?.hfsRegistry;
  if (!reg) throw new Error('Missing hfsRegistry in manifest');

  const idRec = await wallet.ensureIdentityWithPrompt({ rpcUrl, appName: 'Jones in the Blockchain' });
  const myEoa = wallet.keypair.address;
  const myPriv = wallet.keypair.privateKey;

  if (onStatus) onStatus('Block 1/2: Instantiating jones_blockchain.wasm Town Board…');
  const n0 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const s0 = signOrderedTx({
    privateKey: myPriv,
    nonce: n0,
    to: null,
    data: codeHash,
    gasLimit: 5_000_000n,
  });
  const [r0] = await waitReceipts(rpcUrl, [await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [s0.raw])]);
  const newContractAddr = r0.contractAddress.toLowerCase();

  const gameId = bytesToHex(concatBytes(utf8ToBytes('JONES_BRD_'), randomBytes(22)));
  if (onStatus) onStatus(`Block 2/2: Opening Sunnyvale Lobby & registering ${shortHex(newContractAddr)}…`);

  const n1 = BigInt(await slxNodeRpc(rpcUrl, 'eth_getTransactionCount', [myEoa, 'latest']));
  const txCreate = signOrderedTx({
    privateKey: myPriv,
    nonce: n1,
    to: newContractAddr,
    data: encodeSimpleAbi('createGame(bytes32,address,uint64,uint64,uint64,uint64)', [
      ['bytes32', gameId],
      ['address', idRec?.identityAddr || '0x0000000000000000000000000000000000000000'],
      ['uint64', 5000n],
      ['uint64', 65n],
      ['uint64', 30n],
      ['uint64', 60n],
    ]),
    gasLimit: 3_500_000n,
    extraTargets: [newContractAddr],
  });
  const txReg = signOrderedTx({
    privateKey: myPriv,
    nonce: n1 + 1n,
    to: reg,
    data: HfsRegistryAbi.registerInstance('JONES_BLOCKCHAIN', newContractAddr, idRec?.identityAddr, label, {
      gameId,
    }),
    gasLimit: 5_200_000n,
    extraTargets: [reg, newContractAddr, ...(idRec?.identityAddr ? [idRec.identityAddr] : [])],
    lowerBoundHashHex: txCreate.txHash,
  });

  await waitReceipts(rpcUrl, [
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txCreate.raw]),
    await slxNodeRpc(rpcUrl, 'eth_sendRawTransaction', [txReg.raw]),
  ]);

  await wallet
    .setHfsAssociation({
      hfsAddr: newContractAddr,
      typeName: 'JONES_BLOCKCHAIN',
      status: 2,
      label,
      rpcUrl,
    })
    .catch(() => {});

  return {
    primaryAddr: newContractAddr,
    label,
    meta: { gameId },
    selectionKey: makeHfsSelectionKey(newContractAddr, { gameId }),
  };
}

function wrapWebGatedDeployer(fn) {
  return async (opts = {}) => {
    const candidateLabel = opts.companyName || opts.label || '';
    if (candidateLabel) assertNotConfusableSuperlexiconName(candidateLabel);
    await assertWebRpcHfsDeployAllowed({
      wallet: opts.wallet,
      rpcUrl: opts.rpcUrl || getDefaultNodeWsUrl(),
    });
    return fn(opts);
  };
}

registerHfsTypeDeployer("PHANTOM_FLEET", wrapWebGatedDeployer(deployNewPhantomFleetHfs));
registerHfsTypeDeployer("DEX_CLOB", wrapWebGatedDeployer(deployNewDexMarketHfs));
registerHfsTypeDeployer("CORPORATE_CHARTER", deployNewCorporateCharterHfs);
registerHfsTypeDeployer("FRACTURED_HEGEMONY", wrapWebGatedDeployer(deployNewFracturedHegemonyHfs));
registerHfsTypeDeployer("CIPHER_NOIR", wrapWebGatedDeployer(deployNewCipherNoirHfs));
registerHfsTypeDeployer("QUANTUM_LOTTERY", wrapWebGatedDeployer(deployNewQuantumLotteryHfs));
registerHfsTypeDeployer("SECRET_BALLOT", wrapWebGatedDeployer(deployNewSecretBallotHfs));
registerHfsTypeDeployer("IFRS_LEDGER", wrapWebGatedDeployer(deployNewIfrsLedgerHfs));
registerHfsTypeDeployer("WEBRTC_SIGNAL", wrapWebGatedDeployer(deployNewWebRtcSignalHfs));
registerHfsTypeDeployer("VOLATILE_VOLES", wrapWebGatedDeployer(deployNewVolatileVolesHfs));
registerHfsTypeDeployer("RIDE_EXCHANGE", wrapWebGatedDeployer(deployNewRideExchangeHfs));
registerHfsTypeDeployer("JONES_BLOCKCHAIN", wrapWebGatedDeployer(deployNewJonesBlockchainHfs));
