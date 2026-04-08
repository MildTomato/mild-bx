/**
 * TtyOutput — implements DevOutput using clack spinners, rail UI, and heartbeat.
 */

import { relative } from "node:path";
import * as p from "@clack/prompts";
import { C } from "@/lib/colors.js";
import { generated as fmtGenerated, verboseLog as fmtVerboseLog } from "@/lib/styles.js";
import { S_BAR, printCommandHeader, printProjectContextLines, printContextExtra, printOverlayCreatedBanner } from "@/components/command-header.js";
import type { Profile } from "@/lib/config.js";
import type { DevOutput, ConfigChange, RunningInfo } from "./dev-output.js";
import type { DevSeedResult } from "./seed.js";

const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"];
const HEARTBEAT_FRAMES = ["⠏", "⠇", "⠧", "⠦", "⠴", "⠼", "⠸", "⠹", "⠙", "⠋"];
type SpinnerLike = ReturnType<typeof p.spinner>;

function getStatusMessage(status: string): string {
  switch (status) {
    case "COMING_UP": return "Starting services";
    case "GOING_DOWN": return "Shutting down";
    case "RESTORING": return "Restoring from backup";
    case "UPGRADING": return "Upgrading";
    case "PAUSING": return "Pausing";
    default: return status.toLowerCase().replace(/_/g, " ");
  }
}

export class TtyOutput implements DevOutput {
  private activeSpinner: SpinnerLike | null = null;
  private earlySpinner: SpinnerLike | null = null;
  private isSpinnerActive = false;
  private stepStart = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatFrame = 0;
  private heartbeatHasSpacer = false;
  private heartbeatStarted = false;
  private lastActivity = Date.now();
  private currentLine = "";
  private spinnerFrame = 0;
  private lastProjectStatus = "";

  constructor(
    private readonly verbose: boolean,
    isInteractive: boolean,
  ) {
    this.isInteractive = isInteractive && !verbose;
  }

  private readonly isInteractive: boolean;

  private makeSpinner(): SpinnerLike {
    if (this.isInteractive) return p.spinner();
    return {
      start: () => {},
      stop: (msg?: string) => { if (msg) p.log.step(msg); },
      error: (msg?: string) => { if (msg) p.log.error(msg); },
      cancel: (msg?: string) => { if (msg) p.log.warn(msg); },
      message: () => {},
      clear: () => {},
      isCancelled: false,
    };
  }

  private clearLine(): void {
    if (!this.isInteractive || !this.currentLine) return;
    process.stdout.write(`\r\x1b[K`);
    this.currentLine = "";
    this.heartbeatHasSpacer = false;
  }

