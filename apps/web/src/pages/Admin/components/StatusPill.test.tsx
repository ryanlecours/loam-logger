import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it.each([
    ['pending', 'bg-warning'],
    ['processing', 'bg-info'],
    ['sent', 'bg-success'],
    ['cancelled', 'bg-surface-2'],
    ['failed', 'bg-danger'],
  ] as const)('maps %s status to the %s tone class', (status, cls) => {
    const { container } = render(<StatusPill status={status} />);
    const span = container.querySelector('span');
    expect(span?.className).toContain(cls);
  });

  it('renders the status as visible text (color-only state would fail a11y)', () => {
    // Founding-rider/etc. cells used to communicate state via color alone in
    // the old admin page. The pill's text label is the load-bearing part of
    // the design — assert it's actually in the DOM, not just the class.
    render(<StatusPill status="pending" />);
    expect(screen.getByText('pending')).toBeInTheDocument();
  });
});
