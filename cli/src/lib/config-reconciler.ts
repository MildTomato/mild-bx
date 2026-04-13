import { join } from "node:path";
import chalk from "chalk";
import type { Branch, SupabaseClient } from "./api.js";
import type { ProjectConfig } from "./config-types.js";
import { loadEffectiveConfig } from "./config-overlay.js";
import {
  detectHardcodedSecrets,
  detectMissingSecrets,
  getEnvRefs,
  getSecretRefs,
  isSchemaSecretEnvVar,
  stripHardcodedSecrets,
} from "./config-ref.js";
import { buildAuthPayload, buildPostgrestPayload, compareConfigs } from "./sync.js";
import { listRemoteVariables } from "./env-api-bridge.js";
import { parseScopedVarName, scopedVarName, type Scope } from "@supabase-dx/env-vars";
import type { EnvVariable } from "./env-types.js";
import { createSpinner } from "@/components/output.js";

type TargetKind = "production" | "preview";

export interface ConfigReconcileTarget {
  kind: TargetKind;
  projectRef: string;
  branch?: string;
}

export interface ConfigReconcileResult {
  target: ConfigReconcileTarget;
  layers: string[];
  authChanges: number;
  apiChanges: number;
  missing: Array<{ path: string; envVarName?: string }>;
  warnings: string[];
  applied: boolean;
}

export interface ConfigReconcileOptions {
  cwd: string;
  parentProjectRef: string;
  currentProjectRef: string;
  currentBranch: string;
  isBranch: boolean;
  client: SupabaseClient;
  dryRun?: boolean;
  verbose?: boolean;
  includePreviewBranches?: "auto" | "all" | "none";
}

function verboseLog(enabled: boolean | undefined, message: string): void {
  if (enabled) process.stderr.write(`[config-sync] ${message}\n`);
}

function targetLabel(target: ConfigReconcileTarget): string {
  if (target.kind === "production") return `production (${target.projectRef})`;
  return `preview/${target.branch ?? "unknown"} (${target.projectRef})`;
}

function branchName(branch: Branch): string | undefined {
  return branch.git_branch ?? branch.name;
}

function resolveTargetScope(target: ConfigReconcileTarget): Scope {
  return target.kind === "production" ? "production" : "preview";
}

async function loadAllEnvVars(parentProjectRef: string): Promise<EnvVariable[]> {
  return listRemoteVariables(parentProjectRef);
}

function envValueLookup(vars: EnvVariable[], target: ConfigReconcileTarget): (key: string) => string | undefined {
  const byKey = new Map(vars.map((v) => [v.key, v.value]));
  return (key: string): string | undefined => {
    const candidates =
      target.kind === "preview"
        ? [
            target.branch ? scopedVarName(key, "branch", target.branch) : undefined,
            scopedVarName(key, "preview"),
            scopedVarName(key, "production"),
            key,
          ]
        : [
            scopedVarName(key, "production"),
            key,
          ];
    for (const candidate of candidates) {
      if (candidate && byKey.has(candidate)) return byKey.get(candidate);
    }
    return process.env[key];
  };
}

function hasPreviewWideConfigSecret(vars: EnvVariable[]): boolean {
  return vars.some((v) => {
    const parsed = parseScopedVarName(v.key);
    return parsed.scope === "preview" && isSchemaSecretEnvVar(parsed.base);
  });
}

async function resolveTargets(options: ConfigReconcileOptions, vars: EnvVariable[]): Promise<ConfigReconcileTarget[]> {
  const targets: ConfigReconcileTarget[] = [{
    kind: options.isBranch ? "preview" : "production",
    projectRef: options.currentProjectRef,
    branch: options.isBranch ? options.currentBranch : undefined,
  }];

  const includePreview =
    options.includePreviewBranches === "all" ||
    (options.includePreviewBranches === "auto" && hasPreviewWideConfigSecret(vars));

  if (!includePreview) return targets;

  verboseLog(options.verbose, "preview-wide config secret detected; resolving all preview branches");
  const branches = await options.client.listBranches(options.parentProjectRef);
  for (const branch of branches) {
    const branchRef = branch.project_ref;
    const gitBranch = branchName(branch);
    if (!branchRef || !gitBranch) continue;
    if (targets.some((t) => t.projectRef === branchRef)) continue;
    targets.push({ kind: "preview", projectRef: branchRef, branch: gitBranch });
  }
  return targets;
}

