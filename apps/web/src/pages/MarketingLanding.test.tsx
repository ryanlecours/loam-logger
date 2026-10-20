import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '../test/test-utils';
import MarketingLanding from './MarketingLanding';

// jsdom has no WebGL and no requestIdleCallback; the gate must keep the
// three.js module out of the page here, which also keeps it out of the test.
vi.mock('../components/marketing/terrainGate', () => ({
  detectTerrainEnvironment: () => ({
    reducedMotion: true,
    viewportWidth: 1024,
    saveData: false,
    webgl: false,
  }),
  shouldRenderTerrain: () => false,
}));

describe('MarketingLanding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('leads with the positioning line and the free tier', () => {
    render(<MarketingLanding />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Anyone can track a ride.');
    expect(heading).toHaveTextContent('Loam Logger tracks your bike.');
    expect(screen.getAllByRole('link', { name: 'Start free' }).length).toBeGreaterThan(0);
  });

  it('always draws the static ridge and never the terrain canvas when gated off', async () => {
    render(<MarketingLanding />);
    expect(screen.getByTestId('hero-ridge')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.queryByTestId('hero-terrain')).not.toBeInTheDocument();
  });

  it('shows all four component health states in the dashboard example', () => {
    render(<MarketingLanding />);
    const mock = within(screen.getByTestId('dashboard-mock'));
    expect(mock.getByText(/Overdue/)).toBeInTheDocument();
    expect(mock.getByText(/Due now/)).toBeInTheDocument();
    expect(mock.getByText(/Due soon/)).toBeInTheDocument();
    expect(mock.getByText('Good to go')).toBeInTheDocument();
    expect(mock.getByText('Nothing tracked')).toBeInTheDocument();
  });

  it('states the real pricing and names the partners', () => {
    render(<MarketingLanding />);
    expect(screen.getByText('$4.99')).toBeInTheDocument();
    expect(screen.getByText('a month, or $39.99 a year')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go Pro' })).toHaveAttribute(
      'href',
      '/pricing?source=landing-pricing',
    );
    expect(screen.getAllByText(/Garmin Connect™/).length).toBeGreaterThan(0);
  });

  it('keeps the 99spokes attribution and the Garmin trademark notice', () => {
    render(<MarketingLanding />);
    expect(screen.getByAltText('Powered by 99 Spokes')).toBeInTheDocument();
    expect(screen.getByText(/Garmin Connect is a trademark/)).toBeInTheDocument();
  });

  it('does not fabricate social proof', () => {
    render(<MarketingLanding />);
    expect(screen.queryByText(/testimonial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/riders trust/i)).not.toBeInTheDocument();
  });
});
