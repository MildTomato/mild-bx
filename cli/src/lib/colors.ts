/**
 * ANSI color codes for CLI output
 */

export const C = {
  reset: "\x1b[0m",
  value: "\x1b[37m", // Primary values (white)
  secondary: "\x1b[38;5;244m", // Secondary text (gray)
  icon: "\x1b[33m", // Icons and accents (yellow)
  fileName: "\x1b[36m", // File names (cyan)
  error: "\x1b[31m", // Errors (red)
  success: "\x1b[32m", // Success (green)
  warning: "\x1b[33m", // Warnings (yellow)
  magenta: "\x1b[35m", // Spinner/active (magenta)
  bold: "\x1b[1m",
} as const;
