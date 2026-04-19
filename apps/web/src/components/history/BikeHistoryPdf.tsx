import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import { getComponentLabel } from '@/constants/componentLabels';
import { fmtDateTime, fmtDistance, fmtDuration, fmtElevation } from '@/lib/format';
import { bikeName } from '@/lib/bikeHistory';
import type {
  ComponentLite,
  HistoryBike,
  HistoryInstallEvent,
  HistoryRide,
  HistoryServiceEvent,
  HistoryTotals,
} from '@/lib/bikeHistory';

const SAGE = '#788c80';
const INK = '#0c0c0e';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  logo: { width: 44, height: 44, marginRight: 12 },
  headerMeta: { flex: 1 },
  brand: { fontSize: 10, color: SAGE, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 2, color: INK },
  subtitle: { fontSize: 10, color: MUTED, marginTop: 2 },
  totalsRow: { flexDirection: 'row', marginBottom: 16, borderTop: `1pt solid ${BORDER}`, borderBottom: `1pt solid ${BORDER}`, paddingVertical: 8 },
  total: { flex: 1 },
  totalLabel: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  totalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 2, color: INK },
  yearHeader: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: SAGE, marginTop: 10, marginBottom: 4, borderBottom: `1pt solid ${BORDER}`, paddingBottom: 3 },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottom: `0.5pt solid ${BORDER}` },
  rideRow: { paddingLeft: 24 },
  rowIcon: { width: 56, color: MUTED, fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  rowTitle: { flex: 1, fontSize: 10 },
  rowMeta: { color: MUTED, fontSize: 9 },
  footer: { position: 'absolute', left: 36, right: 36, bottom: 18, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: MUTED },
  truncatedNote: { fontSize: 9, color: MUTED, marginBottom: 8, fontStyle: 'italic' },
});

type YearGroup = {
  year: number;
  items: Array<
    | { kind: 'ride'; date: Date; ride: HistoryRide }
    | { kind: 'service'; date: Date; service: HistoryServiceEvent }
    | { kind: 'install'; date: Date; install: HistoryInstallEvent }
  >;
};

type Props = {
  bike: HistoryBike;
  totals: HistoryTotals;
  yearGroups: YearGroup[];
  distanceUnit: 'mi' | 'km';
  timeframeLabel: string;
  truncated: boolean;
  /** URL (typically served from /public) for the Loam Logger logo. */
  logoSrc?: string;
};

function componentText(c: ComponentLite): string {
  const label = getComponentLabel(c.type);
  const loc = c.location && c.location !== 'NONE' ? ` (${c.location.toLowerCase()})` : '';
  const brandModel = [c.brand, c.model].filter(Boolean).join(' ');
  return brandModel ? `${label}${loc} — ${brandModel}` : `${label}${loc}`;
}

export function BikeHistoryPdf({ bike, totals, yearGroups, distanceUnit, timeframeLabel, truncated, logoSrc }: Props) {
  const generated = new Date();
  return (
    <Document title={`${bikeName(bike)} – Loam Logger history`}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.headerRow} fixed>
          {logoSrc && <Image src={logoSrc} style={styles.logo} />}
          <View style={styles.headerMeta}>
            <Text style={styles.brand}>LOAM LOGGER</Text>
            <Text style={styles.title}>{bikeName(bike)}</Text>
            <Text style={styles.subtitle}>
              {bike.year ? `${bike.year} · ` : ''}{timeframeLabel} · Generated {generated.toLocaleDateString()}
            </Text>
          </View>
        </View>

        <View style={styles.totalsRow}>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Rides</Text>
            <Text style={styles.totalValue}>{totals.rideCount.toLocaleString()}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Distance</Text>
            <Text style={styles.totalValue}>{fmtDistance(totals.totalDistanceMeters, distanceUnit)}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Elevation</Text>
            <Text style={styles.totalValue}>{fmtElevation(totals.totalElevationGainMeters, distanceUnit)}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Service & installs</Text>
            <Text style={styles.totalValue}>{(totals.serviceEventCount + totals.installEventCount).toLocaleString()}</Text>
          </View>
        </View>

        {truncated && (
          <Text style={styles.truncatedNote}>
            History was capped to the most recent entries — some older events may not appear.
          </Text>
        )}

        {yearGroups.length === 0 ? (
          <Text style={styles.subtitle}>No events in this timeframe.</Text>
        ) : (
          yearGroups.map(({ year, items }) => (
            <View key={year} wrap>
              <Text style={styles.yearHeader}>{year}</Text>
              {items.map((item) => {
                if (item.kind === 'ride') {
                  const { ride } = item;
                  const title = ride.trailSystem || ride.location || `${ride.rideType} ride`;
                  return (
                    <View key={`r:${ride.id}`} style={[styles.row, styles.rideRow]} wrap={false}>
                      <Text style={styles.rowIcon}>RIDE</Text>
                      <View style={styles.rowTitle}>
                        <Text>{title}</Text>
                        <Text style={styles.rowMeta}>
                          {fmtDateTime(ride.startTime)} · {fmtDuration(ride.durationSeconds)} · {fmtDistance(ride.distanceMeters, distanceUnit)} · {fmtElevation(ride.elevationGainMeters, distanceUnit)}
                        </Text>
                      </View>
                    </View>
                  );
                }
                if (item.kind === 'service') {
                  const s = item.service;
                  return (
                    <View key={`s:${s.id}`} style={styles.row} wrap={false}>
                      <Text style={styles.rowIcon}>SERVICE</Text>
                      <View style={styles.rowTitle}>
                        <Text>{componentText(s.component)}</Text>
                        <Text style={styles.rowMeta}>
                          {fmtDateTime(s.performedAt)} · {s.hoursAtService.toFixed(0)} hrs{s.notes ? ` · ${s.notes}` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                }
                const inst = item.install;
                return (
                  <View key={`i:${inst.id}`} style={styles.row} wrap={false}>
                    <Text style={styles.rowIcon}>{inst.eventType === 'INSTALLED' ? 'INSTALL' : 'REMOVE'}</Text>
                    <View style={styles.rowTitle}>
                      <Text>{componentText(inst.component)}</Text>
                      <Text style={styles.rowMeta}>{fmtDateTime(inst.occurredAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}

        <View style={styles.footer} fixed>
          <Text>Generated by Loam Logger · {generated.toLocaleDateString()}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
