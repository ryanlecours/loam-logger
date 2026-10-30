/**
 * The rider's whole maintenance history as one CSV: every service, inspection,
 * install and removal across every bike they have or had, with the parts and
 * costs they recorded. The owner's own copy, so notes are included; the public
 * share pages never carry them.
 *
 * Services are attributed to a bike by tenure (where the part was when the work
 * was done), not by Component.bikeId, so work on a part since replaced or moved
 * still lands under the bike it was on. A service performed while the part sat
 * in inventory has no bike and says so.
 *
 * "Hours at event" derives from partner ride data, which makes this file
 * downstream data under the Garmin API Brand Guidelines: when any of the
 * rider's rides came from Garmin, the sanctioned attribution and trademark
 * notice travel at the end of the file (DESIGN.md, Third-Party Attribution).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_CURRENCY,
  GARMIN_INSIGHT_ATTRIBUTION,
  GARMIN_TRADEMARK_NOTICE,
  formatComponentType,
  minorToMajor,
  currencyMinorDigits,
} from '@loam/shared';
import { componentWindowsForBike, windowContaining, type ComponentWindow } from './component-history';

type Db = PrismaClient | Prisma.TransactionClient;

export const MAINTENANCE_CSV_COLUMNS = [
  'date',
  'bike',
  'component_type',
  'location',
  'component_brand',
  'component_model',
  'event',
  'hours_at_event',
  'cost',
  'currency',
  'parts',
  'vendors',
  'notes',
] as const;

export interface MaintenanceCsvResult {
  csv: string;
  rowCount: number;
  bikeCount: number;
  attributed: boolean;
}

/** RFC 4180 quoting: wrap when the value holds a comma, quote or line break. */
export function csvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  // A leading =, +, - or @ (or a tab or carriage return, which OWASP lists
  // too), even after leading whitespace, would be read as a formula by a
  // spreadsheet; the apostrophe keeps rider text as text.
  const safe = /^\s*[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The currency an exported amount is written in. The API always stores a code
 * beside an amount, so a null here is a legacy or hand-edited row; the default
 * is used for the number and written into the currency cell too, so the two
 * never disagree.
 */
export const exportCurrency = (currency: string | null | undefined): string => currency ?? DEFAULT_CURRENCY;

export function formatMinor(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return '';
  const code = exportCurrency(currency);
  return minorToMajor(minor, code).toFixed(currencyMinorDigits(code));
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

type Row = Record<(typeof MAINTENANCE_CSV_COLUMNS)[number], string>;

const bikeLabel = (b: { nickname: string | null; manufacturer: string; model: string; year: number | null }) =>
  b.nickname || [b.year, b.manufacturer, b.model].filter(Boolean).join(' ');

const locationLabel = (loc: string) => (loc === 'NONE' ? '' : loc.toLowerCase());

export async function buildMaintenanceCsv(
  db: Db,
  userId: string,
  now: Date = new Date()
): Promise<MaintenanceCsvResult> {
  const [bikes, components, installs, logs, garminRide] = await Promise.all([
    db.bike.findMany({
      where: { userId },
      select: { id: true, nickname: true, manufacturer: true, model: true, year: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.component.findMany({
      where: { userId },
      select: { id: true, type: true, location: true, brand: true, model: true },
    }),
    db.bikeComponentInstall.findMany({
      where: { userId },
      select: { bikeId: true, componentId: true, installedAt: true, removedAt: true },
    }),
    db.serviceLog.findMany({
      where: { component: { userId } },
      select: {
        componentId: true,
        performedAt: true,
        kind: true,
        hoursAtService: true,
        costMinor: true,
        currency: true,
        notes: true,
        parts: {
          select: { brand: true, model: true, priceMinor: true, vendor: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    }),
    db.ride.findFirst({ where: { userId, garminActivityId: { not: null } }, select: { id: true } }),
  ]);

  const bikeById = new Map(bikes.map((b) => [b.id, b]));
  const componentById = new Map(components.map((c) => [c.id, c]));

  // Tenure windows per bike, so each service can be placed on the bike it was
  // performed on. Bikes are few; one pass each.
  const windowsByBike = new Map<string, ComponentWindow[]>(
    await Promise.all(
      bikes.map(async (bike) => [bike.id, await componentWindowsForBike(db, bike.id, userId, now)] as const)
    )
  );
  // Index the windows by component so placing each log is a lookup over that
  // part's few tenures, not a scan of every window of every bike.
  const windowsByComponent = new Map<string, Array<ComponentWindow & { bikeId: string }>>();
  for (const [bikeId, windows] of windowsByBike) {
    for (const w of windows) {
      const list = windowsByComponent.get(w.componentId);
      const entry = { ...w, bikeId };
      if (list) list.push(entry);
      else windowsByComponent.set(w.componentId, [entry]);
    }
  }
  const bikeFor = (componentId: string, at: Date): string => {
    const hit = windowContaining(windowsByComponent.get(componentId) ?? [], componentId, at);
    if (!hit) return '';
    const bike = bikeById.get(hit.bikeId);
    return bike ? bikeLabel(bike) : '';
  };

  const rows: Array<{ at: Date; row: Row }> = [];
  const push = (at: Date, partial: Partial<Row>) => {
    const row = Object.fromEntries(MAINTENANCE_CSV_COLUMNS.map((c) => [c, ''])) as Row;
    rows.push({ at, row: { ...row, ...partial, date: isoDay(at) } });
  };

  for (const i of installs) {
    const c = componentById.get(i.componentId);
    const b = bikeById.get(i.bikeId);
    const base: Partial<Row> = {
      bike: b ? bikeLabel(b) : '',
      component_type: c ? formatComponentType(c.type) : '',
      location: c ? locationLabel(c.location) : '',
      component_brand: c?.brand ?? '',
      component_model: c?.model ?? '',
    };
    push(i.installedAt, { ...base, event: 'installed' });
    if (i.removedAt) push(i.removedAt, { ...base, event: 'removed' });
  }

  for (const log of logs) {
    const c = componentById.get(log.componentId);
    const parts = log.parts
      .map((p) => {
        const name = [p.brand, p.model].filter(Boolean).join(' ');
        const price = p.priceMinor != null ? ` (${formatMinor(p.priceMinor, log.currency)})` : '';
        return `${name}${price}`;
      })
      .join('; ');
    const vendors = [...new Set(log.parts.map((p) => p.vendor).filter((v): v is string => !!v))].join('; ');
    push(log.performedAt, {
      bike: bikeFor(log.componentId, log.performedAt),
      component_type: c ? formatComponentType(c.type) : '',
      location: c ? locationLabel(c.location) : '',
      component_brand: c?.brand ?? '',
      component_model: c?.model ?? '',
      event: log.kind === 'INSPECTION' ? 'inspection' : 'service',
      hours_at_event: log.hoursAtService.toFixed(1),
      cost: formatMinor(log.costMinor, log.currency),
      currency: log.costMinor != null ? exportCurrency(log.currency) : '',
      parts,
      vendors,
      notes: log.notes ?? '',
    });
  }

  rows.sort((a, b) => a.at.getTime() - b.at.getTime());

  const lines = [MAINTENANCE_CSV_COLUMNS.join(',')];
  for (const { row } of rows) {
    lines.push(MAINTENANCE_CSV_COLUMNS.map((c) => csvField(row[c])).join(','));
  }

  const attributed = garminRide != null;
  if (attributed) {
    // Attribution travels with the data, as two trailing records in the
    // first column (no blank separator, which strict parsers read as an
    // empty record). A reader that wants only events can drop rows whose
    // event column is empty.
    lines.push(csvField(GARMIN_INSIGHT_ATTRIBUTION));
    lines.push(csvField(GARMIN_TRADEMARK_NOTICE));
  }

  // BOM so Excel reads the UTF-8 as such; CRLF per RFC 4180.
  return {
    csv: '﻿' + lines.join('\r\n') + '\r\n',
    rowCount: rows.length,
    bikeCount: bikes.length,
    attributed,
  };
}
