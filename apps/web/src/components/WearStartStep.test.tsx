import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WearStartStep } from './WearStartStep';

describe('WearStartStep', () => {
  const defaultProps = {
    selected: null,
    onSelect: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
    submitting: false,
  };

  describe('rendering', () => {
    it('renders title and description', () => {
      render(<WearStartStep {...defaultProps} />);

      expect(screen.getByText('Are your components stock?')).toBeInTheDocument();
      expect(
        screen.getByText(
          'This helps us set up accurate component tracking. You can always update details later.'
        )
      ).toBeInTheDocument();
    });

    it('renders both stock options', () => {
      render(<WearStartStep {...defaultProps} />);

      expect(screen.getByText('All Stock')).toBeInTheDocument();
      expect(screen.getByText('Components are unchanged from the factory.')).toBeInTheDocument();

      expect(screen.getByText('Some Swapped')).toBeInTheDocument();
      expect(
        screen.getByText("I've replaced some parts since buying.")
      ).toBeInTheDocument();
    });

    it('shows Recommended badge on All Stock option', () => {
      render(<WearStartStep {...defaultProps} />);

      expect(screen.getByText('Recommended')).toBeInTheDocument();
    });

    it('renders Back and Create Bike buttons', () => {
      render(<WearStartStep {...defaultProps} />);

      expect(screen.getByText('Back')).toBeInTheDocument();
      expect(screen.getByText('Create Bike')).toBeInTheDocument();
    });
  });

  describe('option selection', () => {
    it('calls onSelect when All Stock option is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<WearStartStep {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByText('All Stock'));

      expect(onSelect).toHaveBeenCalledWith('NEW');
    });

    it('calls onSelect when Some Swapped option is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<WearStartStep {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByText('Some Swapped'));

      expect(onSelect).toHaveBeenCalledWith('USED');
    });

    it('highlights selected option', () => {
      const { rerender } = render(<WearStartStep {...defaultProps} selected="USED" />);

      // The selected option should have accent styling
      const usedButton = screen.getByText('Some Swapped').closest('button');
      expect(usedButton).toHaveClass('border-accent');

      // Non-selected options should have default styling
      const newButton = screen.getByText('All Stock').closest('button');
      expect(newButton).toHaveClass('border-app');

      // Rerender with different selection
      rerender(<WearStartStep {...defaultProps} selected="NEW" />);

      const newButtonAfter = screen.getByText('All Stock').closest('button');
      expect(newButtonAfter).toHaveClass('border-accent');
    });
  });

  describe('button states', () => {
    it('disables Create Bike button when nothing is selected', () => {
      render(<WearStartStep {...defaultProps} selected={null} />);

      const submitButton = screen.getByText('Create Bike');
      expect(submitButton).toBeDisabled();
    });

    it('enables Create Bike button when an option is selected', () => {
      render(<WearStartStep {...defaultProps} selected="NEW" />);

      const submitButton = screen.getByText('Create Bike');
      expect(submitButton).not.toBeDisabled();
    });

    it('disables both buttons when submitting', () => {
      render(<WearStartStep {...defaultProps} selected="NEW" submitting={true} />);

      expect(screen.getByText('Back')).toBeDisabled();
      expect(screen.getByText('Creating...')).toBeDisabled();
    });

    it('shows Creating... text when submitting', () => {
      render(<WearStartStep {...defaultProps} selected="NEW" submitting={true} />);

      expect(screen.getByText('Creating...')).toBeInTheDocument();
      expect(screen.queryByText('Create Bike')).not.toBeInTheDocument();
    });
  });

  describe('submission flow', () => {
    it('calls onSubmit when Create Bike is clicked', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<WearStartStep {...defaultProps} selected="NEW" onSubmit={onSubmit} />);

      await user.click(screen.getByText('Create Bike'));

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('calls onBack when Back is clicked', async () => {
      const user = userEvent.setup();
      const onBack = vi.fn();
      render(<WearStartStep {...defaultProps} onBack={onBack} />);

      await user.click(screen.getByText('Back'));

      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('does not call onSubmit when button is disabled', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<WearStartStep {...defaultProps} selected={null} onSubmit={onSubmit} />);

      const submitButton = screen.getByText('Create Bike');
      await user.click(submitButton);

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
