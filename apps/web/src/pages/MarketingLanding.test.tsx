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

  it('sells Free, states the yearly Pro price once, and sends pricing detail to its own page', () => {
    render(<MarketingLanding />);
    expect(screen.getByRole('heading', { name: 'Free for one bike, for good.' })).toBeInTheDocument();
    expect(screen.getAllByText(/\$39\.99 a year/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$4\.99/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Go Pro/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details on the pricing page.' })).toHaveAttribute(
      'href',
      '/pricing?source=landing-free-note',
    );
    expect(screen.getAllByText(/Garmin Connect™/).length).toBeGreaterThan(0);
  });

  it('is honest about what Free leaves out', () => {
    render(<MarketingLanding />);
    expect(screen.getByText('What does Free actually leave out?')).toBeInTheDocument();
    expect(screen.getByText(/flags it once it’s past due/)).toBeInTheDocument();
  });

  it('keeps the 99spokes attribution and the Garmin trademark notice', () => {
    render(<MarketingLanding />);
    expect(screen.getByAltText('Powered by 99 Spokes')).toBeInTheDocument();
    expect(screen.getByText(/Garmin Connect is a trademark/)).toBeInTheDocument();
  });

  it('keeps the FAQ structured data in step with the visible Straight Answers', () => {
    const { container } = render(<MarketingLanding />);
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const faq = scripts.map((s) => JSON.parse(s.textContent ?? '{}')).find((d) => d['@type'] === 'FAQPage');
    expect(faq).toBeDefined();
    const visible = Array.from(container.querySelectorAll('.lp-faq__q')).map((dt) => dt.textContent);
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(visible);
  });

  it('publishes the same Pro price in the structured data as in the copy', () => {
    const { container } = render(<MarketingLanding />);
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const graph = scripts.map((s) => JSON.parse(s.textContent ?? '{}')).find((d) => Array.isArray(d['@graph']));
    const app = graph['@graph'].find((n: { '@type': string }) => n['@type'] === 'SoftwareApplication');
    const yearly = app.offers.find((o: { name: string }) => o.name === 'Pro, yearly');
    expect(screen.getAllByText(new RegExp(`\\$${yearly.price} a year`)).length).toBeGreaterThan(0);
  });

  it('does not fabricate social proof', () => {
    render(<MarketingLanding />);
    expect(screen.queryByText(/testimonial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/riders trust/i)).not.toBeInTheDocument();
  });
});
