/**
 * Implicit binding resolution engine.
 * Resolves environment variables for enabled features by checking multiple sources.
 * Pure logic - uses an injected ValueLookup for all I/O.
 */
import type { ProjectConfig } from "./types.js";
import type { FeatureRequirement, FeatureVariable } from "./feature-registry.js";
import { getNestedValue, isEnvVarBinding, parseEnvVarBinding } from "./env-var-mapping.js";

/**
 * Injected value lookup function.
 * The CLI provides this, typically reading from process.env / .env files.
 */
export type ValueLookup = (varName: string) => string | undefined;

export interface ResolvedVariable {
  configPath: string;
  canonicalName: string;
  value: string | undefined;
  source: "hardcoded" | "explicit_env_ref" | "implicit_canonical" | "missing";
  secret: boolean;
}

export interface BindingDiagnostic {
  level: "error" | "warning" | "info";
  message: string;
  configPath: string;
  canonicalName: string;
  suggestion?: string;
}

/**
 * Resolve a single variable using the resolution order:
 * 1. Hardcoded value in config (non-env() string)
 * 2. Explicit env() reference in config
 * 3. Implicit canonical name lookup
 * 4. Missing
 */
export function resolveVariable(
  variable: FeatureVariable,
  config: ProjectConfig,
  lookup: ValueLookup
): ResolvedVariable {
  const configValue = getNestedValue(config, variable.configPath);

  // 1. Check for explicit env() reference
  if (typeof configValue === "string" && isEnvVarBinding(configValue)) {
    const envVarName = parseEnvVarBinding(configValue)!;
    const value = lookup(envVarName);
    return {
      configPath: variable.configPath,
      canonicalName: variable.canonicalName,
      value,
      source: "explicit_env_ref",
      secret: variable.secret,
    };
  }

  // 2. Hardcoded non-empty value in config
  if (
    configValue !== undefined &&
    configValue !== null &&
    configValue !== ""
  ) {
    return {
      configPath: variable.configPath,
      canonicalName: variable.canonicalName,
      value: String(configValue),
      source: "hardcoded",
      secret: variable.secret,
    };
  }

  // 3. Implicit canonical name lookup
  const implicitValue = lookup(variable.canonicalName);
  if (implicitValue !== undefined) {
    return {
      configPath: variable.configPath,
      canonicalName: variable.canonicalName,
      value: implicitValue,
      source: "implicit_canonical",
      secret: variable.secret,
    };
  }

  // 4. Missing
  return {
    configPath: variable.configPath,
    canonicalName: variable.canonicalName,
    value: undefined,
    source: "missing",
    secret: variable.secret,
  };
}

/**
 * Resolve all variables for the given enabled features
 */
export function resolveAllVariables(
  features: FeatureRequirement[],
  config: ProjectConfig,
  lookup: ValueLookup
): ResolvedVariable[] {
  const results: ResolvedVariable[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    for (const variable of feature.variables) {
      if (seen.has(variable.configPath)) continue;
      seen.add(variable.configPath);
      results.push(resolveVariable(variable, config, lookup));
    }
  }

  return results;
}

/**
 * Diagnose binding issues from resolved variables
 */
export function diagnoseBindings(
  resolved: ResolvedVariable[],
  features: FeatureRequirement[]
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];

  // Build a lookup of which variables are required
  const requiredSet = new Set<string>();
  for (const feature of features) {
    for (const variable of feature.variables) {
      if (variable.required) {
        requiredSet.add(variable.configPath);
      }
    }
  }

  for (const r of resolved) {
    const isRequired = requiredSet.has(r.configPath);

    // Error: required variable is missing
    if (r.source === "missing" && isRequired) {
      diagnostics.push({
        level: "error",
        message: `Required variable ${r.canonicalName} is not set`,
        configPath: r.configPath,
        canonicalName: r.canonicalName,
        suggestion: r.secret
          ? `Add to supabase/.env:\n  # @secret\n  ${r.canonicalName}=your-value`
          : `Add to supabase/.env:\n  ${r.canonicalName}=your-value`,
      });
    }

    // Warning: sensitive field is hardcoded
    if (r.source === "hardcoded" && r.secret) {
      diagnostics.push({
        level: "warning",
        message: `Sensitive field ${r.configPath} is hardcoded in config.json`,
        configPath: r.configPath,
        canonicalName: r.canonicalName,
        suggestion: `Move to supabase/.env:\n  # @secret\n  ${r.canonicalName}=${r.value}\n\nThen remove from config.json (implicit binding will resolve it automatically)`,
      });
    }

    // Info: variable resolved via explicit env ref
    if (r.source === "explicit_env_ref" && r.value === undefined) {
      const configValue = r.canonicalName; // The env var name from the ref
      diagnostics.push({
        level: "error",
        message: `env() reference in config points to unset variable`,
        configPath: r.configPath,
        canonicalName: r.canonicalName,
        suggestion: `Set the environment variable or add it to supabase/.env`,
      });
    }
  }

  return diagnostics;
}

/**
 * Format diagnostics as a plain string with actionable suggestions
 */
export function formatDiagnostics(diagnostics: BindingDiagnostic[]): string {
  if (diagnostics.length === 0) return "";

  const lines: string[] = [];
  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");

  if (errors.length > 0) {
    lines.push(`${errors.length} error(s):\n`);
    for (const d of errors) {
      lines.push(`  ${d.message}`);
      if (d.suggestion) {
        lines.push(`  ${d.suggestion}`);
      }
      lines.push("");
    }
  }

  if (warnings.length > 0) {
    lines.push(`${warnings.length} warning(s):\n`);
    for (const d of warnings) {
      lines.push(`  ${d.message}`);
      if (d.suggestion) {
        lines.push(`  ${d.suggestion}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
