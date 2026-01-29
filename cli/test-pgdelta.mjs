#!/usr/bin/env node

/**
 * Test pg-delta integration directly (no Ink UI)
 */

import { createPlan } from "@supabase/pg-delta";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Get connection string from environment
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error("Please set SUPABASE_DB_URL environment variable");
  process.exit(1);
}

const schemaDir = join(__dirname, "../examples/nextjs-demo/supabase/schema");

console.log("Testing pg-delta schema diff...");
console.log("Schema dir:", schemaDir);
console.log("Connection:", connectionString.replace(/:([^:@]+)@/, ":***@"));

// Find SQL files
function findSqlFiles(dir, basePath = "") {
  const files = [];
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...findSqlFiles(fullPath, relativePath));
    } else if (entry.name.endsWith(".sql")) {
      files.push({
        path: relativePath,
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  }
  return files;
}

// Find auth migrations
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
  if (!migrationsDir) {
    console.log("[warn] Auth migrations not found");
    return [];
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();

  return files.map((file) => {
    let content = readFileSync(join(migrationsDir, file), "utf-8");
    content = content.replace(
      /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
      "auth",
    );
    return content;
  });
}

// Create PGlite pool adapter
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
      return {
        rows: result.rows,
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

try {
  console.log("\n1. Creating PGlite instance...");
  const pglite = new PGlite();
  await pglite.waitReady;

  console.log("2. Creating required schemas...");
  await pglite.query("CREATE SCHEMA IF NOT EXISTS extensions");
  await pglite.query("CREATE SCHEMA IF NOT EXISTS auth");

  console.log("3. Seeding auth migrations...");
  const authMigrations = loadAuthMigrations();
  console.log(`   Found ${authMigrations.length} auth migrations`);

  for (let i = 0; i < authMigrations.length; i++) {
    try {
      await pglite.query(authMigrations[i]);
    } catch (err) {
      // Skip extension and common errors
      if (
        !err.message.includes("CREATE EXTENSION") &&
        !err.message.includes("already exists")
      ) {
        console.log(`   [warn] Migration ${i}: ${err.message.slice(0, 80)}`);
      }
    }
  }

  console.log("4. Applying local schema files...");
  const schemaFiles = findSqlFiles(schemaDir);
  console.log(`   Found ${schemaFiles.length} schema files`);

  for (const file of schemaFiles) {
    try {
      await pglite.query(file.content);
      console.log(`   Applied: ${file.path}`);
    } catch (err) {
      console.log(`   [warn] ${file.path}: ${err.message.slice(0, 60)}`);
    }
  }

  console.log("\n5. Creating pools...");
  const pglitePool = createPGlitePool(pglite);
  const supabasePool = new pg.Pool({ connectionString });

  console.log("6. Computing diff with pg-delta...");
  const plan = await createPlan(supabasePool, pglitePool, {
    filter: { schema: "public" },
  });

  console.log("\n=== Result ===");
  console.log("Changes:", plan.changes?.length || 0);
  console.log("Statements:", plan.statements?.length || 0);

  if (plan.statements?.length > 0) {
    console.log("\nSQL to apply:");
    for (const stmt of plan.statements.slice(0, 10)) {
      console.log("-", stmt.slice(0, 100) + (stmt.length > 100 ? "..." : ""));
    }
    if (plan.statements.length > 10) {
      console.log(`... and ${plan.statements.length - 10} more`);
    }
  }

  await supabasePool.end();
  await pglitePool.end();

  console.log("\nDone!");
} catch (err) {
  console.error("\nFailed:", err);
  process.exit(1);
}
