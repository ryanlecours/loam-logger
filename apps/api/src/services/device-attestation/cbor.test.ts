import { CborDecodeError, decodeCbor } from './cbor';

const hex = (s: string) => Buffer.from(s.replace(/\s/g, ''), 'hex');

describe('decodeCbor', () => {
  it('decodes the types an attestation object uses (RFC 8949 Appendix A vectors)', () => {
    expect(decodeCbor(hex('00'))).toBe(0);
    expect(decodeCbor(hex('1903e8'))).toBe(1000);
    expect(decodeCbor(hex('20'))).toBe(-1);
    expect(decodeCbor(hex('6449455446'))).toBe('IETF');
    expect(decodeCbor(hex('4401020304'))).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(decodeCbor(hex('83 01 82 02 03 82 04 05'))).toEqual([1, [2, 3], [4, 5]]);
    expect(decodeCbor(hex('a2 6161 01 6162 82 02 03'))).toEqual({ a: 1, b: [2, 3] });
    expect(decodeCbor(hex('f4'))).toBe(false);
    expect(decodeCbor(hex('f5'))).toBe(true);
    expect(decodeCbor(hex('f6'))).toBeNull();
  });

  it('keeps a __proto__ key as plain data instead of touching a prototype', () => {
    const decoded = decodeCbor(hex('a1 69 5f5f70726f746f5f5f a1 6870 6f6c6c75746564 f5')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(Object.keys(decoded)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((decoded as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it.each([
    ['truncated input', '4401'],
    ['trailing bytes', '0000'],
    ['an indefinite-length string', '5f42010243030405ff'],
    ['a tag', 'c11a514b67b0'],
    ['a float', 'f93c00'],
    ['a non-text map key', 'a10102'],
    ['nesting past the limit', '81'.repeat(20) + '00'],
  ])('rejects %s', (_label, input) => {
    expect(() => decodeCbor(hex(input))).toThrow(CborDecodeError);
  });
});
