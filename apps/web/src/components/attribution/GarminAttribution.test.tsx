import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  GarminSourceBadge,
  GarminSourceLine,
  GarminDerivedNote,
  GarminTrademarkNotice,
} from './GarminAttribution';
import RideSourceBadges from '../RideSourceBadges';

/**
 * These assert exact rendered strings on purpose.
 *
 * Garmin reviews applications for attribution compliance and can suspend API
 * access over it, and their guidelines distinguish acceptable from
 * unacceptable wording by the exact phrasing. A well-meaning copy edit here is
 * a compliance regression, so these tests exist to make one fail loudly rather
 * than ship quietly.
 */

describe('GarminSourceBadge', () => {
  it('renders "Garmin [device model]" for primary displays', () => {
    render(<GarminSourceBadge deviceName="edge_840" />);
    expect(screen.getByText('Garmin Edge 840')).toBeInTheDocument();
  });

  it('falls back to plain "Garmin" when the device is unknown', () => {
    render(<GarminSourceBadge deviceName={null} />);
    expect(screen.getByText('Garmin')).toBeInTheDocument();
  });

  it('opts out of the shared badge uppercase transform', () => {
    // The badge carries a Garmin product name; upper-casing it restyles how
    // Garmin's hardware is presented.
    const { container } = render(<GarminSourceBadge deviceName="edge_840" />);
    expect(container.firstElementChild).toHaveClass('source-badge-garmin-attribution');
  });
});

describe('GarminSourceLine', () => {
  it('names the device as the data source on secondary screens', () => {
    render(<GarminSourceLine deviceName="fenix7" />);
    expect(screen.getByText('Data source: Garmin Fenix7')).toBeInTheDocument();
  });
});

describe('GarminDerivedNote', () => {
  it('uses the sanctioned insight wording verbatim', () => {
    render(<GarminDerivedNote />);
    expect(
      screen.getByText('Insights derived in part from Garmin device-sourced data.')
    ).toBeInTheDocument();
  });

  it('uses the sanctioned chart wording verbatim', () => {
    render(<GarminDerivedNote variant="chart" />);
    expect(
      screen.getByText('This chart was created using data provided by Garmin devices.')
    ).toBeInTheDocument();
  });
});

describe('GarminTrademarkNotice', () => {
  it('renders the trademark notice for downstream surfaces', () => {
    render(<GarminTrademarkNotice />);
    expect(screen.getByText(/trademarks of Garmin Ltd\. or its subsidiaries/)).toBeInTheDocument();
  });
});

describe('RideSourceBadges', () => {
  it('attributes a Garmin ride with its device model', () => {
    render(<RideSourceBadges ride={{ garminActivityId: 'a1', garminDeviceName: 'edge_840' }} />);
    expect(screen.getByText('Garmin Edge 840')).toBeInTheDocument();
  });

  // The bug this component was created to fix: Strava outranks Garmin in the
  // single-source helper, so a cross-provider ride used to render as Strava
  // alone and drop the Garmin attribution the guidelines require.
  it('shows BOTH providers on a ride matched across Strava and Garmin', () => {
    render(
      <RideSourceBadges
        ride={{ stravaActivityId: '123', garminActivityId: 'a1', garminDeviceName: 'edge_840' }}
      />
    );
    expect(screen.getByText('Strava')).toBeInTheDocument();
    expect(screen.getByText('Garmin Edge 840')).toBeInTheDocument();
  });

  // The inverse is equally binding: no Garmin mark where Garmin contributed
  // nothing.
  it('shows no Garmin attribution on a Strava-only ride', () => {
    render(<RideSourceBadges ride={{ stravaActivityId: '123' }} />);
    expect(screen.getByText('Strava')).toBeInTheDocument();
    expect(screen.queryByText(/Garmin/)).not.toBeInTheDocument();
  });

  it('shows no Garmin attribution on a manual ride', () => {
    render(<RideSourceBadges ride={{}} />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.queryByText(/Garmin/)).not.toBeInTheDocument();
  });
});
