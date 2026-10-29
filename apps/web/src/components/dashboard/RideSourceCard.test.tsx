import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RideSourceCard, type RideSourceCardState } from './RideSourceCard';

vi.mock('../attribution/GarminConnectMark', () => ({ default: () => null }));

const NOW = new Date('2026-10-28T12:00:00Z');

function renderCard(state: RideSourceCardState, handlers: Partial<{ onDeclineTracker: () => void; onReconsiderTracker: () => void }> = {}) {
  return render(
    <MemoryRouter>
      <RideSourceCard
        state={state}
        onDeclineTracker={handlers.onDeclineTracker ?? vi.fn()}
        onReconsiderTracker={handlers.onReconsiderTracker ?? vi.fn()}
        now={NOW}
      />
    </MemoryRouter>
  );
}

describe('RideSourceCard', () => {
  describe('nothing connected', () => {
    it('says so plainly and never calls the bike healthy', () => {
      renderCard({ kind: 'none' });

      expect(screen.getByRole('heading', { name: 'No ride source connected' })).toBeInTheDocument();
      expect(screen.queryByText(/all good|good to go/i)).not.toBeInTheDocument();
    });

    // Whichever app or watch the rider already uses is the one that imports a
    // year of history on its own, so every provider is one click away.
    it('offers all four providers inline, each starting its own OAuth', () => {
      renderCard({ kind: 'none' });

      expect(screen.getByRole('link', { name: /Connect Strava/ })).toHaveAttribute(
        'href',
        expect.stringMatching(/\/auth\/strava\/start$/)
      );
      expect(screen.getByRole('link', { name: /Connect Garmin Connect/ })).toHaveAttribute(
        'href',
        expect.stringMatching(/\/auth\/garmin\/start$/)
      );
      expect(screen.getByRole('link', { name: /Connect WHOOP/ })).toHaveAttribute(
        'href',
        expect.stringMatching(/\/auth\/whoop\/start$/)
      );
      expect(screen.getByRole('link', { name: /Connect Suunto/ })).toHaveAttribute(
        'href',
        expect.stringMatching(/\/auth\/suunto\/start$/)
      );
    });

    it('offers the two manual paths', () => {
      renderCard({ kind: 'none' });

      expect(screen.getByRole('link', { name: /Record with the app/ })).toHaveAttribute('href', '/app');
      expect(screen.getByRole('link', { name: /Log a ride by hand/ })).toHaveAttribute('href', '/rides');
    });

    it('lets the rider say they do not use a tracker', async () => {
      const onDeclineTracker = vi.fn();
      renderCard({ kind: 'none' }, { onDeclineTracker });

      await userEvent.click(screen.getByRole('button', { name: /I don't use a ride tracker/ }));

      expect(onDeclineTracker).toHaveBeenCalledTimes(1);
    });
  });

  describe('importing', () => {
    it('names the provider and shows the count when there is one', () => {
      renderCard({ kind: 'importing', provider: 'garmin', ridesFound: 12, startedAt: '2026-10-28T11:56:00Z' });

      expect(screen.getByRole('heading', { name: /Importing your rides from Garmin Connect/ })).toBeInTheDocument();
      expect(screen.getByText('12 rides so far')).toBeInTheDocument();
      expect(screen.getByText('Started 4 minutes ago')).toBeInTheDocument();
    });

    // Strava reports its count only at the end; say what to expect instead.
    it('explains the wait when nothing can be counted yet', () => {
      renderCard({ kind: 'importing', provider: 'strava', ridesFound: null, startedAt: '2026-10-28T11:59:50Z' });

      expect(screen.getByText(/Rides show up here as they arrive/)).toBeInTheDocument();
      expect(screen.getByText('Started just now')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Connect/ })).not.toBeInTheDocument();
    });
  });

  describe('import finished with nothing', () => {
    it('names the window and offers record or log', () => {
      renderCard({ kind: 'empty', provider: 'strava', lookbackDays: 365 });

      expect(screen.getByRole('heading', { name: 'Nothing found in the last year' })).toBeInTheDocument();
      expect(screen.getByText(/Strava is connected, but it had no rides to import/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Record with the app/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Log a ride by hand/ })).toBeInTheDocument();
      // The source is connected; asking to connect another would be noise.
      expect(screen.queryByRole('link', { name: /Connect Strava/ })).not.toBeInTheDocument();
    });

    it('uses the 30-day window for WHOOP', () => {
      renderCard({ kind: 'empty', provider: 'whoop', lookbackDays: 30 });

      expect(screen.getByRole('heading', { name: 'Nothing found in the last 30 days' })).toBeInTheDocument();
    });

    it('does not invent a window when no import ever ran', () => {
      renderCard({ kind: 'empty', provider: 'suunto', lookbackDays: null });

      expect(screen.getByRole('heading', { name: 'No rides have come in yet' })).toBeInTheDocument();
    });
  });

  it('points a failed import at Settings', () => {
    renderCard({ kind: 'failed', provider: 'suunto' });

    expect(screen.getByRole('heading', { name: /The import from Suunto didn't finish/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Retry in Settings/ })).toHaveAttribute('href', '/settings');
  });

  it('offers a way back for a rider who opted out', async () => {
    const onReconsiderTracker = vi.fn();
    renderCard({ kind: 'manual' }, { onReconsiderTracker });

    expect(screen.getByRole('heading', { name: 'Logging rides by hand' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Connect Strava/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Connect a ride tracker after all/ }));

    expect(onReconsiderTracker).toHaveBeenCalledTimes(1);
  });
});
