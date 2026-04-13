import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scopedVarName, type Scope } from "@supabase-dx/env-vars";
import { sanitizeBranchName } from "./config-overlay.js";
import { configPathToEnvVar, getSchemaSecretPathForEnvVar, isSchemaSecretPath, makeEnvRef } from "./config-ref.js";
import { writeJsonAtomic } from "./fs-atomic.js";

export interface ConfigSecretTarget {
  path: string;
  envVar: string;
}

export function resolveConfigSecretTarget(input: string): ConfigSecretTarget {
  const schemaPath = getSchemaSecretPathForEnvVar(input);
  if (schemaPath) return { path: schemaPath, envVar: input };
  if (!isSchemaSecretPath(input)) {
    throw new Error(`${input} is not a config secret field`);
  }
  return { path: input, envVar: configPathToEnvVar(input) };
}

export function configSecretScope(options: {
  isBranch: boolean;
  branch: string;
  explicitScope?: Scope;
  explicitBranch?: string;
}): { scope: Scope; branch?: string } {
  if (options.explicitScope === "branch") {
    return { scope: "branch", branch: options.explicitBranch ?? options.branch };
  }
  if (options.explicitScope) return { scope: options.explicitScope };
  if (options.isBranch) return { scope: "branch", branch: options.branch };
  return { scope: "production" };
}

export function envServerScope(scope: Scope, branch?: string): "production" | "preview" | "development" | `branch:${string}` {
  return scope === "branch" ? `branch:${branch}` : scope;
}

export function scopedConfigSecretName(envVar: string, scope: Scope, branch?: string): string {
  return scopedVarName(envVar, scope, branch);
}

export function configSecretLayerFile(scope: Scope, branch?: string): string {
  if (scope === "production") return "config.production.json";
  if (scope === "preview") return "config.preview.json";
  if (scope === "development") return "config.json";
  if (!branch) throw new Error("branch is required for branch config secrets");
  return `config.${sanitizeBranchName(branch)}.json`;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (next && typeof next === "object" && !Array.isArray(next)) {
      cur = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cur[part] = created;
      cur = created;
    }
  }
  cur[parts[parts.length - 1]] = value;
}

export function writeConfigSecretRef(options: {
  cwd: string;
  scope: Scope;
  branch?: string;
  path: string;
  envVar: string;
}): string {
  const file = configSecretLayerFile(options.scope, options.branch);
  const filePath = join(options.cwd, "supabase", file);
  const json = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
    : {};
  setPath(json, options.path, makeEnvRef(options.envVar));
  writeJsonAtomic(filePath, json);
  return file;
}
