import { GARMIN_INSIGHT_ATTRIBUTION, GARMIN_TRADEMARK_NOTICE } from '@loam/shared';
import { buildMaintenanceCsv, csvField, formatMinor, MAINTENANCE_CSV_COLUMNS } from './maintenance-export';

const d = (iso: string) => new Date(iso);
const NOW = d('2026-10-30T00:00:00Z');

describe('csvField', () => {
  it('leaves plain text alone and quotes commas, quotes and line breaks', () => {
    expect(csvField('Fox 36')).toBe('Fox 36');
    expect(csvField('seal kit, 20wt oil')).toBe('"seal kit, 20wt oil"');
    expect(csvField('the "good" pads')).toBe('"the ""good"" pads"');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField(null)).toBe('');
  });

  it('defuses spreadsheet formulas in rider text', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-5 psi lower')).toBe("'-5 psi lower");
    expect(csvField('@SUM(1)')).toBe("'@SUM(1)");
    expect(csvField('\tcmd')).toBe("'\tcmd");
    expect(csvField('\rcmd')).toBe(`"'\rcmd"`);
  });
});

describe('formatMinor', () => {
  it('writes major units with the currency decimals', () => {
    expect(formatMinor(8500, 'USD')).toBe('85.00');
    expect(formatMinor(1200, 'JPY')).toBe('1200');
    expect(formatMinor(null, 'USD')).toBe('');
  });
});

describe('buildMaintenanceCsv', () => {
  function db(opts: { garmin?: boolean } = {}) {
    const installs = [
      { bikeId: 'bike-1', componentId: 'chain-old', installedAt: d('2025-01-01T00:00:00Z'), removedAt: d('2026-01-01T00:00:00Z') },
      { bikeId: 'bike-1', componentId: 'chain-new', installedAt: d('2026-01-01T00:00:00Z'), removedAt: null },
    ];
    const components = [
      { id: 'chain-old', userId: 'u1', bikeId: null, type: 'CHAIN', location: 'NONE', brand: 'Shimano', model: 'XT', installedAt: d('2025-01-01T00:00:00Z'), createdAt: d('2025-01-01T00:00:00Z'), retiredAt: d('2026-01-01T00:00:00Z'), hoursUsed: 0 },
      { id: 'chain-new', userId: 'u1', bikeId: 'bike-1', type: 'CHAIN', location: 'NONE', brand: 'SRAM', model: 'GX Eagle', installedAt: d('2026-01-01T00:00:00Z'), createdAt: d('2026-01-01T00:00:00Z'), retiredAt: null, hoursUsed: 0 },
    ];
    return {
      bike: { findMany: jest.fn(async () => [{ id: 'bike-1', nickname: 'Trail bike', manufacturer: 'Santa Cruz', model: 'Hightower', year: 2024 }]) },
      component: {
        findMany: jest.fn(async ({ where }: { where: { OR?: unknown } }) =>
          where.OR ? components : components.map(({ id, type, location, brand, model }) => ({ id, type, location, brand, model }))
        ),
      },
      bikeComponentInstall: {
        findMany: jest.fn(async ({ select }: { select: Record<string, boolean> }) =>
          select.id ? installs.map((i, n) => ({ ...i, id: `i${n}`, slotKey: 'CHAIN_NONE' })) : installs
        ),
      },
      serviceLog: {
        findMany: jest.fn(async () => [
          {
            componentId: 'chain-old',
            performedAt: d('2025-06-15T12:00:00Z'),
            kind: 'SERVICE',
            hoursAtService: 42.25,
            costMinor: 1500,
            currency: 'USD',
            notes: 'Waxed, "hot melt"',
            parts: [
              { brand: 'Silca', model: 'Secret Chain Wax', priceMinor: 1500, vendor: 'Local shop' },
              { brand: '', model: 'Quick link', priceMinor: null, vendor: null },
            ],
          },
          {
            // After the old chain came off: no bike.
            componentId: 'chain-old',
            performedAt: d('2026-02-01T12:00:00Z'),
            kind: 'INSPECTION',
            hoursAtService: 60,
            costMinor: null,
            currency: null,
            notes: null,
            parts: [],
          },
        ]),
      },
      ride: { findFirst: jest.fn(async () => (opts.garmin ? { id: 'r1' } : null)) },
    } as unknown as Parameters<typeof buildMaintenanceCsv>[0];
  }

  it('writes one row per event with parts, cost and the bike the part was on', async () => {
    const { csv, rowCount, bikeCount, attributed } = await buildMaintenanceCsv(db(), 'u1', NOW);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(MAINTENANCE_CSV_COLUMNS.join(','));
    expect(rowCount).toBe(5);
    expect(bikeCount).toBe(1);
    expect(attributed).toBe(false);

    // Chronological: install, service, removal, install, inspection.
    expect(lines[1]).toBe('2025-01-01,Trail bike,Chain,,Shimano,XT,installed,,,,,,');
    expect(lines[2]).toBe(
      '2025-06-15,Trail bike,Chain,,Shimano,XT,service,42.3,15.00,USD,Silca Secret Chain Wax (15.00); Quick link,Local shop,"Waxed, ""hot melt"""'
    );
    expect(lines[3]).toBe('2026-01-01,Trail bike,Chain,,Shimano,XT,removed,,,,,,');
    expect(lines[4]).toBe('2026-01-01,Trail bike,Chain,,SRAM,GX Eagle,installed,,,,,,');
    // The inspection happened after the part left the bike, so it has none.
    expect(lines[5]).toBe('2026-02-01,,Chain,,Shimano,XT,inspection,60.0,,,,,');
    expect(csv).not.toContain(GARMIN_TRADEMARK_NOTICE);
  });

  it('carries the Garmin attribution when any ride came from Garmin', async () => {
    const { csv, attributed } = await buildMaintenanceCsv(db({ garmin: true }), 'u1', NOW);
    expect(attributed).toBe(true);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[lines.length - 2]).toBe(csvField(GARMIN_INSIGHT_ATTRIBUTION));
    expect(lines[lines.length - 1]).toBe(csvField(GARMIN_TRADEMARK_NOTICE));
    // No blank record between the events and the attribution.
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });
});
