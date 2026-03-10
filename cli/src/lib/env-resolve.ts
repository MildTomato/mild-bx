/**
 * Value lookup adapter - bridges the config package's ValueLookup
 * to the CLI's env resolution.
 */
import { resolveLocalVariable } from "./env-file.js";

/**
 * Create a value lookup function for the implicit binding engine.
 * Resolution order: OS env > .env.local > supabase/.env
 */
export function createValueLookup(
  cwd: string
): (varName: string) => string | undefined {
  return (varName) => {
    return process.env[varName] ?? resolveLocalVariable(varName, cwd);
  };
}
