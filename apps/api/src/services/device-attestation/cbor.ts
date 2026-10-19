/**
 * Minimal CBOR (RFC 8949) decoder for Apple App Attest attestation objects.
 *
 * An attestation object is a map of text keys to text, byte strings, arrays
 * and nested maps, so only those major types are supported. Anything else
 * (tags, floats, indefinite lengths) throws, which the caller reports as a
 * malformed attestation. Byte strings decode to Buffers.
 */

export type CborValue = number | string | Buffer | boolean | null | CborValue[] | { [key: string]: CborValue };

const MAX_DEPTH = 8;

export class CborDecodeError extends Error {}

export function decodeCbor(input: Buffer): CborValue {
  const { value, offset } = decodeItem(input, 0, 0);
  if (offset !== input.length) {
    throw new CborDecodeError('Trailing bytes after CBOR item');
  }
  return value;
}

function need(buf: Buffer, offset: number, count: number): Buffer {
  if (offset + count > buf.length) throw new CborDecodeError('Truncated CBOR input');
  return buf;
}

function readLength(buf: Buffer, offset: number, info: number): { length: number; offset: number } {
  if (info < 24) return { length: info, offset };
  if (info === 24) return { length: need(buf, offset, 1).readUInt8(offset), offset: offset + 1 };
  if (info === 25) return { length: need(buf, offset, 2).readUInt16BE(offset), offset: offset + 2 };
  if (info === 26) return { length: need(buf, offset, 4).readUInt32BE(offset), offset: offset + 4 };
  // 8-byte and indefinite lengths never appear in an attestation object.
  throw new CborDecodeError(`Unsupported CBOR length encoding ${info}`);
}

function decodeItem(buf: Buffer, start: number, depth: number): { value: CborValue; offset: number } {
  if (depth > MAX_DEPTH) throw new CborDecodeError('CBOR nesting too deep');
  const initial = need(buf, start, 1).readUInt8(start);
  const major = initial >> 5;
  const info = initial & 0x1f;

  if (major === 7) {
    if (info === 20) return { value: false, offset: start + 1 };
    if (info === 21) return { value: true, offset: start + 1 };
    if (info === 22) return { value: null, offset: start + 1 };
    throw new CborDecodeError(`Unsupported CBOR simple value ${info}`);
  }

  const { length, offset } = readLength(buf, start + 1, info);

  switch (major) {
    case 0:
      return { value: length, offset };
    case 1:
      return { value: -1 - length, offset };
    case 2:
      need(buf, offset, length);
      return { value: Buffer.from(buf.subarray(offset, offset + length)), offset: offset + length };
    case 3:
      need(buf, offset, length);
      return { value: buf.toString('utf8', offset, offset + length), offset: offset + length };
    case 4: {
      const items: CborValue[] = [];
      let next = offset;
      for (let i = 0; i < length; i++) {
        const item = decodeItem(buf, next, depth + 1);
        items.push(item.value);
        next = item.offset;
      }
      return { value: items, offset: next };
    }
    case 5: {
      const map: { [key: string]: CborValue } = {};
      let next = offset;
      for (let i = 0; i < length; i++) {
        const key = decodeItem(buf, next, depth + 1);
        if (typeof key.value !== 'string') throw new CborDecodeError('Non-text CBOR map key');
        const value = decodeItem(buf, key.offset, depth + 1);
        map[key.value] = value.value;
        next = value.offset;
      }
      return { value: map, offset: next };
    }
    default:
      throw new CborDecodeError(`Unsupported CBOR major type ${major}`);
  }
}
