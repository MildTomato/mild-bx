-- =============================================================================
-- AUTH RULES: SCHEMA SETUP
-- =============================================================================
-- Creates schemas for the auth-rules system.
-- Assumes running on Supabase (auth.uid, authenticated role, etc. exist)
-- System schema: tables and functions for auth-rules
CREATE SCHEMA IF NOT EXISTS auth_rules;

-- Claims schema: views that expose user relationships
CREATE SCHEMA IF NOT EXISTS auth_rules_claims;

-- Data API schema: generated views that wrap public tables
CREATE SCHEMA IF NOT EXISTS data_api;

-- Grants
GRANT USAGE ON SCHEMA auth_rules TO authenticated,
service_role;

GRANT USAGE ON SCHEMA auth_rules_claims TO anon,
authenticated,
service_role;

GRANT USAGE ON SCHEMA data_api TO anon,
authenticated,
service_role;

-- Default privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA auth_rules_claims GRANT
SELECT
  ON TABLES TO anon,
  authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA data_api GRANT
SELECT
  ON TABLES TO anon,
  authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA data_api GRANT
INSERT
,
UPDATE
,
  DELETE ON TABLES TO authenticated;

-- =============================================================================
-- AUTH RULES: TABLES
-- =============================================================================
-- Storage for rule definitions and generated objects
CREATE TABLE IF NOT EXISTS auth_rules.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_name TEXT NOT NULL UNIQUE,
  sql TEXT NOT NULL,
  -- The SELECT that returns (user_id, value)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_rules.rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (
    operation IN ('select', 'insert', 'update', 'delete')
  ),
  columns TEXT [],
  filters JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (table_name, operation)
);

CREATE TABLE IF NOT EXISTS auth_rules.generated_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES auth_rules.rules(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK (object_type IN ('view', 'function', 'trigger')),
  object_schema TEXT NOT NULL,
  object_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_table ON auth_rules.rules(table_name);

-- Track generated claim views
CREATE TABLE IF NOT EXISTS auth_rules.generated_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES auth_rules.claims(id) ON DELETE CASCADE,
  view_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claims_name ON auth_rules.claims(claim_name);

-- Only service_role can modify rules and claims
GRANT
SELECT
  ON auth_rules.claims TO authenticated;

GRANT ALL ON auth_rules.claims TO service_role;

GRANT
SELECT
  ON auth_rules.rules TO authenticated;

GRANT ALL ON auth_rules.rules TO service_role;

GRANT
SELECT
  ON auth_rules.generated_objects TO authenticated;

GRANT ALL ON auth_rules.generated_objects TO service_role;

GRANT
SELECT
  ON auth_rules.generated_claims TO authenticated;

GRANT ALL ON auth_rules.generated_claims TO service_role;

-- =============================================================================
-- TRIGGERS: Auto-generate views on INSERT/UPDATE/DELETE
-- =============================================================================
-- Trigger function for claims: auto-create claims view
CREATE
OR REPLACE FUNCTION auth_rules._on_claim_change() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $ $ BEGIN IF TG_OP = 'DELETE' THEN EXECUTE format(
  'DROP VIEW IF EXISTS auth_rules_claims.%I',
  OLD.claim_name
);

DELETE FROM
  auth_rules.generated_claims
WHERE
  claim_id = OLD.id;

RETURN OLD;

END IF;

-- For INSERT or UPDATE, create/replace the view from the SQL
EXECUTE format(
  'CREATE OR REPLACE VIEW auth_rules_claims.%I AS %s',
  NEW.claim_name,
  NEW.sql
);

EXECUTE format(
  'GRANT SELECT ON auth_rules_claims.%I TO authenticated',
  NEW.claim_name
);

IF TG_OP = 'INSERT' THEN
INSERT INTO
  auth_rules.generated_claims (claim_id, view_name)
VALUES
  (NEW.id, NEW.claim_name);

END IF;

RETURN NEW;

END;

$ $;

CREATE
OR REPLACE TRIGGER claims_auto_view
AFTER
INSERT
  OR
UPDATE
  OR DELETE ON auth_rules.claims FOR EACH ROW EXECUTE FUNCTION auth_rules._on_claim_change();

-- Trigger function for rules: auto-create data_api views/triggers
CREATE
OR REPLACE FUNCTION auth_rules._on_rule_change() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $ $ DECLARE obj RECORD;

sql TEXT;

BEGIN IF TG_OP = 'DELETE' THEN -- Clean up generated objects
FOR obj IN
SELECT
  *
FROM
  auth_rules.generated_objects
WHERE
  rule_id = OLD.id LOOP IF obj.object_type = 'trigger' THEN EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %I.%I',
    obj.object_name,
    obj.object_schema,
    OLD.table_name
  );

