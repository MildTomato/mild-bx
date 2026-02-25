/**
 * Config field scope metadata.
 *
 * Defines how each field in config.json behaves across environments:
 *
 *   promote   — safe to change on a preview/feature branch and apply to
 *               production when the branch merges (feature flags, policies,
 *               templates, provider toggles, resource limits)
 *
 *   env       — environment-specific; holds a different value per environment
 *               and must never be blindly promoted (URLs, ports, credentials,
 *               API keys, secrets)
 *
 *   metadata  — set once at project initialisation; never changes via a
 *               branch merge (project_id, db major version, workflow profile)
 *
 * Paths use dot notation. A `*` segment matches any single dynamic key
 * (provider name, bucket name, function name, hook name, etc.).
 *
 * When resolving a concrete path, more-specific patterns win over
 * wildcard patterns (longest match wins).
 */

export type FieldScope = "promote" | "env" | "metadata";

interface FieldMeta {
  scope: FieldScope;
}

/**
 * Pattern → metadata.
 * Ordered from most-specific to least-specific within groups; the resolver
 * also picks longest match so order inside a group doesn't matter, but
 * keeping it logical aids readability.
 */
const FIELD_META: Record<string, FieldMeta> = {
  // ── Top-level metadata ───────────────────────────────────────────────────
  "project_id":                                     { scope: "metadata" },
  "workflow_profile":                               { scope: "metadata" },
  "schema_management":                              { scope: "metadata" },
  "config_source":                                  { scope: "metadata" },
  "environments":                                   { scope: "promote"  },

  // ── Analytics ────────────────────────────────────────────────────────────
  "analytics.enabled":                              { scope: "promote"  },
  "analytics.port":                                 { scope: "env"      },
  "analytics.vector_port":                          { scope: "env"      },
  "analytics.backend":                              { scope: "promote"  },

  // ── API (PostgREST) ──────────────────────────────────────────────────────
  "api.enabled":                                    { scope: "promote"  },
  "api.port":                                       { scope: "env"      },
  "api.schemas":                                    { scope: "promote"  },
  "api.extra_search_path":                          { scope: "promote"  },
  "api.max_rows":                                   { scope: "promote"  },
  "api.tls.enabled":                                { scope: "promote"  },
  "api.external_url":                               { scope: "env"      },

  // ── Auth — core ──────────────────────────────────────────────────────────
  "auth.enabled":                                   { scope: "promote"  },
  "auth.site_url":                                  { scope: "env"      },
  "auth.additional_redirect_urls":                  { scope: "env"      },
  "auth.jwt_expiry":                                { scope: "promote"  },
  "auth.enable_refresh_token_rotation":             { scope: "promote"  },
  "auth.refresh_token_reuse_interval":              { scope: "promote"  },
  "auth.enable_manual_linking":                     { scope: "promote"  },
  "auth.enable_signup":                             { scope: "promote"  },
  "auth.enable_anonymous_sign_ins":                 { scope: "promote"  },
  "auth.minimum_password_length":                   { scope: "promote"  },
  "auth.password_requirements":                     { scope: "promote"  },

  // ── Auth — email ─────────────────────────────────────────────────────────
  "auth.email.enable_signup":                       { scope: "promote"  },
  "auth.email.double_confirm_changes":              { scope: "promote"  },
  "auth.email.enable_confirmations":                { scope: "promote"  },
  "auth.email.secure_password_change":              { scope: "promote"  },
  "auth.email.max_frequency":                       { scope: "promote"  },
  "auth.email.otp_length":                          { scope: "promote"  },
  "auth.email.otp_expiry":                          { scope: "promote"  },
  // SMTP credentials are env-specific
  "auth.email.smtp.enabled":                        { scope: "promote"  },
  "auth.email.smtp.host":                           { scope: "env"      },
  "auth.email.smtp.port":                           { scope: "env"      },
  "auth.email.smtp.user":                           { scope: "env"      },
  "auth.email.smtp.pass":                           { scope: "env"      },
  "auth.email.smtp.admin_email":                    { scope: "env"      },
  "auth.email.smtp.sender_name":                    { scope: "env"      },
  // Email templates are promotable (they live in the repo)
  "auth.email.template.*.subject":                  { scope: "promote"  },
  "auth.email.template.*.content_path":             { scope: "promote"  },

  // ── Auth — hooks ─────────────────────────────────────────────────────────
  // enabled flag is promotable; uri and secrets are env-specific
  "auth.hook.*.enabled":                            { scope: "promote"  },
  "auth.hook.*.uri":                                { scope: "env"      },
  "auth.hook.*.secrets":                            { scope: "env"      },

  // ── Auth — MFA ───────────────────────────────────────────────────────────
  "auth.mfa.totp.enroll_enabled":                   { scope: "promote"  },
  "auth.mfa.totp.verify_enabled":                   { scope: "promote"  },
  "auth.mfa.phone.enroll_enabled":                  { scope: "promote"  },
  "auth.mfa.phone.verify_enabled":                  { scope: "promote"  },
  "auth.mfa.phone.otp_length":                      { scope: "promote"  },
  "auth.mfa.phone.template":                        { scope: "promote"  },
  "auth.mfa.phone.max_frequency":                   { scope: "promote"  },
  "auth.mfa.max_enrolled_factors":                  { scope: "promote"  },

  // ── Auth — sessions ──────────────────────────────────────────────────────
  "auth.sessions.timebox":                          { scope: "promote"  },
  "auth.sessions.inactivity_timeout":               { scope: "promote"  },

  // ── Auth — SMS ───────────────────────────────────────────────────────────
  "auth.sms.enable_signup":                         { scope: "promote"  },
  "auth.sms.enable_confirmations":                  { scope: "promote"  },
  "auth.sms.template":                              { scope: "promote"  },
  "auth.sms.max_frequency":                         { scope: "promote"  },
  "auth.sms.test_otp":                              { scope: "promote"  },
  // Twilio
  "auth.sms.twilio.enabled":                        { scope: "promote"  },
  "auth.sms.twilio.account_sid":                    { scope: "env"      },
  "auth.sms.twilio.message_service_sid":            { scope: "env"      },
  "auth.sms.twilio.auth_token":                     { scope: "env"      },
  // Twilio Verify
  "auth.sms.twilio_verify.enabled":                 { scope: "promote"  },
  "auth.sms.twilio_verify.account_sid":             { scope: "env"      },
  "auth.sms.twilio_verify.message_service_sid":     { scope: "env"      },
  "auth.sms.twilio_verify.auth_token":              { scope: "env"      },
  // MessageBird
  "auth.sms.messagebird.enabled":                   { scope: "promote"  },
  "auth.sms.messagebird.originator":                { scope: "env"      },
  "auth.sms.messagebird.api_key":                   { scope: "env"      },
  // Textlocal
  "auth.sms.textlocal.enabled":                     { scope: "promote"  },
  "auth.sms.textlocal.sender":                      { scope: "env"      },
  "auth.sms.textlocal.api_key":                     { scope: "env"      },
  // Vonage
  "auth.sms.vonage.enabled":                        { scope: "promote"  },
  "auth.sms.vonage.from":                           { scope: "env"      },
  "auth.sms.vonage.api_key":                        { scope: "env"      },
  "auth.sms.vonage.api_secret":                     { scope: "env"      },

  // ── Auth — external OAuth providers ─────────────────────────────────────
  // enabled and skip_nonce_check are promotable;
  // credentials and URLs are env-specific
  "auth.external.*.enabled":                        { scope: "promote"  },
  "auth.external.*.skip_nonce_check":               { scope: "promote"  },
  "auth.external.*.client_id":                      { scope: "env"      },
  "auth.external.*.secret":                         { scope: "env"      },
  "auth.external.*.url":                            { scope: "env"      },
  "auth.external.*.redirect_uri":                   { scope: "env"      },

  // ── Database ─────────────────────────────────────────────────────────────
  "db.port":                                        { scope: "env"      },
  "db.shadow_port":                                 { scope: "env"      },
  "db.major_version":                               { scope: "metadata" },
  "db.pooler.enabled":                              { scope: "promote"  },
  "db.pooler.port":                                 { scope: "env"      },
  "db.pooler.pool_mode":                            { scope: "promote"  },
  "db.pooler.default_pool_size":                    { scope: "promote"  },
  "db.pooler.max_client_conn":                      { scope: "promote"  },
  "db.seed.enabled":                                { scope: "promote"  },
  "db.seed.sql_paths":                              { scope: "promote"  },

  // ── Edge Runtime ─────────────────────────────────────────────────────────
  "edge_runtime.enabled":                           { scope: "promote"  },
  "edge_runtime.policy":                            { scope: "promote"  },
  "edge_runtime.inspector_port":                    { scope: "env"      },

  // ── Experimental ─────────────────────────────────────────────────────────
  "experimental.orioledb_version":                  { scope: "promote"  },
  "experimental.s3_host":                           { scope: "env"      },
  "experimental.s3_region":                         { scope: "env"      },
  "experimental.s3_access_key":                     { scope: "env"      },
  "experimental.s3_secret_key":                     { scope: "env"      },

  // ── Functions ────────────────────────────────────────────────────────────
  "functions.*.enabled":                            { scope: "promote"  },
  "functions.*.verify_jwt":                         { scope: "promote"  },
  "functions.*.import_map":                         { scope: "promote"  },
  "functions.*.entrypoint":                         { scope: "promote"  },

  // ── Inbucket (local email testing) ──────────────────────────────────────
  "inbucket.enabled":                               { scope: "promote"  },
  "inbucket.port":                                  { scope: "env"      },
  "inbucket.smtp_port":                             { scope: "env"      },
  "inbucket.pop3_port":                             { scope: "env"      },

  // ── Realtime ─────────────────────────────────────────────────────────────
  "realtime.enabled":                               { scope: "promote"  },
  "realtime.ip_version":                            { scope: "promote"  },
  "realtime.max_header_length":                     { scope: "promote"  },

  // ── Storage ──────────────────────────────────────────────────────────────
  "storage.enabled":                                { scope: "promote"  },
  "storage.file_size_limit":                        { scope: "promote"  },
  "storage.image_transformation.enabled":           { scope: "promote"  },
  "storage.buckets.*.public":                       { scope: "promote"  },
  "storage.buckets.*.file_size_limit":              { scope: "promote"  },
  "storage.buckets.*.allowed_mime_types":           { scope: "promote"  },
  "storage.buckets.*.objects_path":                 { scope: "promote"  },

  // ── Studio ───────────────────────────────────────────────────────────────
  "studio.enabled":                                 { scope: "promote"  },
  "studio.port":                                    { scope: "env"      },
  "studio.api_url":                                 { scope: "env"      },
  "studio.openai_api_key":                          { scope: "env"      },
};

