# System SQL

Complete SQL to set up the pure SQL authorization system on top of **Supabase Auth**.

---

## Prerequisites

This system builds on Supabase's existing infrastructure:

- **`auth.uid()`** - Already provided by Supabase, returns current user's UUID
- **`auth.role()`** - Already provided by Supabase, returns current role
- **`auth.users`** - Supabase's users table
- **`authenticated`** role - Supabase's role for logged-in users

You don't need to create these - they exist in every Supabase project.

---

## Schema Setup

```sql
-- =============================================================================
-- SCHEMA CREATION
-- =============================================================================

-- Auth rules system schema
CREATE SCHEMA IF NOT EXISTS auth_rules;

-- Claims schema: Views that expose user relationships
CREATE SCHEMA IF NOT EXISTS auth_rules_claims;

-- Data API schema: Generated views that wrap public tables with auth
CREATE SCHEMA IF NOT EXISTS data_api;

-- Grant usage to authenticated users
GRANT USAGE ON SCHEMA auth_rules TO authenticated, service_role;
GRANT USAGE ON SCHEMA auth_rules_claims TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA data_api TO anon, authenticated, service_role;
```

---

## Claims Views

Claims are **views** that expose user relationships. They query source tables in real-time.

```sql
-- =============================================================================
-- CLAIMS VIEWS (LIVE)
-- =============================================================================

-- Example: Organization membership
CREATE VIEW auth_rules_claims.org_ids AS
SELECT user_id, org_id
FROM public.org_members;

-- Example: Organization roles (for checkClaim)
CREATE VIEW auth_rules_claims.org_roles AS
SELECT user_id, org_id, role
FROM public.org_members;

-- Example: Team membership
CREATE VIEW auth_rules_claims.team_ids AS
SELECT user_id, team_id
FROM public.team_members;

-- Example: Hierarchical teams (recursive)
CREATE VIEW auth_rules_claims.accessible_team_ids AS
WITH RECURSIVE team_tree AS (
  -- Direct membership
  SELECT user_id, team_id
  FROM public.team_members

  UNION

  -- Child teams inherit
  SELECT tt.user_id, t.id AS team_id
  FROM team_tree tt
  JOIN public.teams t ON t.parent_team_id = tt.team_id
)
SELECT DISTINCT user_id, team_id FROM team_tree;

-- Grant SELECT on claims views to authenticated
GRANT SELECT ON ALL TABLES IN SCHEMA auth_rules_claims TO authenticated;
```

Claims views are **live**. When user is added to an org, they immediately have access. No cache invalidation needed.

---

## Rule Functions

Functions used by customers to define rules.

```sql
-- =============================================================================
-- RULE DEFINITION FUNCTIONS
-- =============================================================================

-- Returns current user ID (wrapper around auth.uid())
CREATE OR REPLACE FUNCTION auth_rules.user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid()
$$;

-- Placeholder for one_of (used in rule definitions, interpreted by view generator)
CREATE OR REPLACE FUNCTION auth_rules.one_of(claim_name TEXT)
RETURNS UUID[]
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::UUID[]
$$;

COMMENT ON FUNCTION auth_rules.one_of IS 'Used in rule definitions. Returns IDs from the named claims view.';

-- Placeholder for check (used in rule definitions, interpreted by view generator)
CREATE OR REPLACE FUNCTION auth_rules.check(
  claim_name TEXT,
  property TEXT,
  allowed_values TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT TRUE
$$;

COMMENT ON FUNCTION auth_rules.check IS 'Used in rule definitions. Adds conditions to the claims subquery.';
```

---

## Generated Views (Example)

The system generates views from rules. Here's what gets generated.

### SELECT View

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.select('id', 'org_id', 'title'),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids'))
);
```

**Generated view:**

```sql
CREATE OR REPLACE VIEW data_api.documents AS
SELECT id, org_id, title
FROM public.documents
WHERE org_id IN (
  SELECT org_id FROM auth_rules_claims.org_ids
  WHERE user_id = auth.uid()
);

GRANT SELECT ON data_api.documents TO authenticated;
```

### INSERT Trigger

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.insert(),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('created_by', auth_rules.user_id())
);
```

**Generated trigger:**

