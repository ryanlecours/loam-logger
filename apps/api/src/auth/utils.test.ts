import { canonicalizeEmail } from './utils';

describe('canonicalizeEmail', () => {
  it('drops dots and +tags in Gmail addresses', () => {
    expect(canonicalizeEmail('John.Smith+loam@gmail.com')).toBe('johnsmith@gmail.com');
    expect(canonicalizeEmail('j.o.h.n.smith@gmail.com')).toBe('johnsmith@gmail.com');
  });

  it('treats googlemail.com as gmail.com', () => {
    expect(canonicalizeEmail('john.smith@googlemail.com')).toBe('johnsmith@gmail.com');
  });

  it('drops +tags on other domains but keeps their dots', () => {
    expect(canonicalizeEmail('first.last+news@example.com')).toBe('first.last@example.com');
    expect(canonicalizeEmail('first.last@outlook.com')).toBe('first.last@outlook.com');
  });

  it('trims and lowercases', () => {
    expect(canonicalizeEmail('  Rider@Example.COM ')).toBe('rider@example.com');
  });

  it('keeps a + in the first position, which has no base address to fold to', () => {
    expect(canonicalizeEmail('+tag@example.com')).toBe('+tag@example.com');
    expect(canonicalizeEmail('+x.y@gmail.com')).toBe('+xy@gmail.com');
  });

  it('keeps the plain address when folding would leave the local part empty', () => {
    expect(canonicalizeEmail('...@gmail.com')).toBe('...@gmail.com');
  });

  it('returns a string with no @ unchanged apart from case', () => {
    expect(canonicalizeEmail('Not-An-Email')).toBe('not-an-email');
  });
});
