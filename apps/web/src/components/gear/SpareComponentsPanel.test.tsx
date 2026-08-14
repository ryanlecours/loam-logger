import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpareComponentsPanel } from './SpareComponentsPanel';

const noop = () => undefined;

const spare = (over: Partial<{ id: string; type: string; brand: string; model: string; isStock: boolean }> = {}) => ({
  id: 'spare-1',
  type: 'FORK',
  brand: 'Fox',
  model: '36',
  isStock: false,
  bikeId: null,
  hoursUsed: 0,
  ...over,
});

const renderPanel = (components: ReturnType<typeof spare>[]) =>
  render(
    <SpareComponentsPanel
      components={components}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onAdd={noop}
    />
  );

describe('SpareComponentsPanel', () => {
  it('renders a friendly label for a known type', () => {
    renderPanel([spare({ type: 'BRAKE_ROTOR' })]);

    expect(screen.getByText('Brake Rotors')).toBeInTheDocument();
  });

  // Motor and battery can only be INSTALLED on an e-bike, but inventory is
  // deliberately ungated: a rider can hold a spare before the bike arrives or
  // between e-bikes. This panel is therefore exactly where an unassigned one
  // lands, and it has its own label map separate from constants/componentLabels,
  // so a type added there does not automatically render correctly here.
  describe('e-bike spares', () => {
    it('labels a spare motor rather than falling back to the raw enum', () => {
      renderPanel([spare({ id: 'spare-motor', type: 'MOTOR', brand: 'Bosch', model: 'Performance Line CX' })]);

      expect(screen.getByText('Motor')).toBeInTheDocument();
      expect(screen.queryByText('MOTOR')).not.toBeInTheDocument();
    });

    it('labels a spare battery rather than falling back to the raw enum', () => {
      renderPanel([spare({ id: 'spare-battery', type: 'BATTERY', brand: 'Bosch', model: 'PowerTube 750' })]);

      expect(screen.getByText('Battery')).toBeInTheDocument();
      expect(screen.queryByText('BATTERY')).not.toBeInTheDocument();
    });

    it('renders both alongside conventional spares', () => {
      renderPanel([
        spare({ id: 's1', type: 'FORK' }),
        spare({ id: 's2', type: 'MOTOR' }),
        spare({ id: 's3', type: 'BATTERY' }),
      ]);

      expect(screen.getByText('Fork')).toBeInTheDocument();
      expect(screen.getByText('Motor')).toBeInTheDocument();
      expect(screen.getByText('Battery')).toBeInTheDocument();
    });
  });
});
