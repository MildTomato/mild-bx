/**
 * Canonical environment variable name mapping
 * Maps config.json paths to SUPABASE_* canonical names
 */
import type { ProjectConfig } from "./types.js";
import { getSensitiveFields } from "./feature-registry.js";

/**
 * Convert a config path to canonical SUPABASE_* environment variable name
 * Example: "auth.external.google.secret" -> "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET"
 */
export function configPathToEnvVar(configPath: string): string {
  const normalized = configPath
    .replace(/\./g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .toUpperCase();

  return `SUPABASE_${normalized}`;
}

/**
 * Check if a value uses env() reference syntax
 */
export function isEnvVarBinding(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^env\([A-Z_][A-Z0-9_]*\)$/.test(value);
}

/**
 * Extract variable name from env() binding
 * Returns null if not an env() binding
 */
export function parseEnvVarBinding(value: string): string | null {
  const match = value.match(/^env\(([A-Z_][A-Z0-9_]*)\)$/);
  return match ? match[1] : null;
}

/**
 * Get nested value from object using dot notation path
 */
export function getNestedValue(obj: unknown, path: string): unknown {
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
 * Walk config object and check for hardcoded sensitive values
 * Returns array of error messages for any violations
 */
export function validateNoHardcodedSecrets(
  config: ProjectConfig
): string[] {
  const errors: string[] = [];
  const sensitiveFields = getSensitiveFields();

  for (const field of sensitiveFields) {
    const value = getNestedValue(config, field.configPath);

    // Skip if field is not set
    if (value === undefined || value === null || value === "") {
      continue;
    }

    // Check if it's an env() binding
    if (isEnvVarBinding(value)) {
      continue;
    }

    // Found a hardcoded sensitive value
    const command = `supa project env set ${field.canonicalName} "your-value" --env development --secret`;

    errors.push(
      `Error: ${field.configPath} is a sensitive field and cannot be hardcoded in config.json.\n\n` +
        `Set it with:\n  ${command}\n\n` +
        `Or add it to supabase/.env for local development:\n  ${field.canonicalName}=your-value`
    );
  }

  return errors;
}

/**
 * Generate suggested environment variable name for a config path
 */
export function suggestEnvVarName(configPath: string): string {
  return configPathToEnvVar(configPath);
}