/**
 * Resolve the scope for a concrete config path.
 *
 * Resolution order:
 *   1. Exact match
 *   2. Wildcard patterns — longest matching pattern wins
 *   3. Falls back to "promote" (unknown fields are assumed safe to promote)
 */
export function getFieldScope(configPath: string): FieldScope {
  // 1. Exact match
  if (configPath in FIELD_META) {
    return FIELD_META[configPath].scope;
  }

  // 2. Wildcard match — find all patterns that match, pick the longest
  const parts = configPath.split(".");
  let bestMatch: { pattern: string; scope: FieldScope } | null = null;

  for (const [pattern, meta] of Object.entries(FIELD_META)) {
    if (!pattern.includes("*")) continue;

    const patternParts = pattern.split(".");
    if (patternParts.length !== parts.length) continue;

    const matches = patternParts.every(
      (p, i) => p === "*" || p === parts[i]
    );

    if (matches) {
      if (!bestMatch || pattern.length > bestMatch.pattern.length) {
        bestMatch = { pattern, scope: meta.scope };
      }
    }
  }

  if (bestMatch) return bestMatch.scope;

  // 3. Unknown field — assume promotable
  return "promote";
}

/**
 * Whether a config field is safe to apply to production on branch merge.
 */
export function isPromotable(configPath: string): boolean {
  return getFieldScope(configPath) === "promote";
}

/**
 * Whether a config field is environment-specific (credential, URL, port).
 */
export function isEnvSpecific(configPath: string): boolean {
  return getFieldScope(configPath) === "env";
}

/**
 * Filter an object of config diffs, returning only the promotable fields.
 * Used by the platform to determine what to apply when a branch merges.
 */
export function filterPromotableFields(
  diffs: Record<string, { oldValue: unknown; newValue: unknown }>
): Record<string, { oldValue: unknown; newValue: unknown }> {
  return Object.fromEntries(
    Object.entries(diffs).filter(([path]) => isPromotable(path))
  );
}