ELSIF obj.object_type = 'function' THEN EXECUTE format(
  'DROP FUNCTION IF EXISTS %I.%I()',
  obj.object_schema,
  obj.object_name
);

ELSIF obj.object_type = 'view' THEN EXECUTE format(
  'DROP VIEW IF EXISTS %I.%I',
  obj.object_schema,
  obj.object_name
);

END IF;

END LOOP;

DELETE FROM
  auth_rules.generated_objects
WHERE
  rule_id = OLD.id;

RETURN OLD;

END IF;

-- For INSERT or UPDATE, generate the appropriate objects
-- Clean old generated objects first (for UPDATE)
IF TG_OP = 'UPDATE' THEN FOR obj IN
SELECT
  *
FROM
  auth_rules.generated_objects
WHERE
  rule_id = NEW.id LOOP IF obj.object_type = 'trigger' THEN EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %I.%I',
    obj.object_name,
    obj.object_schema,
    NEW.table_name
  );

ELSIF obj.object_type = 'function' THEN EXECUTE format(
  'DROP FUNCTION IF EXISTS %I.%I()',
  obj.object_schema,
  obj.object_name
);

ELSIF obj.object_type = 'view' THEN EXECUTE format(
  'DROP VIEW IF EXISTS %I.%I',
  obj.object_schema,
  obj.object_name
);

END IF;

END LOOP;

DELETE FROM
  auth_rules.generated_objects
WHERE
  rule_id = NEW.id;

END IF;

-- Generate based on operation type
CASE
  NEW.operation
  WHEN 'select' THEN sql := auth_rules._gen_select_view(NEW.table_name, NEW.columns, NEW.filters);

EXECUTE sql;

EXECUTE format(
  'GRANT SELECT ON data_api.%I TO anon, authenticated',
  NEW.table_name
);

INSERT INTO
  auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
VALUES
  (NEW.id, 'view', 'data_api', NEW.table_name);

-- Try to generate wrapper function (may fail for complex filters)
BEGIN sql := auth_rules._gen_select_function(NEW.table_name, NEW.columns, NEW.filters);

EXECUTE sql;

EXECUTE format(
  'GRANT EXECUTE ON FUNCTION data_api.get_%I TO authenticated',
  NEW.table_name
);

INSERT INTO
  auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
VALUES
  (
    NEW.id,
    'function',
    'data_api',
    'get_' || NEW.table_name
  );

EXCEPTION
WHEN OTHERS THEN RAISE NOTICE 'Could not generate wrapper function for %: %',
NEW.table_name,
SQLERRM;

END;

WHEN 'insert' THEN IF NOT EXISTS (
  SELECT
    1
  FROM
    information_schema.views
  WHERE
    table_schema = 'data_api'
    AND table_name = NEW.table_name
) THEN RAISE EXCEPTION 'Define SELECT rule before INSERT for %',
NEW.table_name;

END IF;

sql := auth_rules._gen_insert_trigger(NEW.table_name, NEW.filters);

EXECUTE sql;

EXECUTE format(
  'GRANT INSERT ON data_api.%I TO authenticated',
  NEW.table_name
);

WHEN 'update' THEN IF NOT EXISTS (
  SELECT
    1
  FROM
    information_schema.views
  WHERE
    table_schema = 'data_api'
    AND table_name = NEW.table_name
) THEN RAISE EXCEPTION 'Define SELECT rule before UPDATE for %',
NEW.table_name;

END IF;

sql := auth_rules._gen_update_trigger(NEW.table_name, NEW.filters);

EXECUTE sql;

EXECUTE format(
  'GRANT UPDATE ON data_api.%I TO authenticated',
  NEW.table_name
);

WHEN 'delete' THEN IF NOT EXISTS (
  SELECT
    1
  FROM
    information_schema.views
  WHERE
    table_schema = 'data_api'
    AND table_name = NEW.table_name
) THEN RAISE EXCEPTION 'Define SELECT rule before DELETE for %',
NEW.table_name;

END IF;

sql := auth_rules._gen_delete_trigger(NEW.table_name, NEW.filters);

EXECUTE sql;

EXECUTE format(
  'GRANT DELETE ON data_api.%I TO authenticated',
  NEW.table_name
);

END CASE
;

RETURN NEW;

END;

$ $;

CREATE
OR REPLACE TRIGGER rules_auto_view
AFTER
INSERT
  OR
UPDATE
  OR DELETE ON auth_rules.rules FOR EACH ROW EXECUTE FUNCTION auth_rules._on_rule_change();