```sql
CREATE OR REPLACE FUNCTION data_api.documents_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, claims, auth
AS $$
BEGIN
  -- Validate org_id
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this organization'
      USING ERRCODE = '42501';
  END IF;

  -- Validate created_by
  IF NEW.created_by != auth.uid() THEN
    RAISE EXCEPTION 'created_by must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.documents (org_id, title, content, created_by)
  VALUES (NEW.org_id, NEW.title, NEW.content, NEW.created_by)
  RETURNING * INTO NEW;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_insert
INSTEAD OF INSERT ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_insert_trigger();

GRANT INSERT ON data_api.documents TO authenticated;
```

### UPDATE Trigger

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.update(),
  auth_rules.eq('org_id', auth_rules.one_of('org_ids')),
  auth_rules.eq('created_by', auth_rules.user_id())
);
```

**Generated trigger:**

```sql
CREATE OR REPLACE FUNCTION data_api.documents_update_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, claims, auth
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.documents
  SET title = NEW.title, content = NEW.content
  WHERE id = OLD.id
    AND org_id IN (SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid())
    AND created_by = auth.uid();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Document not found or not authorized'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_update
INSTEAD OF UPDATE ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_update_trigger();

GRANT UPDATE ON data_api.documents TO authenticated;
```

### DELETE Trigger

**Rule:**

```sql
SELECT auth_rules.rule('documents',
  auth_rules.delete(),
  auth_rules.eq('created_by', auth_rules.user_id())
);
```

**Generated trigger:**

```sql
CREATE OR REPLACE FUNCTION data_api.documents_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, claims, auth
AS $$
BEGIN
  DELETE FROM public.documents
  WHERE id = OLD.id
    AND created_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER documents_delete
INSTEAD OF DELETE ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_delete_trigger();

GRANT DELETE ON data_api.documents TO authenticated;
```

---

## Complete Example: Organization Setup

```sql
-- =============================================================================
-- CUSTOMER TABLES (in public schema)
-- =============================================================================

CREATE TABLE public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.org_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  joined_at   TIMESTAMPTZ DEFAULT now(),

  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON public.org_members(user_id);
CREATE INDEX idx_org_members_user_role ON public.org_members(user_id, role);

CREATE TABLE public.documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT,
  is_public   BOOLEAN DEFAULT FALSE,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documents_org ON public.documents(org_id);


-- =============================================================================
-- CLAIMS VIEWS
-- =============================================================================

CREATE VIEW auth_rules_claims.org_ids AS
SELECT user_id, org_id
FROM public.org_members;

CREATE VIEW auth_rules_claims.org_roles AS
SELECT user_id, org_id, role
FROM public.org_members;

GRANT SELECT ON auth_rules_claims.org_ids TO authenticated;
GRANT SELECT ON auth_rules_claims.org_roles TO authenticated;


-- =============================================================================
-- GENERATED VIEWS (api schema)
-- =============================================================================

-- Organizations: members can view
CREATE OR REPLACE VIEW data_api.organizations AS
SELECT id, name, created_at
FROM public.organizations
WHERE id IN (
  SELECT org_id FROM auth_rules_claims.org_ids
  WHERE user_id = auth.uid()
);

GRANT SELECT ON data_api.organizations TO authenticated;


-- Documents: public OR org member
CREATE OR REPLACE VIEW data_api.documents AS
SELECT id, org_id, title, is_public, created_by, created_at
FROM public.documents
WHERE is_public = TRUE
   OR org_id IN (SELECT org_id FROM auth_rules_claims.org_ids WHERE user_id = auth.uid());

GRANT SELECT ON data_api.documents TO authenticated;


-- =============================================================================
-- WRITE TRIGGERS
-- =============================================================================

-- Insert documents
CREATE OR REPLACE FUNCTION data_api.documents_insert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, claims, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth_rules_claims.org_ids
    WHERE user_id = auth.uid() AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this organization'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'created_by must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.documents (org_id, title, content, is_public, created_by)
  VALUES (NEW.org_id, NEW.title, NEW.content, COALESCE(NEW.is_public, FALSE), auth.uid())
  RETURNING * INTO NEW;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_insert
INSTEAD OF INSERT ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_insert_trigger();

GRANT INSERT ON data_api.documents TO authenticated;


-- Update documents (only creator)
CREATE OR REPLACE FUNCTION data_api.documents_update_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, claims, auth
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.documents
  SET title = NEW.title, content = NEW.content, is_public = NEW.is_public
  WHERE id = OLD.id
    AND created_by = auth.uid();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Document not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_update
INSTEAD OF UPDATE ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_update_trigger();

