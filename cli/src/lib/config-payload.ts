/**
 * Build Management API payloads from local config.
 *
 * Promotable field mapping lives in @supabase-dx/config (remote-api-field-map).
 * This file only adds the env-specific fields that are CLI/deployment-specific:
 * site_url, redirect URLs, SMTP credentials, OAuth client_id/secret/url/redirect_uri.
 */

import { buildAuthApiPayload, buildPostgrestApiPayload } from "@supabase-dx/config";
import type { ProjectConfig } from "./config-types.js";
import { parseConfigRef } from "./config-ref.js";

export { buildPostgrestApiPayload as buildPostgrestPayload };

/**
 * Resolve a config value that may be a ref string.
 *
 * If the value is `env(VAR)` or `secret(VAR)`, calls `lookupEnvVar(VAR)` and
 * returns the result (or undefined if the lookup returns nothing).
 * Otherwise returns the value as-is.
 */
function resolveValue(
  value: unknown,
  lookupEnvVar?: (varName: string) => string | undefined
): unknown {
  const ref = parseConfigRef(value);
  if (ref) {
    if (!lookupEnvVar) return undefined;
    return lookupEnvVar(ref.varName);
  }
  return value;
}

/**
 * Build a full auth update payload: promotable fields from the shared map
 * plus env-specific deployment fields (site_url, SMTP, OAuth credentials).
 *
 * @param config        The project config object.
 * @param lookupEnvVar  Optional function to resolve `env(VAR)` / `secret(VAR)`
 *                      references in config values. When omitted, ref values
 *                      are omitted from the payload entirely.
 */
export function buildAuthPayload(
  config: ProjectConfig,
  lookupEnvVar?: (varName: string) => string | undefined
): Record<string, unknown> | null {
  const raw = config as Record<string, unknown>;
  const auth = config.auth as Record<string, unknown> | undefined;
  if (!auth) return null;

  // Promotable fields from shared map
  const payload = buildAuthApiPayload(raw);

  // ── Env-specific fields ───────────────────────────────────────────────────

  if (auth.site_url !== undefined) payload.site_url = auth.site_url;

  const redirectUrls = auth.additional_redirect_urls as string[] | undefined;
  if (redirectUrls !== undefined) payload.uri_allow_list = redirectUrls.join(",");

  // SMTP
  const email = auth.email as Record<string, unknown> | undefined;
  const smtp = email?.smtp as Record<string, unknown> | undefined;
  if (smtp) {
    if (smtp.host !== undefined)         payload.smtp_host = resolveValue(smtp.host, lookupEnvVar);
    if (smtp.port !== undefined)         payload.smtp_port = String(smtp.port);
    if (smtp.user !== undefined)         payload.smtp_user = resolveValue(smtp.user, lookupEnvVar);
    if (smtp.pass !== undefined)         payload.smtp_pass = resolveValue(smtp.pass, lookupEnvVar);
    if (smtp.admin_email !== undefined)  payload.smtp_admin_email = resolveValue(smtp.admin_email, lookupEnvVar);
    if (smtp.sender_name !== undefined)  payload.smtp_sender_name = resolveValue(smtp.sender_name, lookupEnvVar);
  }

  // External OAuth — env-specific credentials (must be explicit in config, no fallbacks)
  const external = auth.external as Record<string, Record<string, unknown>> | undefined;
  if (external) {
    for (const [provider, settings] of Object.entries(external)) {
      const prefix = `external_${provider}`;
      if (settings.enabled !== undefined) {
        const resolvedEnabled = resolveValue(settings.enabled, lookupEnvVar);
        if (resolvedEnabled !== undefined) {
          // Coerce string "true"/"false" (from env refs) to boolean
          payload[`${prefix}_enabled`] =
            typeof resolvedEnabled === "string"
              ? resolvedEnabled.toLowerCase() === "true" || resolvedEnabled === "1"
              : resolvedEnabled;
        }
      }
      if (settings.client_id !== undefined) {
        const resolved = resolveValue(settings.client_id, lookupEnvVar);
        if (resolved !== undefined) payload[`${prefix}_client_id`] = resolved;
      }
      if (settings.secret !== undefined) {
        const resolved = resolveValue(settings.secret, lookupEnvVar);
        if (resolved !== undefined) payload[`${prefix}_secret`] = resolved;
      }
      if (settings.redirect_uri !== undefined) {
        const resolved = resolveValue(settings.redirect_uri, lookupEnvVar);
        if (resolved !== undefined) payload[`${prefix}_redirect_uri`] = resolved;
      }
      if (settings.url !== undefined) {
        const resolved = resolveValue(settings.url, lookupEnvVar);
        if (resolved !== undefined) payload[`${prefix}_url`] = resolved;
      }
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

/**
 * Get list of what will be synced (for dry-run / preview)
 */
export function getSyncPreview(config: ProjectConfig): { postgrest: string[]; auth: string[] } {
  const postgrest: string[] = [];
  const auth: string[] = [];

  const postgrestPayload = buildPostgrestApiPayload(config as Record<string, unknown>);
  postgrest.push(...Object.keys(postgrestPayload));

  const authPayload = buildAuthPayload(config);
  if (authPayload) auth.push(...Object.keys(authPayload));

  return { postgrest, auth };
}
