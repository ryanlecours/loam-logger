import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BikeSpecsGrid, EbikeSpecsGrid } from './BikeSpecsGrid';

describe('BikeSpecsGrid', () => {
  const createBike = (overrides = {}) => ({
    id: 'bike-1',
    ...overrides,
  });

  describe('rendering', () => {
    it('always renders with fork and shock travel (shows -- when null)', () => {
      render(<BikeSpecsGrid bike={createBike()} />);

      expect(screen.getByText('Fork Travel')).toBeInTheDocument();
      expect(screen.getByText('Shock Travel')).toBeInTheDocument();
      // Shows "--" for null values
      expect(screen.getAllByText('--')).toHaveLength(2);
    });

    it('renders section title', () => {
      render(<BikeSpecsGrid bike={createBike()} />);

      expect(screen.getByText('Specifications')).toBeInTheDocument();
    });
  });

  describe('fork travel', () => {
    it('renders fork travel value when present', () => {
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: 160 })} />);

      expect(screen.getByText('Fork Travel')).toBeInTheDocument();
      expect(screen.getByText('160mm')).toBeInTheDocument();
    });

    it('shows -- when fork travel is null', () => {
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: null })} />);

      expect(screen.getByText('Fork Travel')).toBeInTheDocument();
      // First "--" is for fork travel
      expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('shock travel', () => {
    it('renders shock travel value when present', () => {
      render(<BikeSpecsGrid bike={createBike({ travelShockMm: 150 })} />);

      expect(screen.getByText('Shock Travel')).toBeInTheDocument();
      expect(screen.getByText('150mm')).toBeInTheDocument();
    });

    it('shows -- when shock travel is null', () => {
      render(<BikeSpecsGrid bike={createBike({ travelShockMm: null })} />);

      expect(screen.getByText('Shock Travel')).toBeInTheDocument();
      expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('model', () => {
    it('renders model when present', () => {
      render(<BikeSpecsGrid bike={createBike({ model: 'Slash' })} />);

      expect(screen.getByText('Model')).toBeInTheDocument();
      expect(screen.getByText('Slash')).toBeInTheDocument();
    });

    it('does not render model when null', () => {
      render(<BikeSpecsGrid bike={createBike({ model: null })} />);

      expect(screen.queryByText('Model')).not.toBeInTheDocument();
    });
  });

  describe('editable specs', () => {
    it('calls onEditTravel when fork spec is clicked', async () => {
      const user = userEvent.setup();
      const onEditTravel = vi.fn();
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: 160 })} onEditTravel={onEditTravel} />);

      const forkSpec = screen.getByText('Fork Travel').closest('.bike-spec-item');
      await user.click(forkSpec!);

      expect(onEditTravel).toHaveBeenCalledWith('fork');
    });

    it('calls onEditTravel when shock spec is clicked', async () => {
      const user = userEvent.setup();
      const onEditTravel = vi.fn();
      render(<BikeSpecsGrid bike={createBike({ travelShockMm: 150 })} onEditTravel={onEditTravel} />);

      const shockSpec = screen.getByText('Shock Travel').closest('.bike-spec-item');
      await user.click(shockSpec!);

      expect(onEditTravel).toHaveBeenCalledWith('shock');
    });

    it('handles keyboard activation with Enter', async () => {
      const user = userEvent.setup();
      const onEditTravel = vi.fn();
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: 160 })} onEditTravel={onEditTravel} />);

      const forkSpec = screen.getByText('Fork Travel').closest('.bike-spec-item');
      forkSpec!.focus();
      await user.keyboard('{Enter}');

      expect(onEditTravel).toHaveBeenCalledWith('fork');
    });

    it('handles keyboard activation with Space', async () => {
      const user = userEvent.setup();
      const onEditTravel = vi.fn();
      render(<BikeSpecsGrid bike={createBike({ travelShockMm: 150 })} onEditTravel={onEditTravel} />);

      const shockSpec = screen.getByText('Shock Travel').closest('.bike-spec-item');
      shockSpec!.focus();
      await user.keyboard(' ');

      expect(onEditTravel).toHaveBeenCalledWith('shock');
    });

    it('adds editable class when onEditTravel is provided', () => {
      const onEditTravel = vi.fn();
      render(<BikeSpecsGrid bike={createBike()} onEditTravel={onEditTravel} />);

      const forkSpec = screen.getByText('Fork Travel').closest('.bike-spec-item');
      expect(forkSpec).toHaveClass('bike-spec-item--editable');
    });

    it('does not add editable class when onEditTravel is not provided', () => {
      render(<BikeSpecsGrid bike={createBike()} />);

      const forkSpec = screen.getByText('Fork Travel').closest('.bike-spec-item');
      expect(forkSpec).not.toHaveClass('bike-spec-item--editable');
    });
  });

  describe('multiple specs', () => {
    it('renders fork travel, shock travel, and model when all present', () => {
      render(
        <BikeSpecsGrid
          bike={createBike({
            travelForkMm: 160,
            travelShockMm: 150,
            model: 'Slash',
          })}
        />
      );

      expect(screen.getByText('Fork Travel')).toBeInTheDocument();
      expect(screen.getByText('160mm')).toBeInTheDocument();
      expect(screen.getByText('Shock Travel')).toBeInTheDocument();
      expect(screen.getByText('150mm')).toBeInTheDocument();
      expect(screen.getByText('Model')).toBeInTheDocument();
      expect(screen.getByText('Slash')).toBeInTheDocument();
    });
  });
});

