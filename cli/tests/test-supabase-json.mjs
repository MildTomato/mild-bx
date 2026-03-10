#!/usr/bin/env node

/**
 * Test: Does pg-delta's type parsers break column defaults from Supabase?
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually
const envPath = resolve("../examples/nextjs-demo/.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

// Import pg-delta to trigger its type parsers
await import("@supabase/pg-delta");

import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("SUPABASE_DB_PASSWORD not found in .env");
  process.exit(1);
}

// Build connection string (use session pooler port 5432)
const connectionString = `postgresql://postgres.dumltzfoaxseaekszcnt:${password}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;

console.log("Connecting to Supabase...");
const pool = new pg.Pool({ connectionString });

// Query like pg-delta does - get columns with defaults
const result = await pool.query(`
  SELECT 
    c.relname as table_name,
    json_agg(
      json_build_object(
        'name', a.attname,
        'position', a.attnum,
        'default', pg_get_expr(ad.adbin, ad.adrelid)
      )
      ORDER BY a.attnum
    ) as columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  WHERE n.nspname IN ('public', 'auth', 'storage') 
    AND c.relkind IN ('r', 'p')
  GROUP BY c.oid, c.relname
  ORDER BY c.relname
`);

console.log(`\nFound ${result.rows.length} tables\n`);

for (const row of result.rows) {
  console.log(`Table: ${row.table_name}`);
  console.log(
    `  columns type: ${typeof row.columns} / isArray: ${Array.isArray(row.columns)}`,
  );

  // Check each column's default
  const columns = row.columns;
  for (const col of columns || []) {
    if (col.default !== null) {
      const defaultType = Array.isArray(col.default)
        ? "ARRAY"
        : typeof col.default;
      if (defaultType === "ARRAY") {
        console.log(`  [PROBLEM] ${col.name}: default is ARRAY:`, col.default);
      } else {
        console.log(
          `  ${col.name}: default = ${String(col.default).slice(0, 60)}`,
        );
      }
    }
  }
}

await pool.end();
console.log("\nDone.");
