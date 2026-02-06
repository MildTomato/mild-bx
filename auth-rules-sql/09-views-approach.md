# Views Approach

Rules generate views. Filters become WHERE clauses. That's it.

---

## Core Concept

Every rule is a filter-based rule. A view can literally be that filter.

Customer tables stay where they are (`public` schema). System creates views in `api` schema. PostgREST finds views first.

---

## How It Works

1. Customer has `public.projects` table (already exists, stays there)
2. Customer defines rule for `projects`
3. System creates `data_api.projects` view (wraps `public.projects` with auth)
4. PostgREST config: `db-schemas = "api, public"`
5. Client requests `/projects` → PostgREST finds `data_api.projects` first → uses view

**Tables without rules:** No view in `api`, falls through to `public.projects`

**Tables with rules:** `data_api.projects` view takes precedence

No table moving. No renaming. Existing setup untouched.

---

## Rule to View

**Rule:**

```sql
SELECT auth_rules.rule('projects',
  auth_rules.select('id', 'name', 'org_id'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated View:**

```sql
CREATE VIEW data_api.projects AS
SELECT id, name, org_id
FROM public.projects
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids
  WHERE user_id = auth.uid()
);
```

- `auth_rules.select(...)` → columns in SELECT
- `auth_rules.eq(...)` → condition in WHERE
- `auth_rules.one_of('org_ids')` → subquery against claims table
- View references `public.projects` (the actual table)

---

## Example 1: Simple User Ownership

**Rule:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.select('id', 'content', 'user_id', 'created_at'),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**Generated View:**

```sql
CREATE VIEW data_api.messages AS
SELECT id, content, user_id, created_at
FROM public.messages
WHERE user_id = auth.uid();
```

---

## Example 2: Org Membership

**Rule:**

```sql
SELECT auth_rules.rule('projects',
  auth_rules.select('id', 'name', 'org_id', 'created_at'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated View:**

```sql
CREATE VIEW data_api.projects AS
SELECT id, name, org_id, created_at
FROM public.projects
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids
  WHERE user_id = auth.uid()
);
```

---

## Example 3: Multiple Filters

**Rule:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.select('id', 'content', 'org_id', 'user_id'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('user_id', auth_rules.user_id())
);
```

**Generated View:**

```sql
CREATE VIEW data_api.messages AS
SELECT id, content, org_id, user_id
FROM public.messages
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids
  WHERE user_id = auth.uid()
)
AND user_id = auth.uid();
```

---

## Example 4: Role-Based Access (checkClaim)

**Rule:**

```sql
SELECT auth_rules.rule('org_billing',
  auth_rules.select('id', 'org_id', 'plan', 'amount'),
  auth_rules.in('org_id', 'org_ids', auth_rules.check('org_roles', 'role', ARRAY['admin', 'owner']))
);
```

**Generated View:**

```sql
CREATE VIEW data_api.org_billing AS
SELECT id, org_id, plan, amount
FROM public.org_billing
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_roles
  WHERE user_id = auth.uid()
    AND role IN ('admin', 'owner')
);
```

`auth_rules.check()` adds conditions to the claims subquery.

---

## Example 5: Insert

**Rule:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.insert(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated:** INSTEAD OF INSERT trigger on the view:

```sql
CREATE FUNCTION data_api.messages_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate user_id
  IF NEW.user_id != auth.uid() THEN
    RAISE EXCEPTION 'user_id must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- Validate org_id
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO internal.messages (user_id, org_id, content)
  VALUES (NEW.user_id, NEW.org_id, NEW.content);

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_insert
INSTEAD OF INSERT ON data_api.messages
FOR EACH ROW EXECUTE FUNCTION data_api.messages_insert_trigger();
```

---

## Example 6: Update

**Rule:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.update(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated:** INSTEAD OF UPDATE trigger:

```sql
CREATE FUNCTION data_api.messages_update_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validate user_id
  IF NEW.user_id != auth.uid() THEN
    RAISE EXCEPTION 'user_id must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- Validate org_id
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'org_id not in your organizations'
      USING ERRCODE = '42501';
  END IF;

  UPDATE internal.messages
  SET content = NEW.content
  WHERE id = OLD.id
    AND user_id = auth.uid()
    AND org_id IN (SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid());

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update
INSTEAD OF UPDATE ON data_api.messages
FOR EACH ROW EXECUTE FUNCTION data_api.messages_update_trigger();
```

---

## Example 7: Delete

**Rule:**

```sql
SELECT auth_rules.rule('messages',
  auth_rules.delete(),
  auth_rules.eq('user_id', auth_rules.user_id()),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated:** INSTEAD OF DELETE trigger:

```sql
CREATE FUNCTION data_api.messages_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.messages
  WHERE id = OLD.id
    AND user_id = auth.uid()
    AND org_id IN (SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER messages_delete
INSTEAD OF DELETE ON data_api.messages
FOR EACH ROW EXECUTE FUNCTION data_api.messages_delete_trigger();
```

---

## How It Works

1. Customer creates table in `internal` schema (or we move it there)
2. Customer defines rule using `auth_rules.rule()`
3. System generates:
   - View in `api` schema (for SELECT + column security)
   - INSTEAD OF triggers (for INSERT/UPDATE/DELETE)
4. PostgREST exposes `api` schema
5. Client queries `data_api.projects` like a normal table
6. View handles row filtering, triggers handle writes

---

## Schema Layout

```
public.*          -- Customer tables (stay here, untouched)
auth_rules_claims.*          -- Claims views (org_ids, org_roles, etc.)
data_api.*             -- Generated views + triggers (takes precedence)
auth.*            -- System functions (auth_rules.rule, auth.uid, etc.)
```

PostgREST config:

```
db-schemas = "api, public"
db-extra-search-path = "auth, claims"
```

PostgREST searches `api` first. If view exists, uses it. Otherwise falls through to `public`.

---

## Rule → View Mapping

| Rule Component                         | View Component                                |
| -------------------------------------- | --------------------------------------------- |
| `auth_rules.select('a', 'b', 'c')`           | `SELECT a, b, c`                              |
| `auth_rules.eq('col', auth_rules.user_id())`       | `WHERE col = auth.uid()`                      |
| `auth_rules.eq('col', auth_rules.one_of('claim'))` | `WHERE col IN (SELECT ... FROM auth_rules_claims.claim)` |
| `auth_rules.check('claim', 'prop', [...])`   | `AND prop IN (...)` in subquery               |
| `auth_rules.insert()`                        | INSTEAD OF INSERT trigger                     |
| `auth_rules.update()`                        | INSTEAD OF UPDATE trigger                     |
| `auth_rules.delete()`                        | INSTEAD OF DELETE trigger                     |

---

## Benefits

1. **Standard PostgREST** - Just views, nothing special
2. **Column security** - View SELECT controls visible columns
3. **Row security** - View WHERE controls visible rows
4. **Explicit errors** - Triggers can RAISE EXCEPTION
5. **No per-row function calls** - WHERE clause is efficient
6. **Rules are declarative** - System generates the SQL

---

## Trade-offs

1. **Generated code** - Views/triggers are generated, not hand-written
2. **Rule changes = regenerate views** - Need migration strategy
3. **Schema precedence** - `api` must come before `public` in PostgREST config