describe('EbikeSpecsGrid', () => {
  const createBike = (overrides = {}) => ({
    id: 'bike-1',
    isEbike: true,
    ...overrides,
  });

  describe('rendering', () => {
    it('returns null when not an e-bike', () => {
      const { container } = render(
        <EbikeSpecsGrid bike={createBike({ isEbike: false })} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('returns null when e-bike has no specs', () => {
      const { container } = render(<EbikeSpecsGrid bike={createBike()} />);

      expect(container.firstChild).toBeNull();
    });

    it('renders section title when e-bike specs exist', () => {
      render(<EbikeSpecsGrid bike={createBike({ motorPowerW: 250 })} />);

      expect(screen.getByText('E-Bike Specifications')).toBeInTheDocument();
    });
  });

  describe('motor', () => {
    it('renders motor name when maker and model present', () => {
      render(
        <EbikeSpecsGrid
          bike={createBike({ motorMaker: 'Shimano', motorModel: 'EP8' })}
        />
      );

      expect(screen.getByText('Motor')).toBeInTheDocument();
      expect(screen.getByText('Shimano EP8')).toBeInTheDocument();
    });

    it('renders only motor maker when model is missing', () => {
      render(<EbikeSpecsGrid bike={createBike({ motorMaker: 'Bosch' })} />);

      expect(screen.getByText('Motor')).toBeInTheDocument();
      expect(screen.getByText('Bosch')).toBeInTheDocument();
    });

    it('renders only motor model when maker is missing', () => {
      render(<EbikeSpecsGrid bike={createBike({ motorModel: 'Performance CX' })} />);

      expect(screen.getByText('Motor')).toBeInTheDocument();
      expect(screen.getByText('Performance CX')).toBeInTheDocument();
    });
  });

  describe('power', () => {
    it('renders motor power when present', () => {
      render(<EbikeSpecsGrid bike={createBike({ motorPowerW: 250 })} />);

      expect(screen.getByText('Power')).toBeInTheDocument();
      expect(screen.getByText('250W')).toBeInTheDocument();
    });
  });

  describe('torque', () => {
    it('renders motor torque when present', () => {
      render(<EbikeSpecsGrid bike={createBike({ motorTorqueNm: 85 })} />);

      expect(screen.getByText('Torque')).toBeInTheDocument();
      expect(screen.getByText('85Nm')).toBeInTheDocument();
    });
  });

  describe('battery', () => {
    it('renders battery capacity when present', () => {
      render(<EbikeSpecsGrid bike={createBike({ batteryWh: 625 })} />);

      expect(screen.getByText('Battery')).toBeInTheDocument();
      expect(screen.getByText('625Wh')).toBeInTheDocument();
    });
  });

  describe('all specs', () => {
    it('renders all e-bike specs when present', () => {
      render(
        <EbikeSpecsGrid
          bike={createBike({
            motorMaker: 'Shimano',
            motorModel: 'EP8',
            motorPowerW: 250,
            motorTorqueNm: 85,
            batteryWh: 630,
          })}
        />
      );

      expect(screen.getByText('Motor')).toBeInTheDocument();
      expect(screen.getByText('Power')).toBeInTheDocument();
      expect(screen.getByText('Torque')).toBeInTheDocument();
      expect(screen.getByText('Battery')).toBeInTheDocument();
    });
  });
});