  private writeLine(msg: string): void {
    if (!this.isInteractive) return;
    process.stdout.write(`\r${msg}\x1b[K`);
    this.currentLine = msg;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  header(): void {
    printCommandHeader({
      command: "supa dev",
      description: ["Watch for schema and config changes."],
    });
  }
  contextLines(opts: { parentRef: string; branchRef?: string; gitBranch: string; profileName?: string; dashboardUrl: string; configLayers?: string[] }): void {
    printProjectContextLines(opts);
  }
  contextExtra(extra: [string, string][]): void {
    printContextExtra(extra);
  }
  overlayCreatedBanner(): void { printOverlayCreatedBanner(); }
  running(_info: RunningInfo): void { /* noop — header already shown */ }
  stopped(): void {
    console.log(`${C.pipe}└${C.reset}`);
    console.log("");
  }
  fatalError(message: string, hint?: string): void {
    console.error(`\n${C.error}Error:${C.reset} ${message}`);
    if (hint) console.error(`  ${hint}`);
  }

  // ── Early startup spinners ────────────────────────────────────────────────
  connectingToProject(): void {
    this.earlySpinner = this.makeSpinner();
    this.earlySpinner.start("Connecting to project");
  }
  connectedToProject(): void {
    if (this.earlySpinner) {
      this.earlySpinner.stop("Connected to project");
      this.earlySpinner = null;
    } else {
      p.log.step("Connected to project");
    }
  }
  connectFailed(error: string): void {
    if (this.earlySpinner) {
      this.earlySpinner.error(`Failed to connect: ${error}`);
      this.earlySpinner = null;
    } else {
      p.log.error(`Failed to connect: ${error}`);
    }
  }
  resolvingBranch(): void {
    this.earlySpinner = this.makeSpinner();
    this.earlySpinner.start("Resolving branch");
  }
  branchResolved(): void {
    if (this.earlySpinner) {
      this.earlySpinner.stop("Branch resolved");
      this.earlySpinner = null;
    } else {
      p.log.step("Branch resolved");
    }
  }
  branchResolutionFailed(): void {
    if (this.earlySpinner) {
      this.earlySpinner.error("Branch resolution failed");
      this.earlySpinner = null;
    } else {
      p.log.error("Branch resolution failed");
    }
  }

  // ── Project waiting ───────────────────────────────────────────────────────
  waitingForProject(status: string, elapsedMs: number, pollCount: number): void {
    const statusMsg = getStatusMessage(status);
    if (this.isInteractive) {
      if (pollCount === 0) {
        // Initial notice before polling begins
        console.log(`\n${C.secondary}Project is ${statusMsg.toLowerCase()} (${C.value}${status}${C.reset}${C.secondary}), waiting...${C.reset}`);
        return;
      }
      const elapsed = Math.round(elapsedMs / 1000);
      const char = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
      if (this.lastProjectStatus !== "" && this.lastProjectStatus !== status) {
        process.stdout.write("\r\x1b[K");
        console.log(`${C.secondary}→${C.reset} Status: ${C.value}${statusMsg}${C.reset}`);
      }
      this.writeLine(`${C.icon}${char}${C.reset} ${statusMsg}... ${C.secondary}${elapsed}s${C.reset}`);
      this.spinnerFrame++;
    } else if (pollCount === 0 || pollCount === 1 || this.lastProjectStatus !== status) {
      console.log(`${C.secondary}→${C.reset} ${statusMsg}...`);
    }
    this.lastProjectStatus = status;
  }
  waitingForServices(servicesStatus: string, elapsedMs: number, pollCount: number): void {
    if (this.isInteractive) {
      const elapsed = Math.round(elapsedMs / 1000);
      const char = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
      this.writeLine(`${C.icon}${char}${C.reset} Waiting for database... ${C.secondary}(${servicesStatus}) ${elapsed}s${C.reset}`);
      this.spinnerFrame++;
    } else if (pollCount === 1) {
      console.log(`Waiting for database... (${servicesStatus})`);
    }
  }
  projectActive(): void {
    if (this.isInteractive) process.stdout.write("\r\x1b[K");
    console.log(`${C.success}✓${C.reset} Project is active`);
  }

  // ── File watch events ─────────────────────────────────────────────────────
  fileChanged(path: string, type: string, source?: "hook"): void {
    const icon = type === "add" ? "+" : type === "unlink" ? "-" : "~";
    const color = type === "add" ? C.success : type === "unlink" ? C.error : C.warning;
    this.logRail(`${color}${icon}${C.reset} ${path}${source === "hook" ? ` ${C.secondary}(hook)${C.reset}` : ""}`);
  }
  configFileChanged(name: string, type: string): void {
    const icon = type === "add" ? "+" : type === "unlink" ? "-" : "~";
    const color = type === "add" ? C.success : type === "unlink" ? C.error : C.warning;
    this.logRail(`${color}${icon}${C.reset} ${name}`);
  }
  seedFileChanged(path: string, type: string): void {
    const icon = type === "add" ? "+" : type === "unlink" ? "-" : "~";
    const color = type === "add" ? C.success : type === "unlink" ? C.error : C.warning;
    this.logRail(`${color}${icon}${C.reset} seeds/${path}`);
  }

  // ── Branch / env ──────────────────────────────────────────────────────────
  branchChanged(branch: string, profile?: Profile): void {
    if (profile) {
      this.logRail(`→ Branch ${C.fileName}${branch}${C.reset} → profile ${C.value}${profile.name}${C.reset}`);
    } else {
      this.logRail(`→ Branch ${C.fileName}${branch}${C.reset}`);
    }
  }
  envUpdated(branch: string, projectRef: string, isBranch: boolean): void {
    void branch;
    this.logRail(`Updated .env.local → ${isBranch ? "branch" : "main"} (${projectRef})`);
  }
  envUpdateSkipped(branch: string, _reason: string): void {
    this.logRail(`No healthy Supabase branch for "${branch}" — run \`supa project branches create\``);
  }
  envUpdateError(_branch: string, error: string): void {
    this.logRail(`Branch env update failed: ${error}`);
  }
  overlayCreated(file: string): void {
    this.logRail(`${C.success}+${C.reset} Created ${C.fileName}${file}${C.reset}`);
    this.logRail(`  ${C.secondary}Add preview-specific config overrides here.${C.reset}`);
  }

  // ── Step management ───────────────────────────────────────────────────────
  startStep(msg: string): void {
    this.stopHeartbeat();
    this.heartbeatStarted = false;
    this.isSpinnerActive = true;
    this.stepStart = Date.now();
    this.lastActivity = Date.now();
    this.activeSpinner = this.makeSpinner();
    this.activeSpinner.start(msg);
  }

  completeStep(msg: string, summary?: string, status: "success" | "warning" | "error" = "success", detail?: string): void {
    this.isSpinnerActive = false;
    const elapsed = `${((Date.now() - this.stepStart) / 1000).toFixed(1)}s`;
    const parts = [msg, summary, elapsed].filter(Boolean);
    const resultMsg = parts.join(" · ");
    if (this.activeSpinner) {
      if (status === "error") this.activeSpinner.error(resultMsg);
      else if (status === "warning") this.activeSpinner.cancel(resultMsg);
      else this.activeSpinner.stop(resultMsg);
      this.activeSpinner = null;
    }
    if (detail) {
      for (const line of detail.split("\n")) p.log.message(line);
    }
    this.lastActivity = Date.now();
    this.heartbeatStarted = true;
    this.startHeartbeat();
  }

  cancelStep(): void {
    this.isSpinnerActive = false;
    if (this.activeSpinner) {
      this.activeSpinner.clear();
      this.activeSpinner = null;
    }
    this.heartbeatStarted = true;
    this.lastActivity = 0;
    this.startHeartbeat();
  }

  // ── Inline detail ─────────────────────────────────────────────────────────
  logNested(msg: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.message(msg);
    } else {
      this.clearLine();
      console.log(`${S_BAR}  ${C.secondary}${msg}${C.reset}`);
    }
    this.lastActivity = Date.now();
  }

