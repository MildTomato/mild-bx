/**
 * Tape template functions
 *
 * Each function returns the full .tape file content for a given command.
 * All tapes Source the shared config.tape and Output to the docs GIF directory.
 */

import { TAPE_CONFIG } from "./tape-config.js";

const CONFIG_SOURCE = "Source config.tape";

function outputLine(gifName: string): string {
  return `Output ../../../../apps/docs/public/demos/${gifName}`;
}

function requireLine(): string {
  return "Require supa";
}

/**
 * Help-only tape — for parent commands and commands that need auth/network.
 * Types `supa <command> --help`, pauses for reading.
 */
export function helpOnlyTape(
  commandPath: string,
  gifName: string,
  opts?: { height?: number }
): string {
  const lines: string[] = [
    CONFIG_SOURCE,
    outputLine(gifName),
    "",
    requireLine(),
  ];

  if (opts?.height) {
    lines.push(`Set Height ${opts.height}`);
  }

  lines.push(
    "",
    `Type@${TAPE_CONFIG.typingSpeed} "supa ${commandPath} --help"`,
    "Sleep 400ms",
    "Enter",
    `Sleep ${TAPE_CONFIG.helpPause}`,
  );

  return lines.join("\n") + "\n";
}

/**
 * Help + example tape — for leaf commands with safe examples.
 * Shows --help, pauses, clears, types the first example, pauses.
 */
export function helpAndExampleTape(
  commandPath: string,
  gifName: string,
  example: string,
  opts?: { height?: number; setup?: string[] }
): string {
  const lines: string[] = [
    CONFIG_SOURCE,
    outputLine(gifName),
    "",
    requireLine(),
  ];

  if (opts?.height) {
    lines.push(`Set Height ${opts.height}`);
  }

  // Hidden setup (e.g., cd into project directory)
  if (opts?.setup && opts.setup.length > 0) {
    lines.push("", "Hide");
    for (const cmd of opts.setup) {
      lines.push(`Type "${cmd}"`);
      lines.push("Enter");
      lines.push("Sleep 500ms");
    }
    lines.push("Show");
  }

  lines.push(
    "",
    `Type@${TAPE_CONFIG.typingSpeed} "supa ${commandPath} --help"`,
    "Sleep 400ms",
    "Enter",
    `Sleep ${TAPE_CONFIG.helpPause}`,
    "",
    `Type "clear"`,
    "Enter",
    `Sleep ${TAPE_CONFIG.sectionGap}`,
    "",
    `Type@${TAPE_CONFIG.typingSpeed} "${example}"`,
    "Sleep 400ms",
    "Enter",
    `Sleep ${TAPE_CONFIG.examplePause}`,
  );

  return lines.join("\n") + "\n";
}

/**
 * Long-running tape — for commands like `dev`.
 * Shows --help, clears, starts the command, then Ctrl+C after a delay.
 */
export function longRunningTape(
  commandPath: string,
  gifName: string,
  opts?: { height?: number; setup?: string[] }
): string {
  const lines: string[] = [
    CONFIG_SOURCE,
    outputLine(gifName),
    "",
    requireLine(),
  ];

  if (opts?.height) {
    lines.push(`Set Height ${opts.height}`);
  }

  if (opts?.setup && opts.setup.length > 0) {
    lines.push("", "Hide");
    for (const cmd of opts.setup) {
      lines.push(`Type "${cmd}"`);
      lines.push("Enter");
      lines.push("Sleep 500ms");
    }
    lines.push("Show");
  }

  lines.push(
    "",
    `Type@${TAPE_CONFIG.typingSpeed} "supa ${commandPath} --help"`,
    "Sleep 400ms",
    "Enter",
    `Sleep ${TAPE_CONFIG.helpPause}`,
    "",
    `Type "clear"`,
    "Enter",
    `Sleep ${TAPE_CONFIG.sectionGap}`,
    "",
    `Type@${TAPE_CONFIG.typingSpeed} "supa ${commandPath}"`,
    "Sleep 400ms",
    "Enter",
    "Sleep 3s",
    "Ctrl+C",
    "Sleep 1s",
  );

  return lines.join("\n") + "\n";
}

/**
 * Example-only tape — just runs the command, no help screen.
 */
export function exampleOnlyTape(
  commandPath: string,
  gifName: string,
  example: string,
  opts?: { height?: number; setup?: string[] }
): string {
  const lines: string[] = [
    CONFIG_SOURCE,
    outputLine(gifName),
    "",
    requireLine(),
  ];

  if (opts?.height) {
    lines.push(`Set Height ${opts.height}`);
  }

  if (opts?.setup && opts.setup.length > 0) {
    lines.push("", "Hide");
    for (const cmd of opts.setup) {
      lines.push(`Type "${cmd}"`);
      lines.push("Enter");
      lines.push("Sleep 500ms");
    }
    lines.push("Show");
  }

  lines.push(
    "",
    `Type@${TAPE_CONFIG.typingSpeed} "${example}"`,
    "Sleep 400ms",
    "Enter",
    `Sleep ${TAPE_CONFIG.examplePause}`,
  );

  return lines.join("\n") + "\n";
}

/**
 * Interactive tape — wraps a hand-crafted fixture body with Source + Output.
 * The fixture provides the full tape body including typed commands and Wait directives.
 */
export function interactiveTape(
  gifName: string,
  tapeBody: string,
  opts?: { height?: number }
): string {
  const lines: string[] = [
    CONFIG_SOURCE,
    outputLine(gifName),
    "",
    requireLine(),
  ];

  if (opts?.height) {
    lines.push(`Set Height ${opts.height}`);
  }

  lines.push("", tapeBody);

  return lines.join("\n") + "\n";
}
