# Auth Rules SQL

Pure SQL authorization system for Supabase that replaces RLS with explicit, typed authorization.

## Quick Start

### Option 1: Test locally with Docker

```bash
# Start postgres and run all tests
./reset.sh
```

This will:
1. Start a fresh postgres container (port 5433)
2. Run Supabase auth migrations
3. Run the auth_rules system SQL
4. Run tests to verify everything works

### Option 2: Run on a real Supabase project

Copy and paste `sql/system.sql` into the Supabase SQL editor and execute it.

## Architecture

### Schemas

| Schema | Purpose |
|--------|---------|
| `auth.*` | Supabase auth (provides `auth.uid()`, users table, etc.) |
| `auth_rules.*` | Our system functions and tables |
| `auth_rules_claims.*` | Claims views that expose user relationships |
| `data_api.*` | Generated views that wrap public tables |

### Key Files

- `sql/system.sql` - Combined system SQL (run this on Supabase)
- `sql/test.sql` - Test file with mock auth for local testing
- `docker-compose.yml` - Postgres for local testing
- `reset.sh` - Script to reset and test everything

## How It Works

### 1. Define Claims Views

Claims views expose what each user has access to:

```sql
-- In auth_rules_claims schema
CREATE OR REPLACE VIEW auth_rules_claims.org_ids AS
SELECT user_id, org_id FROM public.org_members;
```

### 2. Create Data API Views with require()

Views in `data_api` use `auth_rules.require()` to validate access:

```sql
CREATE OR REPLACE VIEW data_api.documents AS
SELECT id, org_id, title, created_by
FROM public.documents
WHERE auth_rules.require('org_ids', 'org_id', org_id);
```

### 3. Query with Explicit Errors

```sql
-- If user doesn't have access to this org_id, raises error:
-- "org_id invalid" (ERRCODE 42501)
SELECT * FROM data_api.documents WHERE org_id = '...';
```

## Require Functions

### `auth_rules.require(claim, col, val)`

Validates that the current user has a claim for the given value.

```sql
-- Check user is member of org
auth_rules.require('org_ids', 'org_id', org_id)

-- Error if not: "org_id invalid"
```

### `auth_rules.require_user(col, val)`

Validates that the value matches `auth.uid()`.

```sql
-- Check column matches current user
auth_rules.require_user('user_id', user_id)

-- Error if not: "user_id invalid"
```

## DSL Functions

For programmatic rule creation:

```sql
-- Define a SELECT rule
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title', 'created_by'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

## Testing

The test file (`sql/test.sql`) includes:
- Mock `auth.uid()` function for testing without Supabase
- `set_user(uuid)` helper to switch users
- Sample tables (organizations, org_members, documents)
- Test cases for authorized/unauthorized access

Run tests:
```bash
./reset.sh
```

Or connect directly:
```bash
psql -h localhost -p 5433 -U postgres -d postgres -f sql/test.sql
```

## PostgREST Configuration

To expose `data_api` views via PostgREST/Supabase:

```
db-schemas = "data_api, public"
```

## Error Codes

| Error | Meaning |
|-------|---------|
| `42501` | Insufficient privilege (unauthorized access) |
| `P0002` | No data found (for UPDATE/DELETE operations) |
