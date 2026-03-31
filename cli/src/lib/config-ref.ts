/**
 * Config reference syntax utilities.
 *
 * Supports two reference types in config.json values:
 *   env(VAR_NAME)    — non-sensitive, can be pulled to .env.local / env-server
 *   secret(VAR_NAME) — sensitive, never pulled locally, never stored in env-server
 */

export type ConfigRef = { type: "env" | "secret"; varName: string };

/**
 * Parse a config ref string such as `env(FOO)` or `secret(BAR)`.
 * Returns null if the value is not a ref.
 */
export function parseConfigRef(value: unknown): ConfigRef | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(env|secret)\(([^)]+)\)$/);
  if (!m) return null;
  return { type: m[1] as "env" | "secret", varName: m[2] };
}

/**
 * Returns true if the value is a config ref string.
 */
export function isConfigRef(value: unknown): boolean {
  return parseConfigRef(value) !== null;
}

/**
 * Build an `env(VAR_NAME)` ref string.
 */
export function makeEnvRef(varName: string): string {
  return `env(${varName})`;
}

/**
 * Build a `secret(VAR_NAME)` ref string.
 */
export function makeSecretRef(varName: string): string {
  return `secret(${varName})`;
}

// ---------------------------------------------------------------------------
// Config scanning
// ---------------------------------------------------------------------------

import type { ProjectConfig } from "./config-types.js";

function collectRefs(
  obj: unknown,
  type: "env" | "secret",
  path: string,
  result: Map<string, string>
): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "string") {
    const ref = parseConfigRef(obj);
    if (ref && ref.type === type) result.set(ref.varName, path);
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) collectRefs(obj[i], type, `${path}[${i}]`, result);
    return;
  }
  if (typeof obj === "object") {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      collectRefs(val, type, path ? `${path}.${key}` : key, result);
    }
  }
}

/** Scan config for all `secret(VAR)` refs. Returns Map<varName, configPath>. */
export function getSecretRefs(config: ProjectConfig): Map<string, string> {
  const result = new Map<string, string>();
  collectRefs(config, "secret", "", result);
  return result;
}

/** Scan config for all `env(VAR)` refs. Returns Map<varName, configPath>. */
export function getEnvRefs(config: ProjectConfig): Map<string, string> {
  const result = new Map<string, string>();
  collectRefs(config, "env", "", result);
  return result;
}
