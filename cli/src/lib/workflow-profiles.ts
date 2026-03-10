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
 * Current workflow profiles.
 *
 * Two axes: branching (on/off) × dev environment (remote/local).
 */
export const WORKFLOW_PROFILES: WorkflowProfileDefinition[] = [
  {
    name: "remote",
    title: "Remote dev, no branching",
    art: `
▓▓▓▓▓▓▓▓▓▓▓▓▓▓        supa push        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓ Remote Dev ▓ ──────────────────────► ▓ PRODUCTION ▓
▓▓▓▓▓▓▓▓▓▓▓▓▓▓                         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Work directly against a remote project. No local services.",
    vibe: "Side project, indie hacker, always-on remote",
  },
  {
    name: "local",
    title: "Local dev, no branching",
    art: `
▓▓▓▓▓▓▓▓▓        supa push        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓ Local  ▓ ──────────────────────► ▓ PRODUCTION ▓
▓▓▓▓▓▓▓▓▓                          ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Run Supabase locally. Push to production when ready.",
    vibe: "Prefer local services, full offline capability",
  },
  {
    name: "branching-remote",
    title: "Branching, remote dev",
    art: `
              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
feat/x ──────► ▓ dev/alice  ▓ ─╮
              ▓ dev/bob    ▓ ─┼──► ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   merge   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ╯   ▓ preview/feat  ▓ ──────────► ▓ PRODUCTION ▓
                                   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓            ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Personal remote dev environment per developer per branch. Shared preview per branch.",
    vibe: "Team working against remote, Convex-style isolation",
  },
  {
    name: "branching-local",
    title: "Branching, local dev",
    art: `
▓▓▓▓▓▓▓▓▓   git push   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   merge PR   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓ Local  ▓ ──────────► ▓ preview/feat   ▓ ──────────► ▓ PRODUCTION ▓
▓▓▓▓▓▓▓▓▓              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`,
    description: "Run Supabase locally. Git push triggers a shared preview per branch.",
    vibe: "Team workflow, local services, Git-driven previews",
  },
];

/**
 * Legacy profiles — kept for reference and backwards compatibility.
 * Do not use for new projects.
 */
export const LEGACY_WORKFLOW_PROFILES: WorkflowProfileDefinition[] = [
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
    description: "Automatic preview environments per Git branch. CI/CD friendly.",
    vibe: "Team workflow, CI/CD, ephemeral preview environments",
  },
];

/** Default workflow profile for new projects. */
export const DEFAULT_WORKFLOW_PROFILE: WorkflowProfile = "branching-remote";

/** Set of current branching profile names. */
export const BRANCHING_PROFILES = new Set<WorkflowProfile>([
  "branching-remote",
  "branching-local",
]);

/** Set of legacy profile names — present in config but no longer selectable for new projects. */
export const LEGACY_PROFILE_NAMES = new Set<WorkflowProfile>([
  "solo",
  "staged",
  "preview",
  "preview-git",
]);

/**
 * Returns true if the given profile uses database branching.
 */
export function isBranchingProfile(profile: WorkflowProfile): boolean {
  return BRANCHING_PROFILES.has(profile);
}

/**
 * Returns true if the given profile is a legacy (pre-rename) profile.
 */
export function isLegacyProfile(profile: WorkflowProfile): boolean {
  return LEGACY_PROFILE_NAMES.has(profile);
}

/**
 * Look up a profile definition by name (current or legacy).
 */
export function getProfileDefinition(
  name: WorkflowProfile,
): WorkflowProfileDefinition | undefined {
  return (
    WORKFLOW_PROFILES.find((p) => p.name === name) ??
    LEGACY_WORKFLOW_PROFILES.find((p) => p.name === name)
  );
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
