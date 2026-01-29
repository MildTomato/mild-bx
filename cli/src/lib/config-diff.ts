/**
 * Config diff comparison and formatting
 */

import type { ConfigDiff } from "./config-types.js";

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "undefined";
  if (typeof value === "string" && value === "") return "undefined";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

/**
 * Normalize a value for comparison
 * - undefined/null booleans are treated as false
 */
function normalizeForComparison(value: unknown): unknown {
  // Treat undefined/null as false for boolean comparisons
  if (value === undefined || value === null) {
    return false;
  }
  return value;
}

/**
 * Check if two values are equivalent
 */
function areValuesEqual(a: unknown, b: unknown): boolean {
  const normalizedA = normalizeForComparison(a);
  const normalizedB = normalizeForComparison(b);
  return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}

/**
 * Compare local payload with remote config and return all entries with change status
 */
export function compareConfigs(
  localPayload: Record<string, unknown>,
  remoteConfig: Record<string, unknown>,
): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];

  // Compare keys that are in the local payload (what we're explicitly setting)
  for (const [key, newValue] of Object.entries(localPayload)) {
    const oldValue = remoteConfig[key];
    const changed = !areValuesEqual(oldValue, newValue);

    diffs.push({
      key,
      oldValue,
      newValue,
      changed,
    });
  }

  return diffs;
}

/**
 * Format a diff for display
 */
export function formatDiff(diff: ConfigDiff): {
  key: string;
  old: string;
  new: string;
} {
  return {
    key: diff.key,
    old: formatValue(diff.oldValue),
    new: formatValue(diff.newValue),
  };
}