export async function reconcileConfigTargets(options: ConfigReconcileOptions): Promise<ConfigReconcileResult[]> {
  const spinner = createSpinner();
  spinner.start("Resolving config env values...");
  const vars = await loadAllEnvVars(options.parentProjectRef);
  spinner.stop(`Resolved ${vars.length} env value${vars.length === 1 ? "" : "s"}`);
  verboseLog(options.verbose, `loaded env vars: ${vars.map((v) => `${v.key}[${v.scope ?? "unknown"}]`).join(", ") || "(none)"}`);

  spinner.start("Resolving config targets...");
  const targets = await resolveTargets(options, vars);
  spinner.stop(`Resolved ${targets.length} config target${targets.length === 1 ? "" : "s"}`);
  verboseLog(options.verbose, `targets: ${targets.map(targetLabel).join(", ")}`);

  const results: ConfigReconcileResult[] = [];

  for (const target of targets) {
    spinner.start(`Resolving config for ${targetLabel(target)}...`);
    const env = resolveTargetScope(target);
    const { config, layers } = loadEffectiveConfig(options.cwd, env, target.branch);
    const lookup = envValueLookup(vars, target);
    const supabaseDir = join(options.cwd, "supabase");
    const hardcoded = detectHardcodedSecrets(supabaseDir, layers);
    const safeConfig = hardcoded.length > 0 ? stripHardcodedSecrets(config) : config;
    const missing = detectMissingSecrets(safeConfig, lookup);
    const refs = [...getEnvRefs(safeConfig).keys(), ...getSecretRefs(safeConfig).keys()];
    const missingRefs = refs
      .filter((key) => !lookup(key))
      .map((key) => ({ path: key, envVarName: key }));
    const allMissing = [...missing, ...missingRefs];
    spinner.stop(`Resolved config for ${targetLabel(target)}`);
    verboseLog(options.verbose, `${targetLabel(target)} layers: ${layers.join(" + ")}`);

    if (allMissing.length > 0) {
      results.push({
        target,
        layers,
        authChanges: 0,
        apiChanges: 0,
        missing: allMissing,
        warnings: hardcoded.map((s) => `Hardcoded secret skipped: ${s.path}`),
        applied: false,
      });
      continue;
    }

    spinner.start(`Checking remote config for ${targetLabel(target)}...`);
    const [remoteAuth, remoteApi] = await Promise.all([
      options.client.getAuthConfig(target.projectRef),
      options.client.getPostgrestConfig(target.projectRef),
    ]);
    const authPayload = buildAuthPayload(safeConfig, lookup);
    const apiPayload = buildPostgrestPayload(safeConfig);
    const authDiffs = authPayload
      ? compareConfigs(authPayload, remoteAuth as Record<string, unknown>).filter((d) => d.changed)
      : [];
    const apiDiffs = apiPayload
      ? compareConfigs(apiPayload, remoteApi as Record<string, unknown>).filter((d) => d.changed)
      : [];
    spinner.stop(`Checked remote config for ${targetLabel(target)}`);
    verboseLog(options.verbose, `${targetLabel(target)} auth changes=${authDiffs.length} api changes=${apiDiffs.length}`);

    if (!options.dryRun) {
      spinner.start(`Applying config to ${targetLabel(target)}...`);
      if (apiPayload && apiDiffs.length > 0) {
        verboseLog(options.verbose, `PATCH /v1/projects/${target.projectRef}/config/postgrest`);
        await options.client.updatePostgrestConfig(target.projectRef, apiPayload);
      }
      if (authPayload && authDiffs.length > 0) {
        verboseLog(options.verbose, `PATCH /v1/projects/${target.projectRef}/config/auth`);
        await options.client.updateAuthConfig(target.projectRef, authPayload);
      }
      spinner.stop(`Applied config to ${chalk.cyan(targetLabel(target))}`);
    }

    results.push({
      target,
      layers,
      authChanges: authDiffs.length,
      apiChanges: apiDiffs.length,
      missing: [],
      warnings: hardcoded.map((s) => `Hardcoded secret skipped: ${s.path}`),
      applied: !options.dryRun && (authDiffs.length > 0 || apiDiffs.length > 0),
    });
  }

  return results;
}
