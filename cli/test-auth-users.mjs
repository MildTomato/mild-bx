#!/usr/bin/env node

/**
 * Check auth.users column 28 on Supabase
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env
const envPath = resolve("../examples/nextjs-demo/.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

// Import pg-delta to trigger type parsers
await import("@supabase/pg-delta");

import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
const connectionString = `postgresql://postgres.dumltzfoaxseaekszcnt:${password}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;

const pool = new pg.Pool({ connectionString });

// Check auth.users columns with their indexes
const result = await pool.query(`
  SELECT 
    a.attnum as position,
    a.attname as name,
    pg_get_expr(ad.adbin, ad.adrelid) as "default",
    pg_typeof(pg_get_expr(ad.adbin, ad.adrelid)) as default_type
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
  WHERE n.nspname = 'auth' AND c.relname = 'users'
  ORDER BY a.attnum
`);

console.log("auth.users columns on Supabase:\n");
for (let i = 0; i < result.rows.length; i++) {
  const row = result.rows[i];
  const marker = i === 28 ? " <-- INDEX 28" : "";
  const defaultType = row.default
    ? Array.isArray(row.default)
      ? "ARRAY"
      : typeof row.default
    : "null";
  console.log(`[${i}] ${row.name}: default=${defaultType}${marker}`);
  if (row.default) {
    console.log(`     value: ${String(row.default).slice(0, 60)}`);
  }
}

await pool.end();
