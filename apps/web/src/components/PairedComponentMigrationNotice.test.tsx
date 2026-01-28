import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PairedComponentMigrationNotice } from './PairedComponentMigrationNotice';

// Mock the Modal component
vi.mock('./ui/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        {children}
      </div>
    ) : null,
}));

// Mock Button component
vi.mock('./ui/Button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    size,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

describe('PairedComponentMigrationNotice', () => {
  const defaultProps = {
    isOpen: true,
    onReviewNow: vi.fn(),
    onMaybeLater: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when isOpen is true', () => {
    it('should render the modal', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('should display the title', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      expect(screen.getByText('Component Tracking Update')).toBeInTheDocument();
    });

    it('should display Front & Rear Tracking heading', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      expect(screen.getByText('Front & Rear Tracking')).toBeInTheDocument();
    });

    it('should list all paired component types', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      expect(screen.getByText('Tires')).toBeInTheDocument();
      expect(screen.getByText('Brake Pads')).toBeInTheDocument();
      expect(screen.getByText('Brake Rotors')).toBeInTheDocument();
      expect(screen.getByText('Brakes')).toBeInTheDocument();
    });

    it('should display explanation about duplicated components', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      expect(
        screen.getByText(/Your existing components have been duplicated as "same front & rear" by default/)
      ).toBeInTheDocument();
    });

    it('should display instructions about updating different components', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      expect(
        screen.getByText(/If your front and rear components are different/)
      ).toBeInTheDocument();
    });
  });

  describe('when isOpen is false', () => {
    it('should not render the modal', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });
  });

  describe('button interactions', () => {
    it('should call onMaybeLater when Maybe Later button is clicked', () => {
      const onMaybeLater = vi.fn();
      render(
        <PairedComponentMigrationNotice
          {...defaultProps}
          onMaybeLater={onMaybeLater}
        />
      );

      fireEvent.click(screen.getByText('Maybe Later'));

      expect(onMaybeLater).toHaveBeenCalledTimes(1);
    });

    it('should call onReviewNow when Review Components Now button is clicked', () => {
      const onReviewNow = vi.fn();
      render(
        <PairedComponentMigrationNotice
          {...defaultProps}
          onReviewNow={onReviewNow}
        />
      );

      fireEvent.click(screen.getByText('Review Components Now'));

      expect(onReviewNow).toHaveBeenCalledTimes(1);
    });

    it('should call onMaybeLater when modal close button is clicked', () => {
      const onMaybeLater = vi.fn();
      render(
        <PairedComponentMigrationNotice
          {...defaultProps}
          onMaybeLater={onMaybeLater}
        />
      );

      fireEvent.click(screen.getByTestId('modal-close'));

      expect(onMaybeLater).toHaveBeenCalledTimes(1);
    });
  });

  describe('button styling', () => {
    it('should render Maybe Later button with outline variant and sm size', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      const maybeLaterButton = screen.getByText('Maybe Later');
      expect(maybeLaterButton).toHaveAttribute('data-variant', 'outline');
      expect(maybeLaterButton).toHaveAttribute('data-size', 'sm');
    });

    it('should render Review Components Now button with primary variant and sm size', () => {
      render(<PairedComponentMigrationNotice {...defaultProps} />);

      const reviewButton = screen.getByText('Review Components Now');
      expect(reviewButton).toHaveAttribute('data-variant', 'primary');
      expect(reviewButton).toHaveAttribute('data-size', 'sm');
    });
  });
});
