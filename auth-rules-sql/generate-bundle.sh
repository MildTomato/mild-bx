#!/bin/bash
set -e

# Generates a single SQL file that can be run on a fresh Supabase project
# Contains: system SQL + test setup + all tests

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$SCRIPT_DIR/sql/bundle.sql"

echo "-- =============================================================================" > "$OUTPUT"
echo "-- AUTH RULES SQL - Complete Bundle" >> "$OUTPUT"
echo "-- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUTPUT"
echo "-- Run this on a fresh Supabase project (or any Postgres with auth schema)" >> "$OUTPUT"
echo "-- =============================================================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# 1. System SQL (schemas, tables, DSL, compiler, rule entry point)
echo "-- =============================================================================" >> "$OUTPUT"
echo "-- PART 1: AUTH RULES SYSTEM" >> "$OUTPUT"
echo "-- =============================================================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"
cat "$SCRIPT_DIR/sql/system.sql" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# 2. Test setup (mock auth, tables, claims, rules, test data)
echo "-- =============================================================================" >> "$OUTPUT"
echo "-- PART 2: TEST SETUP (tables, claims, rules, test data)" >> "$OUTPUT"
echo "-- =============================================================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"
cat "$SCRIPT_DIR/sql/tests/00-setup.sql" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# 3. All test files
echo "-- =============================================================================" >> "$OUTPUT"
echo "-- PART 3: TESTS" >> "$OUTPUT"
echo "-- =============================================================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"
for test_file in "$SCRIPT_DIR"/sql/tests/[0-9][1-9]*.sql; do
  echo "" >> "$OUTPUT"
  cat "$test_file" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
done

echo "Generated: $OUTPUT"
wc -l "$OUTPUT" | awk '{print $1 " lines"}'
