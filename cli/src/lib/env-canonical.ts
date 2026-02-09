/**
 * Canonical environment variable name mapping
 * Maps config.json paths to SUPABASE_* canonical names
 */
import type { ProjectConfig } from "./config-types.js";

/**
 * Convert a config path to canonical SUPABASE_* environment variable name
 * Example: "auth.external.google.secret" -> "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET"
 */
export function toCanonicalName(configPath: string): string {
  const normalized = configPath
    .replace(/\./g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .toUpperCase();

  return `SUPABASE_${normalized}`;
}

/**
 * Check if a value uses env() reference syntax
 */
export function isEnvRef(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^env\([A-Z_][A-Z0-9_]*\)$/.test(value);
}

/**
 * Extract variable name from env() reference
 * Returns null if not an env reference
 */
export function extractEnvRef(value: string): string | null {
  const match = value.match(/^env\(([A-Z_][A-Z0-9_]*)\)$/);
  return match ? match[1] : null;
}

/**
 * List of sensitive config field paths that must use env() references
 * These correspond to fields marked sensitive by the platform schema
 */
const SENSITIVE_FIELDS = [
  // Auth OAuth secrets
  "auth.external.apple.secret",
  "auth.external.azure.secret",
  "auth.external.bitbucket.secret",
  "auth.external.discord.secret",
  "auth.external.facebook.secret",
  "auth.external.figma.secret",
  "auth.external.github.secret",
  "auth.external.gitlab.secret",
  "auth.external.google.secret",
  "auth.external.kakao.secret",
  "auth.external.keycloak.secret",
  "auth.external.linkedin_oidc.secret",
  "auth.external.notion.secret",
  "auth.external.slack.secret",
  "auth.external.spotify.secret",
  "auth.external.twitch.secret",
  "auth.external.twitter.secret",
  "auth.external.workos.secret",
  "auth.external.zoom.secret",

  // SMTP credentials
  "auth.email.smtp.pass",

  // Storage S3 credentials (if added in future)
  "storage.s3.secret_access_key",
];

/**
 * Walk config object and check for hardcoded sensitive values
 * Returns array of error messages for any violations
 */
export function validateNoHardcodedSecrets(
  config: ProjectConfig
): string[] {
  const errors: string[] = [];

  for (const fieldPath of SENSITIVE_FIELDS) {
    const value = getNestedValue(config, fieldPath);

    // Skip if field is not set
    if (value === undefined || value === null || value === "") {
      continue;
    }

    // Check if it's an env() reference
    if (isEnvRef(value)) {
      continue;
    }

    // Found a hardcoded sensitive value
    const canonicalName = toCanonicalName(fieldPath);
    const command = `supa project env set ${canonicalName} "your-value" --env development --secret`;

    errors.push(
      `Error: ${fieldPath} is a sensitive field and cannot be hardcoded in config.json.\n\n` +
        `Set it with:\n  ${command}\n\n` +
        `Or add it to supabase/.env for local development:\n  ${canonicalName}=your-value`
    );
  }

  return errors;
}

/**
 * Get nested value from object using dot notation path
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Generate suggested environment variable name for a config path
 * Used in error messages and documentation
 */
export function suggestEnvVarName(configPath: string): string {
  return toCanonicalName(configPath);
}
