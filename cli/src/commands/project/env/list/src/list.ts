/**
 * List environment variables for an environment
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { setupEnvCommand } from "../../setup.js";
import { createClient } from "@/lib/api.js";
import { handleCommandError } from "@/lib/command-error.js";
import { listRemoteVariables } from "@/lib/env-api-bridge.js";
import {
  parseScopedVarName,
  resolveScoped,
  branchToScope,
  SENTINEL_KEYS,
  type Scope,
  type EnvironmentContext,
} from "@supabase-dx/env-vars";
import { S_BAR } from "@/components/command-header.js";
import { createSpinner, setOutputMode } from "@/components/output.js";

const PRODUCTION_BRANCHES = new Set(["main", "master", "production"]);

export interface ListOptions {
  environment?: "production" | "preview" | "development";
  branch?: string;
  json?: boolean;
  profile?: string;
}

interface ScopedEntry {
  value: string;
  secret: boolean;
}

type ScopeMap = Map<Scope | null, ScopedEntry>;

/**
 * Group a flat list of raw remote vars by base name → scope → entry.
 * scope: null = legacy bare var (no suffix).
 */
function groupByBaseVar(
  raw: Array<{ key: string; value: string; secret: boolean }>
): Map<string, ScopeMap> {
  const groups = new Map<string, ScopeMap>();

  for (const v of raw) {
    const { base, scope, branch } = parseScopedVarName(v.key);
    const scopeKey: Scope | null =
      scope === "branch" ? (`branch:${branch}` as unknown as Scope) : scope;

    if (!groups.has(base)) groups.set(base, new Map());
    groups.get(base)!.set(scopeKey, { value: v.value, secret: v.secret });
  }

  return groups;
}

function scopeLabel(scope: Scope | null, dim = false): string {
  if (scope === null) return dim ? chalk.dim("(legacy)") : chalk.dim("legacy");
  const s = String(scope);
  if (s.startsWith("branch:")) {
    const branch = s.slice(7);
    return dim ? chalk.dim(`branch:${branch}`) : chalk.yellow(`branch:${branch}`);
  }
  if (s === "production") return chalk.green(s);
  if (s === "preview") return chalk.cyan(s);
  if (s === "development") return chalk.yellow(s);
  return s;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const context = options.environment
    ? options.environment === "preview"
      ? ({ type: "preview", branch: options.branch } satisfies EnvironmentContext)
      : ({ type: options.environment } satisfies EnvironmentContext)
    : null;

  const contextLabel = context
    ? context.type === "preview" && options.branch
      ? `preview (branch: ${options.branch})`
      : context.type
    : "all";

  const ctx = await setupEnvCommand({
    command: "supa project env list",
    description: "List environment variables.",
    json: options.json,
    profile: options.profile,
    context: [["View", contextLabel]],
  });
  if (!ctx) return;

  const client = createClient(ctx.token);
  const spinner = createSpinner();
  spinner.start("Fetching variables...");

  let raw: Array<{ key: string; value: string; secret: boolean }>;
  try {
    raw = await listRemoteVariables( ctx.parentProjectRef);
    spinner.stop(`Fetched ${raw.length} stored var(s)`);
  } catch (error) {
    spinner.stop(chalk.red("Failed"));
    await handleCommandError(error, options, client, ctx.projectRef);
  }

  const groups = groupByBaseVar(raw.filter((v) => !SENTINEL_KEYS.has(v.key)));

  // Show branch-specific override count if on a preview branch
  if (!options.json && !PRODUCTION_BRANCHES.has(ctx.branch)) {
    const branchSuffix = branchToScope(ctx.branch);
    const branchSpecificCount = raw.filter((v) => {
      const { scope, branch } = parseScopedVarName(v.key);
      return scope === "branch" && branch === branchSuffix;
    }).length;

    if (branchSpecificCount > 0) {
      console.log(`${S_BAR}  ${chalk.dim(`↳ ${branchSpecificCount} variable${branchSpecificCount === 1 ? "" : "s"} specific to ${ctx.branch}`)}`);
      console.log(S_BAR);
    }
  }

  // ── Resolved view ────────────────────────────────────────────────────────
  if (context) {
    const resolved = resolveScoped(
      raw.map((v) => ({ name: v.key, value: v.value })),
      context
    );

    // Determine winning scope for each resolved key
    const rows: Array<{
      key: string;
      value: string;
      secret: boolean;
      winningScope: Scope | null;
    }> = [];

    for (const [base, value] of resolved) {
      const scopes = groups.get(base);
      // Find which scope won by matching value
      let winningScope: Scope | null = null;
      if (scopes) {
        for (const [s, entry] of scopes) {
          if (entry.value === value) {
            winningScope = s as Scope | null;
            break;
          }
        }
      }
      const secret = scopes?.get(winningScope)?.secret ?? false;
      rows.push({ key: base, value, secret, winningScope });
    }

    if (options.json) {
      console.log(JSON.stringify({
        status: "success",
        context: contextLabel,
        variables: rows.map((r) => ({
          key: r.key,
          value: r.secret ? null : r.value,
          secret: r.secret,
          scope: r.winningScope,
        })),
      }));
      return;
    }

    if (rows.length === 0) {
      p.log.info(`No variables for ${contextLabel}`);
      return;
    }

    console.log();
    const maxKeyLen = Math.max(...rows.map((r) => r.key.length));
    for (const r of rows) {
      const key = chalk.cyan(r.key.padEnd(maxKeyLen));
      const value = r.secret ? chalk.dim("[secret]") : r.value;
      const scope = chalk.dim(`← ${scopeLabel(r.winningScope)}`);
      console.log(`  ${key}  ${value}  ${scope}`);
    }
    console.log();
    console.log(chalk.dim(`  ${rows.length} variable(s) resolved for ${contextLabel}`));
    return;
  }

  // ── All vars view (grouped by base name) ─────────────────────────────────
  if (options.json) {
    const variables = Array.from(groups.entries()).map(([base, scopes]) => ({
      key: base,
      scopes: Object.fromEntries(
        Array.from(scopes.entries()).map(([s, entry]) => [
          s ?? "legacy",
          { value: entry.secret ? null : entry.value, secret: entry.secret },
        ])
      ),
    }));
    console.log(JSON.stringify({ status: "success", variables }));
    return;
  }

  if (groups.size === 0) {
    p.log.info("No variables found");
    return;
  }

  console.log();
  const maxKeyLen = Math.max(...Array.from(groups.keys()).map((k) => k.length));
  const scopeColLen = 12; // "development" is 11 chars

  for (const [base, scopes] of groups) {
    let first = true;
    for (const [s, entry] of scopes) {
      const keyCol = first ? chalk.cyan(base.padEnd(maxKeyLen)) : " ".repeat(maxKeyLen);
      const scopeCol = scopeLabel(s as Scope | null).padEnd(scopeColLen);
      const valueCol = entry.secret ? chalk.dim("[secret]") : chalk.dim(entry.value);
      console.log(`  ${keyCol}  ${scopeCol}  ${valueCol}`);
      first = false;
    }
  }
  console.log();
  console.log(chalk.dim(`  ${groups.size} variable(s)  (${raw.length} stored)`));
}
