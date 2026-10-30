import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { FileDown } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { bikeName, slugify } from '@/lib/bikeHistory';
import { todayDateInput } from '@/lib/format';
import { posthog } from '@/lib/posthog';
import type {
  HistoryBike,
  HistoryInstallEvent,
  HistoryRide,
  HistoryServiceEvent,
  HistoryTotals,
} from '@/lib/bikeHistory';
import { BikeHistoryPdf } from './BikeHistoryPdf';

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
  /** The rider's tier, for the export event. */
  tier?: string;
};

const LOGO_SRC = '/loamLoggerLogo_512x512.png';

export default function BikeHistoryPdfButton(props: Props) {
  const [generating, setGenerating] = useState(false);
  // The same document serves insurance and resale; a buyer need not see
  // what was spent, so costs can be left out. On by default.
  const [includeCosts, setIncludeCosts] = useState(true);

  const handleExport = async () => {
    setGenerating(true);
    try {
      const blob = await pdf(
        <BikeHistoryPdf {...props} includeCosts={includeCosts} logoSrc={LOGO_SRC} />
      ).toBlob();
      posthog.capture('maintenance_exported', {
        format: 'pdf',
        include_costs: includeCosts,
        tier: props.tier ?? 'PRO',
      });
      const url = URL.createObjectURL(blob);
      const dateStr = todayDateInput();
      const filename = `${slugify(bikeName(props.bike))}-history-${dateStr}.pdf`;
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label className="flex select-none items-center gap-1.5 text-xs text-muted">
        <input
          type="checkbox"
          checked={includeCosts}
          onChange={(e) => setIncludeCosts(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-app bg-surface accent-accent"
        />
        Include what you spent
      </label>
      <Button variant="outline" size="sm" onClick={handleExport} disabled={generating}>
        <FileDown size={14} className="icon-left" />
        {generating ? 'Generating…' : 'Export PDF'}
      </Button>
    </div>
  );
}
