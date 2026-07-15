import { formatComponentType } from './formatComponentType';

describe('formatComponentType', () => {
  describe('default (title case)', () => {
    it('formats a simple type', () => {
      expect(formatComponentType('BRAKE_PAD')).toBe('Brake Pad');
    });

    it('formats a single-word type', () => {
      expect(formatComponentType('CHAIN')).toBe('Chain');
    });

    it('prefixes FRONT location', () => {
      expect(formatComponentType('BRAKE_PAD', 'FRONT')).toBe('Front Brake Pad');
    });

    it('prefixes REAR location', () => {
      expect(formatComponentType('BRAKE_ROTOR', 'REAR')).toBe('Rear Brake Rotor');
    });

    it('drops NONE location', () => {
      expect(formatComponentType('CHAIN', 'NONE')).toBe('Chain');
    });

    it('drops null location', () => {
      expect(formatComponentType('CHAIN', null)).toBe('Chain');
    });

    it('drops undefined location', () => {
      expect(formatComponentType('CHAIN', undefined)).toBe('Chain');
    });

    it('handles the ambiguous brake family distinctly', () => {
      // The whole point of PR 1 — Advisor eval relies on these being distinct.
      expect(formatComponentType('BRAKES', 'FRONT')).toBe('Front Brakes');
      expect(formatComponentType('BRAKE_PAD', 'FRONT')).toBe('Front Brake Pad');
      expect(formatComponentType('BRAKE_ROTOR', 'FRONT')).toBe('Front Brake Rotor');
    });
  });

  describe('lower case override', () => {
    it('lowercases the whole label', () => {
      expect(formatComponentType('BRAKE_PAD', null, { case: 'lower' })).toBe('brake pad');
    });

    it('lowercases with location', () => {
      expect(formatComponentType('BRAKE_PAD', 'FRONT', { case: 'lower' })).toBe('front brake pad');
    });
  });

  describe('upper case override', () => {
    it('uppercases the whole label', () => {
      expect(formatComponentType('BRAKE_PAD', null, { case: 'upper' })).toBe('BRAKE PAD');
    });

    it('uppercases with location', () => {
      expect(formatComponentType('BRAKE_PAD', 'FRONT', { case: 'upper' })).toBe('FRONT BRAKE PAD');
    });
  });
});
