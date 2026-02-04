// Re-export all template components and types
export * from './types';

// Import templateConfig from each template for aggregation
import { templateConfig as welcome1Config } from './welcome-1';
import { templateConfig as welcome2Config } from './welcome-2';
import { templateConfig as welcome3Config } from './welcome-3';
import { templateConfig as announcementConfig } from './announcement';
import { templateConfig as foundingRidersConfig } from './founding-riders';
import { templateConfig as preAccessConfig } from './pre-access';
import { templateConfig as stravaEnabledConfig } from './strava-enabled';
import { templateConfig as whoopEnabledConfig } from './whoop-enabled';
// Note: activation template excluded - it's system-triggered, not admin-sendable

import type { TemplateConfig, TemplateConfigDTO } from './types';

/** All email templates (including system-only ones) */
const allTemplates: TemplateConfig[] = [
  welcome1Config,
  welcome2Config,
  welcome3Config,
  announcementConfig,
  foundingRidersConfig,
  preAccessConfig,
  stravaEnabledConfig,
  whoopEnabledConfig,
];

/** Templates visible in admin UI (excludes system-only templates) */
export const EMAIL_TEMPLATES = allTemplates.filter(t => t.adminVisible !== false);

/** Get a template by ID */
export function getTemplateById(id: string): TemplateConfig | undefined {
  return allTemplates.find(t => t.id === id);
}

/** Get template list for API response (without render function) */
export function getTemplateListForAPI(): TemplateConfigDTO[] {
  return EMAIL_TEMPLATES.map(t => ({
    id: t.id,
    displayName: t.displayName,
    description: t.description,
    defaultSubject: t.defaultSubject,
    parameters: t.parameters.filter(p => p.type !== 'hidden').map(({ autoFill: _autoFill, ...rest }) => rest),
  }));
}