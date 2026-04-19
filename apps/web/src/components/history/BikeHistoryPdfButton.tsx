import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { FileDown } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { bikeName, slugify } from '@/lib/bikeHistory';
import { todayDateInput } from '@/lib/format';
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
};

const LOGO_SRC = '/loamLoggerLogo_512x512.png';

export default function BikeHistoryPdfButton(props: Props) {
  const [generating, setGenerating] = useState(false);

  const handleExport = async () => {
    setGenerating(true);
    try {
      const blob = await pdf(
        <BikeHistoryPdf {...props} logoSrc={LOGO_SRC} />
      ).toBlob();
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
    <Button variant="outline" size="sm" onClick={handleExport} disabled={generating}>
      <FileDown size={14} className="icon-left" />
      {generating ? 'Generating…' : 'Export PDF'}
    </Button>
  );
}