-- =============================================================================
-- AUTH RULES: DSL FUNCTIONS
-- =============================================================================
-- Functions that form the rule definition language
-- =============================================================================
-- CLAIM DEFINITION
-- =============================================================================
-- Define a claim with arbitrary SQL
-- The SELECT must return (user_id, <value_column>)
-- Usage: SELECT auth_rules.claim('org_ids', 'SELECT user_id, org_id FROM org_members');
CREATE
OR REPLACE FUNCTION auth_rules.claim(p_claim_name TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $ $ BEGIN -- Store claim definition
INSERT INTO
  auth_rules.claims (claim_name, sql)
VALUES
  (p_claim_name, p_sql) ON CONFLICT (claim_name) DO
UPDATE
SET
  sql = EXCLUDED.sql,
  updated_at = now();

-- Create the view with security_invoker = false so it runs with owner (postgres) privileges
-- This allows the view to read public.* tables that authenticated can't access directly
EXECUTE format(
  $ v $ CREATE
  OR REPLACE VIEW auth_rules_claims.% I WITH (security_invoker = false) AS % s $ v $,
  p_claim_name,
  p_sql
);

EXECUTE format(
  'GRANT SELECT ON auth_rules_claims.%I TO authenticated',
  p_claim_name
);

RETURN format('Claim: %s', p_claim_name);

END;

$ $;

-- Drop a claim
CREATE
OR REPLACE FUNCTION auth_rules.drop_claim(p_claim_name TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $ $ BEGIN EXECUTE format(
  'DROP VIEW IF EXISTS auth_rules_claims.%I',
  p_claim_name
);

DELETE FROM
  auth_rules.claims
WHERE
  claim_name = p_claim_name;

RETURN format('Dropped claim: %s', p_claim_name);

END;

$ $;

-- List all claims
CREATE
OR REPLACE FUNCTION auth_rules.list_claims() RETURNS TABLE (claim_name TEXT, sql TEXT) LANGUAGE sql STABLE SECURITY DEFINER AS $ $
SELECT
  claim_name,
  sql
FROM
  auth_rules.claims
ORDER BY
  claim_name;

$ $;

-- =============================================================================
-- DSL MARKERS AND HELPERS
-- =============================================================================
-- Wrapper for auth.uid()
CREATE
OR REPLACE FUNCTION auth_rules.user_id() RETURNS UUID LANGUAGE sql STABLE AS $ $
SELECT
  auth.uid() $ $;

-- Operation markers
CREATE
OR REPLACE FUNCTION auth_rules.select(VARIADIC columns TEXT []) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'select', 'columns', to_jsonb(columns)) $ $;

-- Select with require mode: raises explicit errors instead of silent filtering
CREATE
OR REPLACE FUNCTION auth_rules.select_strict(VARIADIC columns TEXT []) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'select',
    'columns',
    to_jsonb(columns),
    'mode',
    'require'
  ) $ $;

CREATE
OR REPLACE FUNCTION auth_rules.insert() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'insert') $ $;

CREATE
OR REPLACE FUNCTION auth_rules.update() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'update') $ $;

CREATE
OR REPLACE FUNCTION auth_rules.delete() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'delete') $ $;

-- User ID marker for DSL
CREATE
OR REPLACE FUNCTION auth_rules.user_id_marker() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'user_id') $ $;

-- Claim reference
CREATE
OR REPLACE FUNCTION auth_rules.one_of(claim_name TEXT) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'one_of', 'claim', claim_name) $ $;

-- Claim property check
CREATE
OR REPLACE FUNCTION auth_rules.check(
  claim_name TEXT,
  property TEXT,
  allowed_values TEXT []
) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'check',
    'claim',
    claim_name,
    'property',
    property,
    'values',
    to_jsonb(allowed_values)
  ) $ $;

-- Equality filter (JSONB value - for nested DSL)
CREATE
OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'eq',
    'column',
    column_name,
    'value',
    value
  ) $ $;

-- Equality filter overloads for literals
CREATE
OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value UUID) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'eq',
    'column',
    column_name,
    'value',
    jsonb_build_object('type', 'literal', 'value', value)
  ) $ $;

CREATE
OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value TEXT) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'eq',
    'column',
    column_name,
    'value',
    jsonb_build_object('type', 'literal', 'value', value)
  ) $ $;

CREATE
OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value BOOLEAN) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'eq',
    'column',
    column_name,
    'value',
    jsonb_build_object('type', 'literal', 'value', value)
  ) $ $;

-- IN claim with optional check
CREATE
OR REPLACE FUNCTION auth_rules.in_claim(
  column_name TEXT,
  claim_name TEXT,
  check_condition JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'in',
    'column',
    column_name,
    'claim',
    claim_name,
    'check',
    check_condition
  ) $ $;

-- Boolean combinators
CREATE
OR REPLACE FUNCTION auth_rules.or_(VARIADIC conditions JSONB []) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object('type', 'or', 'conditions', to_jsonb(conditions)) $ $;

CREATE
OR REPLACE FUNCTION auth_rules.and_(VARIADIC conditions JSONB []) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $ $
SELECT
  jsonb_build_object(
    'type',
    'and',
    'conditions',
    to_jsonb(conditions)
  ) $ $;

