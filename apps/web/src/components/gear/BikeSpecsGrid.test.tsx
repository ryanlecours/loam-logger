import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BikeSpecsGrid, EbikeSpecsGrid } from './BikeSpecsGrid';

describe('BikeSpecsGrid', () => {
  const createBike = (overrides = {}) => ({
    id: 'bike-1',
    ...overrides,
  });

  describe('rendering', () => {
    it('returns null when no specs are present', () => {
      const { container } = render(<BikeSpecsGrid bike={createBike()} />);

      expect(container.firstChild).toBeNull();
    });

    it('renders section title when specs exist', () => {
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: 160 })} />);

      expect(screen.getByText('Specifications')).toBeInTheDocument();
    });
  });

  describe('fork travel', () => {
    it('renders fork travel when present', () => {
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: 160 })} />);

      expect(screen.getByText('Fork Travel')).toBeInTheDocument();
      expect(screen.getByText('160mm')).toBeInTheDocument();
    });

    it('does not render fork travel when null', () => {
      render(<BikeSpecsGrid bike={createBike({ travelForkMm: null, frameMaterial: 'Carbon' })} />);

      expect(screen.queryByText('Fork Travel')).not.toBeInTheDocument();
    });
  });

  describe('shock travel', () => {
    it('renders shock travel when present', () => {
      render(<BikeSpecsGrid bike={createBike({ travelShockMm: 150 })} />);

      expect(screen.getByText('Shock Travel')).toBeInTheDocument();
      expect(screen.getByText('150mm')).toBeInTheDocument();
    });
  });

  describe('frame material', () => {
    it('renders frame material when present', () => {
      render(<BikeSpecsGrid bike={createBike({ frameMaterial: 'Carbon' })} />);

      expect(screen.getByText('Frame Material')).toBeInTheDocument();
      expect(screen.getByText('Carbon')).toBeInTheDocument();
    });
  });

  describe('hanger standard', () => {
    it('renders hanger standard when present', () => {
      render(<BikeSpecsGrid bike={createBike({ hangerStandard: 'SRAM UDH' })} />);

      expect(screen.getByText('Hanger Standard')).toBeInTheDocument();
      expect(screen.getByText('SRAM UDH')).toBeInTheDocument();
    });
  });

  describe('family', () => {
    it('renders family when present', () => {
      render(<BikeSpecsGrid bike={createBike({ family: 'Slash' })} />);

      expect(screen.getByText('Family')).toBeInTheDocument();
      expect(screen.getByText('Slash')).toBeInTheDocument();
    });
  });

  describe('build kind', () => {
    it('renders build kind when present', () => {
      render(<BikeSpecsGrid bike={createBike({ buildKind: 'Complete' })} />);

      expect(screen.getByText('Build')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
  });

  describe('gender', () => {
    it('renders fit (gender) when present', () => {
      render(<BikeSpecsGrid bike={createBike({ gender: 'Unisex' })} />);

      expect(screen.getByText('Fit')).toBeInTheDocument();
      expect(screen.getByText('Unisex')).toBeInTheDocument();
    });
  });

  describe('multiple specs', () => {
    it('renders all available specs', () => {
      render(
        <BikeSpecsGrid
          bike={createBike({
            travelForkMm: 160,
            travelShockMm: 150,
            frameMaterial: 'Carbon',
            hangerStandard: 'SRAM UDH',
          })}
        />
      );

      expect(screen.getByText('Fork Travel')).toBeInTheDocument();
      expect(screen.getByText('Shock Travel')).toBeInTheDocument();
      expect(screen.getByText('Frame Material')).toBeInTheDocument();
      expect(screen.getByText('Hanger Standard')).toBeInTheDocument();
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
