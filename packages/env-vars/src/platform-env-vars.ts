/**
 * Platform environment variable registry.
 *
 * A static map of every reserved SUPABASE_* env var name derived from the
 * config schema. Keeps all tools (dashboard, CLI, extension) in sync
 * automatically — no hand-maintained lists anywhere.
 *
 * Usage:
 *   import { PLATFORM_ENV_VARS, isPlatformVar, isPlatformVarSecret } from '@supabase-dx/env-vars';
 *
 *   isPlatformVar('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID') // true
 *   isPlatformVarSecret('SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET') // true
 *   PLATFORM_ENV_VARS['SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID']
 *   // { configPath: 'auth.external.google.client_id', isSecret: false }
 */

import { buildFeatureRegistry } from "@supabase-dx/config";

export interface PlatformEnvVarMeta {
  /** Dot-notation config path, e.g. 'auth.external.google.client_id' */
  configPath: string;
  /** Whether the value should be treated as a secret (masked, write-only) */
  isSecret: boolean;
}

function buildPlatformEnvVars(): Record<string, PlatformEnvVarMeta> {
  const map: Record<string, PlatformEnvVarMeta> = {};

  for (const feature of buildFeatureRegistry()) {
    for (const variable of feature.variables) {
      map[variable.canonicalName] = {
        configPath: variable.configPath,
        isSecret: variable.secret,
      };
    }
  }

  return map;
}

/**
 * All reserved SUPABASE_* platform env var names, keyed by canonical name.
 * Derived from the config schema — add providers to the schema and they
 * appear here automatically.
 */
export const PLATFORM_ENV_VARS: Record<string, PlatformEnvVarMeta> =
  buildPlatformEnvVars();

/**
 * Returns true if the given env var name is a reserved platform variable
 * (managed via config APIs, not the secrets API).
 */
export function isPlatformVar(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLATFORM_ENV_VARS, name);
}

/**
 * Returns true if the given platform env var is a secret (masked, write-only).
 */
export function isPlatformVarSecret(name: string): boolean {
  return PLATFORM_ENV_VARS[name]?.isSecret ?? false;
}

/**
 * Returns the config path for a given platform env var name, or undefined
 * if it's not a platform variable.
 */
export function getConfigPathForVar(name: string): string | undefined {
  return PLATFORM_ENV_VARS[name]?.configPath;
}
