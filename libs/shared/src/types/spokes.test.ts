import { formatSpokesBikeLabel, canCreateBikeFrom } from './spokes';

describe('formatSpokesBikeLabel', () => {
  it('leads with the model year', () => {
    expect(
      formatSpokesBikeLabel({ year: 2026, maker: 'Evil', model: 'Offering X0' }),
    ).toBe('2026 Evil Offering X0');
  });

  // `${null} Evil Offering X0` is "null Evil Offering X0". That string reached
  // the search box, an aria-label, and a form field that then treated it as a
  // valid year, because a non-empty string is truthy.
  it('drops a missing year instead of printing the word null', () => {
    expect(
      formatSpokesBikeLabel({ year: null, maker: 'Evil', model: 'Offering X0' }),
    ).toBe('Evil Offering X0');
  });
});

describe('canCreateBikeFrom', () => {
  it('accepts a listing with a year', () => {
    expect(canCreateBikeFrom({ year: 2026 })).toBe(true);
  });

  // AddBikeInput.year is a required Int!, so this cannot become a bike.
  it('rejects a listing with none', () => {
    expect(canCreateBikeFrom({ year: null })).toBe(false);
  });
});
