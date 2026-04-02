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

// ---------------------------------------------------------------------------
// Schema-driven secret detection
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const _require = createRequire(import.meta.url);
const _dirname = dirname(fileURLToPath(import.meta.url));

/** Set of dot-paths that are marked `secret: true` in the platform schema. */
function loadSecretPaths(): Set<string> {
  try {
    const schemaPath = join(_dirname, "../../../packages/config/config-schema/config.platform.schema.json");
    const schema = _require(schemaPath);
    const paths = new Set<string>();

    function walk(obj: Record<string, unknown>, path: string): void {
      if (obj.secret === true) paths.add(path);
      const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        for (const [key, val] of Object.entries(props)) {
          walk(val, path ? `${path}.${key}` : key);
        }
      }
    }

    walk(schema, "");
    return paths;
  } catch {
    return new Set();
  }
}

const SECRET_PATHS = loadSecretPaths();

export interface HardcodedSecret {
  /** Dot-path to the field in config, e.g. "auth.external.github.secret" */
  path: string;
  /** CLI command to set this secret properly */
  setCommand: string;
}

function scanForHardcodedSecrets(
  obj: unknown,
  path: string,
  results: HardcodedSecret[]
): void {
  if (obj === null || obj === undefined || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof value === "string" && value.length > 0 && !isConfigRef(value)) {
      if (SECRET_PATHS.has(currentPath)) {
        results.push({
          path: currentPath,
          setCommand: `supa secret set ${currentPath}=<value>`,
        });
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      scanForHardcodedSecrets(value, currentPath, results);
    }
  }
}

/**
 * Scan config for secret fields (schema `secret: true`) that contain raw
 * hardcoded values instead of being set via `supa secret set`.
 */
export function detectHardcodedSecrets(config: ProjectConfig): HardcodedSecret[] {
  const results: HardcodedSecret[] = [];
  scanForHardcodedSecrets(config, "", results);
  return results;
}

/**
 * Return a deep copy of config with all hardcoded secret fields removed.
 * Use this before building payloads to ensure hardcoded secrets are never sent.
 */
export function stripHardcodedSecrets(config: ProjectConfig): ProjectConfig {
  const hardcoded = detectHardcodedSecrets(config);
  if (hardcoded.length === 0) return config;

  const copy = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const { path } of hardcoded) {
    const parts = path.split(".");
    let obj = copy as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]] as Record<string, unknown>;
      if (!obj) break;
    }
    if (obj) delete obj[parts[parts.length - 1]];
  }
  return copy as ProjectConfig;
}
