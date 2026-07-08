type Role = 'FREE' | 'PRO' | 'ADMIN' | string;

const CLASS_BY_ROLE: Record<string, string> = {
  ADMIN: 'badge-role badge-role-admin',
  PRO: 'badge-role badge-role-pro',
};

const DEFAULT_CLASS = 'badge-role badge-role-user';

/**
 * Pill displaying a user role using the shared `.badge-role-*` classes from
 * the design system (apps/web/src/styles/design-system/colors.css). Wrapped
 * so the role-to-class mapping lives in one place — Admin.tsx previously
 * inlined `getRoleBadgeColor` everywhere a role was rendered.
 */
export function RoleBadge({ role }: { role: Role }) {
  const className = CLASS_BY_ROLE[role] ?? DEFAULT_CLASS;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {role}
    </span>
  );
}
