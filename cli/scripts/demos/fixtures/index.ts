/**
 * Fixture registry
 *
 * Maps command paths (e.g. "init", "project env set") to hand-crafted
 * tape overrides. Commands without a fixture use auto-classification.
 */

import { initLocalFixture, initConnectFixture, initCreateFixture } from "./init.js";

export type TapeCategory =
  | "HELP_ONLY"
  | "HELP_AND_EXAMPLE"
  | "EXAMPLE_ONLY"
  | "LONG_RUNNING"
  | "INTERACTIVE"
  | "SKIP";

export interface TapeFixture {
  /** Override auto-classification */
  category?: TapeCategory;
  /** Hidden VHS commands before recording starts */
  setup?: string[];
  /** Override the spec's first example value */
  exampleOverride?: string;
  /** Override terminal height */
  height?: number;
  /** For INTERACTIVE: full tape body content */
  tapeBody?: string;
}

/**
 * Registry keyed by command path (space-separated).
 * e.g. "init", "project env set"
 */
// Shared setup: cd into demo project directory (relative from generated/)
const PROJECT_SETUP = ["cd ../../../demos/recordings"];

/**
 * Extra tapes that don't map 1:1 to a command path.
 * The generator writes these as additional .tape files.
 * Key format: "command--variant" → tape file: supa-command--variant.tape
 */
export const extraTapes = new Map<string, TapeFixture>([
  ["init--local", initLocalFixture],
  ["init--connect", initConnectFixture],
]);

export const fixtures = new Map<string, TapeFixture>([
  // Interactive commands (init → "create new project" is the primary demo)
  ["init", initCreateFixture],

  // Long-running commands
  ["dev", { category: "LONG_RUNNING", setup: PROJECT_SETUP }],

  // Truly help-only (browser auth or destructive)
  ["login", { category: "HELP_ONLY" }],
  ["logout", { category: "HELP_ONLY" }],

  // Commands with real output — just run the example
  ["orgs", { category: "EXAMPLE_ONLY", exampleOverride: "supa orgs" }],
  ["projects list", { category: "EXAMPLE_ONLY", exampleOverride: "supa projects list" }],

  // Parent commands with no direct examples
  ["projects", { category: "HELP_ONLY" }],
  ["projects delete", { category: "HELP_ONLY" }],
  ["project", { category: "HELP_ONLY" }],
  ["project env", { category: "HELP_ONLY" }],
  ["project auth-provider", { category: "HELP_ONLY" }],

  // Project commands — example only, cd into demo directory
  ["project pull", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project pull --plan" }],
  ["project push", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project push --plan" }],
  ["project dev", { category: "LONG_RUNNING", setup: PROJECT_SETUP }],
  ["project seed", { setup: PROJECT_SETUP }],
  ["project seed-status", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project seed-status" }],
  ["project api-keys", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project api-keys" }],
  ["project profile", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project profile" }],
  ["project env pull", { setup: PROJECT_SETUP }],
  ["project env push", { setup: PROJECT_SETUP }],
  ["project env set", { setup: PROJECT_SETUP }],
  ["project env unset", { setup: PROJECT_SETUP }],
  ["project env list", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project env list" }],
  ["project env list-environments", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project env list-environments" }],
  ["project env create", { setup: PROJECT_SETUP }],
  ["project env delete", { setup: PROJECT_SETUP }],
  ["project env seed", { setup: PROJECT_SETUP }],
  ["project auth-provider list", { category: "EXAMPLE_ONLY", setup: PROJECT_SETUP, exampleOverride: "supa project auth-provider list" }],
  ["project auth-provider add", { setup: PROJECT_SETUP }],
  ["project auth-provider enable", { setup: PROJECT_SETUP }],
  ["project auth-provider disable", { setup: PROJECT_SETUP }],
]);
