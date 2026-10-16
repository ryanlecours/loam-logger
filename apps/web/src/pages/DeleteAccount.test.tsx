import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DeleteAccount, { DELETION_EMAIL } from './DeleteAccount';

// The glass Card animates in on scroll, and jsdom has no IntersectionObserver.
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// Google Play reviews this page against its account deletion policy: it must
// name the app or developer, give the steps, offer a way to ask without the
// app, and say what is deleted and what is kept. These tests pin those parts.
function renderPage() {
  return render(
    <MemoryRouter>
      <DeleteAccount />
    </MemoryRouter>
  );
}

describe('DeleteAccount', () => {
  it('names the app and the developer', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Delete your Loam Logger account' })).toBeInTheDocument();
    expect(screen.getByText(/made by Loam Labs LLC/)).toBeInTheDocument();
  });

  it('leads with the deletion steps, as Play asks them to be prominent', () => {
    renderPage();
    const sections = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(sections.slice(0, 3)).toEqual([
      'Delete from the app',
      'Delete on the website',
      'Delete by email',
    ]);
  });

  it('gives app, website and email routes to deletion', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Delete from the app' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete on the website' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings, then Danger Zone' })).toHaveAttribute(
      'href',
      '/settings?section=danger'
    );

    const emailLinks = screen.getAllByRole('link', { name: DELETION_EMAIL });
    expect(emailLinks[0]).toHaveAttribute(
      'href',
      `mailto:${DELETION_EMAIL}?subject=${encodeURIComponent('Delete my Loam Logger account')}`
    );
  });

  it('says what is deleted and what is kept, with retention periods', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'What is deleted' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is kept, and for how long' })).toBeInTheDocument();
    expect(screen.getByText(/kept for up to 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/kept for up to 12 months/)).toBeInTheDocument();
  });

  it('warns that deleting does not cancel a store subscription', () => {
    renderPage();
    expect(screen.getByText(/does not cancel a Loam Logger Pro subscription bought through the App Store or Google Play/)).toBeInTheDocument();
  });
});

describe('Delete by email form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  function submit(email: string) {
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a confirmation link' }));
  }

  it('asks the API to email a link, without credentials, then says to check the inbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    submit(' rider@example.com ');

    expect(await screen.findByRole('status')).toHaveTextContent(
      "If rider@example.com has a Loam Logger account, we've sent it a confirmation link."
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/delete-account\/request$/);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ email: 'rider@example.com' }) });
    expect(init.credentials).toBeUndefined();
  });

  it('shows the retry time when rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ retryAfter: 42 }) }));
    renderPage();

    submit('rider@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please try again in 42 seconds.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks for an email before sending anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    submit('   ');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email.'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Delete some data without deleting your account', () => {
  // Play shows this section's link on the store listing as the partial
  // deletion URL, and asks for the steps to be prominent there too.
  it('gives steps for rides, bikes and imported data', () => {
    renderPage();
    for (const name of [
      'Delete a ride',
      'Delete a bike',
      'Remove data imported from Garmin or Strava',
      'Anything else',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Settings, then Data Sources' })).toHaveAttribute(
      'href',
      '/settings?section=data-sources'
    );
    expect(screen.getByRole('link', { name: 'My Bikes' })).toHaveAttribute('href', '/gear');
  });
});
