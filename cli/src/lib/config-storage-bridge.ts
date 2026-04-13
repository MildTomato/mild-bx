/**
 * Config storage bridge — talks to the local env-server config storage endpoints.
 *
 * The CLI owns file discovery and config resolution. env-server receives
 * semantic config states, not filenames:
 *   - environment/development
 *   - environment/preview
 *   - environment/production
 *   - branch/<environment>/<git branch>
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getEnvironmentForBranch, loadProjectConfig } from "./config.js";
import { sanitizeBranchName } from "./config-overlay.js";

const ENV_SERVER_URL = process.env.ENV_SERVER_URL ?? "http://localhost:3457";

function encSegment(s: string): string {
  return encodeURIComponent(s);
}

async function configFetch(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${ENV_SERVER_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`config-storage ${options?.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res;
}

export interface EnvSnapshot {
  id: number;
  gitBranch: string;
  envName: string;
  target?: ConfigStateTarget;
  layers?: string[];
  committedAt: string;
  config: Record<string, unknown>;
}

export interface BranchSummary {
  gitBranch: string;
  lastCommittedAt: string;
  envCount: number;
}

export interface ConfigDiffResult {
  from: string;
  to: string;
  env?: string;
  targetKey?: string;
  target?: ConfigStateTarget;
  hasChanges: boolean;
  added: Array<{ path: string; value: unknown }>;
  changed: Array<{ path: string; from: unknown; to: unknown }>;
  removed: Array<{ path: string; value: unknown }>;
}

export type ConfigStateTarget =
  | { type: "environment"; environment: string }
  | { type: "branch"; environment: string; branch: string };

export interface ConfigStateCommit {
  target: ConfigStateTarget;
  sources: ConfigStateSource[];
}

export interface ConfigStateSource {
  name: string;
  path: string;
  config: Record<string, unknown>;
}

/**
 * Commit a resolved config snapshot for one env layer on a git branch.
 */
export async function commitConfig(
  projectRef: string,
  gitBranch: string,
  envName: string,
  config: Record<string, unknown>
): Promise<void> {
  await configFetch(`/projects/${projectRef}/config/${encSegment(gitBranch)}/${encSegment(envName)}`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/**
 * Get all env snapshots for a git branch.
 */
export async function getBranchSnapshots(
  projectRef: string,
  gitBranch: string
): Promise<EnvSnapshot[]> {
  const res = await configFetch(`/projects/${projectRef}/config-state/${encSegment(gitBranch)}`);
  const states = await res.json() as Array<{
    id: number;
    gitBranch: string;
    targetKey: string;
    target: ConfigStateTarget;
    sources: ConfigStateSource[];
    committedAt: string;
    resolved: Record<string, unknown>;
  }>;
  return states.map((state) => ({
    id: state.id,
    gitBranch: state.gitBranch,
    envName: state.targetKey,
    target: state.target,
    layers: state.sources.map((source) => source.name),
    committedAt: state.committedAt,
    config: state.resolved,
  }));
}

/**
 * List all git branches that have config snapshots for a project.
 */
export async function listConfigBranches(projectRef: string): Promise<BranchSummary[]> {
  const res = await configFetch(`/projects/${projectRef}/config`);
  return res.json() as Promise<BranchSummary[]>;
}

/**
 * Diff the same env layer between two git branches.
 */
export async function diffConfig(
  projectRef: string,
  from: string,
  to: string,
  env = "production"
): Promise<ConfigDiffResult> {
  const res = await configFetch(
    `/projects/${projectRef}/config-state/diff?from=${encSegment(from)}&to=${encSegment(to)}&type=environment&environment=${encSegment(env)}`
  );
  return res.json() as Promise<ConfigDiffResult>;
}

export async function commitConfigState(
  projectRef: string,
  gitBranch: string,
  states: ConfigStateCommit[],
): Promise<void> {
  await configFetch(`/projects/${projectRef}/config-state`, {
    method: "PUT",
    body: JSON.stringify({ gitBranch, states }),
  });
}

function loadJsonFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function configSourcesForTarget(options: {
  cwd: string;
  environment: string;
  branch?: string;
}): ConfigStateSource[] {
  const { cwd, environment, branch } = options;
  const supabaseDir = join(cwd, "supabase");
  const sources: ConfigStateSource[] = [];

  const basePath = join(supabaseDir, "config.json");
  const base = loadJsonFile(basePath);
  if (base) {
    sources.push({ name: "base", path: "supabase/config.json", config: base });
  }

  const envPath = join(supabaseDir, `config.${environment}.json`);
  if (environment !== "development" && existsSync(envPath)) {
    const envConfig = loadJsonFile(envPath);
    if (envConfig) {
      sources.push({
        name: environment,
        path: `supabase/config.${environment}.json`,
        config: envConfig,
      });
    }
  }

  if (branch && environment === "preview") {
    const sanitized = sanitizeBranchName(branch);
    const branchPath = join(supabaseDir, `config.${sanitized}.json`);
    if (existsSync(branchPath)) {
      const branchConfig = loadJsonFile(branchPath);
      if (branchConfig) {
        sources.push({
          name: `branch:${branch}`,
          path: `supabase/config.${sanitized}.json`,
          config: branchConfig,
        });
      }
    }
  }

  return sources;
}

/**
 * Commit semantic config states for the given git branch.
 *
 * The local file layout is translated into target semantics here. env-server
 * stores the target identity and resolved config, never a config filename.
 */
export async function commitAllConfigSnapshots(
  cwd: string,
  projectRef: string,
  gitBranch: string,
): Promise<void> {
  const supabaseDir = join(cwd, "supabase");
  const base = loadProjectConfig(cwd);
  if (!base) return;

  let files: string[];
  try {
    files = readdirSync(supabaseDir).filter(
      (f) => f.startsWith("config") && f.endsWith(".json"),
    );
  } catch {
    return;
  }

  const currentBranchFileSegment = sanitizeBranchName(gitBranch);
  const overlayNames = files
    .map((file) => /^config\.(.+)\.json$/.exec(file)?.[1])
    .filter((name): name is string => !!name);

  const states: ConfigStateCommit[] = [];

  const baseSource = configSourcesForTarget({ cwd, environment: "development" })[0];
  if (baseSource) {
    states.push({
      target: { type: "environment", environment: "base" },
      sources: [baseSource],
    });
  }

  const currentEnvironment = getEnvironmentForBranch(base, gitBranch);
  for (const overlayName of overlayNames) {
    if (overlayName === currentBranchFileSegment) {
      const sources = configSourcesForTarget({ cwd, environment: currentEnvironment, branch: gitBranch });
      if (sources.length === 0) continue;
      states.push({
        target: { type: "branch", environment: currentEnvironment, branch: gitBranch },
        sources,
      });
    } else {
      const sources = configSourcesForTarget({ cwd, environment: overlayName });
      if (sources.length === 0) continue;
      states.push({
        target: { type: "environment", environment: overlayName },
        sources,
      });
    }
  }

  if (states.length > 0) await commitConfigState(projectRef, gitBranch, states);
}
