/**
 * @superlexicon/sdk/charter-social
 *
 * Cast-in-Stone `Superlexicon Pte. Ltd.` Sovereign Charter Root, Protocol Confusable-Name Guard,
 * Automatic Company-Wide Social Groups (`All Members`), Director-Managed Company Sub-Groups
 * (e.g. `Superlexicon · Developers`), and Web RPC Developer Authorization Helpers.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  keccak256Hex,
  selectorBytes,
} from './crypto.js';
import {
  ZERO_ADDR,
  ZERO_BYTES32,
  readU16BE,
  readU64BE,
  encodeAbi,
  decodeUintWord,
  decodeAddrWord,
} from './abi.js';
import { getDefaultNodeWsUrl, SlxHfsCache, slxNodeRpc } from './rpc.js';

export const SUBGROUP_ALL_MEMBERS_SLUG =
  '0x2d6fd82dccd40f16639bc58f11cdac93aa27f4dca7ba174e4232571848422afc';
export const SUBGROUP_DEVELOPERS_SLUG =
  '0x7425dff72041e497b9005317e8d584a8e5ec49bffe00da3b355471b70c8799a4';

export const SOVEREIGN_SUPERLEXICON_CHARTER_SPEC = {
  legalName: 'Superlexicon Pte. Ltd.',
  jurisdiction: 'Singapore',
  countryCode: 'SG',
  shareSymbol: 'SLX-ORD',
  totalOrdinaryShares: 100_000,
  directors: [
    {
      key: 'manogaran_thanabalan',
      fullName: 'Manogaran Thanabalan',
      roleLabel: 'Director & Sole Shareholder',
      ordinaryShares: 100_000,
      ownershipPct: 100,
    },
    {
      key: 'sarah_jean_rodrigues',
      fullName: 'Sarah Jean Rodrigues',
      roleLabel: 'Director',
      ordinaryShares: 0,
      ownershipPct: 0,
    },
  ],
  developersSubgroupLabel: 'Superlexicon · Developers',
  developersSubgroupSlug: SUBGROUP_DEVELOPERS_SLUG,
};

// ---------------------------------------------------------------------------
// 1. Deterministic Confusable-Name Normalization (Mirrors `hps_sdk::governance`)
// ---------------------------------------------------------------------------

const _HOMOGLYPH_MAP = {
  0: 'o',
  1: 'i',
  '!': 'i',
  '|': 'i',
  2: 'z',
  3: 'e',
  4: 'a',
  '@': 'a',
  5: 's',
  $: 's',
  6: 'g',
  7: 't',
  8: 'b',
  9: '9',
  l: 'i',
  i: 'i',
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
  ç: 'c',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i', ł: 'i',
  ñ: 'n',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y',
  // Cyrillic & Greek UTS #39 confusables
  а: 'a', α: 'a',
  в: 'b', β: 'b',
  с: 'c', ς: 'c',
  е: 'e', ё: 'e', ε: 'e',
  і: 'i', ї: 'i', ӏ: 'i', Ӏ: 'i', ι: 'i',
  ј: 'j',
  к: 'k', κ: 'k',
  м: 'm', μ: 'm',
  н: 'h', η: 'h',
  ν: 'v',
  о: 'o', ο: 'o',
  р: 'p', ρ: 'p',
  ѕ: 's', σ: 's',
  т: 't', τ: 't',
  у: 'u', υ: 'u',
  х: 'x', χ: 'x',
};

const _CORP_NOISE_TOKENS = new Set([
  'the',
  'pte',
  'itd', // ltd
  'pteitd',
  'imited', // limited
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'ic', // llc
  'ip', // llp
  'pic', // plc
  'gmbh',
  'ag',
  'sa',
  'co',
  'company',
  'hoidings',
  'hoiding',
  'group',
  'iabs',
  'iab',
  'technoiogies',
  'technoiogy',
  'tech',
  'systems',
  'soiutions',
  'ventures',
  'foundation',
  'dao',
  'network',
  'protocoi',
  'officiai',
  'singapore',
  'sg',
  'giobai',
  'internationai',
]);

function _foldConfusableChar(ch) {
  const cp = ch.codePointAt(0);
  const norm = cp >= 0xff01 && cp <= 0xff5e ? String.fromCodePoint(cp - 0xfee0) : ch;
  const low = norm.toLowerCase();
  if (_HOMOGLYPH_MAP[low]) return _HOMOGLYPH_MAP[low];
  if (low >= 'a' && low <= 'z') return low === 'l' || low === 'i' ? 'i' : low;
  return null;
}

function _collapseRuns(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (!out || out[out.length - 1] !== str[i]) out += str[i];
  }
  return out;
}

function _editDistLe2(a, b) {
  if (Math.abs(a.length - b.length) > 2 || a.length > 32 || b.length > 32) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > 2) return false;
    prev = curr;
  }
  return prev[b.length] <= 2;
}

function _skeletonMatchesSuperlexicon(skel) {
  if (!skel) return false;
  const ROOT = 'superiexicon';
  if (
    skel.includes(ROOT) ||
    skel.includes('spriexicon') ||
    skel.includes('supiexicon') ||
    skel.includes('superiex') ||
    skel.includes('iexiconbiockchain')
  ) {
    return true;
  }
  if (_editDistLe2(skel, ROOT)) return true;
  if (skel.length > ROOT.length) {
    for (const w of [11, 12, 13]) {
      for (let i = 0; i + w <= skel.length; i++) {
        if (_editDistLe2(skel.slice(i, i + w), ROOT)) return true;
      }
    }
  }
  return false;
}

export function isConfusableSuperlexiconName(rawName) {
  const s = String(rawName || '').slice(0, 256);
  if (!s) return false;
  const tokens = [];
  let cur = '';
  for (const ch of s) {
    const f = _foldConfusableChar(ch);
    if (f) {
      if (!cur || cur[cur.length - 1] !== f) cur += f;
    } else if (/[\s.,\-_()[\]{}/\\&+:;'"•·]/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
    }
  }
  if (cur) tokens.push(cur);
  const fullSkel = _collapseRuns(tokens.join(''));
  const coreSkel = _collapseRuns(tokens.filter((t) => !_CORP_NOISE_TOKENS.has(t)).join(''));
  return _skeletonMatchesSuperlexicon(coreSkel) || _skeletonMatchesSuperlexicon(fullSkel);
}

export function subgroupSlugBytes32(slugOrLabel) {
  const s = String(slugOrLabel || '').trim();
  if (/^0x[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (!s || s.toUpperCase() === 'ALL_MEMBERS') return SUBGROUP_ALL_MEMBERS_SLUG;
  const norm = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return keccak256Hex(utf8ToBytes(norm || 'subgroup'));
}

export function companyGroupChannelHash(charterAddr, subgroupSlug = SUBGROUP_ALL_MEMBERS_SLUG) {
  const cleanSlug =
    !subgroupSlug || subgroupSlug === ZERO_BYTES32
      ? SUBGROUP_ALL_MEMBERS_SLUG
      : subgroupSlugBytes32(subgroupSlug);
  return keccak256Hex(
    concatBytes(
      utf8ToBytes('SLX_CORP_GROUP_V1'),
      hexToBytes(charterAddr).slice(-20),
      hexToBytes(cleanSlug).slice(0, 32)
    )
  );
}

export function isPublicWebsiteRpcUrl(rpcUrl) {
  const u = String(rpcUrl || '').trim().toLowerCase();
  if (!u) return true;
  if (
    u.includes('127.0.0.1') ||
    u.includes('localhost') ||
    u.includes('192.168.') ||
    u.includes('10.') ||
    u.startsWith('rf://') ||
    u.startsWith('serial://')
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. `CorporateCharter` Entity & Social Sub-Group ABI + Binary Decoders
// ---------------------------------------------------------------------------

export const CharterSocialAbi = {
  configureEntityAndSocial: ({
    legalName,
    jurisdiction = 'Singapore',
    registrationId = '',
    hfsRegistry = ZERO_ADDR,
    messagingHps = ZERO_ADDR,
  }) =>
    encodeAbi('configureEntityAndSocial(string,string,string,address,address)', [
      ['string', String(legalName || '').slice(0, 96)],
      ['string', String(jurisdiction || '').slice(0, 48)],
      ['string', String(registrationId || '').slice(0, 48)],
      ['address', hfsRegistry || ZERO_ADDR],
      ['address', messagingHps || ZERO_ADDR],
    ]),

  setRegistrationId: (registrationId) =>
    encodeAbi('setRegistrationId(string)', [['string', String(registrationId || '').slice(0, 48)]]),

  entityProfile: () => bytesToHex(selectorBytes('entityProfile()')),
  isSovereignSuperlexicon: () => bytesToHex(selectorBytes('isSovereignSuperlexicon()')),
  messagingHps: () => bytesToHex(selectorBytes('messagingHps()')),
  syncCompanySocialGroup: () => bytesToHex(selectorBytes('syncCompanySocialGroup()')),

  isCompanySocialMember: (accountAddr) =>
    encodeAbi('isCompanySocialMember(address)', [['address', accountAddr]]),

  createCompanySubgroup: ({ subgroupSlug, label, initialMembers = [] }) => {
    const slugHex = subgroupSlugBytes32(subgroupSlug || label);
    const packed = concatBytes(
      ...initialMembers
        .filter((a) => /^0x[0-9a-f]{40}$/i.test(String(a || '')))
        .map((a) => hexToBytes(a).slice(-20))
    );
    return encodeAbi('createCompanySubgroup(bytes32,string,bytes)', [
      ['bytes32', slugHex],
      ['string', String(label || '').slice(0, 64)],
      ['bytes', packed],
    ]);
  },

  addSubgroupMember: (subgroupSlug, memberIdentity) =>
    encodeAbi('addSubgroupMember(bytes32,address)', [
      ['bytes32', subgroupSlugBytes32(subgroupSlug)],
      ['address', memberIdentity],
    ]),

  removeSubgroupMember: (subgroupSlug, memberIdentity) =>
    encodeAbi('removeSubgroupMember(bytes32,address)', [
      ['bytes32', subgroupSlugBytes32(subgroupSlug)],
      ['address', memberIdentity],
    ]),

  isSubgroupMember: (subgroupSlug, accountAddr) =>
    encodeAbi('isSubgroupMember(bytes32,address)', [
      ['bytes32', subgroupSlugBytes32(subgroupSlug)],
      ['address', accountAddr],
    ]),

  isSubgroupAuthorizedActor: (subgroupSlug, actorOrEoa) =>
    encodeAbi('isSubgroupAuthorizedActor(bytes32,address)', [
      ['bytes32', subgroupSlugBytes32(subgroupSlug)],
      ['address', actorOrEoa],
    ]),

  postCompanyGroupMessage: (subgroupSlug, messageTextOrBytes) =>
    encodeAbi('postCompanyGroupMessage(bytes32,bytes)', [
      [
        'bytes32',
        !subgroupSlug || subgroupSlug === ZERO_BYTES32
          ? ZERO_BYTES32
          : subgroupSlugBytes32(subgroupSlug),
      ],
      [
        'bytes',
        messageTextOrBytes instanceof Uint8Array
          ? messageTextOrBytes
          : utf8ToBytes(String(messageTextOrBytes || '')),
      ],
    ]),

  getCompanySocialOverview: (viewerIdentity = ZERO_ADDR) =>
    encodeAbi('getCompanySocialOverview(address)', [['address', viewerIdentity || ZERO_ADDR]]),
};

export function decodeEntityProfileHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 81) return null;
  const isSovereign = b[0] === 1;
  const nLen = readU16BE(b, 1);
  const jLen = readU16BE(b, 3);
  const rLen = readU16BE(b, 5);
  const messagingHps = bytesToHex(b.subarray(7, 27)).toLowerCase();
  const hfsRegistry = bytesToHex(b.subarray(27, 47)).toLowerCase();
  const allMembersChannelHash = bytesToHex(b.subarray(47, 79)).toLowerCase();
  const subgroupCount = readU16BE(b, 79);
  let pos = 81;
  if (pos + nLen + jLen + rLen > b.length) return null;
  const legalName = bytesToUtf8(b.subarray(pos, pos + nLen));
  pos += nLen;
  const jurisdiction = bytesToUtf8(b.subarray(pos, pos + jLen));
  pos += jLen;
  const registrationId = bytesToUtf8(b.subarray(pos, pos + rLen));
  return {
    isSovereign,
    legalName,
    jurisdiction,
    registrationId,
    messagingHps,
    hfsRegistry,
    allMembersChannelHash,
    subgroupCount,
  };
}

export function decodeCompanySocialOverviewHex(hex) {
  const b = hexToBytes(hex);
  if (b.length < 65) return null;
  const isSovereign = b[0] === 1;
  const viewerInAllMembers = b[1] === 1;
  const viewerIsActiveDirector = b[2] === 1;
  const charterState = b[3];
  const nLen = readU16BE(b, 4);
  const jLen = readU16BE(b, 6);
  const rLen = readU16BE(b, 8);
  const messagingHps = bytesToHex(b.subarray(10, 30)).toLowerCase();
  const allMembersChannelHash = bytesToHex(b.subarray(30, 62)).toLowerCase();
  const allMembersCount = readU16BE(b, 62);
  const subgroupCount = b[64];

  let pos = 65;
  if (pos + nLen + jLen + rLen + allMembersCount * 20 > b.length) return null;
  const legalName = bytesToUtf8(b.subarray(pos, pos + nLen));
  pos += nLen;
  const jurisdiction = bytesToUtf8(b.subarray(pos, pos + jLen));
  pos += jLen;
  const registrationId = bytesToUtf8(b.subarray(pos, pos + rLen));
  pos += rLen;

  const allMembers = [];
  for (let i = 0; i < allMembersCount; i++) {
    allMembers.push(bytesToHex(b.subarray(pos, pos + 20)).toLowerCase());
    pos += 20;
  }

  const subgroups = [];
  for (let s = 0; s < subgroupCount; s++) {
    if (pos + 98 > b.length) break;
    const slug = bytesToHex(b.subarray(pos, pos + 32)).toLowerCase();
    const channelHash = bytesToHex(b.subarray(pos + 32, pos + 64)).toLowerCase();
    const creatorDirector = bytesToHex(b.subarray(pos + 64, pos + 84)).toLowerCase();
    const createdBlock = Number(readU64BE(b, pos + 84));
    const active = b[pos + 92] === 1;
    const viewerIsMember = b[pos + 93] === 1;
    const lblLen = readU16BE(b, pos + 94);
    const memCnt = readU16BE(b, pos + 96);
    pos += 98;
    if (pos + lblLen + memCnt * 20 > b.length) break;
    const label = bytesToUtf8(b.subarray(pos, pos + lblLen));
    pos += lblLen;
    const members = [];
    for (let m = 0; m < memCnt; m++) {
      members.push(bytesToHex(b.subarray(pos, pos + 20)).toLowerCase());
      pos += 20;
    }
    subgroups.push({
      slug,
      channelHash,
      creatorDirector,
      createdBlock,
      active,
      viewerIsMember,
      label,
      members,
    });
  }

  return {
    isSovereign,
    viewerInAllMembers,
    viewerIsActiveDirector,
    charterState,
    legalName,
    jurisdiction,
    registrationId,
    messagingHps,
    allMembersChannelHash,
    allMembers,
    subgroups,
  };
}

// ---------------------------------------------------------------------------
// 3. Sovereign `Superlexicon Pte. Ltd.` & Developer Standing Resolver
// ---------------------------------------------------------------------------

export async function resolveSovereignSuperlexiconCharter(rpcUrl = getDefaultNodeWsUrl()) {
  try {
    const { manifest } = await SlxHfsCache.hydrateWithManifest();
    const explicitSov =
      manifest?.sovereignSuperlexicon?.corporateCharter ||
      manifest?.superlexiconCharter?.corporateCharter ||
      manifest?.sovereignCharter ||
      '';
    if (explicitSov && /^0x[0-9a-f]{40}$/i.test(explicitSov) && explicitSov !== ZERO_ADDR) {
      return explicitSov.toLowerCase();
    }
    const hfsReg = manifest?.institutional?.hfsRegistry || manifest?.hfsRegistry;
    if (hfsReg && hfsReg !== ZERO_ADDR) {
      const sovHex = await slxNodeRpc(rpcUrl, 'eth_call', [
        { to: hfsReg, data: bytesToHex(selectorBytes('sovereignCharter()')) },
        'latest',
      ]);
      const addr = decodeAddrWord(sovHex);
      if (addr && addr !== ZERO_ADDR) return addr.toLowerCase();
    }
  } catch (_) {}
  return '';
}

export async function checkSuperlexiconDeveloperStanding({
  rpcUrl = getDefaultNodeWsUrl(),
  identityAddr = '',
  eoaAddr = '',
  storeAddr = '',
} = {}) {
  const isDirectRf = !isPublicWebsiteRpcUrl(rpcUrl);
  const sovCharter = await resolveSovereignSuperlexiconCharter(rpcUrl);
  const candidates = [identityAddr, eoaAddr].filter(
    (a) => a && /^0x[0-9a-f]{40}$/i.test(a) && a.toLowerCase() !== ZERO_ADDR
  );

  // 1. Check AppStore.canPublish(actor) if AppStore is deployed and gated
  if (storeAddr && storeAddr !== ZERO_ADDR && candidates.length > 0) {
    try {
      const gateHex = await slxNodeRpc(rpcUrl, 'eth_call', [
        { to: storeAddr, data: bytesToHex(selectorBytes('authorizedPublisherGroup()')) },
        'latest',
      ]);
      const gateCharter = decodeAddrWord(gateHex);
      if (gateCharter && gateCharter !== ZERO_ADDR) {
        for (const cand of candidates) {
          const okHex = await slxNodeRpc(rpcUrl, 'eth_call', [
            { to: storeAddr, data: encodeAbi('canPublish(address)', [['address', cand]]) },
            'latest',
          ]);
          if (decodeUintWord(okHex) === 1) {
            return {
              authorized: true,
              inDevelopersGroup: true,
              isDirectRf,
              sovereignCharter: gateCharter.toLowerCase(),
              subgroupSlug: SUBGROUP_DEVELOPERS_SLUG,
              reason: 'Authorized member of Superlexicon · Developers',
            };
          }
        }
        return {
          authorized: false,
          inDevelopersGroup: false,
          isDirectRf,
          sovereignCharter: gateCharter.toLowerCase(),
          subgroupSlug: SUBGROUP_DEVELOPERS_SLUG,
          reason:
            'Publishing apps & deploying HFS over Web RPC requires membership in the Superlexicon · Developers social group (governed by Superlexicon Pte. Ltd. CorporateCharter).',
        };
      }
    } catch (_) {}
  }

  // 2. Check sovereign Superlexicon CorporateCharter directly
  if (sovCharter && candidates.length > 0) {
    try {
      for (const cand of candidates) {
        const okHex = await slxNodeRpc(rpcUrl, 'eth_call', [
          {
            to: sovCharter,
            data: CharterSocialAbi.isSubgroupAuthorizedActor(SUBGROUP_DEVELOPERS_SLUG, cand),
          },
          'latest',
        ]);
        if (decodeUintWord(okHex) === 1) {
          return {
            authorized: true,
            inDevelopersGroup: true,
            isDirectRf,
            sovereignCharter: sovCharter,
            subgroupSlug: SUBGROUP_DEVELOPERS_SLUG,
            reason: 'Authorized member of Superlexicon · Developers',
          };
        }
      }
    } catch (_) {}
  }

  // 3. If connected via direct local LR2021 RF node (non-website gateway), subnet deploy is open;
  //    on public website RPC, fail closed until user joins Superlexicon · Developers!
  return {
    authorized: isDirectRf && !sovCharter,
    inDevelopersGroup: false,
    isDirectRf,
    sovereignCharter: sovCharter || '',
    subgroupSlug: SUBGROUP_DEVELOPERS_SLUG,
    reason: isDirectRf
      ? 'Connected directly to local RF/dev node'
      : 'Web RPC publishing & non-Identity HFS deployment are restricted to members of the Superlexicon · Developers social group (linked to Superlexicon Pte. Ltd. CorporateCharter).',
  };
}
