#!/usr/bin/env node

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load auth migrations
function loadAuthMigrations() {
  const migrationsDir = join(
    __dirname,
    "vendor",
    "supabase-auth",
    "migrations",
  );
  if (!existsSync(migrationsDir)) return [];

  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".up.sql"))
    .sort()
    .map((file) => {
      let content = readFileSync(join(migrationsDir, file), "utf-8");
      return content.replace(
        /\{\{\s*index\s+\.Options\s+"Namespace"\s*\}\}/g,
        "auth",
      );
    });
}

const pglite = new PGlite();
await pglite.waitReady;

await pglite.exec("CREATE SCHEMA IF NOT EXISTS auth");
await pglite.exec("CREATE SCHEMA IF NOT EXISTS extensions");

console.log("Seeding auth migrations...");
for (const migration of loadAuthMigrations()) {
  try {
    await pglite.exec(migration);
  } catch {}
}

// Apply schema files
const schemaDir = join(
  __dirname,
  "../examples/nextjs-demo/supabase/schema/public",
);
const files = ["types.sql", "tables.sql", "indexes.sql"];

for (const file of files) {
  const content = readFileSync(join(schemaDir, file), "utf-8");
  console.log(`\nApplying ${file}...`);
  try {
    await pglite.exec(content);
    console.log(`  ✓ ${file} applied`);
  } catch (err) {
    console.log(`  ✗ ${file} failed:`, err.message);
  }
}

// Check indexes
console.log("\n=== Indexes in PGlite ===");
const result = await pglite.query(`
  SELECT 
    schemaname,
    tablename,
    indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname
`);

for (const row of result.rows) {
  console.log(`  ${row.tablename}.${row.indexname}`);
}

console.log(`\nTotal: ${result.rows.length} indexes in public schema`);

await pglite.close();
