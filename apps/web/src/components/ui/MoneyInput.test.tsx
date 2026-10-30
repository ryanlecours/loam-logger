import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from './MoneyInput';

describe('MoneyInput', () => {
  it('shows the currency code as the prefix and reports typed text', () => {
    const onChange = vi.fn();
    render(<MoneyInput aria-label="Cost" value="" onChange={onChange} currency="CAD" />);

    expect(screen.getByText('CAD')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '38.50' } });
    expect(onChange).toHaveBeenCalledWith('38.50');
  });

  it('uses a decimal keyboard and lets a custom prefix replace the code', () => {
    render(
      <MoneyInput
        aria-label="Cost"
        value="12"
        onChange={() => {}}
        currency="USD"
        prefix={<span>pick</span>}
      />
    );

    expect(screen.getByLabelText('Cost')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('pick')).toBeInTheDocument();
    expect(screen.queryByText('USD')).not.toBeInTheDocument();
  });

  it('marks the field invalid and shows the reason when given an error', () => {
    render(<MoneyInput id="cost" aria-label="Cost" value="1,200" onChange={() => {}} error="Enter a plain amount, like 38.50." />);

    const input = screen.getByLabelText('Cost');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a plain amount, like 38.50.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-describedby', 'cost-error');
  });
});
