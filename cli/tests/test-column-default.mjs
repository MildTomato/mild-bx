#!/usr/bin/env node

/**
 * Debug: Check what the column default looks like from PGlite vs Supabase
 */

import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

// Trigger pg-delta's type parsers to load (they're global)
await import("@supabase/pg-delta");

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("Set SUPABASE_DB_URL");
  process.exit(1);
}

// Query that pg-delta uses (simplified)
const COLUMN_QUERY = `
SELECT 
  c.relname as table_name,
  a.attname as column_name,
  a.attnum as position,
  pg_get_expr(ad.adbin, ad.adrelid) as "default"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
WHERE n.nspname = 'public' 
  AND c.relkind IN ('r', 'p')
  AND ad.adbin IS NOT NULL
ORDER BY c.relname, a.attnum
LIMIT 50;
`;

console.log("=== Testing with pg-delta type parsers loaded ===\n");

// Test Supabase
console.log("1. Supabase connection:");
const supaPool = new pg.Pool({ connectionString });
try {
  const result = await supaPool.query(COLUMN_QUERY);
  console.log(`   Found ${result.rows.length} columns with defaults`);

  for (const row of result.rows) {
    const defaultType = Array.isArray(row.default)
      ? "ARRAY"
      : typeof row.default;
    if (defaultType === "ARRAY") {
      console.log(
        `   [PROBLEM] ${row.table_name}.${row.column_name}: default is ARRAY: ${JSON.stringify(row.default)}`,
      );
    } else {
      console.log(
        `   ${row.table_name}.${row.column_name}: default is ${defaultType}: ${String(row.default).slice(0, 50)}`,
      );
    }
  }
} catch (err) {
  console.error("   Error:", err.message);
}
await supaPool.end();

// Test PGlite
console.log("\n2. PGlite:");
const pglite = new PGlite();
await pglite.waitReady;

// Create a test table with various defaults
await pglite.query(`
  CREATE TABLE test_defaults (
    id serial PRIMARY KEY,
    arr text[] DEFAULT '{}',
    arr2 text[] DEFAULT ARRAY['a', 'b'],
    name text DEFAULT 'hello',
    num int DEFAULT 42
  );
`);

try {
  const result = await pglite.query(COLUMN_QUERY);
  console.log(`   Found ${result.rows.length} columns with defaults`);

  for (const row of result.rows) {
    const defaultType = Array.isArray(row.default)
      ? "ARRAY"
      : typeof row.default;
    if (defaultType === "ARRAY") {
      console.log(
        `   [PROBLEM] ${row.table_name}.${row.column_name}: default is ARRAY: ${JSON.stringify(row.default)}`,
      );
    } else {
      console.log(
        `   ${row.table_name}.${row.column_name}: default is ${defaultType}: ${String(row.default).slice(0, 50)}`,
      );
    }
  }
} catch (err) {
  console.error("   Error:", err.message);
}

await pglite.close();
console.log("\nDone.");
