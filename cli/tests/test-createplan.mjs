#!/usr/bin/env node

/**
 * Test pg-delta createPlan with full logging
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = resolve("../examples/nextjs-demo/.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

// Import pg-delta (triggers type parsers)
const { createPlan } = await import("@supabase/pg-delta");
import pg from "pg";

// ========== Our adapter ==========

const TYPE_PARSERS = {
  22: (val) => {
    // int2vector
    if (!val || val === "") return [];
    return val.trim().split(/\s+/).map(Number);
  },
  20: (val) => BigInt(val),
  1002: (val) => parsePostgresArray(val),
  1009: (val) => parsePostgresArray(val),
  1015: (val) => parsePostgresArray(val),
  1005: (val) => parsePostgresArray(val).map(Number),
  1007: (val) => parsePostgresArray(val).map(Number),
  1016: (val) => parsePostgresArray(val).map(Number),
};

function parsePostgresArray(value) {
  if (!value || value === "{}") return [];
  const inner = value.slice(1, -1);
  if (inner === "") return [];

  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current === "NULL" ? "" : current.replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current === "NULL" ? "" : current.replace(/^"|"$/g, ""));
  return result;
}

function transformRowByFieldTypes(row, fields) {
  const result = { ...row };

  for (const field of fields) {
    const value = result[field.name];
    if (value == null) continue;

    // Handle bigint type (20) - convert number to BigInt
    if (field.dataTypeID === 20) {
      if (typeof value === "number") {
        result[field.name] = BigInt(value);
      } else if (typeof value === "string") {
        result[field.name] = BigInt(value);
      }
      continue;
    }

    // For other types, only transform strings
    const parser = TYPE_PARSERS[field.dataTypeID];
    if (parser && typeof value === "string") {
      try {
        result[field.name] = parser(value);
      } catch {}
    }
  }

  return result;
}

function createPGlitePool(pglite) {
  return {
    async query(queryTextOrConfig, values) {
      let text =
        typeof queryTextOrConfig === "string"
          ? queryTextOrConfig
          : queryTextOrConfig.text;
      let params =
        typeof queryTextOrConfig === "string"
          ? values
          : queryTextOrConfig.values;

      const result = await pglite.query(text, params);
      const transformedRows = result.rows.map((row) =>
        transformRowByFieldTypes(row, result.fields),
      );

      return {
        rows: transformedRows,
        rowCount: result.rows.length,
        fields: result.fields,
        command: "",
        oid: 0,
      };
    },
    async connect() {
      return { query: this.query.bind(this), release: () => {} };
    },
    async end() {
      await pglite.close();
    },
  };
}

// ========== Setup ==========

function findAuthMigrationsDir() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "vendor", "supabase-auth", "migrations");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadAuthMigrations() {
  const migrationsDir = findAuthMigrationsDir();
  if (!migrationsDir) return [];

  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort()
    .map((file) => {
      let content = readFileSync(join(migrationsDir, file), "utf-8");
      content = content.replace(
        /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
        "auth",
      );
      return content;
    });
}

console.log("Creating PGlite...");
const pglite = new PGlite();
await pglite.waitReady;

await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions");

const migrations = loadAuthMigrations();
console.log(`Seeding ${migrations.length} auth migrations...`);
for (const migration of migrations) {
  try {
    await pglite.exec(migration);
  } catch {}
}

// Also apply the schema files
const schemaDir = join(
  __dirname,
  "../examples/nextjs-demo/supabase/schema/public",
);
if (existsSync(schemaDir)) {
  const files = readdirSync(schemaDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  console.log(`Applying ${files.length} schema files...`);
  for (const file of files) {
    try {
      await pglite.exec(readFileSync(join(schemaDir, file), "utf-8"));
    } catch (err) {
      // Ignore errors
    }
  }
}

const pglitePool = createPGlitePool(pglite);

const password = process.env.SUPABASE_DB_PASSWORD;
const connectionString = `postgresql://postgres.dumltzfoaxseaekszcnt:${password}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const supabasePool = new pg.Pool({ connectionString });

console.log("\nCalling createPlan...");

try {
  const plan = await createPlan(
    supabasePool, // from (source)
    pglitePool, // to (target)
    { filter: { schema: "public" } },
  );
  console.log("Success!");
  console.log("Changes:", plan.changes?.length || 0);
} catch (err) {
  console.log("Error:", err.message);
  if (err.errors) {
    console.log("\nZod validation errors:");
    for (const e of err.errors) {
      console.log(`  Path: ${JSON.stringify(e.path)}`);
      console.log(
        `  Issue: expected ${e.expected}, got ${e.received || e.code}`,
      );
    }
  }
}

await supabasePool.end();
await pglitePool.end();
