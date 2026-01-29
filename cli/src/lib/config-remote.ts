/**
 * Build local config from remote API responses
 * Reverse mapping from Management API to config.json structure
 */

import type { ApiConfig, AuthConfig } from "./config-types.js";

/**
 * Build config.json api section from remote PostgREST config
 */
export function buildApiConfigFromRemote(
  remote: Record<string, unknown>,
): ApiConfig {
  const config: ApiConfig = {};

  if (remote.db_schema) {
    config.schemas = String(remote.db_schema)
      .split(",")
      .map((s) => s.trim());
  }
  if (remote.db_extra_search_path) {
    config.extra_search_path = String(remote.db_extra_search_path)
      .split(",")
      .map((s) => s.trim());
  }
  if (remote.max_rows !== undefined && remote.max_rows !== null) {
    config.max_rows = Number(remote.max_rows);
  }

  return config;
}

/**
 * Build config.json auth section from remote Auth config
 */
export function buildAuthConfigFromRemote(
  remote: Record<string, unknown>,
): AuthConfig {
  const config: AuthConfig = {};

  if (remote.site_url !== undefined) {
    config.site_url = String(remote.site_url);
  }
  if (remote.uri_allow_list !== undefined && remote.uri_allow_list !== "") {
    config.additional_redirect_urls = String(remote.uri_allow_list)
      .split(",")
      .map((s) => s.trim());
  }
  if (remote.jwt_exp !== undefined) {
    config.jwt_expiry = Number(remote.jwt_exp);
  }
  if (remote.disable_signup !== undefined) {
    config.enable_signup = !remote.disable_signup;
  }
  if (remote.external_anonymous_users_enabled !== undefined) {
    config.enable_anonymous_sign_ins = Boolean(
      remote.external_anonymous_users_enabled,
    );
  }

  return config;
}
