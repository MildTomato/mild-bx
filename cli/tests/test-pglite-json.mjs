#!/usr/bin/env node

/**
 * Test: Does PGlite return column defaults correctly in JSON?
 */

import { PGlite } from "@electric-sql/pglite";

const pglite = new PGlite();
await pglite.waitReady;

// Create table with array default
await pglite.query(`
  CREATE TABLE test_arr (
    id serial PRIMARY KEY,
    tags text[] DEFAULT '{}'::text[]
  );
`);

// Query like pg-delta does
const result = await pglite.query(`
  SELECT json_agg(
    json_build_object(
      'name', a.attname,
      'default', pg_get_expr(ad.adbin, ad.adrelid)
    )
  ) as columns
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  WHERE n.nspname = 'public' 
    AND c.relname = 'test_arr'
    AND a.attnum > 0
    AND NOT a.attisdropped
`);

console.log("Raw result:", result.rows[0]);
console.log("");

const columns = result.rows[0].columns;
console.log("columns type:", typeof columns);
console.log("columns:", columns);
console.log("");

for (const col of columns || []) {
  console.log(`Column: ${col.name}`);
  console.log(
    `  default type: ${typeof col.default} / isArray: ${Array.isArray(col.default)}`,
  );
  console.log(`  default value:`, col.default);
}

await pglite.close();
