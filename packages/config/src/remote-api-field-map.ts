/**
 * Bidirectional mapping between config.json paths and Management API field names.
 *
 * Single source of truth used by:
 *   - buildAuthApiPayload / buildPostgrestApiPayload  (config → API, for push)
 *   - diffRemoteAuthConfig / diffRemotePostgrestConfig (API → config, for diff)
 *   - buildAuthApiUpdatePayload / buildPostgrestApiUpdatePayload (for merge)
 *
 * Works with both Management API (lowercase keys) and GoTrue API (UPPERCASE keys)
 * because resolveAuthApiField normalises to lowercase before lookup.
 */

import { getFieldMeta } from "./config-field-meta.js";
import { getNestedValue } from "./env-var-mapping.js";
import type { PromotableConfigChange } from "./promotable-diff.js";

type Transform = (v: unknown) => unknown;

interface ApiFieldEntry {
  configPath: string;
  /** API value → config value. Used when reading API responses (diff/display). */
  fromApi?: Transform;
  /**
   * Config value → API value. Used when building push payloads.
   * Defaults to `fromApi` (works because all current transforms are self-inverse).
   */
  toApi?: Transform;
}

const invert: Transform = (v) => (v === null ? null : !v);
const joinComma: Transform = (v) => (Array.isArray(v) ? v.join(",") : v);

// ── Auth API ─────────────────────────────────────────────────────────────────

const AUTH_FIELD_MAP: Record<string, ApiFieldEntry> = {
  // Core
  disable_signup:                              { configPath: "auth.enable_signup",                        fromApi: invert },
  external_anonymous_users_enabled:            { configPath: "auth.enable_anonymous_sign_ins" },
  jwt_exp:                                     { configPath: "auth.jwt_expiry" },
  refresh_token_rotation_enabled:              { configPath: "auth.enable_refresh_token_rotation" },
  security_refresh_token_reuse_interval:       { configPath: "auth.refresh_token_reuse_interval" },
  security_manual_linking_enabled:             { configPath: "auth.enable_manual_linking" },
  password_min_length:                         { configPath: "auth.minimum_password_length" },
  password_required_characters:                { configPath: "auth.password_requirements" },

  // Email
  external_email_enabled:                      { configPath: "auth.email.enable_signup" },
  mailer_autoconfirm:                          { configPath: "auth.email.enable_confirmations",           fromApi: invert },
  mailer_secure_email_change_enabled:          { configPath: "auth.email.double_confirm_changes" },
  mailer_otp_length:                           { configPath: "auth.email.otp_length" },
  mailer_otp_exp:                              { configPath: "auth.email.otp_expiry" },

  // Email templates
  mailer_subjects_confirmation:                { configPath: "auth.email.template.confirmation.subject" },
  mailer_subjects_email_change:                { configPath: "auth.email.template.email_change.subject" },
  mailer_subjects_invite:                      { configPath: "auth.email.template.invite.subject" },
  mailer_subjects_magic_link:                  { configPath: "auth.email.template.magic_link.subject" },
  mailer_subjects_reauthentication:            { configPath: "auth.email.template.reauthentication.subject" },
  mailer_subjects_recovery:                    { configPath: "auth.email.template.recovery.subject" },

  // Hooks (enabled only — uri/secrets are env-specific)
  hook_custom_access_token_enabled:            { configPath: "auth.hook.custom_access_token.enabled" },
  hook_mfa_verification_attempt_enabled:       { configPath: "auth.hook.mfa_verification_attempt.enabled" },
  hook_password_verification_attempt_enabled:  { configPath: "auth.hook.password_verification_attempt.enabled" },
  hook_send_sms_enabled:                       { configPath: "auth.hook.send_sms.enabled" },
  hook_send_email_enabled:                     { configPath: "auth.hook.send_email.enabled" },
  hook_before_user_created_enabled:            { configPath: "auth.hook.before_user_created.enabled" },
  hook_after_user_created_enabled:             { configPath: "auth.hook.after_user_created.enabled" },

  // MFA
  mfa_max_enrolled_factors:                    { configPath: "auth.mfa.max_enrolled_factors" },
  mfa_totp_enroll_enabled:                     { configPath: "auth.mfa.totp.enroll_enabled" },
  mfa_totp_verify_enabled:                     { configPath: "auth.mfa.totp.verify_enabled" },
  mfa_phone_enroll_enabled:                    { configPath: "auth.mfa.phone.enroll_enabled" },
  mfa_phone_verify_enabled:                    { configPath: "auth.mfa.phone.verify_enabled" },
  mfa_phone_otp_length:                        { configPath: "auth.mfa.phone.otp_length" },
  mfa_phone_template:                          { configPath: "auth.mfa.phone.template" },
  mfa_phone_max_frequency:                     { configPath: "auth.mfa.phone.max_frequency" },

  // Sessions
  sessions_timebox:                            { configPath: "auth.sessions.timebox" },
  sessions_inactivity_timeout:                 { configPath: "auth.sessions.inactivity_timeout" },

  // SMS
  external_phone_enabled:                      { configPath: "auth.sms.enable_signup" },
  sms_autoconfirm:                             { configPath: "auth.sms.enable_confirmations",             fromApi: invert },
  sms_template:                                { configPath: "auth.sms.template" },
  sms_max_frequency:                           { configPath: "auth.sms.max_frequency" },
};

