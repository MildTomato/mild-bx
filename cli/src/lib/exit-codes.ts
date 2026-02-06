/**
 * Exit codes for CLI commands
 * Helps scripts and agents distinguish different failure modes
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_ERROR: 1,
  CONFIG_NOT_FOUND: 2,
  AUTH_FAILURE: 3,
  NETWORK_ERROR: 4,
  VALIDATION_ERROR: 5,
  USER_CANCELLED: 130, // Standard code for Ctrl-C
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
