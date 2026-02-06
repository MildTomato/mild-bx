/**
 * Shared command header for Clack-style CLI output
 */

import chalk from "chalk";

// Use 256-color gray (244) for consistency with C.secondary
const gray = chalk.ansi256(244);
const bar = gray("│");
const corner = gray("╭─");
const bullet = gray("○");

export interface CommandHeaderOptions {
  command: string;
  description?: string[];
  showBranding?: boolean;
}

/**
 * Print a Clack-style command header
 *
 * With branding (supa init):
 * ○  SUPABASE
 * │
 * │  Description line 1
 * │
 * ╭   command
 * │
 *
 * Without branding (other commands):
 * ╭   command
 * │
 * │  Description line 1
 */
export function printCommandHeader(options: CommandHeaderOptions): void {
  const { command, description, showBranding } = options;

  console.log();

  if (showBranding) {
    console.log(`   ${chalk.bold.green("SUPABASE")}`);
    console.log();
    if (description && description.length > 0) {
      for (const line of description) {
        console.log(`   ${chalk.dim(line)}`);
      }
      console.log();
    }
    console.log(`${corner} ${chalk.bgGreen.black(` ${command} `)}`);
  } else {
    console.log(`${corner} ${chalk.bgGreen.black(` ${command} `)}`);
    console.log(bar);
    if (description && description.length > 0) {
      for (const line of description) {
        console.log(`${bar}  ${chalk.dim(line)}`);
      }
    }
  }
}

/** The bar character for continuing the rail */
export const S_BAR = gray("│");

/** Gray color function - use this for consistent rail/border colors */
export { gray };
