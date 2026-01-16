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

      expect(screen.getByText('How should we start tracking wear?')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Loam Logger tracks wear automatically based on your rides. Pick a safe starting point.'
        )
      ).toBeInTheDocument();
    });

    it('renders all three wear options', () => {
      render(<WearStartStep {...defaultProps} />);

      expect(screen.getByText('Start Fresh')).toBeInTheDocument();
      expect(screen.getByText('All components start at zero wear.')).toBeInTheDocument();

      expect(screen.getByText('Already Ridden')).toBeInTheDocument();
      expect(
        screen.getByText('Components start with a conservative wear estimate.')
      ).toBeInTheDocument();

      expect(screen.getByText("I'll fine-tune later")).toBeInTheDocument();
      expect(
        screen.getByText('Set individual component wear after adding the bike.')
      ).toBeInTheDocument();
    });

    it('shows Recommended badge on NEW option', () => {
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
    it('calls onSelect when NEW option is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<WearStartStep {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByText('Start Fresh'));

      expect(onSelect).toHaveBeenCalledWith('NEW');
    });

    it('calls onSelect when USED option is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<WearStartStep {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByText('Already Ridden'));

      expect(onSelect).toHaveBeenCalledWith('USED');
    });

    it('calls onSelect when MIXED option is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<WearStartStep {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByText("I'll fine-tune later"));

      expect(onSelect).toHaveBeenCalledWith('MIXED');
    });

    it('highlights selected option', () => {
      const { rerender } = render(<WearStartStep {...defaultProps} selected="USED" />);

      // The selected option should have accent styling
      const usedButton = screen.getByText('Already Ridden').closest('button');
      expect(usedButton).toHaveClass('border-accent');

      // Non-selected options should have default styling
      const newButton = screen.getByText('Start Fresh').closest('button');
      expect(newButton).toHaveClass('border-app');

      // Rerender with different selection
      rerender(<WearStartStep {...defaultProps} selected="NEW" />);

      const newButtonAfter = screen.getByText('Start Fresh').closest('button');
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
