jest.mock('../prisma', () => ({
  prisma: {
    liftGeometryImport: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    liftGeometryLine: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  AERIALWAY_DATASET_FORMAT,
  getActiveLiftGeometryImport,
  lineBounds,
  loadLiftGeometryDataset,
  queryLocalLiftLines,
  validateAerialwayDataset,
  type AerialwayDataset,
} from './local-geometry';
import { prisma } from '../prisma';

const mockImportFindFirst = prisma.liftGeometryImport.findFirst as jest.Mock;
const mockImportDeleteMany = prisma.liftGeometryImport.deleteMany as jest.Mock;
const mockImportCreate = prisma.liftGeometryImport.create as jest.Mock;
const mockImportUpdateMany = prisma.liftGeometryImport.updateMany as jest.Mock;
const mockImportUpdate = prisma.liftGeometryImport.update as jest.Mock;
const mockLineFindMany = prisma.liftGeometryLine.findMany as jest.Mock;
const mockLineCreateMany = prisma.liftGeometryLine.createMany as jest.Mock;
const mockLineDeleteMany = prisma.liftGeometryLine.deleteMany as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

const LINE = {
  id: '99',
  name: 'Summit Express',
  kind: 'chair_lift',
  coordinates: [
    { lat: 45.52, lng: -122.02 },
    { lat: 45.51, lng: -122.01 },
  ],
};

const ACTIVE = {
  id: 'import-old',
  source: 'overpass:https://overpass-api.de/api/interpreter',
  osmBaseAt: new Date('2026-04-01T00:00:00Z'),
  lineCount: 20000,
  activatedAt: new Date('2026-04-02T00:00:00Z'),
};

const dataset = (lines: AerialwayDataset['lines']): AerialwayDataset => ({
  format: AERIALWAY_DATASET_FORMAT,
  source: 'overpass:https://overpass-api.de/api/interpreter',
  osmBaseAt: '2026-10-24T08:00:00Z',
  generatedAt: '2026-10-24T09:00:00Z',
  license: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors',
  lines,
});

const manyLines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...LINE, id: String(i + 1) }));

beforeEach(() => {
  jest.resetAllMocks();
});

describe('validateAerialwayDataset', () => {
  it('accepts a well-formed snapshot', () => {
    const d = validateAerialwayDataset(JSON.parse(JSON.stringify(dataset([LINE]))));
    expect(d.lines).toEqual([LINE]);
    expect(d.osmBaseAt).toBe('2026-10-24T08:00:00Z');
  });

  it.each([
    ['a non-object', null, 'not a JSON object'],
    ['another format', { ...dataset([LINE]), format: 'other/1' }, 'format must be'],
    ['no lines', dataset([]), 'no lines'],
    ['a duplicate id', dataset([LINE, LINE]), 'appears twice'],
    ['a one-point line', dataset([{ ...LINE, coordinates: [LINE.coordinates[0]] }]), 'fewer than two'],
    [
      'an out-of-range coordinate',
      dataset([{ ...LINE, coordinates: [{ lat: 95, lng: 0 }, LINE.coordinates[1]] }]),
      'invalid coordinate',
    ],
    [
      'a non-numeric coordinate',
      dataset([{ ...LINE, coordinates: [{ lat: '45', lng: 0 }, LINE.coordinates[1]] } as never]),
      'invalid coordinate',
    ],
    ['an unparseable osmBaseAt', { ...dataset([LINE]), osmBaseAt: 'yesterday' }, 'not a date'],
  ])('refuses %s', (_label, value, message) => {
    expect(() => validateAerialwayDataset(value)).toThrow(message);
  });
});

describe('lineBounds', () => {
  it('spans every vertex', () => {
    expect(lineBounds(LINE)).toEqual({ south: 45.51, north: 45.52, west: -122.02, east: -122.01 });
  });
});

describe('getActiveLiftGeometryImport', () => {
  it('returns null rather than throwing when the read fails', async () => {
    mockImportFindFirst.mockRejectedValueOnce(new Error('relation does not exist'));
    await expect(getActiveLiftGeometryImport()).resolves.toBeNull();
  });
});

describe('queryLocalLiftLines', () => {
  const bbox = { south: 45.5, west: -122.05, north: 45.55, east: -122.0 };

  it('returns null when no import is active, so the caller uses Overpass', async () => {
    mockImportFindFirst.mockResolvedValueOnce(null);

    await expect(queryLocalLiftLines(bbox)).resolves.toBeNull();
    expect(mockLineFindMany).not.toHaveBeenCalled();
  });

  it('queries active-import lines overlapping the bbox and maps them to LiftLines', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);
    mockLineFindMany.mockResolvedValueOnce([
      { osmId: '99', name: 'Summit Express', kind: 'chair_lift', coordinates: LINE.coordinates },
      { osmId: '100', name: null, kind: 'gondola', coordinates: LINE.coordinates },
    ]);

    const lines = await queryLocalLiftLines(bbox);

    expect(lines).toEqual([LINE, { id: '100', kind: 'gondola', coordinates: LINE.coordinates }]);
    expect(mockLineFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          import: { status: 'ACTIVE' },
          minLat: { lte: 45.55 },
          maxLat: { gte: 45.5 },
          minLng: { lte: -122.0 },
          maxLng: { gte: -122.05 },
        },
      })
    );
  });

  it('returns an empty array (not null) for an area with no lifts', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);
    mockLineFindMany.mockResolvedValueOnce([]);

    await expect(queryLocalLiftLines(bbox)).resolves.toEqual([]);
  });

  it('returns null rather than throwing when the line query fails', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);
    mockLineFindMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(queryLocalLiftLines(bbox)).resolves.toBeNull();
  });
});

