/**
 * Build Management API payloads from local config.
 *
 * Promotable field mapping lives in @supabase-dx/config (remote-api-field-map).
 * This file only adds the env-specific fields that are CLI/deployment-specific:
 * site_url, redirect URLs, SMTP credentials, OAuth client_id/secret/url/redirect_uri.
 */

import { buildAuthApiPayload, buildPostgrestApiPayload } from "@supabase-dx/config";
import type { ProjectConfig } from "./config-types.js";

export { buildPostgrestApiPayload as buildPostgrestPayload };

/**
 * Build a full auth update payload: promotable fields from the shared map
 * plus env-specific deployment fields (site_url, SMTP, OAuth credentials).
 */
export function buildAuthPayload(config: ProjectConfig): Record<string, unknown> | null {
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
    if (smtp.host !== undefined)         payload.smtp_host = smtp.host;
    if (smtp.port !== undefined)         payload.smtp_port = String(smtp.port);
    if (smtp.user !== undefined)         payload.smtp_user = smtp.user;
    if (smtp.pass !== undefined)         payload.smtp_pass = smtp.pass;
    if (smtp.admin_email !== undefined)  payload.smtp_admin_email = smtp.admin_email;
    if (smtp.sender_name !== undefined)  payload.smtp_sender_name = smtp.sender_name;
  }

  // External OAuth — env-specific credentials (must be explicit in config, no fallbacks)
  const external = auth.external as Record<string, Record<string, unknown>> | undefined;
  if (external) {
    for (const [provider, settings] of Object.entries(external)) {
      const prefix = `external_${provider}`;
      if (settings.client_id !== undefined)   payload[`${prefix}_client_id`] = settings.client_id;
      if (settings.secret !== undefined)      payload[`${prefix}_secret`] = settings.secret;
      if (settings.redirect_uri !== undefined) payload[`${prefix}_redirect_uri`] = settings.redirect_uri;
      if (settings.url !== undefined)         payload[`${prefix}_url`] = settings.url;
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
