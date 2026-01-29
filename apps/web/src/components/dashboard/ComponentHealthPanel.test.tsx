import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentHealthPanel } from './ComponentHealthPanel';
import type { ComponentPrediction } from '../../types/prediction';

// Mock useHoursDisplay to avoid PreferencesProvider dependency
vi.mock('../../hooks/useHoursDisplay', () => ({
  useHoursDisplay: () => ({
    hoursDisplay: 'remaining',
    formatHoursForDisplay: () => '100h remaining',
    formatHoursCompact: () => '100h',
  }),
}));

// Mock Apollo Client useMutation for ComponentDetailOverlay
const mockLogService = vi.fn().mockResolvedValue({ data: { logComponentService: { id: 'test' } } });
vi.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings.join(''),
  useMutation: () => [mockLogService, { loading: false }],
}));

// Factory for creating test components
const createComponent = (overrides: Partial<ComponentPrediction> = {}): ComponentPrediction => ({
  componentId: `comp-${Math.random().toString(36).slice(2)}`,
  componentType: 'FORK',
  location: 'NONE',
  brand: 'RockShox',
  model: 'Pike',
  status: 'ALL_GOOD',
  hoursRemaining: 100,
  ridesRemainingEstimate: 20,
  confidence: 'HIGH',
  currentHours: 50,
  serviceIntervalHours: 150,
  hoursSinceService: 50,
  why: null,
  drivers: null,
  ...overrides,
});

