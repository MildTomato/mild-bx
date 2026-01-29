/**
 * Shared terminal styling utilities
 * Centralizes colors and formatting for consistent CLI output
 * Based on external/cli watch.ts styling conventions
 */

// ANSI escape codes
const ESC = "\x1b[";

// Raw ANSI colors
export const colors = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,

  // Semantic colors (matching external/cli)
  value: `${ESC}37m`, // Primary values (white)
  secondary: `${ESC}38;5;244m`, // Secondary text (256-color gray)
  icon: `${ESC}33m`, // Icons and accents (burnt orange/yellow)
  fileName: `${ESC}36m`, // File names (cyan)
  error: `${ESC}31m`, // Errors (red)
  success: `${ESC}32m`, // Success (green)

  // Additional colors
  cyan: `${ESC}36m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  magenta: `${ESC}35m`,
  blue: `${ESC}34m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
};

// Icons (unicode)
export const icons = {
  check: "✓",
  cross: "✗",
  arrow: "→",
  bullet: "•",
  file: "📄",
  folder: "📁",
  key: "🔑",
  link: "🔗",
  warning: "⚠",
  info: "ℹ",
};

// Styled text helpers using semantic colors
export function success(text: string): string {
  return `${colors.success}${icons.check}${colors.reset} ${text}`;
}

export function error(text: string): string {
  return `${colors.error}${icons.cross}${colors.reset} ${text}`;
}

export function warning(text: string): string {
  return `${colors.icon}${icons.warning}${colors.reset} ${text}`;
}

export function info(text: string): string {
  return `${colors.fileName}${icons.info}${colors.reset} ${text}`;
}

export function bold(text: string): string {
  return `${colors.bold}${text}${colors.reset}`;
}

export function dim(text: string): string {
  return `${colors.secondary}${text}${colors.reset}`;
}

export function secondary(text: string): string {
  return `${colors.secondary}${text}${colors.reset}`;
}

export function accent(text: string): string {
  return `${colors.icon}${text}${colors.reset}`;
}

export function url(text: string): string {
  return `${colors.fileName}${text}${colors.reset}`;
}

export function file(text: string): string {
  return `${colors.fileName}${text}${colors.reset}`;
}

export function label(text: string): string {
  return `${colors.secondary}${text}${colors.reset}`;
}

export function value(text: string): string {
  return `${colors.value}${text}${colors.reset}`;
}
