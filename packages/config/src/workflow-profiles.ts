/**
 * Workflow profile values - single source of truth.
 * Used by config schema generation, Zod validation, and type definitions.
 */

export const WORKFLOW_PROFILE_VALUES = [
  "remote",
  "local",
  "branching-remote",
  "branching-local",
] as const;

export type WorkflowProfile = (typeof WORKFLOW_PROFILE_VALUES)[number];
