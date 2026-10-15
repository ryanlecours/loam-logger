import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('warns that deleting does not cancel a subscription', () => {
    renderPage();
    expect(screen.getByText(/does not cancel a Loam Logger Pro subscription/)).toBeInTheDocument();
  });
});
