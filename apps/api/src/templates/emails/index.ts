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
import { templateConfig as suuntoEnabledConfig } from './suunto-enabled';
import { templateConfig as betaFeatureRoundupConfig } from './beta-feature-roundup';
import { templateConfig as mobileAppLaunchConfig } from './mobile-app-launch';
import { templateConfig as foundingRidersAprilUpdateConfig } from './founding-riders-april-2026';
import { templateConfig as foundingRidersMayUpdateConfig } from './founding-riders-may-2026';
import { templateConfig as foundingRiderUpgradeConfig } from './founding-rider-upgrade';
import { templateConfig as composerConfig } from './composer';
// Note: activation template excluded - it's system-triggered, not admin-sendable

import type { TemplateConfig, TemplateConfigDTO } from './types';
import { FRONTEND_URL } from '../../config/env';

const API_URL = process.env.API_URL || 'http://localhost:4000';

/** All email templates (including system-only ones) */
const allTemplates: TemplateConfig[] = [
  composerConfig,
  welcome1Config,
  welcome2Config,
  welcome3Config,
  announcementConfig,
  foundingRidersConfig,
  preAccessConfig,
  stravaEnabledConfig,
  suuntoEnabledConfig,
  betaFeatureRoundupConfig,
  mobileAppLaunchConfig,
  foundingRidersAprilUpdateConfig,
  foundingRidersMayUpdateConfig,
  foundingRiderUpgradeConfig,
];

/** Templates visible in admin UI (excludes system-only templates) */
export const EMAIL_TEMPLATES = allTemplates.filter(t => t.adminVisible !== false);

/** Get a template by ID */
export function getTemplateById(id: string): TemplateConfig | undefined {
  return allTemplates.find(t => t.id === id);
}

/** Per-recipient values filled in by the backend, not the admin form */
export type TemplateAutoFillValues = {
  recipientFirstName?: string;
  email?: string;
  unsubscribeUrl?: string;
};

/**
 * Build render props for a template from admin-provided parameters.
 * Auto-fill values win for their fields; ${FRONTEND_URL}/${API_URL}
 * placeholders in defaults are resolved here.
 */
export function buildTemplateProps(
  template: TemplateConfig,
  userParameters: Record<string, string>,
  autoFillValues: TemplateAutoFillValues
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  for (const param of template.parameters) {
    if (param.autoFill && autoFillValues[param.autoFill] !== undefined) {
      props[param.key] = autoFillValues[param.autoFill];
    } else if (userParameters[param.key] !== undefined && userParameters[param.key] !== '') {
      props[param.key] = userParameters[param.key];
    } else if (param.defaultValue !== undefined) {
      props[param.key] = param.defaultValue
        .replace('${FRONTEND_URL}', FRONTEND_URL)
        .replace('${API_URL}', API_URL);
    }
  }

  return props;
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