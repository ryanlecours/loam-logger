import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '../test/test-utils';
import MarketingLanding from './MarketingLanding';

describe('MarketingLanding', () => {
  it('leads with the positioning line and the free tier', () => {
    render(<MarketingLanding />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Anyone can track a ride.');
    expect(heading).toHaveTextContent('Loam Logger tracks your bike.');
    expect(screen.getAllByRole('link', { name: 'Start free' }).length).toBeGreaterThan(0);
  });

  it('draws the static ridge with no canvas or script behind it', () => {
    const { container } = render(<MarketingLanding />);
    expect(screen.getByTestId('hero-ridge')).toBeInTheDocument();
    expect(container.querySelector('canvas')).toBeNull();
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