// External OAuth providers — matched by pattern after lowercasing
const EXTERNAL_ENABLED_RE     = /^external_([a-z0-9_]+)_enabled$/;
const EXTERNAL_NONCE_RE       = /^external_([a-z0-9_]+)_skip_nonce_check$/;

function resolveAuthApiField(apiKey: string): ApiFieldEntry | null {
  const key = apiKey.toLowerCase();
  if (key in AUTH_FIELD_MAP) return AUTH_FIELD_MAP[key];

  const enabledMatch = EXTERNAL_ENABLED_RE.exec(key);
  if (enabledMatch) return { configPath: `auth.external.${enabledMatch[1]}.enabled` };

  const nonceMatch = EXTERNAL_NONCE_RE.exec(key);
  if (nonceMatch) return { configPath: `auth.external.${nonceMatch[1]}.skip_nonce_check` };

  return null;
}

// ── PostgREST API ────────────────────────────────────────────────────────────

const POSTGREST_FIELD_MAP: Record<string, ApiFieldEntry> = {
  db_schema:            { configPath: "api.schemas",           toApi: joinComma },
  db_extra_search_path: { configPath: "api.extra_search_path", toApi: joinComma },
  max_rows:             { configPath: "api.max_rows" },
};

// ── Build payloads (config → API) ────────────────────────────────────────────

/**
 * Build a Management API auth update payload from a config.json object.
 * Only includes fields that are defined in the config (undefined = not set = skip).
 *
 * Does NOT include env-specific fields (site_url, smtp credentials, OAuth
 * client_id/secret). Those are deployment-specific and handled by the caller.
 */
export function buildAuthApiPayload(config: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [apiKey, entry] of Object.entries(AUTH_FIELD_MAP)) {
    const value = getNestedValue(config, entry.configPath);
    if (value === undefined) continue;
    const transform = entry.toApi ?? entry.fromApi ?? ((v) => v);
    payload[apiKey] = transform(value);
  }

  // Dynamic external providers — enabled and skip_nonce_check (env-specific fields excluded)
  const external = getNestedValue(config, "auth.external") as Record<string, Record<string, unknown>> | undefined;
  if (external) {
    for (const [provider, settings] of Object.entries(external)) {
      if (settings.enabled !== undefined)
        payload[`external_${provider}_enabled`] = settings.enabled;
      if (settings.skip_nonce_check !== undefined)
        payload[`external_${provider}_skip_nonce_check`] = settings.skip_nonce_check;
    }
  }

  return payload;
}

/**
 * Build a Management API PostgREST update payload from a config.json object.
 */
