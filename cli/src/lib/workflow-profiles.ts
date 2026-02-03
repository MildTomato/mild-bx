import type { WorkflowProfile } from "./config-types.js";

/**
 * Definition for a workflow profile that determines how environments
 * are structured and how commands like `supa push` and `supa merge` behave.
 */
export interface WorkflowProfileDefinition {
  /** Profile identifier used in config.json */
  name: WorkflowProfile;
  /** Short tagline shown in profile selector (e.g. "Just ship it") */
  title: string;
  /**
   * ASCII art diagram showing the environment flow.
   * Plain text only - colors are applied at render time by ProfileDisplayUI
   * in profile.tsx, which parses ▓ boxes and colors them based on keywords
   * (local=yellow, preview=blue, staging=cyan, production=red).
   */
  art: string;
  /** One-line description of the profile */
  description: string;
  /** Target audience/use case hint */
  vibe: string;
}

/**
 * Available workflow profiles with ASCII art diagrams.
 *
 * The `art` field is plain text - colors are applied at render time
 * by parsing content and wrapping in Ink `<Text>` components.
 * See profile.tsx ProfileDisplayUI for the color mapping.
 */
export const WORKFLOW_PROFILES: WorkflowProfileDefinition[] = [
  {
    name: "solo",
    title: "Just ship it",
    art: `
▓▓▓▓▓▓▓▓▓        supa push        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓ Local ▓ ──────────────────────► ▓ PRODUCTION ▓
▓▓▓▓▓▓▓▓▓                         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Push straight to production. No staging, no previews.",
    vibe: "Side project, indie hacker, moving fast",
  },
  {
    name: "staged",
    title: "Safety net",
    art: `
▓▓▓▓▓▓▓▓▓  supa push  ▓▓▓▓▓▓▓▓▓▓▓  supa merge  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓ Local ▓ ──────────► ▓ STAGING ▓ ───────────► ▓ PRODUCTION ▓
▓▓▓▓▓▓▓▓▓             ▓▓▓▓▓▓▓▓▓▓▓              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Test changes in staging before pushing to production.",
    vibe: "Want to test before prod",
  },
  {
    name: "preview",
    title: "Multiple preview environments",
    art: `
▓▓▓▓▓▓▓▓▓      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               
▓ Local ▓ ───► ▓ preview-alice ▓ ─╮            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓   ╭─ ▓ preview-bob   ▓ ─┼──────────► ▓ PRODUCTION ▓
            ╰► ▓ preview-carol ▓ ─╯            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
               ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Multiple manually-named preview environments.",
    vibe: "Multiple developers, each with their own sandbox",
  },
  {
    name: "preview-git",
    title: "Git-driven preview environments",
    art: `
feature/auth ──► ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ─╮
feature/pay  ──► ▓ preview-auth ▓ ─┤
feature/dash ──► ▓ preview-pay  ▓ ─┤           ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                 ▓ preview-dash ▓ ─┤─────────► ▓ PRODUCTION ▓
                 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │           ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                         merge PR ─╯
`,
    description:
      "Automatic preview environments per Git branch. CI/CD friendly.",
    vibe: "Team workflow, CI/CD, ephemeral preview environments",
  },
];

/**
 * Look up a profile definition by name.
 * Used when you have a profile name from config and need the full definition
 * (art, description, etc.) for display.
 *
 * @returns The profile definition, or undefined if not found
 */
export function getProfileDefinition(
  name: WorkflowProfile,
): WorkflowProfileDefinition | undefined {
  return WORKFLOW_PROFILES.find((p) => p.name === name);
}

/**
 * Format a profile for plain text output (non-Ink contexts like console.log).
 * Returns the raw ASCII art without colors.
 *
 * For colored Ink output, use ProfileDisplayUI in profile.tsx instead.
 */
export function formatProfile(
  profile: WorkflowProfileDefinition,
  selected = false,
): string {
  return profile.art;
}
