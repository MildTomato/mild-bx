/**
 * Sentinel secret keys written by the CLI and read by the dashboard.
 * These are hidden from env var listings but used to communicate
 * project configuration state to the dashboard UI.
 */

/**
 * Written during `supa project env push` based on config.json `config_source`.
 * Value: "code" | "remote"
 * Dashboard reads this to show/hide the "managed in code" banner and
 * disable/enable direct var editing in the UI.
 */
export const SENTINEL_CONFIG_SOURCE = "SUPABASE_DX_CONFIG_SOURCE";

/**
 * All sentinel keys — used to filter them out of user-facing listings.
 */
export const SENTINEL_KEYS = new Set([SENTINEL_CONFIG_SOURCE]);
