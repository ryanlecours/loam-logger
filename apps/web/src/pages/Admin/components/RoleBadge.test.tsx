import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleBadge } from './RoleBadge';

describe('RoleBadge', () => {
  it('renders the role text', () => {
    render(<RoleBadge role="ADMIN" />);
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
  });

  it.each([
    ['ADMIN', 'badge-role-admin'],
    ['PRO', 'badge-role-pro'],
  ] as const)('maps %s to the %s class', (role, cls) => {
    const { container } = render(<RoleBadge role={role} />);
    const span = container.querySelector('span');
    expect(span?.className).toContain(cls);
  });

  it('falls back to the user variant for any other role', () => {
    // FREE is the canonical user role today; pin that the default mapping
    // is the user pill class (not admin/pro) so a future role addition
    // can't silently inherit the wrong tone.
    const { container } = render(<RoleBadge role="FREE" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('badge-role-user');
  });

  it('treats unknown role strings as user-tier (defensive)', () => {
    const { container } = render(<RoleBadge role="GHOST" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('badge-role-user');
  });
});
