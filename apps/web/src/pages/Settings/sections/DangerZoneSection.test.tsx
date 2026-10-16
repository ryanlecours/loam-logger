import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DangerZoneSection from './DangerZoneSection';

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock('@/lib/csrf', () => ({
  getAuthHeaders: () => ({ 'Content-Type': 'application/json' }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

async function confirmDeletion() {
  render(<DangerZoneSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  // The modal's confirm button shares the label with the section's button.
  const buttons = await screen.findAllByRole('button', { name: 'Delete Account' });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe('DangerZoneSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows the API error text when deletion is blocked by billing', async () => {
    const message =
      "We couldn't cancel your Loam Logger Pro subscription, so your account has not been deleted. Please try again in a few minutes.";
    mockFetch.mockResolvedValue(jsonResponse(503, { error: message, code: 'BILLING_CANCELLATION_FAILED' }));

    await confirmDeletion();

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(message));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('falls back to a message field', async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { message: 'Some data could not be removed' }));

    await confirmDeletion();

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Some data could not be removed'));
  });

  it('shows the generic message when the error body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    await confirmDeletion();

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to delete account'));
  });

  it('confirms success when the account is deleted', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true, message: 'Account successfully deleted' }));

    await confirmDeletion();

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
