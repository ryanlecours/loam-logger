import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { EmailSection } from './EmailSection';

vi.mock('@/lib/csrf', () => ({
  getAuthHeaders: () => ({ 'x-csrf-token': 'test-csrf' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Bypass the Modal portal as in the other section tests.
vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        {title && <h2>{title}</h2>}
        {children}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? 'button'}>
      {children}
    </button>
  ),
}));

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

const ANNOUNCEMENT_TEMPLATE = {
  id: 'announcement',
  displayName: 'Announcement',
  description: 'General announcement to selected users',
  defaultSubject: 'A loam-logger announcement',
  parameters: [
    {
      key: 'body',
      label: 'Body',
      type: 'textarea',
      required: true,
      defaultValue: 'Hello rider',
      helpText: 'Message body',
    },
  ],
};

function templatesResponse() {
  return new Response(
    JSON.stringify({ templates: [ANNOUNCEMENT_TEMPLATE] }),
    { status: 200 },
  );
}

function recipientsResponse(
  users: Array<{
    id: string;
    email: string;
    name: string | null;
    emailUnsubscribed?: boolean;
    isFoundingRider?: boolean;
  }>,
) {
  return new Response(
    JSON.stringify({
      users: users.map((u) => ({
        emailUnsubscribed: false,
        isFoundingRider: false,
        ...u,
      })),
    }),
    { status: 200 },
  );
}

function scheduledResponse(emails: unknown[]) {
  return new Response(JSON.stringify({ emails }), { status: 200 });
}

beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('EmailSection', () => {
  it('loads templates, recipients, and scheduled emails on mount', async () => {
    fetchMock
      .mockResolvedValueOnce(templatesResponse())
      .mockResolvedValueOnce(scheduledResponse([]))
      .mockResolvedValueOnce(
        recipientsResponse([
          { id: 'r1', email: 'r1@example.com', name: null },
          { id: 'r2', email: 'r2@example.com', name: 'Two' },
        ]),
      );

    render(<EmailSection />);

    expect(await screen.findByText('r1@example.com')).toBeInTheDocument();
    expect(screen.getByText('r2@example.com')).toBeInTheDocument();

    // Subject field is pre-populated from the template's defaultSubject.
    const subject = screen.getByLabelText('Subject') as HTMLInputElement;
    expect(subject.value).toBe('A loam-logger announcement');
  });

  it('pre-selects all non-unsubscribed recipients', async () => {
    fetchMock
      .mockResolvedValueOnce(templatesResponse())
      .mockResolvedValueOnce(scheduledResponse([]))
      .mockResolvedValueOnce(
        recipientsResponse([
          { id: 'r1', email: 'r1@example.com', name: null },
          {
            id: 'r2',
            email: 'r2@example.com',
            name: null,
            emailUnsubscribed: true,
          },
        ]),
      );

    render(<EmailSection />);

    await screen.findByText('r1@example.com');
    expect(screen.getByText('1 of 1 selected')).toBeInTheDocument();
  });

  it('changing segment refetches recipients with the right query params', async () => {
    fetchMock
      .mockResolvedValueOnce(templatesResponse())
      .mockResolvedValueOnce(scheduledResponse([]))
      .mockResolvedValueOnce(
        recipientsResponse([{ id: 'r1', email: 'r1@example.com', name: null }]),
      )
      // Refetch after segment change.
      .mockResolvedValueOnce(recipientsResponse([]));

    render(<EmailSection />);
    await screen.findByText('r1@example.com');

    fireEvent.click(screen.getByRole('button', { name: /Founding Riders/i }));

    await waitFor(() => {
      const recipientCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/admin/email/recipients'),
      );
      // Two recipient fetches by now: initial ACTIVE_ALL + the new
      // WAITLIST_FOUNDING refetch with foundingRider=true.
      expect(recipientCalls).toHaveLength(2);
      expect(String(recipientCalls[1][0])).toContain('foundingRider=true');
    });
  });

  it('Send button needs a confirm click before POSTing', async () => {
    fetchMock
      .mockResolvedValueOnce(templatesResponse())
      .mockResolvedValueOnce(scheduledResponse([]))
      .mockResolvedValueOnce(
        recipientsResponse([{ id: 'r1', email: 'r1@example.com', name: null }]),
      )
      // The send response.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: { sent: 1, failed: 0, suppressed: 0 },
            total: 1,
          }),
          { status: 200 },
        ),
      );

    render(<EmailSection />);
    await screen.findByText('r1@example.com');

    // First click flips into "Confirm Send to N recipients" — must NOT post yet.
    fireEvent.click(screen.getByRole('button', { name: /^Send Email$/ }));
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/admin/email/unified/send'),
      ),
    ).toHaveLength(0);

    // Second click confirms — now posts.
    fireEvent.click(
      screen.getByRole('button', { name: /Confirm Send to 1 recipients/ }),
    );

    await waitFor(() => {
      const sendCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/admin/email/unified/send'),
      );
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0][1]).toMatchObject({ method: 'POST' });
    });
  });

  it('cancel-scheduled-email opens a confirm modal and DELETEs on confirm', async () => {
    const scheduledEmail = {
      id: 'sched-1',
      subject: 'Newsletter draft',
      scheduledFor: '2030-01-01T12:00:00.000Z',
      recipientCount: 5,
      recipientEmails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'],
      status: 'pending' as const,
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    fetchMock
      .mockResolvedValueOnce(templatesResponse())
      .mockResolvedValueOnce(scheduledResponse([scheduledEmail]))
      .mockResolvedValueOnce(
        recipientsResponse([{ id: 'r1', email: 'r1@example.com', name: null }]),
      )
      // The DELETE for cancel.
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      // Subsequent re-fetch of scheduled emails (after the delete).
      .mockResolvedValueOnce(scheduledResponse([]));

    render(<EmailSection />);
    await screen.findByText('Newsletter draft');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Cancel scheduled email')).toBeInTheDocument();
    const footer = screen.getByTestId('modal-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Cancel email' }));

    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(
        (call) =>
          String(call[0]).includes('/api/admin/email/scheduled/sched-1') &&
          (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deletes).toHaveLength(1);
    });
  });
});