  logRail(msg: string): void {
    this.clearLine();
    console.log(`${S_BAR}  ${msg}`);
    this.lastActivity = Date.now();
  }

  verboseLog(msg: string): void {
    if (this.verbose) this.logNested(fmtVerboseLog(msg));
  }

  codegen(file: string): void {
    this.logNested(fmtGenerated(file));
  }

  logConfigChanges(changes: ConfigChange[]): void {
    for (const change of changes.slice(0, 5)) {
      this.clearLine();
      console.log(`${S_BAR}  ${change.key}: ${C.warning}${change.oldValue}${C.reset} ${C.secondary}→${C.reset} ${C.value}${change.newValue}${C.reset}`);
      this.lastActivity = Date.now();
    }
    if (changes.length > 5) this.logNested(`+${changes.length - 5} more`);
  }

  // ── Initial sync ──────────────────────────────────────────────────────────
  initialSyncStart(): void { this.startStep("Comparing local state with remote"); }

  initialSyncPlan(hasChanges: boolean, statements: string[]): void {
    if (hasChanges) {
      this.completeStep("Would push to remote", `${statements.length} schema statement${statements.length === 1 ? "" : "s"} (dry-run)`);
      for (const stmt of statements.slice(0, 5)) {
        this.logNested(stmt.length > 60 ? stmt.slice(0, 57) + "..." : stmt);
      }
      if (statements.length > 5) this.logNested(`+${statements.length - 5} more`);
    } else {
      this.completeStep("No changes", "schema already matches remote");
    }
  }

