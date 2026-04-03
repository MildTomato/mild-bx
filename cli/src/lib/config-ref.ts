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

// Import the platform schema statically so the bundler (tsup/bun) embeds it.
// This is necessary because at runtime (bun binary) relative file paths are
// not resolvable — the binary uses a virtual filesystem.
import platformSchema from "../../../packages/config/config-schema/config.platform.schema.json";

/** Set of dot-paths that are marked `secret: true` in the platform schema. */
function loadSecretPaths(): Set<string> {
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

  walk(platformSchema as unknown as Record<string, unknown>, "");
  return paths;
}

const SECRET_PATHS = loadSecretPaths();

export interface HardcodedSecret {
  /** Dot-path to the field in config, e.g. "auth.external.github.secret" */
  path: string;
  /** Source file (relative to cwd), e.g. "supabase/config.preview.json" */
  file: string;
  /** 1-based line number in the source file */
  line: number;
  /** CLI command to set this secret properly */
  setCommand: string;
}

/** Find the 1-based line number of a key in a JSON file's raw text. */
function findLineNumber(raw: string, keyName: string): number {
  const lines = raw.split("\n");
  const pattern = new RegExp(`"${keyName}"\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 1;
}

function scanFileForHardcodedSecrets(
  obj: unknown,
  path: string,
  raw: string,
  file: string,
  results: HardcodedSecret[]
): void {
  if (obj === null || obj === undefined || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (typeof value === "string" && value.length > 0 && !isConfigRef(value)) {
      if (SECRET_PATHS.has(currentPath)) {
        results.push({
          path: currentPath,
          file,
          line: findLineNumber(raw, key),
          setCommand: `supa project env set ${currentPath}=<value>`,
        });
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      scanFileForHardcodedSecrets(value, currentPath, raw, file, results);
    }
  }
}

/**
 * Scan each config layer file for secret fields (schema `secret: true`) that
 * contain raw hardcoded values. Returns source file and line for each hit.
 *
 * @param supabaseDir  Absolute path to the supabase/ directory
 * @param layers       Ordered list of layer filenames (e.g. ["config.json", "config.preview.json"])
 */
export function detectHardcodedSecrets(
  supabaseDir: string,
  layers: string[]
): HardcodedSecret[] {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join: pathJoin } = require("node:path") as typeof import("node:path");
  const results: HardcodedSecret[] = [];

  for (const layer of layers) {
    const filePath = pathJoin(supabaseDir, layer);
    let raw: string;
    let parsed: unknown;
    try {
      raw = readFileSync(filePath, "utf-8");
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    scanFileForHardcodedSecrets(parsed, "", raw, `supabase/${layer}`, results);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Missing provider secret detection
// ---------------------------------------------------------------------------

type SchemaNode = Record<string, unknown>;

function getAtPath(obj: unknown, parts: string[]): unknown {
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export interface MissingSecret {
  /** Dot-path to the field, e.g. "auth.external.github.secret" */
  path: string;
  /** Env var name to set (from schema default or resolved ref), if known */
  envVarName?: string;
}

/**
 * For each enabled feature/provider in config, check that required secret
 * fields are resolvable. Returns one entry per unresolved secret.
 *
 * Checks:
 *  - Fields with `secret: true` that are absent or whose env ref is unset
 *  - Fields with `required: true, secret: false` that are absent
 *  - SMTP: triggered by `host` being set (no `enabled` flag)
 */
export function detectMissingSecrets(
  config: ProjectConfig,
  lookupEnvVar: (key: string) => string | undefined
): MissingSecret[] {
  const results: MissingSecret[] = [];
  const schema = platformSchema as unknown as SchemaNode;

  function checkGroup(schemaProps: Record<string, SchemaNode>, configObj: unknown, basePath: string): void {
    for (const [field, fieldSchema] of Object.entries(schemaProps)) {
      if (field === "enabled") continue;
      const fieldPath = `${basePath}.${field}`;
      const fieldValue = configObj != null && typeof configObj === "object"
        ? (configObj as Record<string, unknown>)[field]
        : undefined;

      if (fieldSchema.secret === true) {
        if (fieldValue == null || fieldValue === "") {
          // Absent — use schema default to find expected env var
          const defaultRef = parseConfigRef(fieldSchema.default);
          if (defaultRef) {
            if (!lookupEnvVar(defaultRef.varName)) {
              results.push({ path: fieldPath, envVarName: defaultRef.varName });
            }
          } else {
            results.push({ path: fieldPath });
          }
        } else {
          const ref = parseConfigRef(fieldValue);
          if (ref && !lookupEnvVar(ref.varName)) {
            results.push({ path: fieldPath, envVarName: ref.varName });
          }
          // hardcoded: already caught by detectHardcodedSecrets
        }
      } else if (fieldSchema.required === true) {
        if (fieldValue == null || fieldValue === "") {
          results.push({ path: fieldPath });
        }
      }
    }
  }

  function walkSchema(schemaNode: SchemaNode, configNode: unknown, path: string): void {
    const props = schemaNode.properties as Record<string, SchemaNode> | undefined;
    if (!props) return;
    for (const [key, childSchema] of Object.entries(props)) {
      const childPath = path ? `${path}.${key}` : key;
      const childConfig = configNode != null && typeof configNode === "object"
        ? (configNode as Record<string, unknown>)[key]
        : undefined;
      const childProps = childSchema.properties as Record<string, SchemaNode> | undefined;
      if (childProps?.enabled) {
        const enabledVal = childConfig != null && typeof childConfig === "object"
          ? (childConfig as Record<string, unknown>).enabled
          : undefined;
        // Only check secrets if explicitly enabled
        if (enabledVal === true) checkGroup(childProps, childConfig, childPath);
        // Always recurse to find nested enabled groups (e.g. auth → auth.external.github)
        walkSchema(childSchema, childConfig, childPath);
      } else if (childProps) {
        walkSchema(childSchema, childConfig, childPath);
      }
    }
  }

  walkSchema(schema, config, "");

  // SMTP: no `enabled` flag — triggered by `host` being present
  const smtp = getAtPath(config, ["auth", "email", "smtp"]) as Record<string, unknown> | undefined;
  if (smtp?.host) {
    const smtpSchema = getAtPath(schema, [
      "properties", "auth", "properties", "email", "properties", "smtp",
    ]) as SchemaNode | undefined;
    const smtpProps = smtpSchema?.properties as Record<string, SchemaNode> | undefined;
    if (smtpProps) checkGroup(smtpProps, smtp, "auth.email.smtp");
  }

  return results;
}

/**
 * Return a deep copy of config with all secret fields (schema `secret: true`)
 * removed. Use this before building payloads to ensure hardcoded secrets are
 * never sent to the API.
 */
export function stripHardcodedSecrets(config: ProjectConfig): ProjectConfig {
  // Collect any paths that are secret schema fields and have raw values
  const secretPaths: string[] = [];
  function collectSecretPaths(obj: unknown, path: string): void {
    if (obj === null || obj === undefined || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (typeof value === "string" && value.length > 0 && !isConfigRef(value) && SECRET_PATHS.has(currentPath)) {
        secretPaths.push(currentPath);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        collectSecretPaths(value, currentPath);
      }
    }
  }
  collectSecretPaths(config, "");
  if (secretPaths.length === 0) return config;

  const copy = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const path of secretPaths) {
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
