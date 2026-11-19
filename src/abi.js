/**
 * @superlexicon/sdk/abi
 *
 * Compact, zero-dependency Solidity/HFS ABI encoders, big-endian binary readers,
 * and address/display formatters shared across SuperLexicon WASM smart contracts.
 */

import {
  hexToBytes,
  bytesToHex,
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  selectorBytes,
} from './crypto.js';

export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x' + '00'.repeat(32);

export function shortHex(hex, lead = 6, tail = 4) {
  const s = String(hex || '');
  if (s.length <= lead + tail + 2) return s;
  return `${s.slice(0, lead)}…${s.slice(-tail)}`;
}

export function shortAddr(addr) {
  if (!addr) return '—';
  const s = String(addr);
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

export function truncAddr4(addrHex) {
  const clean = String(addrHex || '').replace(/^0x/i, '').toLowerCase();
  return clean.slice(0, 4) || '0000';
}

export function u16BEBytes(n) {
  const v = Number(n) & 0xffff;
  return new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
}

export function u64BEBytes(n) {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

export function readU16BE(b, off = 0) {
  return (b[off] << 8) | b[off + 1];
}

export function readU32BE(b, off = 0) {
  return (
    ((b[off] << 24) >>> 0) +
    ((b[off + 1] << 16) >>> 0) +
    ((b[off + 2] << 8) >>> 0) +
    b[off + 3]
  );
}

export function readU64BE(b, off = 0) {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(b[off + i]);
  }
  return Number(v);
}

export function wordU64(n) {
  const b = new Uint8Array(32);
  let v = BigInt(n);
  for (let i = 31; i >= 0 && v > 0n; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

export function wordAddress(addrHex) {
  const b = new Uint8Array(32);
  if (addrHex && addrHex !== '0x') {
    b.set(hexToBytes(addrHex).slice(-20), 12);
  }
  return b;
}

export function wordBytes32(hex32) {
  const b = new Uint8Array(32);
  if (hex32 && hex32 !== '0x') {
    b.set(hexToBytes(hex32).slice(0, 32), 0);
  }
  return b;
}

/**
 * Encode an HFS / Solidity function call (`sig` + `[type, value][]` tuples) into `0x`-prefixed calldata.
 * Supported types: `uint8`, `uint16`, `uint32`, `uint64`, `uint256`, `bool`, `address`, `bytes32`, `bytes`, `string`.
 */
export function encodeAbi(sig, typedArgs = []) {
  const sel = selectorBytes(sig);
  const headLen = typedArgs.length * 32;
  const heads = [];
  const tails = [];
  let curTailLen = 0;

  for (const [ty, val] of typedArgs) {
    if (ty === 'uint8' || ty === 'uint16' || ty === 'uint32' || ty === 'uint64' || ty === 'uint256') {
      heads.push(wordU64(val));
    } else if (ty === 'bool') {
      heads.push(wordU64(val ? 1 : 0));
    } else if (ty === 'address') {
      heads.push(wordAddress(val));
    } else if (ty === 'bytes32') {
      heads.push(wordBytes32(val));
    } else if (ty === 'bytes' || ty === 'string') {
      const raw = typeof val === 'string' ? utf8ToBytes(val) : val;
      heads.push(wordU64(headLen + curTailLen));
      const pad = (32 - (raw.length % 32)) % 32;
      const chunk = concatBytes(wordU64(raw.length), raw, new Uint8Array(pad));
      tails.push(chunk);
      curTailLen += chunk.length;
    } else {
      throw new Error(`Unsupported ABI type: ${ty}`);
    }
  }
  return bytesToHex(concatBytes(sel, ...heads, ...tails), true);
}

export function decodeUintWord(hex, wordIdx = 0) {
  if (!hex || hex === '0x') return 0;
  const b = hexToBytes(hex);
  const base = wordIdx * 32;
  if (b.length >= base + 32) return readU64BE(b, base + 24);
  if (b.length >= base + 8) return readU64BE(b, b.length - 8);
  return 0;
}

export function decodeAddrWord(hex, wordIdx = 0) {
  if (!hex || hex === '0x') return ZERO_ADDR;
  const b = hexToBytes(hex);
  const base = wordIdx * 32;
  if (b.length < base + 32) return ZERO_ADDR;
  return bytesToHex(b.slice(base + 12, base + 32), true).toLowerCase();
}

export function decodeAbiStringHex(hex) {
  if (!hex || hex === '0x') return '';
  const b = hexToBytes(hex);
  if (b.length < 64) return '';
  const offset = readU64BE(b, 24);
  if (offset + 32 > b.length) return '';
  const strLen = readU64BE(b, offset + 24);
  if (strLen === 0 || offset + 32 + strLen > b.length) return '';
  return bytesToUtf8(b.slice(offset + 32, offset + 32 + strLen));
}

export function encodeBytes32Label(str) {
  const b = new Uint8Array(32);
  b.set(utf8ToBytes(String(str || '').trim()).slice(0, 32), 0);
  return bytesToHex(b, true);
}

export function decodeBytes32LabelHex(hex32) {
  if (!hex32 || hex32 === '0x') return '';
  const b = hexToBytes(hex32);
  let end = 0;
  while (end < b.length && b[end] !== 0) end++;
  return bytesToUtf8(b.slice(0, end));
}