  initialSyncSchemaFailed(output?: string): void {
    this.completeStep("Schema push failed", undefined, "error", output);
  }

  initialSyncComplete(data: { schemaChanged: boolean; schemaStatements: number; configChanges: number; dryRun: boolean }): void {
    const { schemaChanged, schemaStatements, configChanges, dryRun } = data;
    if (!schemaChanged && configChanges === 0) {
      this.completeStep("No changes", "schema and config already match remote");
    } else {
      const parts: string[] = [];
      if (schemaChanged) parts.push(`${schemaStatements} schema statement${schemaStatements === 1 ? "" : "s"}`);
      if (configChanges > 0) parts.push(`${configChanges} config change${configChanges === 1 ? "" : "s"}`);
      this.completeStep(dryRun ? "Would push to remote" : "Pushed to remote", parts.join(", "));
    }
  }

  initialSyncError(error: string): void {
    this.completeStep("Initial sync failed", undefined, "error", error);
  }

  // ── Watch-triggered schema sync ───────────────────────────────────────────
  syncStart(_files: string[]): void { this.startStep("Comparing schema with remote"); }

  syncPlan(hasChanges: boolean, statements: string[]): void {
    if (hasChanges) {
      this.completeStep("Would push to remote", `${statements.length} schema statement${statements.length === 1 ? "" : "s"} (dry-run)`);
      for (const stmt of statements.slice(0, 5)) {
        this.logNested(stmt.length > 60 ? stmt.slice(0, 57) + "..." : stmt);
      }
      if (statements.length > 5) this.logNested(`+${statements.length - 5} more`);
    } else {
      this.cancelStep();
    }
  }

  syncComplete(data: { success: boolean; output?: string; statements?: number }): void {
    if (!data.success) {
      this.completeStep("Schema push failed", undefined, "error", data.output);
    } else if (data.output === "No changes to apply") {
      this.cancelStep();
    } else {
      const n = data.statements ?? 0;
      this.completeStep("Pushed schema to remote", `${n} statement${n === 1 ? "" : "s"}`);
    }
  }

  syncNoChanges(): void { this.cancelStep(); }

  // ── Config sync ───────────────────────────────────────────────────────────
  configSyncStart(): void { this.startStep("Comparing config with remote"); }

  configDiff(_type: string, _changes: ConfigChange[]): void { /* shown via logConfigChanges */ }

  configSyncComplete(data: { dryRun: boolean; applied: number; generated: string[] }): void {
    if (data.applied === 0) {
      this.cancelStep();
    } else if (data.dryRun) {
      this.completeStep("Would push to remote", `${data.applied} config change${data.applied === 1 ? "" : "s"} (dry-run)`);
    } else {
      this.completeStep("Pushed config to remote", `${data.applied} change${data.applied === 1 ? "" : "s"}`);
    }
    for (const f of data.generated) this.logNested(fmtGenerated(f));
  }

  configSyncNoChanges(): void { this.cancelStep(); }
  configSyncError(error: string): void { this.completeStep("Config push failed", undefined, "error", error); }

  // ── Seed ─────────────────────────────────────────────────────────────────
  seedPlan(count: number): void { this.logNested(`Would seed ${count} file${count === 1 ? "" : "s"}`); }
  seedStart(_count: number): void { this.startStep("Seeding database"); }
  seedComplete(result: DevSeedResult): void {
    if (result.success) {
      this.completeStep("Seeded", `${result.filesApplied} files`);
    } else {
      const summary = result.errors.slice(0, 2).map((e) => e.file).join(", ");
      this.completeStep("Seeded with errors", summary, "warning");
    }
  }
  seedError(error: string): void { this.completeStep("Seed failed", undefined, "error", error); }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  hookStart(): void { this.startStep("Running pre-push hooks"); }
  hookCommand(cmd: string): void { if (cmd.startsWith("$ ")) this.logNested(cmd); }
  hookComplete(): void { this.completeStep("Pre-push hooks complete"); }
  hookError(error: string): void { this.completeStep("Hook failed", undefined, "error", error); }

