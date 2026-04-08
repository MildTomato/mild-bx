/**
 * DevOutput — single interface for all dev command output.
 *
 * TtyOutput  → clack spinners + heartbeat rail
 * JsonOutput → NDJSON event stream (--json mode / VS Code extension)
 *
 * Both modes share the same business logic in dev.ts; only the output
 * implementation differs.
 */

import type { Profile } from "@/lib/config.js";
import type { DevSeedResult } from "./seed.js";

export interface ConfigChange {
  key: string;
  oldValue: string;
  newValue: string;
}

export interface RunningInfo {
  profile?: string;
  projectRef: string;
  branch: string;
  schemaDir: string;
  seedEnabled: boolean;
  seedPaths?: string[];
  hooksEnabled: boolean;
  hookWatchPaths?: string[];
}

export interface DevOutput {
  // ── Lifecycle ────────────────────────────────────────────────────────────
  header(): void;
  contextLines(opts: {
    parentRef: string;
    branchRef?: string;
    gitBranch: string;
    profileName?: string;
    dashboardUrl: string;
    configLayers?: string[];
  }): void;
  contextExtra(extra: [string, string][]): void;
  overlayCreatedBanner(): void;
  running(info: RunningInfo): void;
  stopped(): void;
  /** Non-recoverable startup error. Caller sets exitCode and returns. */
  fatalError(message: string, hint?: string): void;

  // ── Early startup progress (before main loop) ────────────────────────────
  connectingToProject(): void;
  connectedToProject(): void;
  connectFailed(error: string): void;
  resolvingBranch(): void;
  branchResolved(): void;
  branchResolutionFailed(): void;

  // ── Project status while waiting ─────────────────────────────────────────
  waitingForProject(status: string, elapsedMs: number, pollCount: number): void;
  waitingForServices(servicesStatus: string, elapsedMs: number, pollCount: number): void;
  projectActive(): void;

  // ── File watch events ────────────────────────────────────────────────────
  fileChanged(path: string, type: string, source?: "hook"): void;
  configFileChanged(name: string, type: string): void;
  seedFileChanged(path: string, type: string): void;

  // ── Branch / env events ──────────────────────────────────────────────────
  branchChanged(branch: string, profile?: Profile): void;
  envUpdated(branch: string, projectRef: string, isBranch: boolean): void;
  envUpdateSkipped(branch: string, reason: string): void;
  envUpdateError(branch: string, error: string): void;
  overlayCreated(file: string): void;

  // ── Step management (TTY: spinner; JSON: paired events) ──────────────────
  startStep(msg: string): void;
  completeStep(msg: string, summary?: string, status?: "success" | "warning" | "error", detail?: string): void;
  cancelStep(): void;

  // ── Inline detail (TTY: nested under step or rail; JSON: noop) ───────────
  logNested(msg: string): void;
  logRail(msg: string): void;
  verboseLog(msg: string): void;
  codegen(file: string): void;
  logConfigChanges(changes: ConfigChange[]): void;

  // ── Initial sync ─────────────────────────────────────────────────────────
  initialSyncStart(): void;
  initialSyncPlan(hasChanges: boolean, statements: string[]): void;
  initialSyncSchemaFailed(output?: string): void;
  initialSyncComplete(data: {
    schemaChanged: boolean;
    schemaStatements: number;
    configChanges: number;
    dryRun: boolean;
  }): void;
  initialSyncError(error: string): void;

  // ── Watch-triggered schema sync ──────────────────────────────────────────
  syncStart(files: string[]): void;
  syncPlan(hasChanges: boolean, statements: string[]): void;
  syncComplete(data: { success: boolean; output?: string; statements?: number }): void;
  syncNoChanges(): void;

  // ── Watch-triggered config sync ──────────────────────────────────────────
  configSyncStart(): void;
  configDiff(type: string, changes: ConfigChange[]): void;
  configSyncComplete(data: { dryRun: boolean; applied: number; generated: string[] }): void;
  configSyncNoChanges(): void;
  configSyncError(error: string): void;

  // ── Seed ─────────────────────────────────────────────────────────────────
  seedPlan(count: number): void;
  seedStart(count: number): void;
  seedComplete(result: DevSeedResult): void;
  seedError(error: string): void;

  // ── Hooks ────────────────────────────────────────────────────────────────
  hookStart(): void;
  hookCommand(cmd: string): void;
  hookComplete(): void;
  hookError(error: string): void;

  // ── Types ────────────────────────────────────────────────────────────────
  typesUpdated(path: string, generated: string[]): void;
  typesError(message: string): void;
  typesRetry(n: number, delayMs: number, max: number): void;

  // ── Warnings ─────────────────────────────────────────────────────────────
  missingEnvVars(vars: { name: string; isSecret: boolean }[]): void;
  missingSecrets(found: { path: string; envVarName?: string }[]): void;
  hardcodedSecrets(found: { path: string; file: string; line: number; setCommand: string }[]): void;

  // ── Heartbeat (TTY: animated idle indicator; JSON: noop) ─────────────────
  startHeartbeat(): void;
  stopHeartbeat(): void;
}

export { TtyOutput } from "./dev-output-tty.js";
export { JsonOutput } from "./dev-output-json.js";

import { JsonOutput } from "./dev-output-json.js";
import { TtyOutput } from "./dev-output-tty.js";

export function createDevOutput(
  json: boolean,
  verbose: boolean,
  isInteractive: boolean,
): DevOutput {
  if (json) return new JsonOutput(verbose);
  return new TtyOutput(verbose, isInteractive);
}
