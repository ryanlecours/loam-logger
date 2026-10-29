import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill, NoRidesPill } from './StatusPill';

describe('StatusPill', () => {
  it('names the state and carries its ramp class', () => {
    render(<StatusPill status="DUE_NOW" />);
    const pill = screen.getByText('Due Now');
    expect(pill).toHaveClass('status-pill', 'status-pill-due-now');
  });

  it('renders nothing for a null status (predictions are Pro-only)', () => {
    const { container } = render(<StatusPill status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides its icon from assistive tech; the label is the signal', () => {
    const { container } = render(<StatusPill status="OVERDUE" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('NoRidesPill', () => {
  it('reads No rides yet and sits outside the four-state ramp', () => {
    render(<NoRidesPill />);
    const pill = screen.getByText('No rides yet');
    expect(pill).toHaveClass('status-pill', 'status-pill-no-rides');
    for (const ramp of ['overdue', 'due-now', 'due-soon', 'all-good']) {
      expect(pill).not.toHaveClass(`status-pill-${ramp}`);
    }
  });

  it('hides its decorative icon from assistive tech', () => {
    const { container } = render(<NoRidesPill />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
