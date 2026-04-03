/**
 * Shared command header for Clack-style CLI output
 * Uses C.pipe (\x1b[90m) to match Clack's pipe color exactly.
 */

import { C } from "@/lib/colors.js";

const pipe = (s: string) => `${C.pipe}${s}${C.reset}`;
const secondary = (s: string) => `${C.secondary}${s}${C.reset}`;
const bar = pipe("│");
const corner = pipe("╭─");
const bullet = pipe("○");

/** Raw ANSI: green background + black text (chalk bgGreen.black can fail when color level is 0) */
const bgGreenBlack = (s: string) => `\x1b[42m\x1b[30m${s}\x1b[0m`;

export interface CommandHeaderOptions {
  command: string;
  description?: string[];
  showBranding?: boolean;
  /** Key-value context lines printed below the description (e.g. Project, Profile, Env) */
  context?: [label: string, value: string][];
}

export function printCommandHeader(options: CommandHeaderOptions): void {
  const { command, description, showBranding, context } = options;

  console.log();

  if (showBranding) {
    console.log(`   \x1b[1m\x1b[32mSUPABASE\x1b[0m`);
    console.log();
    if (description && description.length > 0) {
      for (const line of description) {
        console.log(`   ${`\x1b[2m${line}\x1b[0m`}`);
      }
      console.log();
    }
    console.log(`${corner} ${bgGreenBlack(` ${command} `)}`);
  } else {
    console.log(`${corner} ${bgGreenBlack(` ${command} `)}`);
    console.log(bar);
    if (description && description.length > 0) {
      for (const line of description) {
        console.log(`${bar}  ${`\x1b[2m${line}\x1b[0m`}`);
      }
    }
  }

  if (context && context.length > 0) {
    console.log(bar);
    for (const [label, value] of context) {
      console.log(`${bar}  ${secondary((label + ":").padEnd(10))} ${value}`);
    }
    console.log(bar);
  }
}

/** The bar character for continuing the rail */
export const S_BAR = pipe("│");

/** Pipe color function matching Clack's pipe color */
export { pipe };

export interface ProjectContextOptions {
  /** Production / parent project ref */
  parentRef: string;
  /** Branch project ref — shown as └ ref if set and different from parentRef */
  branchRef?: string;
  gitBranch?: string;
  profileName?: string;
  dashboardUrl?: string;
  /**
   * Ordered list of config files that were merged to produce the effective
   * config. When more than one file is present the "Config:" line is rendered.
   */
  configLayers?: string[];
  /** Additional context lines rendered after Branch */
  extra?: [label: string, value: string][];
}

/**
 * Print the standard Project / Dashboard / Profile / Branch / └ ref context block.
 * Call after printCommandHeader (without context) to render project-level details.
 */
export function printProjectContextLines(opts: ProjectContextOptions): void {
  const { parentRef, branchRef, gitBranch, profileName, dashboardUrl, configLayers, extra } = opts;

  console.log(bar);
  console.log(`${bar}  ${secondary("Project:".padEnd(10))} ${parentRef}`);
  if (dashboardUrl) {
    console.log(`${bar}  ${secondary("Dashboard:".padEnd(10))} ${dashboardUrl}`);
  }
  console.log(`${bar}  ${secondary("Profile:".padEnd(10))} ${profileName ?? "default"}`);
  if (gitBranch) {
    console.log(`${bar}  ${secondary("Branch:".padEnd(10))} ${gitBranch}`);
    if (branchRef && branchRef !== parentRef) {
      console.log(`${bar}  ${secondary("  └ ref:".padEnd(10))} ${secondary(branchRef)}`);
    }
  }
  if (configLayers && configLayers.length > 1) {
    console.log(`${bar}  ${secondary("Config:".padEnd(10))} ${configLayers.join(" + ")}`);
  }
  for (const [label, value] of extra ?? []) {
    console.log(`${bar}  ${secondary((label + ":").padEnd(10))} ${value}`);
  }
  console.log(bar);
}
