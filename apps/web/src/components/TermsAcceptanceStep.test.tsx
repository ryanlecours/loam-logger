import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TermsAcceptanceStep } from './TermsAcceptanceStep';

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Mock Apollo Client
const mockAcceptTerms = vi.fn();
const mockRefetchQueries = vi.fn();

vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockAcceptTerms, { loading: false }]),
  useApolloClient: vi.fn(() => ({
    refetchQueries: mockRefetchQueries,
  })),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock the terms content to avoid rendering the full legal text
vi.mock('../legal/terms', () => ({
  TERMS_VERSION: '1.2.0',
  TERMS_LAST_UPDATED: 'January 2026',
  TERMS_TEXT: `# Test Terms

These are test terms and conditions.

## Section 1

Some terms here.

## Section 2

More terms here.`,
}));

describe('TermsAcceptanceStep', () => {
  const defaultProps = {
    onComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcceptTerms.mockResolvedValue({
      data: {
        acceptTerms: {
          success: true,
          acceptedAt: new Date().toISOString(),
        },
      },
    });
    mockRefetchQueries.mockResolvedValue([]);
  });

  describe('rendering', () => {
    it('renders the terms header', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      expect(screen.getByText('Terms & Conditions')).toBeInTheDocument();
      expect(screen.getByText(/Last Updated:/)).toBeInTheDocument();
    });

    it('renders the scrollable terms container', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      // Terms content should be visible
      expect(screen.getByText('Test Terms')).toBeInTheDocument();
    });

    it('renders the checkbox with legal wording', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      expect(
        screen.getByText(/I have read and understood the Loam Logger Terms & Conditions/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Mandatory Arbitration and Class Action Waiver/)
      ).toBeInTheDocument();
    });

    it('renders the submit button', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Agree and Continue' })).toBeInTheDocument();
    });

    it('shows scroll helper text initially', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      expect(screen.getByText('Scroll to the end to enable acceptance.')).toBeInTheDocument();
    });
  });

  describe('scroll detection', () => {
    it('should disable checkbox until scrolled', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeDisabled();
    });

    it('should enable checkbox after scroll to bottom', async () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeDisabled();

      // Simulate scroll to bottom
      // Find the scrollable container and trigger scroll event
      const scrollContainer = screen.getByText('Test Terms').closest('div');
      if (scrollContainer) {
        // Mock the scroll properties to indicate bottom reached
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 1000, configurable: true });
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1400, configurable: true });

        fireEvent.scroll(scrollContainer);
      }

      await waitFor(() => {
        expect(screen.getByRole('checkbox')).not.toBeDisabled();
      });
    });
  });

  describe('checkbox and button states', () => {
    it('should disable submit until checkbox is checked', async () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      // First enable by scrolling
      const scrollContainer = screen.getByText('Test Terms').closest('div');
      if (scrollContainer) {
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 1000, configurable: true });
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1400, configurable: true });
        fireEvent.scroll(scrollContainer);
      }

      await waitFor(() => {
        expect(screen.getByRole('checkbox')).not.toBeDisabled();
      });

      // Button should still be disabled (checkbox not checked)
      const button = screen.getByRole('button', { name: 'Agree and Continue' });
      expect(button).toBeDisabled();

      // Check the checkbox
      fireEvent.click(screen.getByRole('checkbox'));

      // Now button should be enabled
      expect(button).not.toBeDisabled();
    });

    it('should uncheck checkbox to disable button again', async () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      // Enable scrolling and check
      const scrollContainer = screen.getByText('Test Terms').closest('div');
      if (scrollContainer) {
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 1000, configurable: true });
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1400, configurable: true });
        fireEvent.scroll(scrollContainer);
      }

      await waitFor(() => {
        expect(screen.getByRole('checkbox')).not.toBeDisabled();
      });

      const checkbox = screen.getByRole('checkbox');
      const button = screen.getByRole('button', { name: 'Agree and Continue' });

      // Check then uncheck
      fireEvent.click(checkbox);
      expect(button).not.toBeDisabled();

      fireEvent.click(checkbox);
      expect(button).toBeDisabled();
    });
  });

  describe('submission', () => {
    const enableAndCheck = async () => {
      const scrollContainer = screen.getByText('Test Terms').closest('div');
      if (scrollContainer) {
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 1000, configurable: true });
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1400, configurable: true });
        fireEvent.scroll(scrollContainer);
      }

      await waitFor(() => {
        expect(screen.getByRole('checkbox')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('checkbox'));
    };

    it('should call onComplete after successful submission', async () => {
      const onComplete = vi.fn();
      render(<TermsAcceptanceStep onComplete={onComplete} />);

      await enableAndCheck();

      const button = screen.getByRole('button', { name: 'Agree and Continue' });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockAcceptTerms).toHaveBeenCalledWith({
          variables: {
            input: { termsVersion: '1.2.0' },
          },
        });
      });

      await waitFor(() => {
        expect(mockRefetchQueries).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });
    });

    it('should handle submission errors', async () => {
      mockAcceptTerms.mockRejectedValue(new Error('Network error'));

      render(<TermsAcceptanceStep {...defaultProps} />);

      await enableAndCheck();

      const button = screen.getByRole('button', { name: 'Agree and Continue' });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      // onComplete should NOT have been called
      expect(defaultProps.onComplete).not.toHaveBeenCalled();
    });

    it('should show generic error message for non-Error exceptions', async () => {
      mockAcceptTerms.mockRejectedValue('Unknown error');

      render(<TermsAcceptanceStep {...defaultProps} />);

      await enableAndCheck();

      const button = screen.getByRole('button', { name: 'Agree and Continue' });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Failed to accept terms. Please try again.')).toBeInTheDocument();
      });
    });
  });

  describe('button type', () => {
    it('submit button has type="button" to prevent form submission', () => {
      render(<TermsAcceptanceStep {...defaultProps} />);

      const button = screen.getByRole('button', { name: 'Agree and Continue' });
      expect(button).toHaveAttribute('type', 'button');
    });
  });
});