GRANT UPDATE ON data_api.documents TO authenticated;


-- Delete documents (only creator)
CREATE OR REPLACE FUNCTION data_api.documents_delete_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, claims, auth
AS $$
BEGIN
  DELETE FROM public.documents
  WHERE id = OLD.id
    AND created_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found or not yours'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER documents_delete
INSTEAD OF DELETE ON data_api.documents
FOR EACH ROW EXECUTE FUNCTION data_api.documents_delete_trigger();

GRANT DELETE ON data_api.documents TO authenticated;
```

---

## PostgREST Configuration

```ini
# postgrest.conf

# API schema first, then public as fallback
db-schemas = "api, public"

# Extra schemas for internal use
db-extra-search-path = "auth, claims"

# JWT secret (must match your auth provider)
jwt-secret = "your-secret-key"

# Default role for anonymous requests
db-anon-role = "anon"

# Role for authenticated requests
jwt-role-claim-key = ".role"
```

**Key point**: `db-schemas = "api, public"` means PostgREST searches `api` first. If `data_api.documents` exists, it uses that. Otherwise falls through to `public.documents`.

---

## Error Codes

Write triggers raise meaningful errors:

| Error          | ERRCODE | HTTP Status     |
| -------------- | ------- | --------------- |
| Not authorized | `42501` | 403 Forbidden   |
| Not found      | `P0002` | 404 Not Found   |
| Bad request    | `22023` | 400 Bad Request |

```sql
-- 403 Forbidden
RAISE EXCEPTION 'Not a member of this organization'
  USING ERRCODE = '42501';

-- 404 Not Found
RAISE EXCEPTION 'Document not found'
  USING ERRCODE = 'P0002';

-- 400 Bad Request
RAISE EXCEPTION 'Invalid input'
  USING ERRCODE = '22023';
```

---

## Testing

```sql
-- =============================================================================
-- TEST SETUP
-- =============================================================================

-- Create test user context
CREATE OR REPLACE FUNCTION test.set_user(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, TRUE);
END;
$$;

-- Test data
INSERT INTO public.organizations (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Org One'),
  ('22222222-2222-2222-2222-222222222222', 'Org Two');

INSERT INTO public.org_members (org_id, user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'member'),
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'viewer');

INSERT INTO public.documents (org_id, title, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Doc in Org One', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'Doc in Org Two', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');


-- =============================================================================
-- TEST QUERIES
-- =============================================================================

-- As user A (member of both orgs)
SELECT test.set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT * FROM data_api.documents;  -- Should see both docs
SELECT * FROM data_api.organizations;  -- Should see both orgs

-- As user B (viewer in org one only)
SELECT test.set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT * FROM data_api.documents;  -- Should see only Org One doc
SELECT * FROM data_api.organizations;  -- Should see only Org One

-- Test write operations
SELECT test.set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO data_api.documents (org_id, title, created_by)
VALUES ('11111111-1111-1111-1111-111111111111', 'New Doc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- This should fail (wrong org)
INSERT INTO data_api.documents (org_id, title, created_by)
VALUES ('33333333-3333-3333-3333-333333333333', 'Bad Doc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- ERROR: Not a member of this organization
```

---

## Cleanup Script

```sql
-- Remove everything (useful for development)
DROP SCHEMA IF EXISTS api CASCADE;
DROP SCHEMA IF EXISTS claims CASCADE;
```

---

## Summary

| Component             | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `auth.uid()`          | Get current user from JWT (Supabase built-in)      |
| `auth_rules_claims.*`            | Views that expose user relationships               |
| `data_api.*`               | Views that wrap `public.*` tables with auth        |
| `INSTEAD OF` triggers | Handle INSERT/UPDATE/DELETE on views               |
| PostgREST config      | `db-schemas = "api, public"` for schema precedence |

---

## Schema Flow

```
Client Request (GET /documents)
      |
      v
PostgREST (db-schemas = "api, public")
      |
      v
Finds data_api.documents (view) -- uses it
      |
      v
View queries public.documents
with WHERE clause from claims
      |
      v
Returns only authorized rows/columns
```

```
Client Request (POST /documents)
      |
      v
PostgREST (db-schemas = "api, public")
      |
      v
Finds data_api.documents (view)
      |
      v
INSTEAD OF INSERT trigger fires
      |
      v
Trigger validates auth, inserts into public.documents
      |
      v
Returns new row (or error)
```
