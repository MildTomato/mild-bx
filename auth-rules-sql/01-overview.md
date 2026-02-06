# Pure SQL Authorization: Overview

Type-safe, declarative authorization using pure PostgreSQL. No middleware, no RLS, no external DSL.

---

## What This System Does

- **Rules**: Define who can read/write what, using SQL
- **Claims**: Pre-computed user context (org memberships, roles, team access)
- **Views**: Generated from rules, enforce authorization
- **Column security**: Rules specify which columns are exposed
- **Role-based access**: checkClaim filters by user's role in each entity

Replaces RLS with explicit, typed authorization.

---

## Why Not RLS?

| RLS Behavior             | Problem                                          |
| ------------------------ | ------------------------------------------------ |
| Silent filtering         | Queries return empty results instead of errors   |
| Hidden logic             | Authorization buried in policies, not visible    |
| No column security       | RLS is row-level only                            |
| Supabase already uses it | Customers have existing RLS, need migration path |

This system:

- Explicit rules defined in SQL
- Views generated from rules
- Column-level security built-in
- Works alongside existing tables

---

## How It Works

1. Customer has table in `public` schema (e.g., `public.projects`)
2. Customer defines rule using SQL
3. System generates view in `api` schema (e.g., `api.projects`)
4. PostgREST configured: `db-schemas = "api, public"`
5. Client requests `/projects` → PostgREST finds `api.projects` first → uses view

Tables without rules: fall through to `public` schema.
Tables with rules: `data_api` view takes precedence.

```
Client Request
      |
      v
  PostgREST (db-schemas = "data_api, public")
      |
      v
  Looks for data_api.projects (view) -- found? use it
      |                                    |
      v                                    v
  Falls through to                   View wraps public.projects
  public.projects                    with auth logic
```

---

## Example

**Customer's existing table:**

```sql
-- Already exists in public schema
CREATE TABLE public.documents (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL,
  title TEXT,
  content TEXT,
  created_by UUID
);
```

**Customer defines rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**System generates view:**

```sql
CREATE VIEW data_api.documents AS
SELECT id, org_id, title
FROM public.documents
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids
  WHERE user_id = auth.uid()
);
```

**Client queries normally:**

```
GET /documents?title=eq.Report
```

Result: Only documents from orgs the user belongs to. Only columns specified in rule.

---

## Schema Layout

```
public.*              -- Customer tables (stay here, untouched)
data_api.*            -- Generated views (takes precedence in PostgREST)
auth_rules_claims.*   -- Claims views (org_ids, org_roles, etc.)
auth_rules.*          -- System tables and functions (auth_rules.rule, etc.)
auth.*                -- Supabase auth (untouched - provides auth.uid, auth.role, etc.)
```

PostgREST config:

```
db-schemas = "data_api, public"
db-extra-search-path = "auth, auth_rules, auth_rules_claims"
```

---

## Rule Syntax

```sql
SELECT auth_rules.rule('table_name',
  auth_rules.select('col1', 'col2', 'col3'),              -- columns to expose
  auth_rules.eq('column', auth_rules.user_id()),          -- filter by user
  auth_rules.eq('column', auth_rules.one_of('claim_name')), -- filter by claim array
  auth_rules.in('column', 'claim', auth_rules.check(...))   -- filter with role check
);
```

Rules compile to views. Filters become WHERE clauses.

---

## Comparison: RLS vs This System

| Aspect           | RLS                     | Auth Rules (Views)        |
| ---------------- | ----------------------- | ------------------------- |
| Row filtering    | Yes                     | Yes                       |
| Column filtering | No                      | Yes                       |
| Explicit errors  | No (silent)             | Yes (triggers for writes) |
| Rule visibility  | Hidden in policies      | SQL rule definitions      |
| Existing tables  | Policies added to table | View wraps table            |
| Migration        | Modify table            | Add view, table untouched   |

---

## Next Steps

1. **[Basic Usage](./02-basic-usage.md)** - Simple examples
2. **[Claims](./03-claims.md)** - How claims work
3. **[checkClaim()](./04-check-claim.md)** - Role-based filtering
4. **[Advanced Use Cases](./05-advanced-use-cases.md)** - Complex patterns
5. **[System SQL](./06-system-sql.md)** - Complete setup