describe('loadLiftGeometryDataset', () => {
  beforeEach(() => {
    mockImportDeleteMany.mockResolvedValue({ count: 0 });
    mockImportCreate.mockResolvedValue({ id: 'import-new' });
    mockLineCreateMany.mockResolvedValue({ count: 0 });
    mockLineDeleteMany.mockResolvedValue({ count: 0 });
    mockImportUpdateMany.mockReturnValue('supersede-op');
    mockImportUpdate.mockReturnValue('activate-op');
    mockTransaction.mockResolvedValue([]);
  });

  it('loads under a LOADING import, then supersedes the old one and activates in one transaction', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);
    mockImportDeleteMany.mockResolvedValueOnce({ count: 1 });
    const lines = manyLines(20200);

    const result = await loadLiftGeometryDataset(dataset(lines));

    expect(result).toEqual({ importId: 'import-new', lineCount: 20200, previous: ACTIVE });
    // An abandoned earlier load is cleared before anything is written.
    expect(mockImportDeleteMany).toHaveBeenCalledWith({ where: { status: 'LOADING' } });
    expect(mockImportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          source: 'overpass:https://overpass-api.de/api/interpreter',
          osmBaseAt: new Date('2026-10-24T08:00:00Z'),
          lineCount: 20200,
        },
      })
    );

    // Batched inserts carrying each line's bounding box.
    expect(mockLineCreateMany).toHaveBeenCalledTimes(41);
    expect(mockLineCreateMany.mock.calls[0][0].data[0]).toEqual({
      importId: 'import-new',
      osmId: '1',
      name: 'Summit Express',
      kind: 'chair_lift',
      coordinates: LINE.coordinates,
      minLat: 45.51,
      maxLat: 45.52,
      minLng: -122.02,
      maxLng: -122.01,
    });
    const inserted = mockLineCreateMany.mock.calls.reduce((n, [arg]) => n + arg.data.length, 0);
    expect(inserted).toBe(20200);

    expect(mockImportUpdateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    });
    expect(mockImportUpdate).toHaveBeenCalledWith({
      where: { id: 'import-new' },
      data: { status: 'ACTIVE', activatedAt: expect.any(Date) },
    });
    expect(mockTransaction).toHaveBeenCalledWith(['supersede-op', 'activate-op']);

    // Old lines go only after the swap, so a reader never sees an empty set.
    expect(mockLineDeleteMany).toHaveBeenCalledWith({
      where: { import: { status: 'SUPERSEDED' } },
    });
    expect(mockTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockLineDeleteMany.mock.invocationCallOrder[0]
    );
    expect(mockLineCreateMany.mock.invocationCallOrder[40]).toBeLessThan(
      mockTransaction.mock.invocationCallOrder[0]
    );
  });

  it('loads the first snapshot into an empty database', async () => {
    mockImportFindFirst.mockResolvedValueOnce(null);

    const result = await loadLiftGeometryDataset(dataset(manyLines(12000)));

    expect(result.previous).toBeNull();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('refuses a snapshot too small to be worldwide, even into an empty database', async () => {
    mockImportFindFirst.mockResolvedValueOnce(null);

    await expect(loadLiftGeometryDataset(dataset(manyLines(300)))).rejects.toThrow(
      'regional Overpass instance'
    );
    expect(mockImportCreate).not.toHaveBeenCalled();
  });

  it('refuses a snapshot much smaller than the active import, before writing anything', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);

    await expect(loadLiftGeometryDataset(dataset(manyLines(15000)))).rejects.toThrow(
      'refusing a shrink'
    );
    expect(mockImportDeleteMany).not.toHaveBeenCalled();
    expect(mockImportCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('accepts the shrink when told it is real', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);

    await loadLiftGeometryDataset(dataset(manyLines(15000)), { allowShrink: true });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('leaves the active import in place when an insert fails', async () => {
    mockImportFindFirst.mockResolvedValueOnce(ACTIVE);
    mockLineCreateMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(loadLiftGeometryDataset(dataset(manyLines(20000)))).rejects.toThrow(
      'connection reset'
    );
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockLineDeleteMany).not.toHaveBeenCalled();
  });
});