describe('ComponentHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogService.mockClear();
    mockLogService.mockResolvedValue({ data: { logComponentService: { id: 'test' } } });
  });

  describe('empty state', () => {
    it('renders empty state when no components provided', () => {
      render(<ComponentHealthPanel components={[]} />);

      expect(screen.getByText('No components configured')).toBeInTheDocument();
    });

    it('shows Component Health title in empty state', () => {
      render(<ComponentHealthPanel components={[]} />);

      expect(screen.getByText('Component Health')).toBeInTheDocument();
    });
  });

  describe('component list rendering', () => {
    it('renders all components', () => {
      const components = [
        createComponent({ componentId: 'fork', componentType: 'FORK' }),
        createComponent({ componentId: 'shock', componentType: 'SHOCK' }),
        createComponent({ componentId: 'brakes', componentType: 'BRAKES', location: 'FRONT' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('Fork')).toBeInTheDocument();
      expect(screen.getByText('Rear Shock')).toBeInTheDocument();
      expect(screen.getByText('Front Brake')).toBeInTheDocument();
    });

    it('displays make/model for each component', () => {
      const components = [
        createComponent({ brand: 'RockShox', model: 'Pike' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('RockShox Pike')).toBeInTheDocument();
    });

    it('displays "Stock" when no brand or model', () => {
      const components = [
        createComponent({ brand: '', model: '' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('Stock')).toBeInTheDocument();
    });

    it('displays only brand when model is empty', () => {
      const components = [
        createComponent({ brand: 'Fox', model: '' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('Fox')).toBeInTheDocument();
    });

    it('displays only model when brand is empty', () => {
      const components = [
        createComponent({ brand: '', model: '36' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('36')).toBeInTheDocument();
    });

    it('displays hours remaining', () => {
      const components = [
        createComponent({ hoursRemaining: 42.5 }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('42.5 hrs remaining')).toBeInTheDocument();
    });

    it('displays hours since service', () => {
      const components = [
        createComponent({ hoursSinceService: 25.3 }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('25.3 hrs since service')).toBeInTheDocument();
    });

    it('displays rides remaining estimate', () => {
      const components = [
        createComponent({ ridesRemainingEstimate: 15 }),
      ];

      render(<ComponentHealthPanel components={components} />);

      expect(screen.getByText('~15 rides')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('sorts by status severity (OVERDUE first)', () => {
      const components = [
        createComponent({ componentId: 'good', componentType: 'FORK', status: 'ALL_GOOD' }),
        createComponent({ componentId: 'overdue', componentType: 'SHOCK', status: 'OVERDUE' }),
        createComponent({ componentId: 'soon', componentType: 'BRAKES', status: 'DUE_SOON' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      const buttons = screen.getAllByRole('button');
      // First button should be the OVERDUE component (Rear Shock)
      expect(buttons[0]).toHaveTextContent('Rear Shock');
    });

    it('sorts by hours remaining within same severity', () => {
      const components = [
        createComponent({ componentId: 'soon-50', componentType: 'FORK', status: 'DUE_SOON', hoursRemaining: 50 }),
        createComponent({ componentId: 'soon-10', componentType: 'SHOCK', status: 'DUE_SOON', hoursRemaining: 10 }),
        createComponent({ componentId: 'soon-30', componentType: 'BRAKES', status: 'DUE_SOON', hoursRemaining: 30 }),
      ];

      render(<ComponentHealthPanel components={components} />);

      const buttons = screen.getAllByRole('button');
      // Should be sorted by hours remaining: 10, 30, 50
      expect(buttons[0]).toHaveTextContent('Rear Shock'); // 10 hours
      expect(buttons[1]).toHaveTextContent('Brake'); // 30 hours
      expect(buttons[2]).toHaveTextContent('Fork'); // 50 hours
    });
  });

  describe('modal interactions', () => {
    it('opens modal when clicking a component row', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ componentType: 'FORK', brand: 'RockShox', model: 'Pike' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      const row = screen.getByRole('button');
      await user.click(row);

      // Modal should be open with dialog role
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes modal when clicking overlay', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ componentType: 'FORK' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      // Open modal
      await user.click(screen.getByRole('button'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Click overlay to close
      const overlay = screen.getByRole('dialog');
      await user.click(overlay);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('closes modal when clicking close button', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ componentType: 'FORK' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      // Open modal
      await user.click(screen.getByRole('button'));

      // Click close button
      const closeButton = screen.getByText('×');
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('closes modal when pressing Escape key', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ componentType: 'FORK' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      // Open modal
      await user.click(screen.getByRole('button'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Press Escape
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('does not close modal when clicking inside modal content', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ componentType: 'FORK', why: 'Test reason' }),
      ];

      render(<ComponentHealthPanel components={components} />);

      // Open modal
      await user.click(screen.getByRole('button'));

      // Click inside the modal content
      const whyText = screen.getByText('Test reason');
      await user.click(whyText);

      // Modal should still be open
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('modal content', () => {
    it('displays component stats in modal', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({
          hoursRemaining: 50,
          hoursSinceService: 30,
          currentHours: 100,
          ridesRemainingEstimate: 10,
          serviceIntervalHours: 80,
        }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText('50.0 hrs')).toBeInTheDocument();
      expect(screen.getByText('Until next service')).toBeInTheDocument();
      expect(screen.getByText('30.0 hrs')).toBeInTheDocument();
      expect(screen.getByText('Since last service')).toBeInTheDocument();
      expect(screen.getByText('80.0 hrs')).toBeInTheDocument();
      expect(screen.getByText('Service interval')).toBeInTheDocument();
      expect(screen.getByText('~10')).toBeInTheDocument();
      expect(screen.getByText('Rides remaining')).toBeInTheDocument();
    });

    it('displays why text when provided', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ why: 'Heavy use in muddy conditions' }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Heavy use in muddy conditions')).toBeInTheDocument();
    });

    it('does not display why section when null', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ why: null }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      // Modal should be open but no why section
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByText('Heavy use')).not.toBeInTheDocument();
    });

    it('displays wear factors with contribution percentages', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({
          drivers: [
            { factor: 'steepness', label: 'Steepness', contribution: 45 },
            { factor: 'hours', label: 'Hours', contribution: 30 },
          ],
        }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Wear Factors')).toBeInTheDocument();
      expect(screen.getByText('Steepness')).toBeInTheDocument();
      expect(screen.getByText('45%')).toBeInTheDocument();
      expect(screen.getByText('Hours')).toBeInTheDocument();
      expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('displays wear factor definitions', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({
          drivers: [
            { factor: 'steepness', label: 'Steepness', contribution: 45 },
          ],
        }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText(/terrain difficulty/i)).toBeInTheDocument();
    });

    it('displays fallback definition for unknown factors', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({
          drivers: [
            { factor: 'unknown_factor', label: 'Unknown', contribution: 20 },
          ],
        }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText(/contributes to overall component wear/i)).toBeInTheDocument();
    });

    it('displays empty state when no why or drivers', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ why: null, drivers: null }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText('No wear analysis available for this component.')).toBeInTheDocument();
    });

    it('displays empty state when drivers array is empty', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({ why: null, drivers: [] }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText('No wear analysis available for this component.')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('modal has role="dialog" and aria-modal="true"', async () => {
      const user = userEvent.setup();
      const components = [createComponent({})];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('modal has aria-labelledby pointing to title', async () => {
      const user = userEvent.setup();
      const components = [createComponent({})];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'component-detail-title');

      const title = document.getElementById('component-detail-title');
      expect(title).toBeInTheDocument();
    });

    it('component rows are buttons with type="button"', () => {
      const components = [createComponent({})];

      render(<ComponentHealthPanel components={components} />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('type', 'button');
    });
  });

  describe('edge cases', () => {
    it('handles negative hours remaining (overdue)', () => {
      const components = [
        createComponent({ hoursRemaining: -10 }),
      ];

      render(<ComponentHealthPanel components={components} />);

      // Should clamp to 0
      expect(screen.getByText('0.0 hrs remaining')).toBeInTheDocument();
    });

    it('handles null/undefined hours values', async () => {
      const user = userEvent.setup();
      const components = [
        createComponent({
          hoursRemaining: undefined as unknown as number,
          hoursSinceService: null as unknown as number,
        }),
      ];

      render(<ComponentHealthPanel components={components} />);
      await user.click(screen.getByRole('button'));

      // Should show placeholder for invalid values
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThan(0);
    });

    it('applies custom className', () => {
      const components = [createComponent({})];

      const { container } = render(
        <ComponentHealthPanel components={components} className="custom-class" />
      );

      expect(container.querySelector('.component-health-panel.custom-class')).toBeInTheDocument();
    });
  });
});
