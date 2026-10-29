import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import AuthError from './AuthError';
import { CONNECTED_SERVICES_PATH, parseConnectFailure } from '../lib/providerConnectFailure';

// The glass Card animates in on scroll, and jsdom has no IntersectionObserver.
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/error${search}`]}>
      <AuthError />
    </MemoryRouter>
  );
}

describe('AuthError', () => {
  it('shows the failure the callback redirected with', () => {
    renderAt('?message=' + encodeURIComponent('Strava connection failed. Please try again.'));

    expect(screen.getByRole('heading', { name: "Strava didn't connect" })).toBeInTheDocument();
    expect(screen.getByText('Strava connection failed. Please try again.')).toBeInTheDocument();
  });

  it('explains an account that is linked to another rider', () => {
    renderAt('?message=' + encodeURIComponent('This WHOOP account is already linked to another user.'));

    expect(screen.getByRole('heading', { name: 'WHOOP is linked elsewhere' })).toBeInTheDocument();
    expect(screen.getByText(/already linked to another user/)).toBeInTheDocument();
  });

  it('sends Try again to the connected services pane in Settings', () => {
    renderAt('?message=' + encodeURIComponent('Garmin connection failed. Please try again.'));

    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', CONNECTED_SERVICES_PATH);
    expect(CONNECTED_SERVICES_PATH).toBe('/settings?section=data-sources');
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('falls back to generic copy without a message', () => {
    renderAt('');

    expect(screen.getByRole('heading', { name: "The connection didn't finish" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toBeInTheDocument();
  });

  it('never renders text the API did not send', () => {
    const crafted = 'Your account is locked. Call 555-0100 to unlock it.';
    renderAt('?message=' + encodeURIComponent(crafted));

    expect(screen.queryByText(crafted)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "The connection didn't finish" })).toBeInTheDocument();
  });

  it('keeps the message out of session replay', () => {
    renderAt('?message=' + encodeURIComponent('Suunto connection failed. Please try again.'));

    expect(screen.getByText('Suunto connection failed. Please try again.')).toHaveAttribute('data-ph-mask');
  });
});

describe('parseConnectFailure', () => {
  it.each(['Garmin', 'Strava', 'WHOOP', 'Suunto'])('recognises the %s failure messages', (provider) => {
    expect(parseConnectFailure(`${provider} connection failed. Please try again.`)).toEqual({
      kind: 'failed',
      provider,
    });
    expect(parseConnectFailure(`This ${provider} account is already linked to another user.`)).toEqual({
      kind: 'already_linked',
      provider,
    });
  });

  it('treats anything else as unknown', () => {
    expect(parseConnectFailure(null)).toEqual({ kind: 'unknown' });
    expect(parseConnectFailure('')).toEqual({ kind: 'unknown' });
    expect(parseConnectFailure('Zwift connection failed. Please try again.')).toEqual({ kind: 'unknown' });
    expect(
      parseConnectFailure('Strava connection failed. Please try again. Visit evil.example')
    ).toEqual({ kind: 'unknown' });
  });
});
