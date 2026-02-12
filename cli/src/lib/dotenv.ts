/**
 * Smart .env generation with .env.example merging
 *
 * Port of bootstrap.go writeDotEnv() (lines 176-259).
 * Reads .env.example if present, maps known framework keys to real values,
 * and passes through unrecognized keys with their example values.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { createClient } from "@/lib/api.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EnvContext {
  anonKey: string;
  serviceRoleKey: string;
  supabaseUrl: string;
  postgresUrl: string;
  postgresUrlNonPooling: string;
  dbUser: string;
  dbHost: string;
  dbPassword: string;
  dbName: string;
}

// ─────────────────────────────────────────────────────────────
// .env.example parser
// ─────────────────────────────────────────────────────────────

function parseEnvFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    result.set(key, value);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Smart env builder
// ─────────────────────────────────────────────────────────────

/**
 * Build a smart .env file content string.
 *
 * If envExamplePath is provided, reads that file and maps known framework
 * keys (Next.js, Expo, Postgres) to real values. Unrecognized keys are
 * passed through with their example values.
 *
 * Without an .env.example, generates the base Supabase keys.
 */
export function buildSmartEnv(
  ctx: EnvContext,
  envExamplePath?: string,
): string {
  // Base environment variables
  const env = new Map<string, string>();
  env.set("SUPABASE_URL", ctx.supabaseUrl);
  env.set("SUPABASE_ANON_KEY", ctx.anonKey);
  env.set("SUPABASE_SERVICE_ROLE_KEY", ctx.serviceRoleKey);
  env.set("POSTGRES_URL", ctx.postgresUrl);

  // If .env.example exists, merge its keys
  if (envExamplePath && existsSync(envExamplePath)) {
    const exampleContent = readFileSync(envExamplePath, "utf-8");
    const exampleEnvs = parseEnvFile(exampleContent);

    for (const [key, exampleValue] of exampleEnvs) {
      switch (key) {
        // Base keys — already set, skip
        case "SUPABASE_SERVICE_ROLE_KEY":
        case "SUPABASE_ANON_KEY":
        case "SUPABASE_URL":
        case "POSTGRES_URL":
          break;

        // Derived Postgres keys
        case "POSTGRES_PRISMA_URL":
          env.set(key, ctx.postgresUrl);
          break;
        case "POSTGRES_URL_NON_POOLING":
          env.set(key, ctx.postgresUrlNonPooling);
          break;
        case "POSTGRES_USER":
          env.set(key, ctx.dbUser);
          break;
        case "POSTGRES_HOST":
          env.set(key, ctx.dbHost);
          break;
        case "POSTGRES_PASSWORD":
          env.set(key, ctx.dbPassword);
          break;
        case "POSTGRES_DATABASE":
          env.set(key, ctx.dbName);
          break;

        // Next.js framework keys
        case "NEXT_PUBLIC_SUPABASE_ANON_KEY":
          env.set(key, ctx.anonKey);
          break;
        case "NEXT_PUBLIC_SUPABASE_URL":
          env.set(key, ctx.supabaseUrl);
          break;

        // Expo framework keys
        case "EXPO_PUBLIC_SUPABASE_ANON_KEY":
          env.set(key, ctx.anonKey);
          break;
        case "EXPO_PUBLIC_SUPABASE_URL":
          env.set(key, ctx.supabaseUrl);
          break;

        // Unrecognized keys — pass through with example value
        default:
          env.set(key, exampleValue);
          break;
      }
    }
  }

  // Marshal to .env format
  const lines: string[] = [];
  for (const [key, value] of env) {
    // Quote values that contain spaces, #, or special chars
    if (/[\s#"']/.test(value)) {
      lines.push(`${key}="${value}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Write a smart .env file to the target directory.
 * Looks for .env.example in the same directory for key mapping.
 */
export function writeSmartEnv(targetDir: string, ctx: EnvContext): string[] {
  const envExamplePath = join(targetDir, ".env.example");
  const content = buildSmartEnv(ctx, envExamplePath);
  const envPath = join(targetDir, ".env");
  writeFileSync(envPath, content);

  // Return the keys that were written
  const keys: string[] = [];
  for (const line of content.split("\n")) {
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      keys.push(line.slice(0, eqIndex));
    }
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────
// Project credential resolution
// ─────────────────────────────────────────────────────────────

/**
 * Fetch project credentials (API keys, pooler config) and build an EnvContext.
 *
 * Combines three API calls into one composable step:
 *   1. Fetch API keys (anon, service_role)
 *   2. Fetch pooler config (host, ports)
 *   3. Build the EnvContext with connection strings
 *
 * Failures in API keys or pooler config fall back to defaults silently,
 * since those services may not be ready yet.
 *
 * Used by bootstrap, init, and other commands that write .env files.
 */
export async function resolveProjectEnv(
  client: ReturnType<typeof createClient>,
  projectRef: string,
  password?: string,
): Promise<EnvContext> {
  // Fetch API keys
  let anonKey = "";
  let serviceRoleKey = "";
  try {
    const keys = await client.getProjectApiKeys(projectRef);
    const anonKeyObj = keys.find(
      (k) => k.name === "anon" || k.name === "publishable anon key",
    );
    const serviceKeyObj = keys.find(
      (k) => k.name === "service_role" || k.name === "secret service_role key",
    );
    anonKey = anonKeyObj?.api_key ?? "";
    serviceRoleKey = serviceKeyObj?.api_key ?? "";
  } catch {
    // Keys might not be available yet — use empty defaults
  }

  // Fetch pooler config
  let poolerHost = `db.${projectRef}.supabase.co`;
  let poolerPort = 6543;
  let directPort = 5432;
  try {
    const poolerConfigs = await client.getPoolerConfig(projectRef);
    if (poolerConfigs.length > 0) {
      const transactionMode = poolerConfigs.find(
        (c: Record<string, unknown>) =>
          (c as { pool_mode?: string }).pool_mode === "transaction",
      );
      if (transactionMode) {
        const db = transactionMode.database as
          | { host?: string; port?: number }
          | undefined;
        if (db?.host) poolerHost = db.host;
        if (db?.port) poolerPort = db.port;
      }
      const sessionMode = poolerConfigs.find(
        (c: Record<string, unknown>) =>
          (c as { pool_mode?: string }).pool_mode === "session",
      );
      if (sessionMode) {
        const db = sessionMode.database as { port?: number } | undefined;
        if (db?.port) directPort = db.port;
      }
    }
  } catch {
    // Use defaults if pooler config not available
  }

  // Build EnvContext
  const dbUser = "postgres";
  const dbName = "postgres";
  const pw = password ?? "";

  return {
    anonKey,
    serviceRoleKey,
    supabaseUrl: `https://${projectRef}.supabase.co`,
    postgresUrl: `postgresql://${dbUser}.${projectRef}:${pw}@${poolerHost}:${poolerPort}/${dbName}`,
    postgresUrlNonPooling: `postgresql://${dbUser}.${projectRef}:${pw}@db.${projectRef}.supabase.co:${directPort}/${dbName}`,
    dbUser: `${dbUser}.${projectRef}`,
    dbHost: poolerHost,
    dbPassword: pw,
    dbName,
  };
}
