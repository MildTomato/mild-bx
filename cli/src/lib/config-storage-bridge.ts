/**
 * Config storage bridge — talks to the local env-server config storage endpoints.
 *
 * Snapshots are keyed by (projectRef, gitBranch, envName):
 *   gitBranch  = the checked-out git branch when the snapshot was taken
 *   envName    = config layer derived from the filename
 *                "production" → config.production.json
 *                "preview"    → config.preview.json
 *                "feat-auth"  → config.feat-auth.json (branch overlay in preview)
 *
 * This lets Studio answer: "if I merge feat/my-feature into main, how does the
 * PRODUCTION config change?" — by diffing feat/my-feature/production vs main/production.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEffectiveConfig } from "./config-overlay.js";

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
  env: string;
  hasChanges: boolean;
  added: Array<{ path: string; value: unknown }>;
  changed: Array<{ path: string; from: unknown; to: unknown }>;
  removed: Array<{ path: string; value: unknown }>;
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
  const res = await configFetch(`/projects/${projectRef}/config/${encSegment(gitBranch)}`);
  return res.json() as Promise<EnvSnapshot[]>;
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
  env: string
): Promise<ConfigDiffResult> {
  const res = await configFetch(
    `/projects/${projectRef}/config/diff?from=${encSegment(from)}&to=${encSegment(to)}&env=${encSegment(env)}`
  );
  return res.json() as Promise<ConfigDiffResult>;
}

/**
 * Commit config snapshots for every env layer found in supabase/ for the
 * given git branch.
 *
 * For each config*.json file:
 *   config.json              → envName = "base"  (the unmerged base)
 *   config.<name>.json       → envName = "<name>" with merged effective config
 *
 * Called on `supa dev` startup so Studio always has fresh snapshots for every
 * env layer, not just the currently active one.
 */
export async function commitAllConfigSnapshots(
  cwd: string,
  projectRef: string,
  gitBranch: string,
): Promise<void> {
  const supabaseDir = join(cwd, "supabase");

  let files: string[];
  try {
    files = readdirSync(supabaseDir).filter(
      (f) => f.startsWith("config") && f.endsWith(".json"),
    );
  } catch {
    return;
  }

  for (const file of files) {
    if (file === "config.json") {
      // Base config — commit the unmerged base as envName "base"
      const { config: base } = loadEffectiveConfig(cwd);
      if (!base) continue;
      await commitConfig(projectRef, gitBranch, "base", base as Record<string, unknown>);
    } else {
      // config.<name>.json — envName is the middle segment
      const envName = file.slice("config.".length, -".json".length);
      // Load the fully merged effective config for this env/branch layer
      const { config: effective } = loadEffectiveConfig(cwd, envName, gitBranch);
      if (!effective) continue;
      await commitConfig(projectRef, gitBranch, envName, effective as Record<string, unknown>);
    }
  }
}
