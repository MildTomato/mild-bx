/**
 * Shared output formatting helpers for consistent CLI presentation.
 *
 * These are plain console.log wrappers — not Ink/React components.
 * Import these instead of writing raw chalk calls for common patterns.
 *
 * Patterns covered:
 *   - printKeyValue    — "  Label:   value" aligned line
 *   - printNextSteps   — "Next steps:" block with command + description pairs
 *   - printWarning     — yellow ⚠ warning line + optional run-hint
 *   - printSectionHeader — dim section label
 *
 * All helpers respect `chalk` for colour — they do NOT duplicate the
 * `C.*` raw-ANSI codes from src/lib/colors.ts.  Use either one
 * consistently; prefer these helpers at the callsite.
 */

import chalk from "chalk"
import * as p from "@clack/prompts"

// ── Key-value line ─────────────────────────────────────────────────────────

/**
 * Print a single left-aligned key-value line with a dim label.
 *
 * Examples:
 *   printKeyValue("Project", "my-ref-abc")
 *   // "  Project:   my-ref-abc"
 *
 *   printKeyValue("Profile", "remote", "(legacy)")
 *   // "  Profile:   remote  (legacy)"
 *
 * @param label   Left-hand label (no colon — it is added automatically).
 * @param value   Right-hand value (printed as-is; callers may pre-colour it).
 * @param hint    Optional trailing hint printed in dim after the value.
 * @param indent  Leading spaces before the label (default 2).
 */
export function printKeyValue(
  label: string,
  value: string,
  hint?: string,
  indent = 2,
): void {
  const pad = " ".repeat(indent)
  const labelStr = chalk.dim(`${label}:`.padEnd(10))
  const hintStr = hint ? `  ${chalk.dim(hint)}` : ""
  console.log(`${pad}${labelStr} ${value}${hintStr}`)
}

// ── Next-steps block ───────────────────────────────────────────────────────

export interface NextStep {
  /** The command to run, e.g. "supa dev" */
  command: string
  /** Short description, e.g. "Start development watcher" */
  description: string
}

/**
 * Print a "Next steps:" section listing command + description pairs.
 *
 * Example output:
 *   Next steps:
 *     supa dev               Start development watcher
 *     supa project profile   Change workflow profile
 *
 * @param steps   Array of { command, description } entries.
 * @param title   Override for the section header (default "Next steps:").
 * @param indent  Leading spaces before each line (default 2).
 */
export function printNextSteps(
  steps: NextStep[],
  title = "Next steps:",
  indent = 2,
): void {
  if (steps.length === 0) return
  const pad = " ".repeat(indent)
  console.log(chalk.dim(`${pad}${title}`))
  const maxCmdLen = Math.max(...steps.map((s) => s.command.length))
  for (const step of steps) {
    const cmd = chalk.cyan(step.command.padEnd(maxCmdLen))
    const desc = chalk.dim(step.description)
    console.log(`${pad}  ${cmd}  ${desc}`)
  }
}

// ── Warning block ──────────────────────────────────────────────────────────

/**
 * Print a yellow ⚠ warning line, optionally followed by a run-hint line.
 *
 * Example:
 *   printWarning(
 *     "Your workflow profile is out of date.",
 *     "supa project profile",
 *     "to switch to a current profile",
 *   )
 *
 * Output:
 *   ⚠  Your workflow profile is out of date.
 *      Run supa project profile to switch to a current profile.
 *
 * @param message    Main warning text.
 * @param runCommand Optional command to show in a "Run <cmd>" hint line.
 * @param runSuffix  Optional text appended after the command in the hint.
 * @param indent     Leading spaces (default 2).
 */
export function printWarning(
  message: string,
  runCommand?: string,
  runSuffix?: string,
  indent = 2,
): void {
  const pad = " ".repeat(indent)
  console.log(`${pad}${chalk.yellow("⚠")}  ${message}`)
  if (runCommand) {
    const suffix = runSuffix ? ` ${runSuffix}` : ""
    console.log(`${pad}   Run ${chalk.cyan(runCommand)}${suffix}.`)
  }
}

