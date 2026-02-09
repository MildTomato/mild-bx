/**
 * Environment variable diff comparison and formatting
 */
import type { EnvVariable, EnvDiffEntry } from "./env-types.js";

/**
 * Compute diff between local and remote environment variables
 */
export function computeEnvDiff(
  localVars: EnvVariable[],
  remoteVars: EnvVariable[],
  options: { prune?: boolean } = {}
): EnvDiffEntry[] {
  const diffs: EnvDiffEntry[] = [];
  const localMap = new Map(localVars.map((v) => [v.key, v]));
  const remoteMap = new Map(remoteVars.map((v) => [v.key, v]));

  // Check for additions and changes
  for (const localVar of localVars) {
    const remoteVar = remoteMap.get(localVar.key);

    if (!remoteVar) {
      // New variable
      diffs.push({
        key: localVar.key,
        type: "added",
        localValue: localVar.value,
        secret: localVar.secret,
      });
    } else if (localVar.value !== remoteVar.value) {
      // Changed variable (value differs)
      diffs.push({
        key: localVar.key,
        type: "changed",
        localValue: localVar.value,
        remoteValue: remoteVar.value,
        secret: localVar.secret || remoteVar.secret,
      });
    }
    // Note: secret flag changes without value changes are not tracked
    // as the spec requires preserving the existing secret status
  }

  // Check for removals (only if prune is enabled)
  if (options.prune) {
    for (const remoteVar of remoteVars) {
      if (!localMap.has(remoteVar.key)) {
        diffs.push({
          key: remoteVar.key,
          type: "removed",
          remoteValue: remoteVar.value,
          secret: remoteVar.secret,
        });
      }
    }
  }

  return diffs;
}

/**
 * Format diff entries for terminal display with color and symbols
 */
export function formatEnvDiff(diffs: EnvDiffEntry[]): string {
  if (diffs.length === 0) {
    return "No changes detected.";
  }

  const lines: string[] = [];

  // Group by type for cleaner output
  const additions = diffs.filter((d) => d.type === "added");
  const changes = diffs.filter((d) => d.type === "changed");
  const removals = diffs.filter((d) => d.type === "removed");

  if (additions.length > 0) {
    lines.push("\nAdditions:");
    for (const diff of additions) {
      const value = diff.secret ? "[secret]" : diff.localValue;
      lines.push(`  + ${diff.key}=${value}`);
    }
  }

  if (changes.length > 0) {
    lines.push("\nChanges:");
    for (const diff of changes) {
      const oldValue = diff.secret ? "[secret]" : diff.remoteValue;
      const newValue = diff.secret ? "[secret]" : diff.localValue;
      lines.push(`  ~ ${diff.key}`);
      lines.push(`      old: ${oldValue}`);
      lines.push(`      new: ${newValue}`);
    }
  }

  if (removals.length > 0) {
    lines.push("\nRemovals:");
    for (const diff of removals) {
      const value = diff.secret ? "[secret]" : diff.remoteValue;
      lines.push(`  - ${diff.key}=${value}`);
    }
  }

  return lines.join("\n");
}

/**
 * Check if there are any actual changes in the diff
 */
export function hasChanges(diffs: EnvDiffEntry[]): boolean {
  return diffs.length > 0;
}

/**
 * Get summary counts for diff
 */
export function getDiffSummary(diffs: EnvDiffEntry[]): {
  additions: number;
  changes: number;
  removals: number;
} {
  return {
    additions: diffs.filter((d) => d.type === "added").length,
    changes: diffs.filter((d) => d.type === "changed").length,
    removals: diffs.filter((d) => d.type === "removed").length,
  };
}
