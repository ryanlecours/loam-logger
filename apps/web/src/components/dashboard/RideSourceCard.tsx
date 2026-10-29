import { useId } from 'react';
import { Link } from 'react-router';
import { Loader2, Smartphone, PenLine } from 'lucide-react';
import ConnectStravaLink from '../ConnectStravaLink';
import ConnectGarminLink from '../ConnectGarminLink';
import ConnectWhoopLink from '../ConnectWhoopLink';
import ConnectSuuntoLink from '../ConnectSuuntoLink';
import {
  describeLookback,
  describeSince,
  rideProviderLabel,
  type RideSourceState,
} from '../../utils/rideSourceState';

export type RideSourceCardState = Exclude<RideSourceState, { kind: 'has-rides' }>;

interface RideSourceCardProps {
  state: RideSourceCardState;
  /** "I don't use a ride tracker": stop asking this rider to connect one. */
  onDeclineTracker: () => void;
  /** The rider changed their mind and wants the connect buttons back. */
  onReconsiderTracker: () => void;
  /** Injected so tests can pin the clock for the "started N minutes ago" line. */
  now?: Date;
}

/**
 * Where this bike's hours come from, when it has none yet.
 *
 * Rides are the input and component health is the output, so a bike at zero
 * rides is a bike whose clocks are all stopped. The hero used to answer that
 * with "No rides on this bike yet" and a Strava button, whether or not
 * anything was connected, which told a rider who had just connected Garmin to
 * go connect Strava and told a rider with nothing connected that all was well.
 *
 * One card, one of five faces, decided by resolveRideSourceState:
 *  - none: nothing connected. Says so plainly and offers every provider,
 *    since whichever app or watch the rider already uses is the one that
 *    will import a year of history on its own.
 *  - importing: connected and the connect-time import is running. Progress
 *    where a provider can report it.
 *  - empty: connected, import finished, still nothing. The import window had
 *    no rides in it, so the next ride has to be recorded or logged.
 *  - failed: connected, import died. Points at Settings, where it can be rerun.
 *  - manual: the rider said they do not use a tracker. Offers the two manual
 *    paths and a quiet way back.
 *
 * Partner buttons keep their own brand colors (the Guest Jersey Rule); the
 * card itself stays in Loam's palette and never claims a bike is fine.
 */
export function RideSourceCard({ state, onDeclineTracker, onReconsiderTracker, now }: RideSourceCardProps) {
  // One card per dashboard today, but a static id would collide the moment a
  // second one rendered, and aria-labelledby would then point at the wrong one.
  const titleId = useId();
  switch (state.kind) {
    case 'none':
      return (
        <section className="ride-source-card" aria-labelledby={titleId}>
          <p className="ride-source-eyebrow">Ride source</p>
          <h4 id={titleId} className="ride-source-title">
            No ride source connected
          </h4>
          <p className="ride-source-body">
            Your parts are tracked, but nothing is feeding them hours. Connect the app or watch that records
            your rides and the past year imports on its own.
          </p>
          <div className="ride-source-connect">
            <ConnectStravaLink />
            <ConnectGarminLink />
            <ConnectWhoopLink />
            <ConnectSuuntoLink />
          </div>
          <ManualPaths />
          <button type="button" className="ride-source-decline" onClick={onDeclineTracker}>
            I don&apos;t use a ride tracker
          </button>
        </section>
      );

    case 'importing': {
      const label = rideProviderLabel(state.provider);
      const progress =
        state.ridesFound !== null
          ? `${state.ridesFound} ride${state.ridesFound === 1 ? '' : 's'} so far`
          : 'Rides show up here as they arrive. The first ones usually land within a few minutes.';
      return (
        <section className="ride-source-card ride-source-card-busy" aria-labelledby={titleId} aria-live="polite">
          <p className="ride-source-eyebrow">Ride source</p>
          <h4 id={titleId} className="ride-source-title">
            <Loader2 size={16} className="ride-source-spinner" aria-hidden="true" />
            Importing your rides from {label}
          </h4>
          <p className="ride-source-body">{progress}</p>
          <p className="ride-source-meta">Started {describeSince(state.startedAt, now)}</p>
        </section>
      );
    }

    case 'empty': {
      const label = rideProviderLabel(state.provider);
      const window = describeLookback(state.lookbackDays);
      return (
        <section className="ride-source-card" aria-labelledby={titleId}>
          <p className="ride-source-eyebrow">Ride source</p>
          <h4 id={titleId} className="ride-source-title">
            {window ? `Nothing found in ${window}` : 'No rides have come in yet'}
          </h4>
          <p className="ride-source-body">
            {window
              ? `${label} is connected, but it had no rides to import. Record one or log one by hand and the hours start counting.`
              : `${label} is connected, but no import has run for it yet. Start one from Settings, or record or log a ride by hand.`}
          </p>
          <ManualPaths />
          <Link to="/settings" className="ride-source-decline">
            {window ? 'Import earlier seasons in Settings' : 'Import rides in Settings'}
          </Link>
        </section>
      );
    }

    case 'failed': {
      const label = rideProviderLabel(state.provider);
      return (
        <section className="ride-source-card ride-source-card-warning" aria-labelledby={titleId}>
          <p className="ride-source-eyebrow">Ride source</p>
          <h4 id={titleId} className="ride-source-title">
            The import from {label} didn&apos;t finish
          </h4>
          <p className="ride-source-body">
            {label} is connected, but its rides never landed. Run the import again from Settings, or log a ride
            by hand in the meantime.
          </p>
          <div className="ride-source-paths">
            <Link to="/settings" className="ride-source-path">
              Retry in Settings
            </Link>
            <Link to="/rides" className="ride-source-path">
              <PenLine size={14} aria-hidden="true" />
              Log a ride by hand
            </Link>
          </div>
        </section>
      );
    }

    case 'manual':
      return (
        <section className="ride-source-card" aria-labelledby={titleId}>
          <p className="ride-source-eyebrow">Ride source</p>
          <h4 id={titleId} className="ride-source-title">
            Logging rides by hand
          </h4>
          <p className="ride-source-body">
            Hours only count once a ride is logged. Record one with the app or type it in here.
          </p>
          <ManualPaths />
          <button type="button" className="ride-source-decline" onClick={onReconsiderTracker}>
            Connect a ride tracker after all
          </button>
        </section>
      );
  }
}

/** Recording lives in the mobile app; typing a ride in lives on the Rides page. */
function ManualPaths() {
  return (
    <div className="ride-source-paths">
      <Link to="/app" className="ride-source-path">
        <Smartphone size={14} aria-hidden="true" />
        Record with the app
      </Link>
      <Link to="/rides" className="ride-source-path">
        <PenLine size={14} aria-hidden="true" />
        Log a ride by hand
      </Link>
    </div>
  );
}