// ── Section header ─────────────────────────────────────────────────────────

/**
 * Print a dim section label, e.g. "  Project" or "  API Credentials".
 *
 * @param title   Section title text (printed dim, no trailing colon).
 * @param indent  Leading spaces (default 2).
 */
export function printSectionHeader(title: string, indent = 2): void {
  const pad = " ".repeat(indent)
  console.log(chalk.dim(`${pad}${title}`))
}

// ── Config diff block ───────────────────────────────────────────────────────

import { S_BAR } from "@/components/command-header.js";
import type { ConfigDiff } from "@/lib/sync.js";

const strikethrough = (s: string) => `\x1b[9m${s}\x1b[0m`;

/**
 * Print a labelled block of config diffs inside the Clack rail.
 * Old value is shown with strikethrough, new value in green.
 *
 * Example:
 *   │  Auth config changes:
 *   │    jwt_exp:  ~~3600~~ → 500
 */
export function printConfigDiffs(diffs: ConfigDiff[], label: string): void {
  const changes = diffs.filter((d) => d.changed);
  if (changes.length === 0) return;
  console.log(S_BAR);
  console.log(`${S_BAR}  ${chalk.dim(`${label}:`)}`);
  for (const diff of changes) {
    console.log(
      `${S_BAR}  ${chalk.yellow(diff.key)}: ${strikethrough(chalk.dim(String(diff.oldValue)))} → ${chalk.green(String(diff.newValue))}`
    );
  }
}

// ── Output mode ─────────────────────────────────────────────────────────────

let _outputJson = false;
let _outputVerbose = false;

/**
 * Set once at command startup. Controls spinner and verbose log behaviour
 * globally so callers don't need to thread options through every helper.
 */
export function setOutputMode(opts: { json?: boolean; verbose?: boolean }): void {
  _outputJson = opts.json ?? false;
  _outputVerbose = opts.verbose ?? false;
}

export function isJsonMode(): boolean { return _outputJson; }
export function isVerboseMode(): boolean { return _outputVerbose; }

// ── Spinner ─────────────────────────────────────────────────────────────────

export interface Spinner {
  start(msg?: string): void;
  message(msg?: string): void;
  stop(msg?: string): void;
  cancel(msg?: string): void;
  error(msg?: string): void;
  clear(): void;
  readonly isCancelled: boolean;
}

const noopSpinner: Spinner = {
  start: () => {},
  message: () => {},
  stop: () => {},
  cancel: () => {},
  error: () => {},
  clear: () => {},
  isCancelled: false,
};

function isInteractiveSpinnerMode(): boolean {
  return Boolean(process.stderr.isTTY) && process.env.CI !== "true" && process.env.TERM !== "dumb";
}

function writeProgressLine(message?: string): void {
  if (!message) return;
  process.stderr.write(`${message}\n`);
}

function createStaticSpinner(): Spinner {
  let lastMessage: string | undefined;
  let isCancelled = false;

  const logOnce = (message?: string) => {
    if (!message || message === lastMessage) return;
    writeProgressLine(message);
    lastMessage = message;
  };

  return {
    start: (message) => {
      isCancelled = false;
      logOnce(message);
    },
    message: (message) => {
      logOnce(message);
    },
    stop: (message) => {
      logOnce(message);
    },
    cancel: (message) => {
      isCancelled = true;
      logOnce(message);
    },
    error: (message) => {
      logOnce(message);
    },
    clear: () => {},
    get isCancelled() {
      return isCancelled;
    },
  };
}

/**
 * Returns a real clack spinner in interactive TTY mode, a static stderr logger
 * in verbose/non-interactive environments, or a silent no-op stub in JSON mode.
 * Call `setOutputMode` once at command startup.
 */
export function createSpinner(): Spinner {
  if (_outputJson) {
    return noopSpinner;
  }
  if (isInteractiveSpinnerMode() && !_outputVerbose) {
    return p.spinner({ output: process.stderr });
  }
  return createStaticSpinner();
}
