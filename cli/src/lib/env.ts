/**
 * Runtime environment configuration.
 * Override these to point the CLI at a local or staging Supabase instance.
 *
 * SUPABASE_API_URL       — Management API base URL (default: https://api.supabase.com)
 * SUPABASE_DASHBOARD_URL — Dashboard base URL, used for login flow and links
 *                          (default: https://supabase.com/dashboard)
 */

export const SUPABASE_API_URL =
  process.env.SUPABASE_API_URL ?? "https://api.supabase.com";

export const SUPABASE_DASHBOARD_URL =
  process.env.SUPABASE_DASHBOARD_URL ?? "https://supabase.com/dashboard";

/**
 * Derive the project API URL from the database host returned by the management API.
 * e.g. "db.xyz.supabase.co" → "https://xyz.supabase.co"
 */
export function projectUrlFromDbHost(dbHost: string, projectRef: string): string {
  // db host format: db.<ref>.<domain>
  const prefix = `db.${projectRef}.`;
  const domain = dbHost.startsWith(prefix) ? dbHost.slice(prefix.length) : dbHost;
  return `https://${projectRef}.${domain}`;
}

/**
 * Derive the database host from itself (passthrough for consistency).
 * The raw db_host from the API is already in the correct format.
 */
export function projectDbHost(dbHost: string): string {
  return dbHost;
}
