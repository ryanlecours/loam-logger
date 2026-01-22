import type { ReactElement } from 'react';

export interface TemplateParameter {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'hidden';
  required: boolean;
  defaultValue?: string;
  /** Auto-fill from recipient data - these are handled per-recipient by the backend */
  autoFill?: 'recipientFirstName' | 'unsubscribeUrl' | 'email';
  helpText?: string;
}

export interface TemplateConfig {
  /** Unique identifier for the template */
  id: string;
  /** Display name shown in admin dropdown */
  displayName: string;
  /** Short description of when to use this template */
  description: string;
  /** Default email subject line */
  defaultSubject: string;
  /** Email type for audit logging */
  emailType: string;
  /** Template version for tracking changes */
  templateVersion: string;
  /** Configurable parameters for this template */
  parameters: TemplateParameter[];
  /** Render function that returns the React email element */
  render: (props: Record<string, unknown>) => ReactElement;
  /** Whether to show in admin UI. Default true. Set false for system-only templates (e.g., activation) */
  adminVisible?: boolean;
}

/** Serializable version of TemplateConfig for API responses (excludes render function) */
export interface TemplateConfigDTO {
  id: string;
  displayName: string;
  description: string;
  defaultSubject: string;
  parameters: Omit<TemplateParameter, 'autoFill'>[];
}