-- =============================================================================
-- REQUIRE FUNCTIONS: Explicit error handling for views
-- =============================================================================
-- These functions are called in view WHERE clauses. They validate access and
-- raise explicit errors instead of silently filtering rows.
--
-- IMPORTANT: These functions are marked VOLATILE to force PostgreSQL to evaluate
-- them AFTER other WHERE conditions (like IN clauses). Without VOLATILE, the
-- query planner may reorder conditions and call require() on rows that would
-- be filtered out anyway, causing spurious "invalid" errors when indexes exist.
-- Generic require for claim-based checks (one_of)
-- Usage: WHERE auth_rules.require('org_ids', 'org_id', org_id)
-- The claim view must have a column matching 'col' (e.g. org_ids view has org_id column)
-- SECURITY DEFINER so it runs with postgres privileges and can query claim views
CREATE
OR REPLACE FUNCTION auth_rules.require(claim TEXT, col TEXT, val UUID) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $ $ DECLARE has_access BOOLEAN;

BEGIN -- Check the claim view - col matches both the table column and claim view column
EXECUTE format(
  'SELECT EXISTS (SELECT 1 FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = $1)',
  claim,
  col
) INTO has_access USING val;

IF NOT has_access THEN RAISE EXCEPTION '% invalid',
col USING ERRCODE = '42501';

END IF;

RETURN TRUE;

END;

$ $;

-- Require for user_id checks
-- Usage: WHERE auth_rules.require_user('user_id', user_id)
-- SECURITY DEFINER for consistency with require()
CREATE
OR REPLACE FUNCTION auth_rules.require_user(col TEXT, val UUID) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $ $ BEGIN IF val IS DISTINCT
FROM
  auth.uid() THEN RAISE EXCEPTION '% invalid',
  col USING ERRCODE = '42501';

END IF;

RETURN TRUE;

END;

$ $;

-- Grant execute to service_role (rules are defined by admins)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth_rules TO service_role;

