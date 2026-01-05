import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AcquisitionConditionStep } from './AcquisitionConditionStep';

describe('AcquisitionConditionStep', () => {
  const defaultProps = {
    selected: null,
    onSelect: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders all 3 condition options (NEW, USED, MIXED)', () => {
      render(<AcquisitionConditionStep {...defaultProps} />);

      expect(screen.getByText('Brand New')).toBeInTheDocument();
      expect(screen.getByText('Used Bike')).toBeInTheDocument();
      expect(screen.getByText('Mixed / Not Sure')).toBeInTheDocument();
    });

    it('renders correct titles and descriptions', () => {
      render(<AcquisitionConditionStep {...defaultProps} />);

      // NEW
      expect(screen.getByText('Brand New')).toBeInTheDocument();
      expect(screen.getByText('Just purchased or built, all components are fresh')).toBeInTheDocument();

      // USED
      expect(screen.getByText('Used Bike')).toBeInTheDocument();
      expect(screen.getByText('Previously ridden, components have some wear')).toBeInTheDocument();

      // MIXED
      expect(screen.getByText('Mixed / Not Sure')).toBeInTheDocument();
      expect(screen.getByText('Some components replaced recently, others unknown')).toBeInTheDocument();
    });

    it('renders icons for each condition', () => {
      render(<AcquisitionConditionStep {...defaultProps} />);

      expect(screen.getByText('✨')).toBeInTheDocument();
      expect(screen.getByText('🔧')).toBeInTheDocument();
      expect(screen.getByText('🔄')).toBeInTheDocument();
    });

    it('renders Back and Continue buttons', () => {
      render(<AcquisitionConditionStep {...defaultProps} />);

      expect(screen.getByText('Back')).toBeInTheDocument();
      expect(screen.getByText('Continue')).toBeInTheDocument();
    });

    it('renders heading and helper text', () => {
      render(<AcquisitionConditionStep {...defaultProps} />);

      expect(screen.getByText('Is this bike brand new?')).toBeInTheDocument();
      expect(screen.getByText('This helps us set accurate service tracking for your components')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('calls onSelect with "NEW" when NEW clicked', () => {
      const onSelect = vi.fn();
      render(<AcquisitionConditionStep {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Brand New'));

      expect(onSelect).toHaveBeenCalledWith('NEW');
    });

    it('calls onSelect with "USED" when USED clicked', () => {
      const onSelect = vi.fn();
      render(<AcquisitionConditionStep {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Used Bike'));

      expect(onSelect).toHaveBeenCalledWith('USED');
    });

    it('calls onSelect with "MIXED" when MIXED clicked', () => {
      const onSelect = vi.fn();
      render(<AcquisitionConditionStep {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Mixed / Not Sure'));

      expect(onSelect).toHaveBeenCalledWith('MIXED');
    });

    it('applies selected styling to selected condition', () => {
      render(<AcquisitionConditionStep {...defaultProps} selected="NEW" />);

      // Find the button containing "Brand New"
      const newButton = screen.getByText('Brand New').closest('button');

      // Check for selected class pattern
      expect(newButton).toHaveClass('border-accent');
      expect(newButton).toHaveClass('bg-accent/10');
    });

    it('applies default styling to unselected conditions', () => {
      render(<AcquisitionConditionStep {...defaultProps} selected="NEW" />);

      // USED should have default styling
      const usedButton = screen.getByText('Used Bike').closest('button');

      expect(usedButton).toHaveClass('border-app');
      expect(usedButton).not.toHaveClass('border-accent');
    });
  });

  describe('navigation', () => {
    it('calls onBack when Back button clicked', () => {
      const onBack = vi.fn();
      render(<AcquisitionConditionStep {...defaultProps} onBack={onBack} />);

      fireEvent.click(screen.getByText('Back'));

      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('disables Continue when selected is null', () => {
      render(<AcquisitionConditionStep {...defaultProps} selected={null} />);

      const continueButton = screen.getByText('Continue');
      expect(continueButton).toBeDisabled();
    });

    it('enables Continue when selected is not null', () => {
      render(<AcquisitionConditionStep {...defaultProps} selected="NEW" />);

      const continueButton = screen.getByText('Continue');
      expect(continueButton).not.toBeDisabled();
    });

    it('calls onContinue when Continue clicked', () => {
      const onContinue = vi.fn();
      render(
        <AcquisitionConditionStep
          {...defaultProps}
          selected="USED"
          onContinue={onContinue}
        />
      );

      fireEvent.click(screen.getByText('Continue'));

      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('does not call onContinue when Continue is disabled', () => {
      const onContinue = vi.fn();
      render(
        <AcquisitionConditionStep
          {...defaultProps}
          selected={null}
          onContinue={onContinue}
        />
      );

      // Click the disabled button
      fireEvent.click(screen.getByText('Continue'));

      // Should not be called because button is disabled
      expect(onContinue).not.toHaveBeenCalled();
    });
  });

  describe('button types', () => {
    it('all buttons have type="button" to prevent form submission', () => {
      render(<AcquisitionConditionStep {...defaultProps} />);

      const buttons = screen.getAllByRole('button');

      buttons.forEach((button) => {
        expect(button).toHaveAttribute('type', 'button');
      });
    });
  });
});
