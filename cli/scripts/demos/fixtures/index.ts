/**
 * Fixture registry
 *
 * Maps command paths (e.g. "init", "project env set") to hand-crafted
 * tape overrides. Commands without a fixture use auto-classification.
 *
 * All non-interactive tapes automatically cd into demos/recordings/
 * before recording (handled by the generator). Interactive tapes manage
 * their own setup via tapeBody.
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
  /** Override the spec's first example value */
  exampleOverride?: string;
  /** Override terminal height */
  height?: number;
  /** For INTERACTIVE: full tape body content */
  tapeBody?: string;
}

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
  // Interactive commands
  ["bootstrap", { category: "SKIP" }],
  ["init", initCreateFixture],

  // Long-running commands
  ["dev", { category: "LONG_RUNNING" }],

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

  // Project commands
  ["project pull", { category: "EXAMPLE_ONLY", exampleOverride: "supa project pull --plan" }],
  ["project push", { category: "EXAMPLE_ONLY", exampleOverride: "supa project push --plan" }],
  ["project dev", { category: "LONG_RUNNING" }],
  ["project seed", {}],
  ["project seed-status", { category: "EXAMPLE_ONLY", exampleOverride: "supa project seed-status" }],
  ["project api-keys", { category: "EXAMPLE_ONLY", exampleOverride: "supa project api-keys" }],
  ["project profile", { category: "EXAMPLE_ONLY", exampleOverride: "supa project profile" }],
  ["project env pull", {}],
  ["project env push", {}],
  ["project env set", {}],
  ["project env unset", {}],
  ["project env list", { category: "EXAMPLE_ONLY", exampleOverride: "supa project env list" }],
  ["project env list-environments", { category: "EXAMPLE_ONLY", exampleOverride: "supa project env list-environments" }],
  ["project env create", {}],
  ["project env delete", {}],
  ["project env seed", {}],
  ["project auth-provider list", { category: "EXAMPLE_ONLY", exampleOverride: "supa project auth-provider list" }],
  ["project auth-provider add", {}],
  ["project auth-provider enable", {}],
  ["project auth-provider disable", {}],
]);
