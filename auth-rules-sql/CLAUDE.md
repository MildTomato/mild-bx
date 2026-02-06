# Auth Rules SQL - Agent Context

## What This Is

A pure SQL authorization system for Supabase that provides explicit errors (not silent filtering) when users lack access.

## Key Concepts

1. **Claims** = What a user has access to (e.g., which org_ids they're a member of)
2. **Require functions** = Validators that raise exceptions if access check fails
3. **Data API views** = Views in `data_api` schema that use require() in WHERE clauses

## Schema Layout

```
auth.*               - Supabase provides this (auth.uid(), etc.)
auth_rules.*         - Our system (require functions, DSL, rule storage)
auth_rules_claims.*  - Claims views (user relationships)
data_api.*           - Generated views wrapping public tables
```

## The Core Pattern

```sql
-- 1. Define a claim: "What orgs can this user access?"
SELECT auth_rules.claim('org_ids', 'SELECT user_id, org_id FROM org_members');

-- 2. Define a rule: "Documents are filtered by org_id using org_ids claim"
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

This auto-generates:
- `auth_rules_claims.org_ids` view
- `data_api.documents` view with require() calls

When user queries `data_api.documents`:
- If they have access → rows returned
- If not → ERROR: "org_id invalid" (code 42501)

## File Structure

```
auth-rules-sql/
├── sql/
│   ├── 00-schemas.sql    # Schema creation
│   ├── 01-tables.sql     # Rule storage tables
│   ├── 02-dsl.sql        # DSL + require functions
│   ├── 03-compiler.sql   # View/trigger generation
│   ├── 04-rule.sql       # Main entry point
│   ├── system.sql        # All above concatenated
│   └── test.sql          # Standalone test with mock auth
├── docker-compose.yml    # Postgres on port 5433
├── reset.sh              # Reset + test script
└── README.md
```

## How to Test

```bash
cd auth-rules-sql
./reset.sh
```

This:
1. Starts postgres container (port 5433)
2. Creates roles (supabase_admin, anon, authenticated, service_role)
3. Runs auth schema from `vendor/supabase-postgres`
4. Runs system.sql
5. Runs test.sql

## How to Modify

1. Edit the individual SQL files in `sql/`
2. Regenerate system.sql: `cat sql/0*.sql > sql/system.sql`
3. Run `./reset.sh` to test

## Key Functions

| Function | Purpose |
|----------|---------|
| `auth_rules.require(claim, col, val)` | Validate claim access, error if not |
| `auth_rules.require_user(col, val)` | Validate val = auth.uid(), error if not |
| `auth_rules.rule(table, ...)` | DSL to programmatically create rules |

## Common Tasks

### Add a new require function variant
Edit `sql/02-dsl.sql`, add function, regenerate system.sql

### Change error messages
Edit the RAISE EXCEPTION lines in require functions in `sql/02-dsl.sql`

### Add new test cases
Edit `sql/test.sql`, add DO blocks with expected error handling

## Important Notes

- The test.sql file creates a MOCK `auth.uid()` for testing without Supabase
- On real Supabase, `auth.uid()` is already provided
- Error code 42501 = insufficient_privilege (standard PG code)
- Views use require() for explicit errors; the DSL compiler generates silent-filter views
