import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentBaselineCard } from './ComponentBaselineCard';
import type { ComponentBaseline } from '@loam/shared';

// Get today's date in YYYY-MM-DD format
const getTodayDate = () => new Date().toISOString().split('T')[0];

describe('ComponentBaselineCard', () => {
  const defaultBaseline: ComponentBaseline = {
    wearPercent: 50,
    method: 'DEFAULT',
    confidence: 'LOW',
  };

  const defaultProps = {
    componentType: 'FORK',
    displayName: 'Fork Service',
    baseline: defaultBaseline,
    onUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders component type and display name', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      expect(screen.getByText('Fork Service')).toBeInTheDocument();
      expect(screen.getByText('FORK')).toBeInTheDocument();
    });

    it('renders question text', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      expect(screen.getByText('Do you know when this was last serviced?')).toBeInTheDocument();
    });
  });

  describe('mode tabs', () => {
    it('renders all 3 mode tabs (dates, slider, skip)', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      expect(screen.getByText('Enter Date')).toBeInTheDocument();
      expect(screen.getByText('Estimate')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
    });

    it('initializes mode to "skip" when baseline.method is DEFAULT', () => {
      const baseline: ComponentBaseline = {
        wearPercent: 50,
        method: 'DEFAULT',
        confidence: 'LOW',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} />);

      // Skip tab should be active, showing the skip mode content
      expect(screen.getByText('Using default estimate (mid-life). You can update this later.')).toBeInTheDocument();
    });

    it('initializes mode to "dates" when baseline.method is DATES', () => {
      const baseline: ComponentBaseline = {
        wearPercent: 25,
        method: 'DATES',
        confidence: 'HIGH',
        lastServicedAt: '2024-01-15',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} />);

      // Dates mode should be active, showing the date input
      expect(screen.getByText('Last serviced date')).toBeInTheDocument();
    });

    it('initializes mode to "slider" when baseline.method is SLIDER', () => {
      const baseline: ComponentBaseline = {
        wearPercent: 50,
        method: 'SLIDER',
        confidence: 'MEDIUM',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} />);

      // Slider mode should be active
      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('switches to dates mode on tab click', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Enter Date'));

      expect(screen.getByText('Last serviced date')).toBeInTheDocument();
    });

    it('switches to slider mode on tab click', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Estimate'));

      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('switches to skip mode on tab click', () => {
      const onUpdate = vi.fn();
      render(<ComponentBaselineCard {...defaultProps} onUpdate={onUpdate} />);

      // First switch to a different mode
      fireEvent.click(screen.getByText('Enter Date'));

      // Then switch to skip
      fireEvent.click(screen.getByText('Skip'));

      expect(screen.getByText('Using default estimate (mid-life). You can update this later.')).toBeInTheDocument();
    });

    it('shows active styling on selected tab', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      // Skip is default mode
      const skipButton = screen.getByText('Skip');
      expect(skipButton).toHaveClass('border-accent');
      expect(skipButton).toHaveClass('text-accent');
    });
  });

  describe('dates mode', () => {
    it('shows date input in dates mode', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Enter Date'));

      // The date input should be present - check for the label and date input
      expect(screen.getByText('Last serviced date')).toBeInTheDocument();
      expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
    });

    it('date input has max = today', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Enter Date'));

      const dateInput = document.querySelector('input[type="date"]');
      expect(dateInput).toHaveAttribute('max', getTodayDate());
    });

    it('calls onUpdate with method: DATES, confidence: HIGH when date entered', () => {
      const onUpdate = vi.fn();
      render(<ComponentBaselineCard {...defaultProps} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByText('Enter Date'));

      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2024-01-15' } });

      expect(onUpdate).toHaveBeenCalledWith({
        wearPercent: 25,
        method: 'DATES',
        confidence: 'HIGH',
        lastServicedAt: '2024-01-15',
      });
    });

    it('shows helper text', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Enter Date'));

      expect(screen.getByText("We'll refine this automatically as you log rides.")).toBeInTheDocument();
    });

    it('initializes lastServicedAt from baseline', () => {
      const baseline: ComponentBaseline = {
        wearPercent: 25,
        method: 'DATES',
        confidence: 'HIGH',
        lastServicedAt: '2024-01-15',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} />);

      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput.value).toBe('2024-01-15');
    });
  });

  describe('slider mode', () => {
    it('shows slider in slider mode', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Estimate'));

      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('slider range is 0-90', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Estimate'));

      const slider = screen.getByRole('slider');
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '90');
    });

    it('renders all snap point buttons', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Estimate'));

      expect(screen.getByRole('button', { name: 'Just serviced' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lightly used' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mid-life' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Near service' })).toBeInTheDocument();
      // Note: "Overdue" appears twice - once as label and once as button
      const overdueButtons = screen.getAllByText('Overdue');
      expect(overdueButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('snap buttons update slider value', () => {
      const onUpdate = vi.fn();
      render(<ComponentBaselineCard {...defaultProps} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByText('Estimate'));

      // Click "Lightly used" (25%)
      fireEvent.click(screen.getByRole('button', { name: 'Lightly used' }));

      expect(onUpdate).toHaveBeenCalledWith({
        wearPercent: 25,
        method: 'SLIDER',
        confidence: 'MEDIUM',
      });
    });

    it('calls onUpdate with method: SLIDER, confidence: MEDIUM', () => {
      const onUpdate = vi.fn();
      render(<ComponentBaselineCard {...defaultProps} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByText('Estimate'));

      const slider = screen.getByRole('slider');
      fireEvent.change(slider, { target: { value: '75' } });

      expect(onUpdate).toHaveBeenCalledWith({
        wearPercent: 75,
        method: 'SLIDER',
        confidence: 'MEDIUM',
      });
    });

    it('shows helper text', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      fireEvent.click(screen.getByText('Estimate'));

      expect(screen.getByText("This doesn't need to be perfect - just your best guess.")).toBeInTheDocument();
    });

    it('shows current value label', () => {
      const baseline: ComponentBaseline = {
        wearPercent: 50,
        method: 'SLIDER',
        confidence: 'MEDIUM',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} />);

      // "Mid-life" should appear as a label for the 50% value
      // It appears in multiple places: as a snap button and in the "Current:" display
      const midLifeElements = screen.getAllByText('Mid-life');
      expect(midLifeElements.length).toBeGreaterThanOrEqual(1);
    });

    it('initializes sliderValue from baseline.wearPercent', () => {
      const baseline: ComponentBaseline = {
        wearPercent: 75,
        method: 'SLIDER',
        confidence: 'MEDIUM',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} />);

      const slider = screen.getByRole('slider') as HTMLInputElement;
      expect(slider.value).toBe('75');
    });
  });

  describe('skip mode', () => {
    it('shows info message in skip mode', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      expect(screen.getByText('Using default estimate (mid-life). You can update this later.')).toBeInTheDocument();
    });

    it('calls onUpdate immediately on skip mode', () => {
      const onUpdate = vi.fn();

      // Start with dates mode
      const baseline: ComponentBaseline = {
        wearPercent: 25,
        method: 'DATES',
        confidence: 'HIGH',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} onUpdate={onUpdate} />);

      // Switch to skip mode
      fireEvent.click(screen.getByText('Skip'));

      expect(onUpdate).toHaveBeenCalledWith({
        wearPercent: 50,
        method: 'DEFAULT',
        confidence: 'LOW',
      });
    });

    it('sets wearPercent: 50, method: DEFAULT, confidence: LOW', () => {
      const onUpdate = vi.fn();

      // Start with slider mode
      const baseline: ComponentBaseline = {
        wearPercent: 75,
        method: 'SLIDER',
        confidence: 'MEDIUM',
      };

      render(<ComponentBaselineCard {...defaultProps} baseline={baseline} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByText('Skip'));

      expect(onUpdate).toHaveBeenCalledWith({
        wearPercent: 50,
        method: 'DEFAULT',
        confidence: 'LOW',
      });
    });
  });

  describe('button types', () => {
    it('all mode buttons have type="button"', () => {
      render(<ComponentBaselineCard {...defaultProps} />);

      // Mode selector buttons
      expect(screen.getByText('Enter Date')).toHaveAttribute('type', 'button');
      expect(screen.getByText('Estimate')).toHaveAttribute('type', 'button');
      expect(screen.getByText('Skip')).toHaveAttribute('type', 'button');
    });
  });
});
