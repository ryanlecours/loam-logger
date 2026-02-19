import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SetPasswordModal from './SetPasswordModal';

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock sonner toast - use vi.hoisted to ensure proper hoisting
const { mockToastSuccess } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: vi.fn(),
  },
}));

// Mock CSRF headers
vi.mock('@/lib/csrf', () => ({
  getAuthHeaders: () => ({ 'Content-Type': 'application/json' }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const renderModal = (props: Partial<React.ComponentProps<typeof SetPasswordModal>> = {}) => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <SetPasswordModal {...defaultProps} {...props} />
    </MemoryRouter>
  );
};

describe('SetPasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders modal with title and inputs', () => {
      renderModal();

      expect(screen.getByRole('heading', { name: 'Set Password' })).toBeInTheDocument();
      expect(screen.getByText('Add a password to sign in with email')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('At least 8 characters')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Confirm your password')).toBeInTheDocument();
    });

    it('renders password requirements', () => {
      renderModal();

      expect(screen.getByText('Password requirements:')).toBeInTheDocument();
    });

    it('disables Set Password button when fields are empty', () => {
      renderModal();

      const submitButton = screen.getByRole('button', { name: 'Set Password' });
      expect(submitButton).toBeDisabled();
    });
  });

  describe('validation', () => {
    it('shows error when passwords do not match', async () => {
      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'Password123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'DifferentPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('shows error when password does not meet requirements', async () => {
      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'weak' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'weak' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      expect(await screen.findByText(/must be at least 8 characters/i)).toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('API error handling', () => {
    it('shows error on RECENT_AUTH_REQUIRED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ code: 'RECENT_AUTH_REQUIRED' }),
      });

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      expect(
        await screen.findByText('For security, please log in again to set your password. Redirecting to login...')
      ).toBeInTheDocument();
    });

    it('shows error on ALREADY_HAS_PASSWORD', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ code: 'ALREADY_HAS_PASSWORD' }),
      });

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      expect(
        await screen.findByText('You already have a password set. Use "Change Password" instead.')
      ).toBeInTheDocument();
    });

    it('shows rate limit error on 429', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      });

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      expect(
        await screen.findByText('Too many attempts. Please try again later.')
      ).toBeInTheDocument();
    });

    it('shows network error on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      expect(
        await screen.findByText('A network error occurred. Please try again.')
      ).toBeInTheDocument();
    });
  });

  describe('success flow', () => {
    it('calls onSuccess and onClose on successful submission', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      renderModal({ onSuccess, onClose });

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('shows success toast on successful submission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'Password added successfully',
          expect.any(Object)
        );
      });
    });
  });

  describe('modal controls', () => {
    it('calls onClose when Cancel button clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('form submission', () => {
    it('submits when form is submitted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      // Submit form (e.g., via Enter key - form is rendered via portal so query from document)
      const form = document.querySelector('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it('disables submit button while loading', async () => {
      // Create a promise we can control to keep the request pending
      let resolveRequest: (value: unknown) => void;
      const pendingRequest = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      mockFetch.mockReturnValueOnce(pendingRequest);

      renderModal();

      fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
        target: { value: 'ValidPassword123!' },
      });
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'ValidPassword123!' },
      });

      const submitButton = screen.getByRole('button', { name: 'Set Password' });
      expect(submitButton).not.toBeDisabled();

      // Click to start loading
      fireEvent.click(submitButton);

      // Button should now show loading state and be disabled
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Setting...' })).toBeDisabled();
      });

      // Cleanup: resolve the pending request and wait for state update
      await waitFor(async () => {
        resolveRequest!({ ok: true, json: () => Promise.resolve({ ok: true }) });
      });
    });
  });
});