  // ── Types ─────────────────────────────────────────────────────────────────
  typesUpdated(path: string, generated: string[]): void {
    this.logNested(fmtGenerated(relative(process.cwd(), path)));
    for (const f of generated) this.logNested(fmtGenerated(f));
  }
  typesError(message: string): void {
    this.logNested(`${C.warning}⚠${C.reset} Types refresh failed: ${message}`);
  }
  typesRetry(n: number, delayMs: number, max: number): void {
    this.logNested(`${C.warning}⚠${C.reset} PostgREST schema cache not ready, retrying in ${delayMs / 1000}s… (${n}/${max})`);
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  missingEnvVars(vars: { name: string; isSecret: boolean }[]): void {
    if (vars.length === 0) return;
    this.clearLine();
    console.log(S_BAR);
    console.log(`${S_BAR}  ${C.warning}⚠${C.reset}  Missing environment variables:`);
    for (const { name, isSecret } of vars) {
      if (isSecret) {
        console.log(`${S_BAR}    ${C.secondary}•${C.reset}  ${C.fileName}${name}${C.reset}  ${C.secondary}(secret)${C.reset}`);
        console.log(`${S_BAR}       ${C.secondary}export ${name}=<value>${C.reset}`);
      } else {
        console.log(`${S_BAR}    ${C.secondary}•${C.reset}  ${C.fileName}${name}${C.reset}`);
        console.log(`${S_BAR}       ${C.value}supa project env set ${name}=<value>${C.reset}`);
      }
    }
    console.log(S_BAR);
    this.lastActivity = Date.now();
  }

  missingSecrets(found: { path: string; envVarName?: string }[]): void {
    if (found.length === 0) return;
    this.clearLine();
    console.log(S_BAR);
    console.log(`${S_BAR}  ${C.bgWarning} MISSING SECRET ${C.reset}  ${found.length} field${found.length === 1 ? "" : "s"} required by an enabled feature`);
    for (const { path, envVarName } of found) {
      console.log(`${S_BAR}    ${C.secondary}•${C.reset}  ${path}`);
      if (envVarName) {
        console.log(`${S_BAR}       ${C.secondary}→${C.reset}  ${C.value}supa env set ${envVarName}=<value>${C.reset}`);
      }
    }
    console.log(S_BAR);
    this.lastActivity = Date.now();
  }

  hardcodedSecrets(found: { path: string; file: string; line: number; setCommand: string }[]): void {
    if (found.length === 0) return;
    // Must clear active spinner before multi-line output
    if (this.activeSpinner) {
      this.activeSpinner.clear();
      this.activeSpinner = null;
      this.isSpinnerActive = false;
    }
    this.clearLine();
    console.log(S_BAR);
    console.log(`${S_BAR}  ${C.bgError} SECRET DETECTED ${C.reset}  ${found.length} field${found.length === 1 ? "" : "s"} not pushed — remove from config and set via CLI`);
    for (const { path, file, line, setCommand } of found) {
      console.log(`${S_BAR}    ${C.secondary}•${C.reset}  ${path}  ${C.secondary}(${file}:${line})${C.reset}`);
      console.log(`${S_BAR}       ${C.secondary}→${C.reset}  ${C.warning}${setCommand}${C.reset}`);
    }
    console.log(S_BAR);
    this.lastActivity = Date.now();
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  startHeartbeat(): void {
    if (!this.isInteractive || this.verbose || this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      const idle = Date.now() - this.lastActivity > 1000;
      if (idle && !this.isSpinnerActive) {
        if (!this.heartbeatHasSpacer) {
          process.stdout.write(`\n`);
          this.heartbeatHasSpacer = true;
        }
        this.heartbeatStarted = true;
        const char = HEARTBEAT_FRAMES[this.heartbeatFrame % HEARTBEAT_FRAMES.length];
        this.writeLine(`${C.secondary}${char}  Watching for changes...${C.reset}`);
        this.heartbeatFrame++;
      }
    }, 350);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clearLine();
  }
}
