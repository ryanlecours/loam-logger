/**
 * Shared types for the admin page.
 *
 * Each interface here mirrors a response shape from one of the
 * `/api/admin/*` REST endpoints. Centralizing them in a single file makes
 * the coupling between sections that consume the same endpoint explicit:
 * a change to e.g. the `/api/admin/users` payload only needs one update
 * here, instead of having to remember every section file that re-declared
 * the type locally.
 *
 * Form-internal types (e.g. `AddUserForm`) and one-off UI projections
 * (e.g. `IndividualEmailTarget`) deliberately live next to their consumers
 * — they're not API contracts and don't benefit from cross-file reuse.
 */

// ---------------------------------------------------------------------------
// User & waitlist
// ---------------------------------------------------------------------------

export type Role = 'FREE' | 'PRO' | 'ADMIN';

/** Row shape returned by `GET /api/admin/users`. */
export interface UserEntry {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
  activatedAt: string | null;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
  lastPasswordResetEmailAt: string | null;
}

/** Row shape returned by `GET /api/admin/waitlist`. */
export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  referrer: string | null;
  createdAt: string;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
}

/** Response shape from `GET /api/admin/lookup-user?email=…`. */
export interface LookupResult {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  activatedAt: string | null;
  isFoundingRider: boolean;
}

/** Response shape from `GET /api/admin/stats`. */
export interface AdminStats {
  userCount: number;
  waitlistCount: number;
  foundingRidersCount: number;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** Audience filter for the unified email composer. */
export type EmailSegment =
  | 'WAITLIST'
  | 'WAITLIST_FOUNDING'
  | 'WAITLIST_REGULAR'
  | 'ACTIVE_ALL'
  | 'ACTIVE_FREE'
  | 'ACTIVE_PRO';

/** Row shape returned by `GET /api/admin/email/recipients`. */
export interface EmailRecipient {
  id: string;
  email: string;
  name: string | null;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
}

/** Definition of a parameter slot on an email template. */
export interface TemplateParameter {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'hidden';
  required: boolean;
  defaultValue?: string;
  helpText?: string;
}

/** Row shape returned by `GET /api/admin/email/templates`. */
export interface EmailTemplate {
  id: string;
  displayName: string;
  description: string;
  defaultSubject: string;
  parameters: TemplateParameter[];
}

/** Status of a scheduled email row in the queue. */
export type ScheduledEmailStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'cancelled'
  | 'failed';

/** Row shape returned by `GET /api/admin/email/scheduled`. */
export interface ScheduledEmail {
  id: string;
  subject: string;
  scheduledFor: string;
  recipientCount: number;
  recipientEmails: string[];
  status: ScheduledEmailStatus;
  createdAt: string;
  sentCount?: number;
  failedCount?: number;
  suppressedCount?: number;
  processedAt?: string;
  errorMessage?: string;
}

/** Aggregate stats returned by `POST /api/admin/email/unified/send`. */
export interface SendResult {
  sent: number;
  failed: number;
  suppressed: number;
  total: number;
}
