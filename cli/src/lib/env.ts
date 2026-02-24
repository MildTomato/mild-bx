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
