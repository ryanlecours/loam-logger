import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailVerificationBanner from './EmailVerificationBanner';

const mockUseQuery = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  gql: vi.fn((strings: TemplateStringsArray) => strings.join('')),
}));

const mockFetch = vi.fn();

function viewer(needsEmailVerification: boolean | undefined) {
  mockUseQuery.mockReturnValue({
    data: { me: { id: 'u1', email: 'rider@example.com', needsEmailVerification } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

describe('EmailVerificationBanner', () => {
  it('renders nothing for a verified account', () => {
    viewer(false);
    const { container } = render(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the query failed (API without the field)', () => {
    mockUseQuery.mockReturnValue({ data: undefined, error: new Error('Cannot query field') });
    const { container } = render(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks an unverified rider to confirm and resends on request', async () => {
    viewer(true);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    render(<EmailVerificationBanner />);
    expect(screen.getByText(/We sent a link to rider@example.com/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));

    expect(await screen.findByText(/Sent\. Check rider@example.com/)).toBeInTheDocument();
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/auth\/resend-verification$/);
  });

  it('shows the server message when the resend is refused', async () => {
    viewer(true);
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Too many verification emails.' }) });

    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));

    expect(await screen.findByText('Too many verification emails.')).toBeInTheDocument();
  });
});
