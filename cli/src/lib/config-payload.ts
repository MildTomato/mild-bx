/**
 * Build API payloads from local config
 * Maps config.json structure to Management API update payloads
 */

import type { components } from "./api-types.js";
import type { ProjectConfig } from "./config-types.js";

type UpdatePostgrestBody = components["schemas"]["V1UpdatePostgrestConfigBody"];
type UpdateAuthBody = components["schemas"]["UpdateAuthConfigBody"];

/**
 * Resolve environment variable references in config values
 * If value matches env(VAR_NAME), returns process.env[VAR_NAME]
 * Otherwise returns value as-is
 */
export function resolveEnvRef(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const envMatch = value.match(/^env\(([A-Z_][A-Z0-9_]*)\)$/);
  if (!envMatch) return value;

  const envVarName = envMatch[1];
  const envValue = process.env[envVarName];

  if (envValue === undefined) {
    throw new Error(`Environment variable ${envVarName} is not set`);
  }

  return envValue;
}

/**
 * Apply resolveEnvRef to all string values in an object recursively
 */
function resolveEnvRefsInObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = resolveEnvRefsInObject(value as Record<string, unknown>);
    } else {
      result[key] = resolveEnvRef(value);
    }
  }

  return result;
}

/**
 * Build PostgREST config update payload from config.json api section
 */
export function buildPostgrestPayload(
  config: ProjectConfig,
): UpdatePostgrestBody | null {
  const api = config.api;
  if (!api) return null;

  const payload: UpdatePostgrestBody = {};

  if (api.schemas) {
    payload.db_schema = api.schemas.join(",");
  }
  if (api.extra_search_path) {
    payload.db_extra_search_path = api.extra_search_path.join(",");
  }
  if (api.max_rows !== undefined) {
    payload.max_rows = api.max_rows;
  }

  // Resolve environment variable references
  return Object.keys(payload).length > 0
    ? (resolveEnvRefsInObject(payload) as UpdatePostgrestBody)
    : null;
}

/**
 * Build Auth config update payload from config.json auth section
 * Maps nested config structure to flat API keys
 */
export function buildAuthPayload(config: ProjectConfig): UpdateAuthBody | null {
  const auth = config.auth;
  if (!auth) return null;

  const payload: Record<string, unknown> = {};

  // Top-level auth settings
  if (auth.site_url !== undefined) payload.site_url = auth.site_url;
  if (auth.additional_redirect_urls !== undefined) {
    payload.uri_allow_list = auth.additional_redirect_urls.join(",");
  }
  if (auth.jwt_expiry !== undefined) payload.jwt_exp = auth.jwt_expiry;
  if (auth.enable_signup !== undefined)
    payload.disable_signup = !auth.enable_signup;
  if (auth.enable_anonymous_sign_ins !== undefined) {
    payload.external_anonymous_users_enabled = auth.enable_anonymous_sign_ins;
  }
  if (auth.enable_manual_linking !== undefined) {
    payload.security_manual_linking_enabled = auth.enable_manual_linking;
  }
  if (auth.minimum_password_length !== undefined) {
    payload.password_min_length = auth.minimum_password_length;
  }
  if (auth.enable_refresh_token_rotation !== undefined) {
    payload.refresh_token_rotation_enabled = auth.enable_refresh_token_rotation;
  }
  if (auth.refresh_token_reuse_interval !== undefined) {
    payload.security_refresh_token_reuse_interval =
      auth.refresh_token_reuse_interval;
  }

  // Email settings
  if (auth.email) {
    const email = auth.email;
    if (email.enable_signup !== undefined)
      payload.mailer_secure_email_change_enabled = email.enable_signup;
    if (email.double_confirm_changes !== undefined)
      payload.mailer_secure_email_change_enabled = email.double_confirm_changes;
    if (email.enable_confirmations !== undefined)
      payload.mailer_autoconfirm = !email.enable_confirmations;
    if (email.otp_length !== undefined)
      payload.mailer_otp_length = email.otp_length;
    if (email.otp_expiry !== undefined)
      payload.mailer_otp_exp = email.otp_expiry;

    // SMTP settings
    if (email.smtp) {
      const smtp = email.smtp;
      if (smtp.host !== undefined) payload.smtp_host = smtp.host;
      if (smtp.port !== undefined) payload.smtp_port = String(smtp.port);
      if (smtp.user !== undefined) payload.smtp_user = smtp.user;
      if (smtp.pass !== undefined) payload.smtp_pass = smtp.pass;
      if (smtp.admin_email !== undefined)
        payload.smtp_admin_email = smtp.admin_email;
      if (smtp.sender_name !== undefined)
        payload.smtp_sender_name = smtp.sender_name;
    }
  }

  // External OAuth providers
  if (auth.external) {
    for (const [provider, settings] of Object.entries(auth.external)) {
      const prefix = `external_${provider}`;
      if (settings.enabled !== undefined)
        payload[`${prefix}_enabled`] = settings.enabled;
      if (settings.client_id !== undefined)
        payload[`${prefix}_client_id`] = settings.client_id;
      if (settings.secret !== undefined)
        payload[`${prefix}_secret`] = settings.secret;
      if (settings.redirect_uri !== undefined)
        payload[`${prefix}_redirect_uri`] = settings.redirect_uri;
      if (settings.url !== undefined) payload[`${prefix}_url`] = settings.url;
      if (settings.skip_nonce_check !== undefined)
        payload[`${prefix}_skip_nonce_check`] = settings.skip_nonce_check;
    }
  }

  // MFA settings
  if (auth.mfa) {
    const mfa = auth.mfa;
    if (mfa.max_enrolled_factors !== undefined)
      payload.mfa_max_enrolled_factors = mfa.max_enrolled_factors;

    if (mfa.totp) {
      if (mfa.totp.enroll_enabled !== undefined)
        payload.mfa_totp_enroll_enabled = mfa.totp.enroll_enabled;
      if (mfa.totp.verify_enabled !== undefined)
        payload.mfa_totp_verify_enabled = mfa.totp.verify_enabled;
    }

    if (mfa.phone) {
      if (mfa.phone.enroll_enabled !== undefined)
        payload.mfa_phone_enroll_enabled = mfa.phone.enroll_enabled;
      if (mfa.phone.verify_enabled !== undefined)
        payload.mfa_phone_verify_enabled = mfa.phone.verify_enabled;
      if (mfa.phone.otp_length !== undefined)
        payload.mfa_phone_otp_length = mfa.phone.otp_length;
      if (mfa.phone.template !== undefined)
        payload.mfa_phone_template = mfa.phone.template;
    }
  }

  // Resolve environment variable references in all string values
  return Object.keys(payload).length > 0
    ? (resolveEnvRefsInObject(payload) as UpdateAuthBody)
    : null;
}

/**
 * Get list of what will be synced (for dry-run / preview)
 */
export function getSyncPreview(config: ProjectConfig): {
  postgrest: string[];
  auth: string[];
} {
  const postgrest: string[] = [];
  const auth: string[] = [];

  const postgrestPayload = buildPostgrestPayload(config);
  if (postgrestPayload) {
    postgrest.push(...Object.keys(postgrestPayload));
  }

  const authPayload = buildAuthPayload(config);
  if (authPayload) {
    auth.push(...Object.keys(authPayload));
  }

  return { postgrest, auth };
}
