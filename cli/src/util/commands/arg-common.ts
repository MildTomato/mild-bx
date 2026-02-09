/**
 * Shared/common option definitions for reuse across commands
 * Based on Vercel CLI patterns
 */

import { getFlagsSpecification } from "./get-flags-specification.js";
import type { CommandOption } from "./types.js";

/**
 * Global options available on all commands
 */
export const globalCommandOptions = [
  {
    name: "help",
    shorthand: "h",
    type: Boolean,
    description: "Output usage information",
    deprecated: false,
  },
  {
    name: "version",
    shorthand: "V",
    type: Boolean,
    description: "Output the version number",
    deprecated: false,
  },
] as const satisfies ReadonlyArray<CommandOption>;

/**
 * Pre-computed arg spec for global options
 */
const GLOBAL_OPTIONS = getFlagsSpecification(globalCommandOptions);
export const getGlobalOptions = () => GLOBAL_OPTIONS;

// ─────────────────────────────────────────────────────────────
// Reusable option definitions
// ─────────────────────────────────────────────────────────────

/**
 * --yes / -y: Skip confirmation prompts
 */
export const yesOption = {
  name: "yes",
  shorthand: "y",
  type: Boolean,
  deprecated: false,
  description: "Skip confirmation prompts",
} as const satisfies CommandOption;

/**
 * --json: Output as JSON (machine-readable)
 */
export const jsonOption = {
  name: "json",
  shorthand: null,
  type: Boolean,
  deprecated: false,
  description: "Output as JSON",
} as const satisfies CommandOption;

/**
 * --profile / -p: Profile to use for multi-environment workflows
 */
export const profileOption = {
  name: "profile",
  shorthand: "p",
  type: String,
  argument: "NAME",
  deprecated: false,
  description: "Profile to use",
} as const satisfies CommandOption;

/**
 * --verbose / -v: Show detailed logging
 */
export const verboseOption = {
  name: "verbose",
  shorthand: "v",
  type: Boolean,
  deprecated: false,
  description: "Show detailed logging",
} as const satisfies CommandOption;

/**
 * --plan: Dry run / preview mode
 */
export const planOption = {
  name: "plan",
  shorthand: null,
  type: Boolean,
  deprecated: false,
  description: "Show what would happen without making changes",
} as const satisfies CommandOption;

/**
 * --dry-run: Alternative name for plan/preview
 */
export const dryRunOption = {
  name: "dry-run",
  shorthand: null,
  type: Boolean,
  deprecated: false,
  description: "Show what would be done without applying",
} as const satisfies CommandOption;

/**
 * --org: Organization slug
 */
export const orgOption = {
  name: "org",
  shorthand: null,
  type: String,
  argument: "SLUG",
  deprecated: false,
  description: "Organization slug",
} as const satisfies CommandOption;

/**
 * --region: Region for project creation
 */
export const regionOption = {
  name: "region",
  shorthand: null,
  type: String,
  argument: "REGION",
  deprecated: false,
  description: "Region (e.g., us-east-1)",
} as const satisfies CommandOption;

/**
 * --name: Name for resources
 */
export const nameOption = {
  name: "name",
  shorthand: null,
  type: String,
  argument: "NAME",
  deprecated: false,
  description: "Resource name",
} as const satisfies CommandOption;

/**
 * --environment / -e: Environment name (development, preview, production, custom)
 */
export const environmentOption = {
  name: "environment",
  shorthand: "e",
  type: String,
  argument: "NAME",
  deprecated: false,
  description: "Environment name (default: development)",
} as const satisfies CommandOption;

/**
 * --branch / -b: Branch name for branch-specific overrides
 */
export const branchOption = {
  name: "branch",
  shorthand: "b",
  type: String,
  argument: "NAME",
  deprecated: false,
  description: "Branch name for environment variable override",
} as const satisfies CommandOption;

/**
 * --secret: Mark variable as write-only secret
 */
export const secretOption = {
  name: "secret",
  shorthand: null,
  type: Boolean,
  deprecated: false,
  description: "Mark variable as write-only secret",
} as const satisfies CommandOption;

/**
 * --prune: Remove variables not present locally
 */
export const pruneOption = {
  name: "prune",
  shorthand: null,
  type: Boolean,
  deprecated: false,
  description: "Remove remote variables not present locally",
} as const satisfies CommandOption;
