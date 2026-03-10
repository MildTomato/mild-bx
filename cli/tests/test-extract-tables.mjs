#!/usr/bin/env node

/**
 * Test pg-delta's extractTables directly
 */

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========== Copy of our adapter code ==========

const TYPE_PARSERS = {
  22: (val) => {
    // int2vector
    if (!val || val === "") return [];
    return val.trim().split(/\s+/).map(Number);
  },
  20: (val) => BigInt(val), // bigint
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
    const parser = TYPE_PARSERS[field.dataTypeID];
    if (
      parser &&
      result[field.name] != null &&
      typeof result[field.name] === "string"
    ) {
      try {
        result[field.name] = parser(result[field.name]);
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
for (const migration of migrations) {
  try {
    await pglite.exec(migration);
  } catch {}
}

const pool = createPGlitePool(pglite);

// Import pg-delta's extractTables
const { extractTables } =
  await import("@supabase/pg-delta/dist/core/objects/table/table.model.js");

console.log("\nCalling pg-delta extractTables...");

try {
  const tables = await extractTables(pool);
  console.log(`Success! Extracted ${tables.length} tables`);
} catch (err) {
  console.log("Error:", err.message);
  if (err.errors) {
    console.log("\nZod errors:");
    for (const e of err.errors) {
      console.log(`  Path: ${e.path.join(".")}`);
      console.log(
        `  Expected: ${e.expected}, Received: ${e.received || e.message}`,
      );
    }
  }
}

await pool.end();
