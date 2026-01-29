#!/usr/bin/env node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pglite = new PGlite();
await pglite.waitReady;

await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions");

// Find migrations dir (walk up from current dir)
function findMigrationsDir() {
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

const migrationsDir = findMigrationsDir();
console.log("Migrations dir:", migrationsDir);
if (!migrationsDir) {
  console.log("Not found!");
  process.exit(1);
}
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".up.sql"))
  .sort()
  .slice(0, 5); // Just first 5 migrations

console.log("Testing first 5 auth migrations...\n");

for (const file of files) {
  let content = readFileSync(join(migrationsDir, file), "utf-8");
  content = content.replace(
    /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
    "auth",
  );

  console.log(`${file}:`);
  try {
    await pglite.exec(content);
    console.log("  ✓ Success");
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message.slice(0, 100)}`);
  }
}

// Check if auth.users exists
const result = await pglite.query(`
  SELECT tablename FROM pg_tables WHERE schemaname = 'auth'
`);
console.log(
  "\nTables in auth schema:",
  result.rows.map((r) => r.tablename),
);

await pglite.close();
