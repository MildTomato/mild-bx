/**
 * Environment variable scoping utilities.
 *
 * Scope is encoded as a suffix on the variable name:
 *   VAR_NAME__production                  — production only (default)
 *   VAR_NAME__preview                     — all preview branches
 *   VAR_NAME__development                 — local development only
 *   VAR_NAME__preview__feat_my_branch     — specific preview branch (slashes → underscores)
 *
 * Reserved suffixes: production, preview, development.
 * Branch-specific overrides are nested under preview: __preview__<branch>.
 *
 * Bare VAR_NAME (no suffix) is treated as a legacy universal fallback
 * during resolution — it is not produced by this CLI.
 *
 * Resolution order (highest to lowest priority):
 *   Branch context:      VAR__preview__<branch> → VAR__preview → VAR__production → VAR
 *   Production context:  VAR__production → VAR
 *   Development context: VAR__development → VAR
 */

export type Scope = "production" | "preview" | "branch" | "development";

export type EnvironmentContext =
  | { type: "production" }
  | { type: "development" }
  | { type: "preview"; branch?: string };

const SCOPE_SEPARATOR = "__";
const RESERVED_SUFFIXES = new Set(["production", "preview", "development"]);

/**
 * Convert a git branch name to a scope suffix.
 * Replaces slashes and other non-alphanumeric chars with underscores.
 */
export function branchToScope(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Build the scoped secret name for a given var and scope.
 */
export function scopedVarName(
  varName: string,
  scope: Scope,
  branch?: string
): string {
  if (scope === "production") return `${varName}${SCOPE_SEPARATOR}production`;
  if (scope === "preview") return `${varName}${SCOPE_SEPARATOR}preview`;
  if (scope === "development") return `${varName}${SCOPE_SEPARATOR}development`;
  if (scope === "branch") {
    if (!branch) throw new Error("branch is required when scope is 'branch'");
    return `${varName}${SCOPE_SEPARATOR}preview${SCOPE_SEPARATOR}${branchToScope(branch)}`;
  }
  return varName;
}

/**
 * Extract the base var name and scope from a scoped secret name.
 * Returns scope: null for legacy bare variables (no suffix).
 */
export function parseScopedVarName(name: string): {
  base: string;
  scope: Scope | null;
  branch?: string;
} {
  const idx = name.indexOf(SCOPE_SEPARATOR);
  if (idx === -1) return { base: name, scope: null };

  const base = name.slice(0, idx);
  const suffix = name.slice(idx + SCOPE_SEPARATOR.length);

  if (RESERVED_SUFFIXES.has(suffix)) {
    return { base, scope: suffix as Scope };
  }

  // Branch-specific: __preview__<branch>
  const branchPrefix = `preview${SCOPE_SEPARATOR}`;
  if (suffix.startsWith(branchPrefix)) {
    return { base, scope: "branch", branch: suffix.slice(branchPrefix.length) };
  }

  return { base, scope: null };
}

/**
 * Given a flat list of scoped secret names and their values, resolve the
 * effective value for each base var name for a given environment context.
 *
 * Bare (unscoped) vars are treated as a universal fallback for legacy
 * compatibility — they are lowest priority in all contexts.
 */
export function resolveScoped(
  secrets: Array<{ name: string; value: string }>,
  context: EnvironmentContext
): Map<string, string> {
  const legacy = new Map<string, string>();       // bare VAR (no suffix, lowest priority)
  const contextScoped = new Map<string, string>(); // VAR__production / VAR__development
  const preview = new Map<string, string>();       // VAR__preview
  const branchSpecific = new Map<string, string>(); // VAR__<branch>

  const branchSuffix =
    context.type === "preview" && context.branch
      ? branchToScope(context.branch)
      : null;

  for (const { name, value } of secrets) {
    const parsed = parseScopedVarName(name);

    if (parsed.scope === null) {
      legacy.set(parsed.base, value);
    } else if (parsed.scope === context.type) {
      contextScoped.set(parsed.base, value);
    } else if (parsed.scope === "preview" && context.type === "preview") {
      preview.set(parsed.base, value);
    } else if (
      parsed.scope === "branch" &&
      context.type === "preview" &&
      parsed.branch === branchSuffix
    ) {
      branchSpecific.set(parsed.base, value);
    }
  }

  // Merge: legacy → context-scoped → preview → branch-specific
  const resolved = new Map(legacy);
  for (const [k, v] of contextScoped) resolved.set(k, v);
  for (const [k, v] of preview) resolved.set(k, v);
  for (const [k, v] of branchSpecific) resolved.set(k, v);

  return resolved;
}