-- =============================================================================
-- AUTH RULES: COMPILER
-- =============================================================================
-- Functions that compile rule definitions into views and triggers
-- Build WHERE clause from filter
CREATE
OR REPLACE FUNCTION auth_rules._build_where(filter JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $ $ DECLARE ftype TEXT := filter ->> 'type';

col TEXT;

val JSONB;

vtype TEXT;

claim TEXT;

result TEXT;

BEGIN CASE
  ftype
  WHEN 'eq' THEN col := filter ->> 'column';

val := filter -> 'value';

vtype := val ->> 'type';

CASE
  vtype
  WHEN 'user_id' THEN -- Filter to rows where column matches authenticated user
  RETURN format('%I = auth.uid()', col);

WHEN 'one_of' THEN -- Filter to rows where column is in user's claim
claim := val ->> 'claim';

RETURN format(
  '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())',
  col,
  col,
  claim
);

WHEN 'literal' THEN RETURN format('%I = %L', col, val ->> 'value');

WHEN 'check' THEN -- TODO: add require_check function for role-based checks
claim := val ->> 'claim';

RETURN format(
  '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
  col,
  col,
  claim,
  val ->> 'property',
  val -> 'values'
);

ELSE RETURN format('%I = %L', col, val);

END CASE
;

WHEN 'in' THEN col := filter ->> 'column';

claim := filter ->> 'claim';

IF filter -> 'check' IS NULL THEN -- Filter to rows where column is in user's claim
RETURN format(
  '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())',
  col,
  col,
  claim
);

ELSE -- TODO: add require_check function for role-based checks
RETURN format(
  '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
  col,
  col,
  claim,
  filter -> 'check' ->> 'property',
  filter -> 'check' -> 'values'
);

END IF;

WHEN 'or' THEN
SELECT
  '(' || string_agg(auth_rules._build_where(c), ' OR ') || ')' INTO result
FROM
  jsonb_array_elements(filter -> 'conditions') c;

RETURN result;

WHEN 'and' THEN
SELECT
  '(' || string_agg(auth_rules._build_where(c), ' AND ') || ')' INTO result
FROM
  jsonb_array_elements(filter -> 'conditions') c;

RETURN result;

ELSE RAISE EXCEPTION 'Unknown filter type: %',
ftype;

END CASE
;

END;

$ $;

-- Build WHERE clause using require() functions (raises errors instead of filtering)
CREATE
OR REPLACE FUNCTION auth_rules._build_where_require(filter JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $ $ DECLARE ftype TEXT := filter ->> 'type';

col TEXT;

val JSONB;

vtype TEXT;

claim TEXT;

result TEXT;

BEGIN CASE
  ftype
  WHEN 'eq' THEN col := filter ->> 'column';

val := filter -> 'value';

vtype := val ->> 'type';

CASE
  vtype
  WHEN 'user_id' THEN RETURN format('auth_rules.require_user(%L, %I)', col, col);

WHEN 'one_of' THEN claim := val ->> 'claim';

RETURN format(
  'auth_rules.require(%L, %L, %I)',
  claim,
  col,
  col
);

WHEN 'literal' THEN RETURN format('%I = %L', col, val ->> 'value');

WHEN 'check' THEN claim := val ->> 'claim';

-- Fall back to filter mode for check type (no require_check yet)
RETURN format(
  '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
  col,
  col,
  claim,
  val ->> 'property',
  val -> 'values'
);

ELSE RETURN format('%I = %L', col, val);

END CASE
;

WHEN 'in' THEN col := filter ->> 'column';

claim := filter ->> 'claim';

IF filter -> 'check' IS NULL THEN RETURN format(
  'auth_rules.require(%L, %L, %I)',
  claim,
  col,
  col
);

ELSE -- Fall back to filter mode for check conditions
RETURN format(
  '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
  col,
  col,
  claim,
  filter -> 'check' ->> 'property',
  filter -> 'check' -> 'values'
);

END IF;

WHEN 'or' THEN
SELECT
  '(' || string_agg(auth_rules._build_where_require(c), ' OR ') || ')' INTO result
FROM
  jsonb_array_elements(filter -> 'conditions') c;

RETURN result;

WHEN 'and' THEN
SELECT
  '(' || string_agg(auth_rules._build_where_require(c), ' AND ') || ')' INTO result
FROM
  jsonb_array_elements(filter -> 'conditions') c;

RETURN result;

ELSE RAISE EXCEPTION 'Unknown filter type: %',
ftype;

END CASE
;

END;

$ $;

-- Generate SELECT view
CREATE
OR REPLACE FUNCTION auth_rules._gen_select_view(
  p_table TEXT,
  p_cols TEXT [],
  p_filters JSONB,
  p_mode TEXT DEFAULT 'filter'
) RETURNS TEXT LANGUAGE plpgsql AS $ $ DECLARE where_parts TEXT [];

f JSONB;

BEGIN FOR f IN
SELECT
  *
FROM
  jsonb_array_elements(p_filters) LOOP IF f ->> 'type' NOT IN ('select', 'insert', 'update', 'delete') THEN IF p_mode = 'require' THEN where_parts := array_append(where_parts, auth_rules._build_where_require(f));

ELSE where_parts := array_append(where_parts, auth_rules._build_where(f));

END IF;

END IF;

END LOOP;

-- Use security_invoker = false so view runs with owner (postgres) privileges
-- This allows reading public.* tables that authenticated can't access directly
RETURN format(
  $ v $ CREATE
  OR REPLACE VIEW data_api.% I WITH (security_invoker = false) AS
  SELECT
    % s
  FROM
    public.% I % s $ v $,
    p_table,
    array_to_string(p_cols, ', '),
    p_table,
    CASE
      WHEN array_length(where_parts, 1) > 0 THEN 'WHERE ' || array_to_string(where_parts, ' AND ')
      ELSE ''
    END
);

END;

$ $;

-- Generate INSERT trigger
CREATE
OR REPLACE FUNCTION auth_rules._gen_insert_trigger(p_table TEXT, p_filters JSONB) RETURNS TEXT LANGUAGE plpgsql AS $ $ DECLARE validations TEXT := '';

f JSONB;

col TEXT;

val JSONB;

vtype TEXT;

BEGIN FOR f IN
SELECT
  *
FROM
  jsonb_array_elements(p_filters) LOOP IF f ->> 'type' = 'eq' THEN col := f ->> 'column';

val := f -> 'value';

vtype := val ->> 'type';

IF vtype = 'user_id' THEN validations := validations || format(
  $ v $ IF NEW.% I IS DISTINCT
  FROM
    auth.uid() THEN RAISE EXCEPTION '%I must match authenticated user' USING ERRCODE = '42501';

END IF;

$ v $,
col,
col
);

ELSIF vtype = 'one_of' THEN validations := validations || format(
  $ v $ IF NOT EXISTS (
    SELECT
      1
    FROM
      auth_rules_claims.% I
    WHERE
      user_id = auth.uid()
      AND % I = NEW.% I
  ) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';

END IF;

$ v $,
val ->> 'claim',
col,
col
);

END IF;

END IF;

END LOOP;

RETURN format(
  $ f $ CREATE
  OR REPLACE FUNCTION data_api.% I_insert_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $ t $ BEGIN % s
  INSERT INTO
    public.% I
  SELECT
    NEW.*;

RETURN NEW;

END;

$ t $;

DROP TRIGGER IF EXISTS % I_insert ON data_api.% I;

CREATE TRIGGER % I_insert INSTEAD OF
INSERT
  ON data_api.% I FOR EACH ROW EXECUTE FUNCTION data_api.% I_insert_trigger();

$ f $,
p_table,
validations,
p_table,
p_table,
p_table,
p_table,
p_table,
p_table
);

END;

$ $;

-- Generate UPDATE trigger
CREATE
OR REPLACE FUNCTION auth_rules._gen_update_trigger(p_table TEXT, p_filters JSONB) RETURNS TEXT LANGUAGE plpgsql AS $ $ DECLARE where_parts TEXT [] := ARRAY ['id = OLD.id'];

f JSONB;

col TEXT;

val JSONB;

vtype TEXT;

BEGIN FOR f IN
SELECT
  *
FROM
  jsonb_array_elements(p_filters) LOOP IF f ->> 'type' = 'eq' THEN col := f ->> 'column';

val := f -> 'value';

vtype := val ->> 'type';

IF vtype = 'user_id' THEN where_parts := array_append(where_parts, format('%I = auth.uid()', col));

ELSIF vtype = 'one_of' THEN where_parts := array_append(
  where_parts,
  format(
    '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())',
    col,
    col,
    val ->> 'claim'
  )
);

END IF;

END IF;

END LOOP;

RETURN format(
  $ f $ CREATE
  OR REPLACE FUNCTION data_api.% I_update_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $ t $ BEGIN
  UPDATE
    public.% I
  SET
    id = NEW.id
  WHERE
    % s;

IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not authorized' USING ERRCODE = 'P0002';

END IF;

RETURN NEW;

END;

$ t $;

DROP TRIGGER IF EXISTS % I_update ON data_api.% I;

CREATE TRIGGER % I_update INSTEAD OF
UPDATE
  ON data_api.% I FOR EACH ROW EXECUTE FUNCTION data_api.% I_update_trigger();

$ f $,
p_table,
p_table,
array_to_string(where_parts, ' AND '),
p_table,
p_table,
p_table,
p_table,
p_table
);

END;

$ $;

-- Generate DELETE trigger
CREATE
OR REPLACE FUNCTION auth_rules._gen_delete_trigger(p_table TEXT, p_filters JSONB) RETURNS TEXT LANGUAGE plpgsql AS $ $ DECLARE where_parts TEXT [] := ARRAY ['id = OLD.id'];

f JSONB;

col TEXT;

val JSONB;

vtype TEXT;

BEGIN FOR f IN
SELECT
  *
FROM
  jsonb_array_elements(p_filters) LOOP IF f ->> 'type' = 'eq' THEN col := f ->> 'column';

val := f -> 'value';

vtype := val ->> 'type';

IF vtype = 'user_id' THEN where_parts := array_append(where_parts, format('%I = auth.uid()', col));

ELSIF vtype = 'one_of' THEN where_parts := array_append(
  where_parts,
  format(
    '%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())',
    col,
    col,
    val ->> 'claim'
  )
);

END IF;

END IF;

END LOOP;

RETURN format(
  $ f $ CREATE
  OR REPLACE FUNCTION data_api.% I_delete_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $ t $ BEGIN
  DELETE FROM
    public.% I
  WHERE
    % s;

IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not authorized' USING ERRCODE = 'P0002';

END IF;

RETURN OLD;

END;

$ t $;

DROP TRIGGER IF EXISTS % I_delete ON data_api.% I;

CREATE TRIGGER % I_delete INSTEAD OF DELETE ON data_api.% I FOR EACH ROW EXECUTE FUNCTION data_api.% I_delete_trigger();

$ f $,
p_table,
p_table,
array_to_string(where_parts, ' AND '),
p_table,
p_table,
p_table,
p_table,
p_table
);

END;

$ $;

-- Generate SELECT wrapper function (validates then queries, returns explicit errors)
CREATE
OR REPLACE FUNCTION auth_rules._gen_select_function(p_table TEXT, p_cols TEXT [], p_filters JSONB) RETURNS TEXT LANGUAGE plpgsql AS $ $ DECLARE param_defs TEXT [] := ARRAY [] :: TEXT [];

validations TEXT := '';

where_parts TEXT [] := ARRAY [] :: TEXT [];

return_cols TEXT;

f JSONB;

col TEXT;

val JSONB;

vtype TEXT;

claim TEXT;

param_name TEXT;

BEGIN -- Build return columns
return_cols := array_to_string(p_cols, ', ');

-- Process filters to build params, validations, and where clauses
FOR f IN
SELECT
  *
FROM
  jsonb_array_elements(p_filters) LOOP IF f ->> 'type' = 'eq' THEN col := f ->> 'column';

val := f -> 'value';

vtype := val ->> 'type';

param_name := 'p_' || col;

IF vtype = 'user_id' THEN -- user_id filter: validate and add to WHERE
validations := validations || format(
  $ v $ IF % I IS DISTINCT
  FROM
    auth.uid() THEN RAISE EXCEPTION 'Access denied: %I must match authenticated user' USING ERRCODE = '42501';

END IF;

$ v $,
param_name,
col
);

param_defs := array_append(
  param_defs,
  format('%I UUID DEFAULT auth.uid()', param_name)
);

where_parts := array_append(where_parts, format('%I = %I', col, param_name));

ELSIF vtype = 'one_of' THEN -- one_of filter: param required, validate membership, add to WHERE
claim := val ->> 'claim';

param_defs := array_append(param_defs, format('%I UUID', param_name));

validations := validations || format(
  $ v $ IF NOT EXISTS (
    SELECT
      1
    FROM
      auth_rules_claims.% I
    WHERE
      user_id = auth.uid()
      AND % I = % I
  ) THEN RAISE EXCEPTION 'Access denied: not authorized for this %I' USING ERRCODE = '42501';

END IF;

$ v $,
claim,
col,
param_name,
col
);

where_parts := array_append(where_parts, format('%I = %I', col, param_name));

ELSIF vtype = 'literal' THEN -- literal: just add to WHERE
where_parts := array_append(
  where_parts,
  format('%I = %L', col, val ->> 'value')
);

ELSIF vtype = 'check' THEN -- check filter: param required, validate with role check
claim := val ->> 'claim';

param_defs := array_append(param_defs, format('%I UUID', param_name));

validations := validations || format(
  $ v $ IF NOT EXISTS (
    SELECT
      1
    FROM
      auth_rules_claims.% I
    WHERE
      user_id = auth.uid()
      AND % I = % I
      AND % I = ANY(% L :: text [])
  ) THEN RAISE EXCEPTION 'Access denied: insufficient role for this %I' USING ERRCODE = '42501';

END IF;

$ v $,
claim,
col,
param_name,
val ->> 'property',
val -> 'values',
col
);

where_parts := array_append(where_parts, format('%I = %I', col, param_name));

END IF;

ELSIF f ->> 'type' = 'or' THEN -- OR conditions are complex - for now, skip function generation for these
RAISE EXCEPTION 'OR conditions not yet supported in wrapper functions';

ELSIF f ->> 'type' = 'and' THEN -- AND conditions - recurse (simplified: skip for now)
RAISE EXCEPTION 'Nested AND conditions not yet supported in wrapper functions';

END IF;

END LOOP;

-- Build the function
RETURN format(
  $ f $ CREATE
  OR REPLACE FUNCTION data_api.get_ % I(% s) RETURNS TABLE (% s) LANGUAGE plpgsql SECURITY DEFINER
  SET
    search_path = public,
    auth_rules_claims,
    auth AS $ fn $ BEGIN % s RETURN QUERY
  SELECT
    % s
  FROM
    public.% I t % s;

END;

$ fn $;

$ f $,
p_table,
array_to_string(param_defs, ', '),
(
  SELECT
    string_agg(
      c || ' ' || COALESCE(
        (
          SELECT
            data_type
          FROM
            information_schema.columns
          WHERE
            table_schema = 'public'
            AND table_name = p_table
            AND column_name = c
        ),
        'TEXT'
      ),
      ', '
    )
  FROM
    unnest(p_cols) c
),
validations,
return_cols,
p_table,
CASE
  WHEN array_length(where_parts, 1) > 0 THEN ' WHERE ' || array_to_string(where_parts, ' AND ')
  ELSE ''
END
);

END;

$ $;

-- =============================================================================
-- AUTH RULES: MAIN ENTRY POINT
-- =============================================================================
CREATE
OR REPLACE FUNCTION auth_rules.rule(p_table TEXT, VARIADIC p_parts JSONB []) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $ $ DECLARE part JSONB;

op TEXT := 'select';

cols TEXT [];

filters JSONB := '[]' :: JSONB;

v_rule_id UUID;

sql TEXT;

v_mode TEXT := 'filter';

BEGIN -- Parse parts
FOREACH part IN ARRAY p_parts LOOP CASE
  part ->> 'type'
  WHEN 'select' THEN op := 'select';

SELECT
  array_agg(c :: TEXT) INTO cols
FROM
  jsonb_array_elements_text(part -> 'columns') c;

-- Extract mode if present (from select_strict)
IF part ->> 'mode' IS NOT NULL THEN v_mode := part ->> 'mode';

END IF;

WHEN 'insert' THEN op := 'insert';

WHEN 'update' THEN op := 'update';

WHEN 'delete' THEN op := 'delete';

ELSE filters := filters || jsonb_build_array(part);

END CASE
;

END LOOP;

-- Store rule
INSERT INTO
  auth_rules.rules (table_name, operation, columns, filters)
VALUES
  (p_table, op, cols, filters) ON CONFLICT (table_name, operation) DO
UPDATE
SET
  columns = EXCLUDED.columns,
  filters = EXCLUDED.filters,
  updated_at = now() RETURNING id INTO v_rule_id;

-- Clean old generated objects
DELETE FROM
  auth_rules.generated_objects
WHERE
  rule_id = v_rule_id;

-- Generate
CASE
  op
  WHEN 'select' THEN -- Generate view (filter mode = silent filtering, require mode = explicit errors)
  sql := auth_rules._gen_select_view(p_table, cols, filters, v_mode);

EXECUTE sql;

EXECUTE format(
  'GRANT SELECT ON data_api.%I TO anon, authenticated',
  p_table
);

INSERT INTO
  auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
VALUES
  (v_rule_id, 'view', 'data_api', p_table);

-- Generate wrapper function (explicit errors)
BEGIN sql := auth_rules._gen_select_function(p_table, cols, filters);

EXECUTE sql;

EXECUTE format(
  'GRANT EXECUTE ON FUNCTION data_api.get_%I TO authenticated',
  p_table
);

INSERT INTO
  auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
VALUES
  (
    v_rule_id,
    'function',
    'data_api',
    'get_' || p_table
  );

EXCEPTION
WHEN OTHERS THEN -- Function generation may fail for complex filters (OR, etc.) - that's ok, view still works
RAISE NOTICE 'Could not generate wrapper function for %: %',
p_table,
SQLERRM;

END;

WHEN 'insert' THEN IF NOT EXISTS (
  SELECT
    1
  FROM
    information_schema.views
  WHERE
    table_schema = 'data_api'
    AND table_name = p_table
) THEN RAISE EXCEPTION 'Define SELECT rule before INSERT for %',
p_table;

END IF;

sql := auth_rules._gen_insert_trigger(p_table, filters);

EXECUTE sql;

EXECUTE format(
  'GRANT INSERT ON data_api.%I TO authenticated',
  p_table
);

WHEN 'update' THEN IF NOT EXISTS (
  SELECT
    1
  FROM
    information_schema.views
  WHERE
    table_schema = 'data_api'
    AND table_name = p_table
) THEN RAISE EXCEPTION 'Define SELECT rule before UPDATE for %',
p_table;

END IF;

sql := auth_rules._gen_update_trigger(p_table, filters);

EXECUTE sql;

EXECUTE format(
  'GRANT UPDATE ON data_api.%I TO authenticated',
  p_table
);

WHEN 'delete' THEN IF NOT EXISTS (
  SELECT
    1
  FROM
    information_schema.views
  WHERE
    table_schema = 'data_api'
    AND table_name = p_table
) THEN RAISE EXCEPTION 'Define SELECT rule before DELETE for %',
p_table;

END IF;

sql := auth_rules._gen_delete_trigger(p_table, filters);

EXECUTE sql;

EXECUTE format(
  'GRANT DELETE ON data_api.%I TO authenticated',
  p_table
);

END CASE
;

RETURN format('Rule: data_api.%s (%s)', p_table, op);

END;

$ $;

-- Drop rules for a table
CREATE
OR REPLACE FUNCTION auth_rules.drop_rules(p_table TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $ $ DECLARE obj RECORD;

cnt INT := 0;

BEGIN FOR obj IN
SELECT
go
.*
FROM
  auth_rules.generated_objects
go
  JOIN auth_rules.rules r ON r.id =
go
.rule_id
WHERE
  r.table_name = p_table LOOP IF obj.object_type = 'trigger' THEN EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %I.%I',
    obj.object_name,
    obj.object_schema,
    p_table
  );

ELSIF obj.object_type = 'function' THEN EXECUTE format(
  'DROP FUNCTION IF EXISTS %I.%I()',
  obj.object_schema,
  obj.object_name
);

ELSIF obj.object_type = 'view' THEN EXECUTE format(
  'DROP VIEW IF EXISTS %I.%I',
  obj.object_schema,
  obj.object_name
);

END IF;

cnt := cnt + 1;

END LOOP;

DELETE FROM
  auth_rules.rules
WHERE
  table_name = p_table;

RETURN format('Dropped %s objects for %s', cnt, p_table);

END;

$ $;

-- List rules
CREATE
OR REPLACE FUNCTION auth_rules.list_rules() RETURNS TABLE (
  table_name TEXT,
  operation TEXT,
  columns TEXT [],
  filters JSONB
) LANGUAGE sql STABLE SECURITY DEFINER AS $ $
SELECT
  table_name,
  operation,
  columns,
  filters
FROM
  auth_rules.rules
ORDER BY
  table_name,
  operation;

$ $;

GRANT EXECUTE ON FUNCTION auth_rules.rule(TEXT, VARIADIC JSONB []) TO service_role;

GRANT EXECUTE ON FUNCTION auth_rules.drop_rules(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION auth_rules.list_rules() TO service_role;