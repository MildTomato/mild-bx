/**
 * Config field metadata.
 *
 * Three independent attributes per field:
 *
 *   scope      — "global" | "env"
 *                global: same value across all environments (feature flags,
 *                policies, structural settings)
 *                env: differs per environment (URLs, ports, credentials)
 *
 *   promotable — whether this field is diffed and applied to the target when
 *                merging a branch. Non-promotable fields (ports, URLs,
 *                credentials) are left untouched on the target.
 *
 *   secret     — whether the value should be treated as a secret by default
 *                (masked in output, stored encrypted, never logged)
 *
 * Paths use dot notation. A `*` segment matches any single dynamic key
 * (provider name, bucket name, function name, hook name, etc.).
 *
 * When resolving a concrete path, more-specific patterns win over
 * wildcard patterns (longest match wins).
 */

export type FieldScope = "global" | "env";

export interface FieldMeta {
  scope: FieldScope;
  promotable: boolean;
  secret: boolean;
  required: boolean;
}

/**
 * Pattern → metadata.
 * Ordered from most-specific to least-specific within groups; the resolver
 * also picks longest match so order inside a group doesn't matter, but
 * keeping it logical aids readability.
 */
const FIELD_META: Record<string, FieldMeta> = {
  // ── Top-level ────────────────────────────────────────────────────────────
  "project_id":                                     { scope: "global", promotable: false, secret: false, required: false },
  "workflow_profile":                               { scope: "global", promotable: false, secret: false, required: false },
  "schema_management":                              { scope: "global", promotable: false, secret: false, required: false },
  "config_source":                                  { scope: "global", promotable: false, secret: false, required: false },
  "environments":                                   { scope: "global", promotable: false, secret: false, required: false },

  // ── Analytics ────────────────────────────────────────────────────────────
  "analytics.enabled":                              { scope: "global", promotable: true,  secret: false, required: false },
  "analytics.port":                                 { scope: "env",    promotable: false, secret: false, required: false },
  "analytics.vector_port":                          { scope: "env",    promotable: false, secret: false, required: false },
  "analytics.backend":                              { scope: "global", promotable: true,  secret: false, required: false },

  // ── API (PostgREST) ──────────────────────────────────────────────────────
  "api.enabled":                                    { scope: "global", promotable: true,  secret: false, required: false },
  "api.port":                                       { scope: "env",    promotable: false, secret: false, required: false },
  "api.schemas":                                    { scope: "global", promotable: true,  secret: false, required: false },
  "api.extra_search_path":                          { scope: "global", promotable: true,  secret: false, required: false },
  "api.max_rows":                                   { scope: "global", promotable: true,  secret: false, required: false },
  "api.tls.enabled":                                { scope: "global", promotable: true,  secret: false, required: false },
  "api.external_url":                               { scope: "env",    promotable: false, secret: false, required: false },

  // ── Auth — core ──────────────────────────────────────────────────────────
  "auth.enabled":                                   { scope: "global", promotable: true,  secret: false, required: false },
  "auth.site_url":                                  { scope: "env",    promotable: false, secret: false, required: false },
  "auth.additional_redirect_urls":                  { scope: "env",    promotable: false, secret: false, required: false },
  "auth.jwt_expiry":                                { scope: "global", promotable: true,  secret: false, required: false },
  "auth.enable_refresh_token_rotation":             { scope: "global", promotable: true,  secret: false, required: false },
  "auth.refresh_token_reuse_interval":              { scope: "global", promotable: true,  secret: false, required: false },
  "auth.enable_manual_linking":                     { scope: "global", promotable: true,  secret: false, required: false },
  "auth.enable_signup":                             { scope: "global", promotable: true,  secret: false, required: false },
  "auth.enable_anonymous_sign_ins":                 { scope: "global", promotable: true,  secret: false, required: false },
  "auth.minimum_password_length":                   { scope: "global", promotable: true,  secret: false, required: false },
  "auth.password_requirements":                     { scope: "global", promotable: true,  secret: false, required: false },

  // ── Auth — email ─────────────────────────────────────────────────────────
  "auth.email.enable_signup":                       { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.double_confirm_changes":              { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.enable_confirmations":                { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.secure_password_change":              { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.max_frequency":                       { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.otp_length":                          { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.otp_expiry":                          { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.smtp.enabled":                        { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.smtp.host":                           { scope: "env",    promotable: false, secret: false, required: true  },
  "auth.email.smtp.port":                           { scope: "env",    promotable: false, secret: false, required: true  },
  "auth.email.smtp.user":                           { scope: "env",    promotable: false, secret: false, required: true  },
  "auth.email.smtp.pass":                           { scope: "env",    promotable: false, secret: true,  required: true  },
  "auth.email.smtp.admin_email":                    { scope: "env",    promotable: false, secret: false, required: false },
  "auth.email.smtp.sender_name":                    { scope: "env",    promotable: false, secret: false, required: false },
  "auth.email.template.*.subject":                  { scope: "global", promotable: true,  secret: false, required: false },
  "auth.email.template.*.content_path":             { scope: "global", promotable: true,  secret: false, required: false },

  // ── Auth — hooks ─────────────────────────────────────────────────────────
  "auth.hook.*.enabled":                            { scope: "global", promotable: true,  secret: false, required: false },
  "auth.hook.*.uri":                                { scope: "env",    promotable: false, secret: false, required: false },
  "auth.hook.*.secrets":                            { scope: "env",    promotable: false, secret: true,  required: false },

  // ── Auth — MFA ───────────────────────────────────────────────────────────
  "auth.mfa.totp.enroll_enabled":                   { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.totp.verify_enabled":                   { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.phone.enroll_enabled":                  { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.phone.verify_enabled":                  { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.phone.otp_length":                      { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.phone.template":                        { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.phone.max_frequency":                   { scope: "global", promotable: true,  secret: false, required: false },
  "auth.mfa.max_enrolled_factors":                  { scope: "global", promotable: true,  secret: false, required: false },

  // ── Auth — sessions ──────────────────────────────────────────────────────
  "auth.sessions.timebox":                          { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sessions.inactivity_timeout":               { scope: "global", promotable: true,  secret: false, required: false },

  // ── Auth — SMS ───────────────────────────────────────────────────────────
  "auth.sms.enable_signup":                         { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.enable_confirmations":                  { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.template":                              { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.max_frequency":                         { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.test_otp":                              { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.twilio.enabled":                        { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.twilio.account_sid":                    { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.twilio.message_service_sid":            { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.twilio.auth_token":                     { scope: "env",    promotable: false, secret: true,  required: false },
  "auth.sms.twilio_verify.enabled":                 { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.twilio_verify.account_sid":             { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.twilio_verify.message_service_sid":     { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.twilio_verify.auth_token":              { scope: "env",    promotable: false, secret: true,  required: false },
  "auth.sms.messagebird.enabled":                   { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.messagebird.originator":                { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.messagebird.api_key":                   { scope: "env",    promotable: false, secret: true,  required: false },
  "auth.sms.textlocal.enabled":                     { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.textlocal.sender":                      { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.textlocal.api_key":                     { scope: "env",    promotable: false, secret: true,  required: false },
  "auth.sms.vonage.enabled":                        { scope: "global", promotable: true,  secret: false, required: false },
  "auth.sms.vonage.from":                           { scope: "env",    promotable: false, secret: false, required: false },
  "auth.sms.vonage.api_key":                        { scope: "env",    promotable: false, secret: true,  required: false },
  "auth.sms.vonage.api_secret":                     { scope: "env",    promotable: false, secret: true,  required: false },

  // ── Auth — external OAuth providers ─────────────────────────────────────
  "auth.external.*.enabled":                        { scope: "global", promotable: true,  secret: false, required: false },
  "auth.external.*.skip_nonce_check":               { scope: "global", promotable: true,  secret: false, required: false },
  "auth.external.*.client_id":                      { scope: "env",    promotable: false, secret: false, required: true  },
  "auth.external.*.secret":                         { scope: "env",    promotable: false, secret: true,  required: true  },
  "auth.external.*.url":                            { scope: "env",    promotable: false, secret: false, required: false },
  "auth.external.*.redirect_uri":                   { scope: "env",    promotable: false, secret: false, required: false },

  // ── Database ─────────────────────────────────────────────────────────────
  "db.port":                                        { scope: "env",    promotable: false, secret: false, required: false },
  "db.shadow_port":                                 { scope: "env",    promotable: false, secret: false, required: false },
  "db.major_version":                               { scope: "global", promotable: false, secret: false, required: false },
  "db.pooler.enabled":                              { scope: "global", promotable: true,  secret: false, required: false },
  "db.pooler.port":                                 { scope: "env",    promotable: false, secret: false, required: false },
  "db.pooler.pool_mode":                            { scope: "global", promotable: true,  secret: false, required: false },
  "db.pooler.default_pool_size":                    { scope: "global", promotable: true,  secret: false, required: false },
  "db.pooler.max_client_conn":                      { scope: "global", promotable: true,  secret: false, required: false },
  "db.seed.enabled":                                { scope: "global", promotable: true,  secret: false, required: false },
  "db.seed.sql_paths":                              { scope: "global", promotable: true,  secret: false, required: false },

  // ── Edge Runtime ─────────────────────────────────────────────────────────
  "edge_runtime.enabled":                           { scope: "global", promotable: true,  secret: false, required: false },
  "edge_runtime.policy":                            { scope: "global", promotable: true,  secret: false, required: false },
  "edge_runtime.inspector_port":                    { scope: "env",    promotable: false, secret: false, required: false },

  // ── Experimental ─────────────────────────────────────────────────────────
  "experimental.orioledb_version":                  { scope: "global", promotable: true,  secret: false, required: false },
  "experimental.s3_host":                           { scope: "env",    promotable: false, secret: false, required: false },
  "experimental.s3_region":                         { scope: "env",    promotable: false, secret: false, required: false },
  "experimental.s3_access_key":                     { scope: "env",    promotable: false, secret: true,  required: false },
  "experimental.s3_secret_key":                     { scope: "env",    promotable: false, secret: true,  required: false },

  // ── Functions ────────────────────────────────────────────────────────────
  "functions.*.enabled":                            { scope: "global", promotable: true,  secret: false, required: false },
  "functions.*.verify_jwt":                         { scope: "global", promotable: true,  secret: false, required: false },
  "functions.*.import_map":                         { scope: "global", promotable: true,  secret: false, required: false },
  "functions.*.entrypoint":                         { scope: "global", promotable: true,  secret: false, required: false },

  // ── Inbucket ─────────────────────────────────────────────────────────────
  "inbucket.enabled":                               { scope: "global", promotable: true,  secret: false, required: false },
  "inbucket.port":                                  { scope: "env",    promotable: false, secret: false, required: false },
  "inbucket.smtp_port":                             { scope: "env",    promotable: false, secret: false, required: false },
  "inbucket.pop3_port":                             { scope: "env",    promotable: false, secret: false, required: false },

  // ── Realtime ─────────────────────────────────────────────────────────────
  "realtime.enabled":                               { scope: "global", promotable: true,  secret: false, required: false },
  "realtime.ip_version":                            { scope: "global", promotable: true,  secret: false, required: false },
  "realtime.max_header_length":                     { scope: "global", promotable: true,  secret: false, required: false },

  // ── Storage ──────────────────────────────────────────────────────────────
  "storage.enabled":                                { scope: "global", promotable: true,  secret: false, required: false },
  "storage.file_size_limit":                        { scope: "global", promotable: true,  secret: false, required: false },
  "storage.image_transformation.enabled":           { scope: "global", promotable: true,  secret: false, required: false },
  "storage.buckets.*.public":                       { scope: "global", promotable: true,  secret: false, required: false },
  "storage.buckets.*.file_size_limit":              { scope: "global", promotable: true,  secret: false, required: false },
  "storage.buckets.*.allowed_mime_types":           { scope: "global", promotable: true,  secret: false, required: false },
  "storage.buckets.*.objects_path":                 { scope: "global", promotable: true,  secret: false, required: false },

  // ── Studio ───────────────────────────────────────────────────────────────
  "studio.enabled":                                 { scope: "global", promotable: false, secret: false, required: false },
  "studio.port":                                    { scope: "env",    promotable: false, secret: false, required: false },
  "studio.api_url":                                 { scope: "env",    promotable: false, secret: false, required: false },
  "studio.openai_api_key":                          { scope: "env",    promotable: false, secret: true,  required: false },
};

/**
 * Resolve metadata for a concrete config path.
 *
 * Resolution order:
 *   1. Exact match
 *   2. Wildcard patterns — longest matching pattern wins
 *   3. Falls back to { scope: "global", promotable: true, secret: false }
 */
export function getFieldMeta(configPath: string): FieldMeta {
  // 1. Exact match
  if (configPath in FIELD_META) {
    return FIELD_META[configPath];
  }

  // 2. Wildcard match — find all patterns that match, pick the longest
  const parts = configPath.split(".");
  let bestMatch: { pattern: string; meta: FieldMeta } | null = null;

  for (const [pattern, meta] of Object.entries(FIELD_META)) {
    if (!pattern.includes("*")) continue;

    const patternParts = pattern.split(".");
    if (patternParts.length !== parts.length) continue;

    const matches = patternParts.every((p, i) => p === "*" || p === parts[i]);

    if (matches) {
      if (!bestMatch || pattern.length > bestMatch.pattern.length) {
        bestMatch = { pattern, meta };
      }
    }
  }

  if (bestMatch) return bestMatch.meta;

  // 3. Unknown field — assume global, not promotable, not secret, not required
  return { scope: "global", promotable: false, secret: false, required: false };
}

// Convenience accessors
export function getFieldScope(configPath: string): FieldScope {
  return getFieldMeta(configPath).scope;
}

export function isPromotable(configPath: string): boolean {
  return getFieldMeta(configPath).promotable;
}

export function isEnvSpecific(configPath: string): boolean {
  return getFieldMeta(configPath).scope === "env";
}

export function isSecret(configPath: string): boolean {
  return getFieldMeta(configPath).secret;
}

export function isRequired(configPath: string): boolean {
  return getFieldMeta(configPath).required;
}

/**
 * Filter an object of config diffs, returning only the promotable fields.
 */
export function filterPromotableFields(
  diffs: Record<string, { oldValue: unknown; newValue: unknown }>
): Record<string, { oldValue: unknown; newValue: unknown }> {
  return Object.fromEntries(
    Object.entries(diffs).filter(([path]) => isPromotable(path))
  );
}
