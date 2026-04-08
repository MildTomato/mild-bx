/**
 * JsonOutput — implements DevOutput by emitting NDJSON to stdout.
 * Consumed by the VS Code extension (--json mode).
 */

import type { Profile } from "@/lib/config.js";
import type { DevOutput, ConfigChange, RunningInfo } from "./dev-output.js";
import type { DevSeedResult } from "./seed.js";

export class JsonOutput implements DevOutput {
  constructor(private readonly verbose: boolean) {}

  private emit(obj: Record<string, unknown>): void {
    console.log(JSON.stringify(obj));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  header(): void { /* noop */ }
  contextLines(_opts: unknown): void { /* noop */ }
  contextExtra(_extra: unknown): void { /* noop */ }
  overlayCreatedBanner(): void { /* noop — JSON emits overlayCreated event instead */ }
  running(info: RunningInfo): void { this.emit({ status: "running", ...info }); }
  stopped(): void { this.emit({ status: "stopped" }); }
  fatalError(message: string, hint?: string): void {
    this.emit({ status: "error", message, ...(hint ? { hint } : {}) });
  }

  // ── Early startup ─────────────────────────────────────────────────────────
  connectingToProject(): void { /* no event */ }
  connectedToProject(): void { /* no event */ }
  connectFailed(error: string): void { this.emit({ status: "error", message: `Failed to connect: ${error}` }); }
  resolvingBranch(): void { /* no event */ }
  branchResolved(): void { /* no event */ }
  branchResolutionFailed(): void { this.emit({ status: "error", message: "Preview branch credentials unavailable", exitCode: 1 }); }

  // ── Project waiting ───────────────────────────────────────────────────────
  waitingForProject(status: string, elapsedMs: number, pollCount: number): void {
    this.emit({ event: "waiting_for_project", status, elapsed_ms: elapsedMs, poll_count: pollCount });
  }
  waitingForServices(servicesStatus: string, elapsedMs: number, pollCount: number): void {
    this.emit({ event: "waiting_for_services", services_status: servicesStatus, elapsed_ms: elapsedMs, poll_count: pollCount });
  }
  projectActive(): void { /* no event */ }

  // ── File watch events ─────────────────────────────────────────────────────
  fileChanged(path: string, type: string, source?: "hook"): void {
    this.emit({ event: "file_changed", type, path, ...(source ? { source } : {}) });
  }
  configFileChanged(_name: string, type: string): void {
    this.emit({ event: "config_changed", type });
  }
  seedFileChanged(path: string, type: string): void {
    this.emit({ event: "file_changed", type, path: `seeds/${path}` });
  }

  // ── Branch / env ──────────────────────────────────────────────────────────
  branchChanged(branch: string, profile?: Profile): void {
    this.emit({ event: profile ? "profile_changed" : "branch_changed", branch, profile: profile?.name });
  }
  envUpdated(branch: string, projectRef: string, isBranch: boolean): void {
    this.emit({ event: "env_updated", branch, projectRef, isBranch });
  }
  envUpdateSkipped(branch: string, reason: string): void {
    this.emit({ event: "env_update_skipped", branch, reason });
  }
  envUpdateError(branch: string, error: string): void {
    this.emit({ event: "env_update_error", branch, error });
  }
  overlayCreated(file: string): void {
    this.emit({ event: "overlay_created", file });
  }

  // ── Steps (no-op: results carried in semantic events) ────────────────────
  startStep(_msg: string): void { /* no event */ }
  completeStep(_msg: string, _summary?: string, _status?: string, _detail?: string): void { /* no event */ }
  cancelStep(): void { /* no event */ }
  logNested(_msg: string): void { /* no event */ }
  logRail(_msg: string): void { /* no event */ }
  verboseLog(_msg: string): void { /* no event */ }
  codegen(_file: string): void { /* included in event payloads */ }
  logConfigChanges(_changes: ConfigChange[]): void { /* included in configSyncComplete */ }

  // ── Initial sync ──────────────────────────────────────────────────────────
  initialSyncStart(): void { this.emit({ event: "initial_sync_start" }); }
  initialSyncPlan(hasChanges: boolean, statements: string[]): void {
    this.emit({ event: "initial_sync_plan", hasChanges, statements });
  }
  initialSyncSchemaFailed(output?: string): void {
    this.emit({ event: "initial_sync_error", success: false, output });
  }
  initialSyncComplete(data: { schemaChanged: boolean; schemaStatements: number; configChanges: number; dryRun: boolean }): void {
    this.emit({
      event: data.dryRun ? "initial_sync_plan" : "initial_sync_complete",
      success: true,
      statements: data.schemaStatements,
      configChanges: data.configChanges,
    });
  }
  initialSyncError(error: string): void { this.emit({ event: "initial_sync_error", error }); }

  // ── Watch-triggered schema sync ───────────────────────────────────────────
  syncStart(files: string[]): void { this.emit({ event: "sync_start", files }); }
  syncPlan(hasChanges: boolean, statements: string[]): void {
    this.emit({ event: "sync_plan", hasChanges, statements });
  }
  syncComplete(data: { success: boolean; output?: string; statements?: number }): void {
    this.emit({ event: data.success ? "sync_complete" : "sync_error", ...data });
  }
  syncNoChanges(): void { /* covered by syncComplete */ }

  // ── Config sync ───────────────────────────────────────────────────────────
  configSyncStart(): void { this.emit({ event: "config_sync_start" }); }
  configDiff(type: string, changes: ConfigChange[]): void {
    this.emit({ event: "config_diff", type, changes });
  }
  configSyncComplete(data: { dryRun: boolean; applied: number; generated: string[] }): void {
    this.emit({
      event: "config_sync_complete",
      dryRun: data.dryRun,
      applied: data.applied,
      ...(data.generated.length ? { generated: data.generated } : {}),
    });
  }
  configSyncNoChanges(): void { /* covered by configSyncComplete with applied=0 */ }
  configSyncError(error: string): void { this.emit({ event: "config_sync_error", error }); }

  // ── Seed ─────────────────────────────────────────────────────────────────
  seedPlan(count: number): void { this.emit({ event: "seed_plan", files: count }); }
  seedStart(count: number): void { this.emit({ event: "seed_start", files: count }); }
  seedComplete(result: DevSeedResult): void {
    this.emit({
      event: result.success ? "seed_complete" : "seed_error",
      filesApplied: result.filesApplied,
      totalFiles: result.totalFiles,
      errors: result.errors,
    });
  }
  seedError(error: string): void { this.emit({ event: "seed_error", error }); }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  hookStart(): void { /* no event */ }
  hookCommand(_cmd: string): void { /* no event */ }
  hookComplete(): void { this.emit({ event: "hook_complete" }); }
  hookError(error: string): void { this.emit({ event: "hook_error", error }); }

  // ── Types ─────────────────────────────────────────────────────────────────
  typesUpdated(path: string, generated: string[]): void {
    this.emit({ event: "types_updated", path, ...(generated.length ? { generated } : {}) });
  }
  typesError(message: string): void { this.emit({ event: "types_error", message }); }
  typesRetry(_n: number, _delayMs: number, _max: number): void { /* no event */ }

  // ── Warnings ─────────────────────────────────────────────────────────────
  missingEnvVars(vars: { name: string; isSecret: boolean }[]): void {
    if (vars.length === 0) return;
    this.emit({ event: "missing_env_vars", vars });
  }
  missingSecrets(_found: { path: string; envVarName?: string }[]): void { /* no event in JSON mode */ }
  hardcodedSecrets(_found: { path: string; file: string; line: number; setCommand: string }[]): void { /* no event in JSON mode */ }

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  startHeartbeat(): void { /* noop */ }
  stopHeartbeat(): void { /* noop */ }
}