export function buildPostgrestApiPayload(config: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [apiKey, entry] of Object.entries(POSTGREST_FIELD_MAP)) {
    const value = getNestedValue(config, entry.configPath);
    if (value === undefined) continue;
    const transform = entry.toApi ?? entry.fromApi ?? ((v) => v);
    payload[apiKey] = transform(value);
  }

  return payload;
}

// ── Diff (API → config) ──────────────────────────────────────────────────────

function diffApiConfig(
  branchApi: Record<string, unknown>,
  prodApi: Record<string, unknown>,
  resolve: (key: string) => ApiFieldEntry | null,
): PromotableConfigChange[] {
  const changes: PromotableConfigChange[] = [];
  const seen = new Set<string>();
  const allKeys = new Set([...Object.keys(branchApi), ...Object.keys(prodApi)]);

  for (const apiKey of allKeys) {
    const entry = resolve(apiKey);
    if (!entry) continue;

    const { configPath, fromApi } = entry;
    if (seen.has(configPath)) continue;
    seen.add(configPath);

    const meta = getFieldMeta(configPath);
    if (!meta.promotable) continue;

    const transform = fromApi ?? ((v) => v);
    const from = transform(prodApi[apiKey]);
    const to   = transform(branchApi[apiKey]);

    const normalizeApiValue = (v: unknown): unknown => {
      if (v === undefined || v === "") return null;
      return v;
    };

    if (JSON.stringify(normalizeApiValue(from)) !== JSON.stringify(normalizeApiValue(to))) {
      changes.push({ key: configPath, from, to });
    }
  }

  return changes;
}

export function diffRemoteAuthConfig(
  branchConfig: Record<string, unknown>,
  prodConfig: Record<string, unknown>,
): PromotableConfigChange[] {
  return diffApiConfig(branchConfig, prodConfig, resolveAuthApiField);
}

export function diffRemotePostgrestConfig(
  branchConfig: Record<string, unknown>,
  prodConfig: Record<string, unknown>,
): PromotableConfigChange[] {
  return diffApiConfig(branchConfig, prodConfig, (key) => POSTGREST_FIELD_MAP[key] ?? null);
}

// ── Merge update payloads (diff → API keys) ───────────────────────────────────

/**
 * Given a set of diffs (config-path keys), extract the corresponding
 * API-key-named values from the branch config for use in a merge update.
 */
export function buildAuthApiUpdatePayload(
  branchApiConfig: Record<string, unknown>,
  diffs: PromotableConfigChange[],
): Record<string, unknown> {
  const reverseMap = new Map<string, string>();
  for (const [apiKey, entry] of Object.entries(AUTH_FIELD_MAP)) {
    reverseMap.set(entry.configPath, apiKey);
  }
  for (const apiKey of Object.keys(branchApiConfig)) {
    const key = apiKey.toLowerCase();
    const enabledMatch = EXTERNAL_ENABLED_RE.exec(key);
    if (enabledMatch) reverseMap.set(`auth.external.${enabledMatch[1]}.enabled`, apiKey);
    const nonceMatch = EXTERNAL_NONCE_RE.exec(key);
    if (nonceMatch) reverseMap.set(`auth.external.${nonceMatch[1]}.skip_nonce_check`, apiKey);
  }

  const update: Record<string, unknown> = {};
  for (const diff of diffs) {
    const apiKey = reverseMap.get(diff.key);
    if (apiKey !== undefined) update[apiKey] = branchApiConfig[apiKey];
  }
  return update;
}

export function buildPostgrestApiUpdatePayload(
  branchApiConfig: Record<string, unknown>,
  diffs: PromotableConfigChange[],
): Record<string, unknown> {
  const reverseMap = new Map<string, string>(
    Object.entries(POSTGREST_FIELD_MAP).map(([k, v]) => [v.configPath, k]),
  );
  const update: Record<string, unknown> = {};
  for (const diff of diffs) {
    const apiKey = reverseMap.get(diff.key);
    if (apiKey !== undefined) update[apiKey] = branchApiConfig[apiKey];
  }
  return update;
}
