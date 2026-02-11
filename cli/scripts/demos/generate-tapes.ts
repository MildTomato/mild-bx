#!/usr/bin/env tsx
/**
 * Generate VHS .tape files from CLI command specs
 *
 * Walks the command tree (same pattern as generate-docs.ts), classifies each
 * command, selects a template, and writes .tape files to scripts/demos/generated/.
 *
 * Usage:
 *   pnpm demos:generate
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { commandSpecs } from "../../src/commands/index.js";
import type { Command } from "../../src/util/commands/types.js";
import { generateConfigTape } from "./tape-config.js";
import { fixtures, extraTapes, type TapeCategory } from "./fixtures/index.js";
import {
  helpOnlyTape,
  helpAndExampleTape,
  exampleOnlyTape,
  longRunningTape,
  interactiveTape,
} from "./templates.js";

const GENERATED_DIR = join(import.meta.dirname, "generated");

/**
 * Build the tape file name from a command path.
 * e.g. "project env set" → "supa-project-env-set"
 */
function tapeFileName(commandPath: string): string {
  return `supa-${commandPath.replace(/ /g, "-")}`;
}

/**
 * Get the GIF name for a command path.
 */
function gifName(commandPath: string): string {
  return `${tapeFileName(commandPath)}.webm`;
}

/**
 * Auto-classify a command when no fixture is registered.
 */
function autoClassify(command: Command): TapeCategory {
  if (command.hidden) return "SKIP";
  if (command.subcommands && command.subcommands.length > 0) return "HELP_ONLY";
  return "HELP_AND_EXAMPLE";
}

/**
 * Get the first example value from a command spec.
 */
function getFirstExample(command: Command): string | null {
  if (!command.examples || command.examples.length === 0) return null;
  const ex = command.examples[0];
  return Array.isArray(ex.value) ? ex.value[0] : ex.value;
}

/**
 * Process a single command: classify, select template, write .tape file.
 */
function processCommand(command: Command, parentPath?: string): void {
  const commandPath = parentPath
    ? `${parentPath} ${command.name}`
    : command.name;

  const fixture = fixtures.get(commandPath);
  const category = fixture?.category ?? autoClassify(command);

  if (category === "SKIP") return;

  const gif = gifName(commandPath);
  const fileName = `${tapeFileName(commandPath)}.tape`;
  const opts = { height: fixture?.height, setup: fixture?.setup };

  let content: string;

  switch (category) {
    case "HELP_ONLY":
      content = helpOnlyTape(commandPath, gif, opts);
      break;

    case "HELP_AND_EXAMPLE": {
      const example =
        fixture?.exampleOverride ?? getFirstExample(command) ?? `supa ${commandPath} --help`;
      content = helpAndExampleTape(commandPath, gif, example, opts);
      break;
    }

    case "EXAMPLE_ONLY": {
      const example =
        fixture?.exampleOverride ?? getFirstExample(command) ?? `supa ${commandPath}`;
      content = exampleOnlyTape(commandPath, gif, example, opts);
      break;
    }

    case "LONG_RUNNING":
      content = longRunningTape(commandPath, gif, opts);
      break;

    case "INTERACTIVE":
      if (!fixture?.tapeBody) {
        console.warn(`  WARN: ${commandPath} is INTERACTIVE but has no tapeBody, falling back to HELP_ONLY`);
        content = helpOnlyTape(commandPath, gif, opts);
      } else {
        content = interactiveTape(gif, fixture.tapeBody, opts);
      }
      break;

    default:
      content = helpOnlyTape(commandPath, gif, opts);
  }

  const filePath = join(GENERATED_DIR, fileName);
  writeFileSync(filePath, content);
  console.log(`  ${fileName} (${category})`);

  // Recurse into subcommands
  if (command.subcommands) {
    for (const sub of command.subcommands) {
      if (!sub.hidden) {
        processCommand(sub, commandPath);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────

console.log("Generating VHS tape files from command specs...");
console.log("");

mkdirSync(GENERATED_DIR, { recursive: true });

// Write shared config.tape
const configPath = join(GENERATED_DIR, "config.tape");
writeFileSync(configPath, generateConfigTape());
console.log("  config.tape (shared settings)");

// Generate root supa tape (special case: `supa --help`, no subcommand path)
const rootGif = "supa.webm";
writeFileSync(
  join(GENERATED_DIR, "supa.tape"),
  [
    "Source config.tape",
    `Output ../../../../apps/docs/public/demos/${rootGif}`,
    "",
    "Require supa",
    "",
    `Type@40ms "supa --help"`,
    "Sleep 400ms",
    "Enter",
    "Sleep 3s",
    "",
  ].join("\n") + "\n"
);
console.log("  supa.tape (HELP_ONLY)");

// Process all top-level commands
for (const command of commandSpecs) {
  processCommand(command);
}

// Process extra tapes (variant demos for the same command)
for (const [key, fixture] of extraTapes) {
  if (!fixture.tapeBody) continue;
  const gif = `supa-${key}.webm`;
  const fileName = `supa-${key}.tape`;
  const content = interactiveTape(gif, fixture.tapeBody, { height: fixture.height });
  writeFileSync(join(GENERATED_DIR, fileName), content);
  console.log(`  ${fileName} (INTERACTIVE, extra)`);
}

console.log("");
console.log("Done! Tape files written to scripts/demos/generated/");
