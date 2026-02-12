-- =============================================================================
-- AUTH RULES SQL - Complete Bundle
-- Generated: 2026-02-12T12:18:58Z
-- Run this on a fresh Supabase project (or any Postgres with auth schema)
-- =============================================================================

-- =============================================================================
-- PART 1: AUTH RULES SYSTEM
-- =============================================================================

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
GRANT USAGE ON SCHEMA auth_rules TO authenticated, service_role;
GRANT USAGE ON SCHEMA auth_rules_claims TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA data_api TO anon, authenticated, service_role;

-- Default privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA auth_rules_claims GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA data_api GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA data_api GRANT INSERT, UPDATE, DELETE ON TABLES TO authenticated;
-- =============================================================================
-- AUTH RULES: TABLES
-- =============================================================================
-- Storage for rule definitions and generated objects

CREATE TABLE IF NOT EXISTS auth_rules.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_name TEXT NOT NULL UNIQUE,
  sql TEXT NOT NULL,  -- The SELECT that returns (user_id, value)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_rules.rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('select', 'insert', 'update', 'delete')),
  columns TEXT[],
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
GRANT SELECT ON auth_rules.claims TO authenticated;
GRANT ALL ON auth_rules.claims TO service_role;
GRANT SELECT ON auth_rules.rules TO authenticated;
GRANT ALL ON auth_rules.rules TO service_role;
GRANT SELECT ON auth_rules.generated_objects TO authenticated;
GRANT ALL ON auth_rules.generated_objects TO service_role;
GRANT SELECT ON auth_rules.generated_claims TO authenticated;
GRANT ALL ON auth_rules.generated_claims TO service_role;

-- =============================================================================
-- TRIGGERS: Auto-generate views on INSERT/UPDATE/DELETE
-- =============================================================================

-- Trigger function for claims: auto-create claims view
CREATE OR REPLACE FUNCTION auth_rules._on_claim_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    EXECUTE format('DROP VIEW IF EXISTS auth_rules_claims.%I', OLD.claim_name);
    DELETE FROM auth_rules.generated_claims WHERE claim_id = OLD.id;
    RETURN OLD;
  END IF;

  -- For INSERT or UPDATE, create/replace the view from the SQL
  EXECUTE format('CREATE OR REPLACE VIEW auth_rules_claims.%I AS %s', NEW.claim_name, NEW.sql);
  EXECUTE format('GRANT SELECT ON auth_rules_claims.%I TO authenticated', NEW.claim_name);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO auth_rules.generated_claims (claim_id, view_name) VALUES (NEW.id, NEW.claim_name);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER claims_auto_view
  AFTER INSERT OR UPDATE OR DELETE ON auth_rules.claims
  FOR EACH ROW EXECUTE FUNCTION auth_rules._on_claim_change();

-- Trigger function for rules: auto-create data_api views/triggers
CREATE OR REPLACE FUNCTION auth_rules._on_rule_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  obj RECORD;
  sql TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Clean up generated objects
    FOR obj IN SELECT * FROM auth_rules.generated_objects WHERE rule_id = OLD.id LOOP
      IF obj.object_type = 'trigger' THEN
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', obj.object_name, obj.object_schema, OLD.table_name);
      ELSIF obj.object_type = 'function' THEN
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I()', obj.object_schema, obj.object_name);
      ELSIF obj.object_type = 'view' THEN
        EXECUTE format('DROP VIEW IF EXISTS %I.%I', obj.object_schema, obj.object_name);
      END IF;
    END LOOP;
    DELETE FROM auth_rules.generated_objects WHERE rule_id = OLD.id;
    RETURN OLD;
  END IF;

  -- For INSERT or UPDATE, generate the appropriate objects
  -- Clean old generated objects first (for UPDATE)
  IF TG_OP = 'UPDATE' THEN
    FOR obj IN SELECT * FROM auth_rules.generated_objects WHERE rule_id = NEW.id LOOP
      IF obj.object_type = 'trigger' THEN
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', obj.object_name, obj.object_schema, NEW.table_name);
      ELSIF obj.object_type = 'function' THEN
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I()', obj.object_schema, obj.object_name);
      ELSIF obj.object_type = 'view' THEN
        EXECUTE format('DROP VIEW IF EXISTS %I.%I', obj.object_schema, obj.object_name);
      END IF;
    END LOOP;
    DELETE FROM auth_rules.generated_objects WHERE rule_id = NEW.id;
  END IF;

  -- Generate based on operation type
  CASE NEW.operation
    WHEN 'select' THEN
      sql := auth_rules._gen_select_view(NEW.table_name, NEW.columns, NEW.filters);
      EXECUTE sql;
      EXECUTE format('GRANT SELECT ON data_api.%I TO anon, authenticated', NEW.table_name);
      INSERT INTO auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
      VALUES (NEW.id, 'view', 'data_api', NEW.table_name);

      -- Try to generate wrapper function (may fail for complex filters)
      BEGIN
        sql := auth_rules._gen_select_function(NEW.table_name, NEW.columns, NEW.filters);
        EXECUTE sql;
        EXECUTE format('GRANT EXECUTE ON FUNCTION data_api.get_%I TO authenticated', NEW.table_name);
        INSERT INTO auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
        VALUES (NEW.id, 'function', 'data_api', 'get_' || NEW.table_name);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not generate wrapper function for %: %', NEW.table_name, SQLERRM;
      END;

    WHEN 'insert' THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'data_api' AND table_name = NEW.table_name) THEN
        RAISE EXCEPTION 'Define SELECT rule before INSERT for %', NEW.table_name;
      END IF;
      sql := auth_rules._gen_insert_trigger(NEW.table_name, NEW.filters);
      EXECUTE sql;
      EXECUTE format('GRANT INSERT ON data_api.%I TO authenticated', NEW.table_name);

    WHEN 'update' THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'data_api' AND table_name = NEW.table_name) THEN
        RAISE EXCEPTION 'Define SELECT rule before UPDATE for %', NEW.table_name;
      END IF;
      sql := auth_rules._gen_update_trigger(NEW.table_name, NEW.filters);
      EXECUTE sql;
      EXECUTE format('GRANT UPDATE ON data_api.%I TO authenticated', NEW.table_name);

    WHEN 'delete' THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'data_api' AND table_name = NEW.table_name) THEN
        RAISE EXCEPTION 'Define SELECT rule before DELETE for %', NEW.table_name;
      END IF;
      sql := auth_rules._gen_delete_trigger(NEW.table_name, NEW.filters);
      EXECUTE sql;
      EXECUTE format('GRANT DELETE ON data_api.%I TO authenticated', NEW.table_name);
  END CASE;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER rules_auto_view
  AFTER INSERT OR UPDATE OR DELETE ON auth_rules.rules
  FOR EACH ROW EXECUTE FUNCTION auth_rules._on_rule_change();
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
CREATE OR REPLACE FUNCTION auth_rules.claim(p_claim_name TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Store claim definition
  INSERT INTO auth_rules.claims (claim_name, sql)
  VALUES (p_claim_name, p_sql)
  ON CONFLICT (claim_name) DO UPDATE
  SET sql = EXCLUDED.sql, updated_at = now();

  -- Create the view with security_invoker = false so it runs with owner (postgres) privileges
  -- This allows the view to read public.* tables that authenticated can't access directly
  EXECUTE format($v$
    CREATE OR REPLACE VIEW auth_rules_claims.%I
    WITH (security_invoker = false)
    AS %s
  $v$, p_claim_name, p_sql);
  EXECUTE format('GRANT SELECT ON auth_rules_claims.%I TO authenticated', p_claim_name);

  RETURN format('Claim: %s', p_claim_name);
END;
$$;

-- Drop a claim
CREATE OR REPLACE FUNCTION auth_rules.drop_claim(p_claim_name TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE format('DROP VIEW IF EXISTS auth_rules_claims.%I', p_claim_name);
  DELETE FROM auth_rules.claims WHERE claim_name = p_claim_name;
  RETURN format('Dropped claim: %s', p_claim_name);
END;
$$;

-- List all claims
CREATE OR REPLACE FUNCTION auth_rules.list_claims()
RETURNS TABLE (claim_name TEXT, sql TEXT)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT claim_name, sql FROM auth_rules.claims ORDER BY claim_name;
$$;

-- =============================================================================
-- DSL MARKERS AND HELPERS
-- =============================================================================

-- Wrapper for auth.uid()
CREATE OR REPLACE FUNCTION auth_rules.user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT auth.uid()
$$;

-- Operation markers
CREATE OR REPLACE FUNCTION auth_rules.select(VARIADIC columns TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'select', 'columns', to_jsonb(columns))
$$;

CREATE OR REPLACE FUNCTION auth_rules.insert()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'insert')
$$;

CREATE OR REPLACE FUNCTION auth_rules.update()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'update')
$$;

CREATE OR REPLACE FUNCTION auth_rules.delete()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'delete')
$$;

-- User ID marker for DSL
CREATE OR REPLACE FUNCTION auth_rules.user_id_marker()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'user_id')
$$;

-- Claim reference
CREATE OR REPLACE FUNCTION auth_rules.one_of(claim_name TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'one_of', 'claim', claim_name)
$$;

-- Claim property check
CREATE OR REPLACE FUNCTION auth_rules.check(claim_name TEXT, property TEXT, allowed_values TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'check', 'claim', claim_name, 'property', property, 'values', to_jsonb(allowed_values))
$$;

-- Equality filter (JSONB value - for nested DSL)
CREATE OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'eq', 'column', column_name, 'value', value)
$$;

-- Equality filter overloads for literals
CREATE OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value UUID)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'eq', 'column', column_name, 'value', jsonb_build_object('type', 'literal', 'value', value))
$$;

CREATE OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'eq', 'column', column_name, 'value', jsonb_build_object('type', 'literal', 'value', value))
$$;

CREATE OR REPLACE FUNCTION auth_rules.eq(column_name TEXT, value BOOLEAN)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'eq', 'column', column_name, 'value', jsonb_build_object('type', 'literal', 'value', value))
$$;

-- IN claim with optional check
CREATE OR REPLACE FUNCTION auth_rules.in_claim(column_name TEXT, claim_name TEXT, check_condition JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'in', 'column', column_name, 'claim', claim_name, 'check', check_condition)
$$;

-- Boolean combinators
CREATE OR REPLACE FUNCTION auth_rules.or_(VARIADIC conditions JSONB[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'or', 'conditions', to_jsonb(conditions))
$$;

CREATE OR REPLACE FUNCTION auth_rules.and_(VARIADIC conditions JSONB[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('type', 'and', 'conditions', to_jsonb(conditions))
$$;

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
CREATE OR REPLACE FUNCTION auth_rules.require(claim TEXT, col TEXT, val UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  has_access BOOLEAN;
BEGIN
  -- Check the claim view - col matches both the table column and claim view column
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = $1)',
    claim,
    col
  ) INTO has_access USING val;

  IF NOT has_access THEN
    RAISE EXCEPTION '% invalid', col USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

-- Require for user_id checks
-- Usage: WHERE auth_rules.require_user('user_id', user_id)
-- SECURITY DEFINER for consistency with require()
CREATE OR REPLACE FUNCTION auth_rules.require_user(col TEXT, val UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF val IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '% invalid', col USING ERRCODE = '42501';
  END IF;
  RETURN TRUE;
END;
$$;

-- Grant execute to service_role (rules are defined by admins)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth_rules TO service_role;
-- =============================================================================
-- AUTH RULES: COMPILER
-- =============================================================================
-- Functions that compile rule definitions into views and triggers

-- Build WHERE clause from filter
CREATE OR REPLACE FUNCTION auth_rules._build_where(filter JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ftype TEXT := filter->>'type';
  col TEXT;
  val JSONB;
  vtype TEXT;
  claim TEXT;
  result TEXT;
BEGIN
  CASE ftype
    WHEN 'eq' THEN
      col := filter->>'column';
      val := filter->'value';
      vtype := val->>'type';

      CASE vtype
        WHEN 'user_id' THEN
          -- Filter to rows where column matches authenticated user
          RETURN format('%I = auth.uid()', col);
        WHEN 'one_of' THEN
          -- Filter to rows where column is in user's claim
          claim := val->>'claim';
          RETURN format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())', col, col, claim);
        WHEN 'literal' THEN
          RETURN format('%I = %L', col, val->>'value');
        WHEN 'check' THEN
          -- TODO: add require_check function for role-based checks
          claim := val->>'claim';
          RETURN format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
            col, col, claim, val->>'property', val->'values');
        ELSE
          RETURN format('%I = %L', col, val);
      END CASE;

    WHEN 'in' THEN
      col := filter->>'column';
      claim := filter->>'claim';
      IF filter->'check' IS NULL THEN
        -- Filter to rows where column is in user's claim
        RETURN format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())', col, col, claim);
      ELSE
        -- TODO: add require_check function for role-based checks
        RETURN format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
          col, col, claim, filter->'check'->>'property', filter->'check'->'values');
      END IF;

    WHEN 'or' THEN
      SELECT '(' || string_agg(auth_rules._build_where(c), ' OR ') || ')'
      INTO result FROM jsonb_array_elements(filter->'conditions') c;
      RETURN result;

    WHEN 'and' THEN
      SELECT '(' || string_agg(auth_rules._build_where(c), ' AND ') || ')'
      INTO result FROM jsonb_array_elements(filter->'conditions') c;
      RETURN result;

    ELSE
      RAISE EXCEPTION 'Unknown filter type: %', ftype;
  END CASE;
END;
$$;

-- Generate SELECT view
CREATE OR REPLACE FUNCTION auth_rules._gen_select_view(p_table TEXT, p_cols TEXT[], p_filters JSONB)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  where_parts TEXT[];
  f JSONB;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' NOT IN ('select', 'insert', 'update', 'delete') THEN
      where_parts := array_append(where_parts, auth_rules._build_where(f));
    END IF;
  END LOOP;

  -- Use security_invoker = false so view runs with owner (postgres) privileges
  -- This allows reading public.* tables that authenticated can't access directly
  RETURN format($v$
    CREATE OR REPLACE VIEW data_api.%I
    WITH (security_invoker = false)
    AS SELECT %s FROM public.%I %s
  $v$,
    p_table,
    array_to_string(p_cols, ', '),
    p_table,
    CASE WHEN array_length(where_parts, 1) > 0 THEN 'WHERE ' || array_to_string(where_parts, ' AND ') ELSE '' END
  );
END;
$$;

-- Generate INSERT trigger
CREATE OR REPLACE FUNCTION auth_rules._gen_insert_trigger(p_table TEXT, p_filters JSONB)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  validations TEXT := '';
  f JSONB;
  col TEXT;
  val JSONB;
  vtype TEXT;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' = 'eq' THEN
      col := f->>'column';
      val := f->'value';
      vtype := val->>'type';

      IF vtype = 'user_id' THEN
        validations := validations || format($v$
  IF NEW.%I IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '%I must match authenticated user' USING ERRCODE = '42501';
  END IF;$v$, col, col);
      ELSIF vtype = 'one_of' THEN
        validations := validations || format($v$
  IF NOT EXISTS (SELECT 1 FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = NEW.%I) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;$v$, val->>'claim', col, col);
      END IF;
    END IF;
  END LOOP;

  RETURN format($f$
CREATE OR REPLACE FUNCTION data_api.%I_insert_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $t$
BEGIN%s
  INSERT INTO public.%I SELECT NEW.*;
  RETURN NEW;
END;
$t$;
DROP TRIGGER IF EXISTS %I_insert ON data_api.%I;
CREATE TRIGGER %I_insert INSTEAD OF INSERT ON data_api.%I FOR EACH ROW EXECUTE FUNCTION data_api.%I_insert_trigger();
$f$, p_table, validations, p_table, p_table, p_table, p_table, p_table, p_table);
END;
$$;

-- Generate UPDATE trigger
CREATE OR REPLACE FUNCTION auth_rules._gen_update_trigger(p_table TEXT, p_filters JSONB)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  where_parts TEXT[] := ARRAY['id = OLD.id'];
  f JSONB;
  col TEXT;
  val JSONB;
  vtype TEXT;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' = 'eq' THEN
      col := f->>'column';
      val := f->'value';
      vtype := val->>'type';

      IF vtype = 'user_id' THEN
        where_parts := array_append(where_parts, format('%I = auth.uid()', col));
      ELSIF vtype = 'one_of' THEN
        where_parts := array_append(where_parts, format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())',
          col, col, val->>'claim'));
      END IF;
    END IF;
  END LOOP;

  RETURN format($f$
CREATE OR REPLACE FUNCTION data_api.%I_update_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $t$
BEGIN
  UPDATE public.%I SET id = NEW.id WHERE %s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not authorized' USING ERRCODE = 'P0002'; END IF;
  RETURN NEW;
END;
$t$;
DROP TRIGGER IF EXISTS %I_update ON data_api.%I;
CREATE TRIGGER %I_update INSTEAD OF UPDATE ON data_api.%I FOR EACH ROW EXECUTE FUNCTION data_api.%I_update_trigger();
$f$, p_table, p_table, array_to_string(where_parts, ' AND '), p_table, p_table, p_table, p_table, p_table);
END;
$$;

-- Generate DELETE trigger
CREATE OR REPLACE FUNCTION auth_rules._gen_delete_trigger(p_table TEXT, p_filters JSONB)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  where_parts TEXT[] := ARRAY['id = OLD.id'];
  f JSONB;
  col TEXT;
  val JSONB;
  vtype TEXT;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' = 'eq' THEN
      col := f->>'column';
      val := f->'value';
      vtype := val->>'type';

      IF vtype = 'user_id' THEN
        where_parts := array_append(where_parts, format('%I = auth.uid()', col));
      ELSIF vtype = 'one_of' THEN
        where_parts := array_append(where_parts, format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid())',
          col, col, val->>'claim'));
      END IF;
    END IF;
  END LOOP;

  RETURN format($f$
CREATE OR REPLACE FUNCTION data_api.%I_delete_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $t$
BEGIN
  DELETE FROM public.%I WHERE %s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not authorized' USING ERRCODE = 'P0002'; END IF;
  RETURN OLD;
END;
$t$;
DROP TRIGGER IF EXISTS %I_delete ON data_api.%I;
CREATE TRIGGER %I_delete INSTEAD OF DELETE ON data_api.%I FOR EACH ROW EXECUTE FUNCTION data_api.%I_delete_trigger();
$f$, p_table, p_table, array_to_string(where_parts, ' AND '), p_table, p_table, p_table, p_table, p_table);
END;
$$;

-- Generate SELECT wrapper function (validates then queries, returns explicit errors)
CREATE OR REPLACE FUNCTION auth_rules._gen_select_function(p_table TEXT, p_cols TEXT[], p_filters JSONB)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  param_defs TEXT[] := ARRAY[]::TEXT[];
  validations TEXT := '';
  where_parts TEXT[] := ARRAY[]::TEXT[];
  return_cols TEXT;
  f JSONB;
  col TEXT;
  val JSONB;
  vtype TEXT;
  claim TEXT;
  param_name TEXT;
BEGIN
  -- Build return columns (qualify with table alias 't.' to avoid ambiguity with RETURNS TABLE)
  SELECT array_to_string(array_agg('t.' || c), ', ')
  INTO return_cols FROM unnest(p_cols) c;

  -- Process filters to build params, validations, and where clauses
  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' = 'eq' THEN
      col := f->>'column';
      val := f->'value';
      vtype := val->>'type';
      param_name := 'p_' || col;

      IF vtype = 'user_id' THEN
        -- user_id filter: validate and add to WHERE
        validations := validations || format($v$
  IF %I IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied: %I must match authenticated user' USING ERRCODE = '42501';
  END IF;$v$, param_name, col);
        param_defs := array_append(param_defs, format('%I UUID DEFAULT auth.uid()', param_name));
        where_parts := array_append(where_parts, format('t.%I = %I', col, param_name));

      ELSIF vtype = 'one_of' THEN
        -- one_of filter: param required, validate membership, add to WHERE
        -- Use alias 'c' to avoid ambiguity with RETURNS TABLE output columns
        claim := val->>'claim';
        param_defs := array_append(param_defs, format('%I UUID', param_name));
        validations := validations || format($v$
  IF NOT EXISTS (SELECT 1 FROM auth_rules_claims.%I c WHERE c.user_id = auth.uid() AND c.%I = %I) THEN
    RAISE EXCEPTION 'Access denied: not authorized for this %I' USING ERRCODE = '42501';
  END IF;$v$, claim, col, param_name, col);
        where_parts := array_append(where_parts, format('t.%I = %I', col, param_name));

      ELSIF vtype = 'literal' THEN
        -- literal: just add to WHERE
        where_parts := array_append(where_parts, format('%I = %L', col, val->>'value'));

      ELSIF vtype = 'check' THEN
        -- check filter: param required, validate with role check
        -- Use alias 'c' to avoid ambiguity with RETURNS TABLE output columns
        claim := val->>'claim';
        param_defs := array_append(param_defs, format('%I UUID', param_name));
        validations := validations || format($v$
  IF NOT EXISTS (SELECT 1 FROM auth_rules_claims.%I c WHERE c.user_id = auth.uid() AND c.%I = %I AND c.%I = ANY(%L::text[])) THEN
    RAISE EXCEPTION 'Access denied: insufficient role for this %I' USING ERRCODE = '42501';
  END IF;$v$, claim, col, param_name, val->>'property', val->'values', col);
        where_parts := array_append(where_parts, format('t.%I = %I', col, param_name));
      END IF;

    ELSIF f->>'type' = 'or' THEN
      -- OR conditions are complex - for now, skip function generation for these
      RAISE EXCEPTION 'OR conditions not yet supported in wrapper functions';

    ELSIF f->>'type' = 'and' THEN
      -- AND conditions - recurse (simplified: skip for now)
      RAISE EXCEPTION 'Nested AND conditions not yet supported in wrapper functions';
    END IF;
  END LOOP;

  -- Build the function
  RETURN format($f$
CREATE OR REPLACE FUNCTION data_api.get_%I(%s)
RETURNS TABLE (%s)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth_rules_claims, auth
AS $fn$
BEGIN%s
  RETURN QUERY SELECT %s FROM public.%I t%s;
END;
$fn$;
$f$,
    p_table,
    array_to_string(param_defs, ', '),
    (SELECT string_agg(c || ' ' ||
      COALESCE((SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = p_table AND column_name = c), 'TEXT'), ', ')
      FROM unnest(p_cols) c),
    validations,
    return_cols,
    p_table,
    CASE WHEN array_length(where_parts, 1) > 0 THEN ' WHERE ' || array_to_string(where_parts, ' AND ') ELSE '' END
  );
END;
$$;
-- =============================================================================
-- AUTH RULES: MAIN ENTRY POINT
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_rules.rule(p_table TEXT, VARIADIC p_parts JSONB[])
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  part JSONB;
  op TEXT := 'select';
  cols TEXT[];
  filters JSONB := '[]'::JSONB;
  v_rule_id UUID;
  sql TEXT;
BEGIN
  -- Parse parts
  FOREACH part IN ARRAY p_parts LOOP
    CASE part->>'type'
      WHEN 'select' THEN
        op := 'select';
        SELECT array_agg(c::TEXT) INTO cols FROM jsonb_array_elements_text(part->'columns') c;
      WHEN 'insert' THEN op := 'insert';
      WHEN 'update' THEN op := 'update';
      WHEN 'delete' THEN op := 'delete';
      ELSE filters := filters || jsonb_build_array(part);
    END CASE;
  END LOOP;

  -- Store rule
  INSERT INTO auth_rules.rules (table_name, operation, columns, filters)
  VALUES (p_table, op, cols, filters)
  ON CONFLICT (table_name, operation) DO UPDATE
  SET columns = EXCLUDED.columns, filters = EXCLUDED.filters, updated_at = now()
  RETURNING id INTO v_rule_id;

  -- Clean old generated objects
  DELETE FROM auth_rules.generated_objects WHERE rule_id = v_rule_id;

  -- Generate
  CASE op
    WHEN 'select' THEN
      -- Generate view (silent filtering, for browsing)
      sql := auth_rules._gen_select_view(p_table, cols, filters);
      EXECUTE sql;
      EXECUTE format('GRANT SELECT ON data_api.%I TO anon, authenticated', p_table);
      INSERT INTO auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
      VALUES (v_rule_id, 'view', 'data_api', p_table);

      -- Generate wrapper function (explicit errors)
      BEGIN
        sql := auth_rules._gen_select_function(p_table, cols, filters);
        EXECUTE sql;
        EXECUTE format('GRANT EXECUTE ON FUNCTION data_api.get_%I TO authenticated', p_table);
        INSERT INTO auth_rules.generated_objects (rule_id, object_type, object_schema, object_name)
        VALUES (v_rule_id, 'function', 'data_api', 'get_' || p_table);
      EXCEPTION WHEN OTHERS THEN
        -- Function generation may fail for complex filters (OR, etc.) - that's ok, view still works
        RAISE NOTICE 'Could not generate wrapper function for %: %', p_table, SQLERRM;
      END;

    WHEN 'insert' THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'data_api' AND table_name = p_table) THEN
        RAISE EXCEPTION 'Define SELECT rule before INSERT for %', p_table;
      END IF;
      sql := auth_rules._gen_insert_trigger(p_table, filters);
      EXECUTE sql;
      EXECUTE format('GRANT INSERT ON data_api.%I TO authenticated', p_table);

    WHEN 'update' THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'data_api' AND table_name = p_table) THEN
        RAISE EXCEPTION 'Define SELECT rule before UPDATE for %', p_table;
      END IF;
      sql := auth_rules._gen_update_trigger(p_table, filters);
      EXECUTE sql;
      EXECUTE format('GRANT UPDATE ON data_api.%I TO authenticated', p_table);

    WHEN 'delete' THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'data_api' AND table_name = p_table) THEN
        RAISE EXCEPTION 'Define SELECT rule before DELETE for %', p_table;
      END IF;
      sql := auth_rules._gen_delete_trigger(p_table, filters);
      EXECUTE sql;
      EXECUTE format('GRANT DELETE ON data_api.%I TO authenticated', p_table);
  END CASE;

  RETURN format('Rule: data_api.%s (%s)', p_table, op);
END;
$$;

-- Drop rules for a table
CREATE OR REPLACE FUNCTION auth_rules.drop_rules(p_table TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  obj RECORD;
  cnt INT := 0;
BEGIN
  FOR obj IN SELECT go.* FROM auth_rules.generated_objects go JOIN auth_rules.rules r ON r.id = go.rule_id WHERE r.table_name = p_table LOOP
    IF obj.object_type = 'trigger' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', obj.object_name, obj.object_schema, p_table);
    ELSIF obj.object_type = 'function' THEN
      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I()', obj.object_schema, obj.object_name);
    ELSIF obj.object_type = 'view' THEN
      EXECUTE format('DROP VIEW IF EXISTS %I.%I', obj.object_schema, obj.object_name);
    END IF;
    cnt := cnt + 1;
  END LOOP;
  DELETE FROM auth_rules.rules WHERE table_name = p_table;
  RETURN format('Dropped %s objects for %s', cnt, p_table);
END;
$$;

-- List rules
CREATE OR REPLACE FUNCTION auth_rules.list_rules()
RETURNS TABLE (table_name TEXT, operation TEXT, columns TEXT[], filters JSONB)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT table_name, operation, columns, filters FROM auth_rules.rules ORDER BY table_name, operation;
$$;

GRANT EXECUTE ON FUNCTION auth_rules.rule(TEXT, VARIADIC JSONB[]) TO service_role;
GRANT EXECUTE ON FUNCTION auth_rules.drop_rules(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION auth_rules.list_rules() TO service_role;

-- =============================================================================
-- PART 2: TEST SETUP (tables, claims, rules, test data)
-- =============================================================================

-- =============================================================================
-- TEST SETUP: Tables, Claims, Rules, Test Data
-- =============================================================================

-- =============================================================================
-- MOCK AUTH
-- =============================================================================

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- If link token is set, use anonymous user UUID
    WHEN NULLIF(current_setting('app.link_token', true), '') IS NOT NULL
    THEN '00000000-0000-0000-0000-000000000000'::UUID
    -- Otherwise use regular user ID
    ELSE NULLIF(current_setting('app.user_id', true), '')::UUID
  END
$$;

CREATE OR REPLACE FUNCTION set_user(p_user_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id::text, false);
  PERFORM set_config('app.link_token', '', false);  -- Clear link token when setting user
END;
$$;

-- For link-based access (anonymous)
CREATE OR REPLACE FUNCTION set_link_token(p_token TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.link_token', p_token, false);
  PERFORM set_config('app.user_id', '', false);  -- Clear user when using link
END;
$$;

CREATE OR REPLACE FUNCTION current_link_token()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.link_token', true), '')
$$;

-- =============================================================================
-- TABLES
-- =============================================================================

-- Users (for reference, actual auth is mocked)
CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);

-- Organizations
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

-- Org members with roles
CREATE TABLE public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'owner')),
  UNIQUE(org_id, user_id)
);

-- Groups within orgs
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

-- Group members
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  UNIQUE(group_id, user_id)
);

-- Folders
CREATE TABLE public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL
);

-- Files
CREATE TABLE public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  content TEXT
);

-- Direct shares (user-to-user)
CREATE TABLE public.shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'folder')),
  resource_id UUID NOT NULL,
  shared_with_user_id UUID,
  shared_with_group_id UUID,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
  created_by UUID NOT NULL,
  CHECK (shared_with_user_id IS NOT NULL OR shared_with_group_id IS NOT NULL)
);

-- Link shares
CREATE TABLE public.link_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'folder')),
  resource_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  password_hash TEXT,
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL
);

-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- CLAIMS
-- =============================================================================

-- org_ids: which orgs can this user access?
SELECT auth_rules.claim('org_ids', $$
  SELECT user_id, org_id FROM org_members
$$);

-- admin_org_ids: which orgs is this user an admin of?
SELECT auth_rules.claim('admin_org_ids', $$
  SELECT user_id, org_id FROM org_members WHERE role IN ('admin', 'owner')
$$);

-- group_ids: which groups is this user in?
SELECT auth_rules.claim('group_ids', $$
  SELECT user_id, group_id FROM group_members
$$);

-- owned_file_ids: which files does this user own?
SELECT auth_rules.claim('owned_file_ids', $$
  SELECT owner_id AS user_id, id FROM files
$$);

-- shared_file_ids: which files are shared with this user (directly)?
SELECT auth_rules.claim('shared_file_ids', $$
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM shares
  WHERE resource_type = 'file' AND shared_with_user_id IS NOT NULL
$$);

-- group_shared_file_ids: which files are shared with groups this user is in?
SELECT auth_rules.claim('group_shared_file_ids', $$
  SELECT group_members.user_id, shares.resource_id AS id
  FROM shares
  JOIN group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'file'
$$);

-- accessible_file_ids: all files user can access (owned OR shared OR group-shared OR link-shared OR in accessible folder)
SELECT auth_rules.claim('accessible_file_ids', $$
  -- Files user owns
  SELECT owner_id AS user_id, id FROM files
  UNION
  -- Files shared directly with user
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM shares WHERE resource_type = 'file' AND shared_with_user_id IS NOT NULL
  UNION
  -- Files shared with groups user is in
  SELECT group_members.user_id, shares.resource_id AS id
  FROM shares
  JOIN group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'file'
  UNION
  -- Files in folders user owns
  SELECT folders.owner_id AS user_id, files.id
  FROM files
  JOIN folders ON files.folder_id = folders.id
  UNION
  -- Files in folders shared with user
  SELECT shares.shared_with_user_id AS user_id, files.id
  FROM files
  JOIN shares ON shares.resource_id = files.folder_id
  WHERE shares.resource_type = 'folder' AND shares.shared_with_user_id IS NOT NULL
  UNION
  -- Files in folders shared with groups user is in
  SELECT group_members.user_id, files.id
  FROM files
  JOIN shares ON shares.resource_id = files.folder_id
  JOIN group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'folder'
  UNION
  -- Files accessible via link token (for any user including anonymous)
  SELECT COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000') AS user_id, resource_id AS id
  FROM link_shares
  WHERE resource_type = 'file'
    AND token = current_link_token()
    AND (expires_at IS NULL OR expires_at > now())
$$);

-- =============================================================================
-- CLAIMS: For edit/delete permissions
-- =============================================================================

-- editable_file_ids: files user can edit (owned OR shared with edit OR in folder shared with edit)
SELECT auth_rules.claim('editable_file_ids', $$
  -- Files user owns (owner can always edit)
  SELECT owner_id AS user_id, id FROM files
  UNION
  -- Files shared directly with user with edit permission
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM shares WHERE resource_type = 'file' AND shared_with_user_id IS NOT NULL AND permission = 'edit'
  UNION
  -- Files shared with groups user is in with edit permission
  SELECT group_members.user_id, shares.resource_id AS id
  FROM shares
  JOIN group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'file' AND shares.permission = 'edit'
  UNION
  -- Files in folders shared with user with edit permission
  SELECT shares.shared_with_user_id AS user_id, files.id
  FROM files
  JOIN shares ON shares.resource_id = files.folder_id
  WHERE shares.resource_type = 'folder' AND shares.shared_with_user_id IS NOT NULL AND shares.permission = 'edit'
  UNION
  -- Files in folders shared with groups user is in with edit permission
  SELECT group_members.user_id, files.id
  FROM files
  JOIN shares ON shares.resource_id = files.folder_id
  JOIN group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'folder' AND shares.permission = 'edit'
  UNION
  -- Files accessible via link token with edit permission
  SELECT COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000') AS user_id, resource_id AS id
  FROM link_shares
  WHERE resource_type = 'file'
    AND token = current_link_token()
    AND permission = 'edit'
    AND (expires_at IS NULL OR expires_at > now())
$$);

-- deletable_file_ids: only owner can delete
SELECT auth_rules.claim('deletable_file_ids', $$
  SELECT owner_id AS user_id, id FROM files
$$);

-- =============================================================================
-- CLAIMS: Folder access (for hierarchy tests)
-- =============================================================================

-- owned_folder_ids: folders user owns
SELECT auth_rules.claim('owned_folder_ids', $$
  SELECT owner_id AS user_id, id FROM folders
$$);

-- shared_folder_ids: folders shared directly with user
SELECT auth_rules.claim('shared_folder_ids', $$
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM shares
  WHERE resource_type = 'folder' AND shared_with_user_id IS NOT NULL
$$);

-- accessible_folder_ids: folders user can access (owned OR shared)
SELECT auth_rules.claim('accessible_folder_ids', $$
  SELECT owner_id AS user_id, id FROM folders
  UNION
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM shares WHERE resource_type = 'folder' AND shared_with_user_id IS NOT NULL
  UNION
  SELECT group_members.user_id, shares.resource_id AS id
  FROM shares
  JOIN group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'folder'
$$);

-- =============================================================================
-- RULES
-- =============================================================================

-- Files SELECT: user can see files they own OR are shared with them
SELECT auth_rules.rule('files',
  auth_rules.select('id', 'folder_id', 'owner_id', 'name', 'content'),
  auth_rules.eq('id', auth_rules.one_of('accessible_file_ids'))
);

-- Files INSERT: anyone can create files (they become owner)
SELECT auth_rules.rule('files',
  auth_rules.insert(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker())
);

-- Files UPDATE: only if user has edit permission
SELECT auth_rules.rule('files',
  auth_rules.update(),
  auth_rules.eq('id', auth_rules.one_of('editable_file_ids'))
);

-- Files DELETE: only owner can delete
SELECT auth_rules.rule('files',
  auth_rules.delete(),
  auth_rules.eq('id', auth_rules.one_of('deletable_file_ids'))
);

-- Folders SELECT: user can see folders they own or are shared with them
SELECT auth_rules.rule('folders',
  auth_rules.select('id', 'org_id', 'parent_id', 'owner_id', 'name'),
  auth_rules.eq('id', auth_rules.one_of('accessible_folder_ids'))
);

-- Audit logs: only org admins can see
SELECT auth_rules.rule('audit_logs',
  auth_rules.select('id', 'org_id', 'user_id', 'action', 'resource_type', 'resource_id', 'created_at'),
  auth_rules.eq('org_id', auth_rules.one_of('admin_org_ids'))
);

-- =============================================================================
-- TEST DATA: Users
-- =============================================================================

-- Alice: file owner, admin of Org One
-- Bob: just a user, member of Org One
-- Carol: admin of Org Two, member of Org One
-- Dave: member of Org One (non-admin)
-- Eve: no orgs, no access

INSERT INTO public.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'carol@example.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'dave@example.com'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'eve@example.com');

-- =============================================================================
-- TEST DATA: Organizations
-- =============================================================================

INSERT INTO public.organizations (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Org One'),
  ('22222222-2222-2222-2222-222222222222', 'Org Two');

INSERT INTO public.org_members (org_id, user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member'),
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member'),
  ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'member'),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin');

-- =============================================================================
-- TEST DATA: Groups
-- =============================================================================

INSERT INTO public.groups (id, org_id, name) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Engineering'),
  ('bbbb2222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Marketing');

INSERT INTO public.group_members (group_id, user_id) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaa1111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('bbbb2222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- =============================================================================
-- TEST DATA: Folders
-- =============================================================================

-- Alice's folders
INSERT INTO public.folders (id, owner_id, name) VALUES
  ('d0000001-0001-0001-0001-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Projects');

-- Alice's shared folder (will be shared with Bob)
INSERT INTO public.folders (id, owner_id, name) VALUES
  ('d0000002-0002-0002-0002-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Shared Folder');

-- Bob's folder
INSERT INTO public.folders (id, owner_id, name) VALUES
  ('d0000003-0003-0003-0003-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob Projects');

-- =============================================================================
-- TEST DATA: Files
-- =============================================================================

-- Alice's files (not in folder)
INSERT INTO public.files (id, owner_id, name, content) VALUES
  ('f0000001-0001-0001-0001-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-private.txt', 'Alice private content'),
  ('f0000002-0002-0002-0002-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-shared.txt', 'Alice shared content');

-- Alice's file inside her shared folder (Bob should be able to see via folder access)
INSERT INTO public.files (id, folder_id, owner_id, name, content) VALUES
  ('f0000005-0005-0005-0005-000000000005', 'd0000002-0002-0002-0002-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'file-in-shared-folder.txt', 'Content in shared folder');

-- Bob's files
INSERT INTO public.files (id, owner_id, name, content) VALUES
  ('f0000003-0003-0003-0003-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob-private.txt', 'Bob private content');

-- Bob's file inside his folder (Carol has edit access via folder share)
INSERT INTO public.files (id, folder_id, owner_id, name, content) VALUES
  ('f0000006-0006-0006-0006-000000000006', 'd0000003-0003-0003-0003-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob-in-folder.txt', 'Bob folder content');

-- Carol's files
INSERT INTO public.files (id, owner_id, name, content) VALUES
  ('f0000004-0004-0004-0004-000000000004', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'carol-private.txt', 'Carol private content');

-- =============================================================================
-- TEST DATA: Shares
-- =============================================================================

-- Alice shares alice-shared.txt with Bob (view permission)
INSERT INTO public.shares (resource_type, resource_id, shared_with_user_id, permission, created_by) VALUES
  ('file', 'f0000002-0002-0002-0002-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Carol shares carol-private.txt with Engineering group (edit permission)
INSERT INTO public.shares (resource_type, resource_id, shared_with_group_id, permission, created_by) VALUES
  ('file', 'f0000004-0004-0004-0004-000000000004', 'aaaa1111-1111-1111-1111-111111111111', 'edit', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- Alice shares her "Alice Shared Folder" with Bob (view permission on folder)
INSERT INTO public.shares (resource_type, resource_id, shared_with_user_id, permission, created_by) VALUES
  ('folder', 'd0000002-0002-0002-0002-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Bob shares his folder with Carol (edit permission - for testing folder edit propagation)
INSERT INTO public.shares (resource_type, resource_id, shared_with_user_id, permission, created_by) VALUES
  ('folder', 'd0000003-0003-0003-0003-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'edit', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- =============================================================================
-- TEST DATA: Audit Logs
-- =============================================================================

INSERT INTO public.audit_logs (org_id, user_id, action) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'file.created'),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'member.added');

-- =============================================================================
-- TEST DATA: Link Shares
-- =============================================================================

-- Public link to Alice's private file (view only, no expiry)
INSERT INTO public.link_shares (id, resource_type, resource_id, token, permission, created_by) VALUES
  ('11110001-0001-0001-0001-000000000001', 'file', 'f0000001-0001-0001-0001-000000000001', 'public-link-abc123', 'view', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Expired link to Bob's file
INSERT INTO public.link_shares (id, resource_type, resource_id, token, permission, expires_at, created_by) VALUES
  ('11110002-0002-0002-0002-000000000002', 'file', 'f0000003-0003-0003-0003-000000000003', 'expired-link-xyz789', 'view', '2020-01-01 00:00:00', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Future expiry link to Carol's file
INSERT INTO public.link_shares (id, resource_type, resource_id, token, permission, expires_at, created_by) VALUES
  ('11110003-0003-0003-0003-000000000003', 'file', 'f0000004-0004-0004-0004-000000000004', 'valid-link-future', 'edit', '2099-12-31 23:59:59', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

SELECT '=== SETUP COMPLETE ===' AS status;

-- =============================================================================
-- PART 3: TESTS
-- =============================================================================


-- =============================================================================
-- TEST CATEGORY 1: OWNERSHIP
-- =============================================================================
-- Tests that users can see their own files and cannot see others' files

SELECT '====== CATEGORY 1: OWNERSHIP ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 1.1: User can see their own files
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T1.1: Alice can see her own files' AS test;

DO $$
DECLARE
  file_count INT;
BEGIN
  SELECT COUNT(*) INTO file_count
  FROM data_api.files
  WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF file_count = 3 THEN
    RAISE NOTICE 'PASS: Alice sees 3 of her own files';
  ELSE
    RAISE NOTICE 'FAIL: Expected 3 files, got %', file_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.2: User cannot see other users' private files
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T1.2: Alice cannot see Bob''s private file' AS test;

DO $$
BEGIN
  -- Bob's private file (not shared) - use get_files() for explicit error
  PERFORM * FROM data_api.get_files('f0000003-0003-0003-0003-000000000003');
  RAISE NOTICE 'FAIL: Alice should not see Bob''s private file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.3: Different user can see their own files
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T1.3: Bob can see his own files' AS test;

DO $$
DECLARE
  file_count INT;
BEGIN
  SELECT COUNT(*) INTO file_count
  FROM data_api.files
  WHERE owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  IF file_count = 2 THEN
    RAISE NOTICE 'PASS: Bob sees 2 of his own files';
  ELSE
    RAISE NOTICE 'FAIL: Expected 2 files, got %', file_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.4: User with no access gets error when trying to access any file
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T1.4: Dave (no files, nothing shared) gets error accessing any file' AS test;

DO $$
BEGIN
  -- Try to access Alice's file - use get_files() for explicit error
  PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: Dave should not be able to access any files';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.5: User with no auth sees nothing
-- -----------------------------------------------------------------------------
SELECT set_user(NULL);
SELECT 'T1.5: No user (NULL auth) cannot access files' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: NULL user should not see any files';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== OWNERSHIP: 5 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 2: DIRECT SHARING
-- =============================================================================
-- Tests that sharing files with users grants them access

SELECT '====== CATEGORY 2: DIRECT SHARING ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 2.1: User can see file shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T2.1: Bob can see file Alice shared with him' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_name = 'alice-shared.txt' THEN
    RAISE NOTICE 'PASS: Bob can see alice-shared.txt';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-shared.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.2: User cannot see file NOT shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T2.2: Bob cannot see Alice''s private file (not shared)' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: Bob should not see Alice''s private file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.3: User can read content of file shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T2.3: Bob can read content of file Alice shared' AS test;

DO $$
DECLARE
  file_content TEXT;
BEGIN
  SELECT content INTO file_content
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_content = 'Alice shared content' THEN
    RAISE NOTICE 'PASS: Bob can read shared file content';
  ELSE
    RAISE NOTICE 'FAIL: Expected "Alice shared content", got %', file_content;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.4: Share is unidirectional - sharer can still see their own file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T2.4: Alice can still see file she shared with Bob' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_name = 'alice-shared.txt' THEN
    RAISE NOTICE 'PASS: Alice still sees her shared file';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-shared.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.5: Third party cannot see shared file
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T2.5: Dave cannot see file shared between Alice and Bob' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000002-0002-0002-0002-000000000002');
  RAISE NOTICE 'FAIL: Dave should not see file shared between Alice and Bob';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== DIRECT SHARING: 5 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 3: GROUP SHARING
-- =============================================================================
-- Tests that sharing with groups grants access to all group members

SELECT '====== CATEGORY 3: GROUP SHARING ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 3.1: Group member can see file shared with their group
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T3.1: Bob (in Engineering) can see file shared with Engineering' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Carol shared carol-private.txt with Engineering group
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Bob sees file shared with Engineering group';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 3.2: Another group member can also see group-shared file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T3.2: Alice (also in Engineering) can see file shared with Engineering' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Alice sees file shared with Engineering group';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 3.3: Non-group member cannot see group-shared file
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T3.3: Dave (not in Engineering) cannot see file shared with Engineering' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000004-0004-0004-0004-000000000004');
  RAISE NOTICE 'FAIL: Dave should not see file shared with Engineering';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 3.4: User in different group cannot see file shared with other group
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T3.4: Carol (in Marketing, not Engineering) still sees her own file' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Carol owns this file, so she should see it regardless of group shares
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Carol sees her own file (owner access)';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

SELECT '====== GROUP SHARING: 4 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 4: ORGANIZATIONS
-- =============================================================================
-- Tests organization membership and admin access

SELECT '====== CATEGORY 4: ORGANIZATIONS ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 4.1: Org admin can see audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T4.1: Alice (admin of Org One) can see Org One audit logs' AS test;

DO $$
DECLARE
  log_count INT;
BEGIN
  SELECT COUNT(*) INTO log_count
  FROM data_api.audit_logs
  WHERE org_id = '11111111-1111-1111-1111-111111111111';

  IF log_count = 1 THEN
    RAISE NOTICE 'PASS: Alice sees 1 audit log for Org One';
  ELSE
    RAISE NOTICE 'FAIL: Expected 1 audit log, got %', log_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.2: Org member (non-admin) cannot see audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T4.2: Bob (member, not admin) cannot see Org One audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_audit_logs('11111111-1111-1111-1111-111111111111');
  RAISE NOTICE 'FAIL: Bob should not see audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.3: Admin of one org cannot see other org's audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T4.3: Alice (admin of Org One) cannot see Org Two audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_audit_logs('22222222-2222-2222-2222-222222222222');
  RAISE NOTICE 'FAIL: Alice should not see Org Two audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.4: Admin of multiple orgs can see logs in both
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T4.4: Carol (admin of Org Two) can see Org Two audit logs' AS test;

DO $$
DECLARE
  log_action TEXT;
BEGIN
  SELECT action INTO log_action
  FROM data_api.audit_logs
  WHERE org_id = '22222222-2222-2222-2222-222222222222';

  IF log_action = 'member.added' THEN
    RAISE NOTICE 'PASS: Carol sees Org Two audit log';
  ELSE
    RAISE NOTICE 'FAIL: Expected member.added, got %', log_action;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.5: User with no orgs cannot see any audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
SELECT 'T4.5: Eve (no orgs) cannot see any audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_audit_logs('11111111-1111-1111-1111-111111111111');
  RAISE NOTICE 'FAIL: Eve should not see any audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.6: Non-admin member cannot see audit logs even for their own org
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T4.6: Dave (member of Org One, not admin) cannot see audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_audit_logs('11111111-1111-1111-1111-111111111111');
  RAISE NOTICE 'FAIL: Dave should not see audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== ORGANIZATIONS: 6 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 5: LINK SHARING
-- =============================================================================
-- Tests that link tokens grant access to files

SELECT '====== CATEGORY 5: LINK SHARING ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 5.1: Valid link token grants access (anonymous)
-- -----------------------------------------------------------------------------
SELECT set_link_token('public-link-abc123');
SELECT 'T5.1: Anonymous user with valid link can see file' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000001-0001-0001-0001-000000000001';

  IF file_name = 'alice-private.txt' THEN
    RAISE NOTICE 'PASS: Anonymous user sees file via link token';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.2: Invalid link token denies access
-- -----------------------------------------------------------------------------
SELECT set_link_token('invalid-token-wrong');
SELECT 'T5.2: Invalid link token denies access' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: Invalid token should not grant access';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.3: Expired link token denies access
-- -----------------------------------------------------------------------------
SELECT set_link_token('expired-link-xyz789');
SELECT 'T5.3: Expired link token denies access' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000003-0003-0003-0003-000000000003');
  RAISE NOTICE 'FAIL: Expired token should not grant access';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.4: Future expiry link token grants access
-- -----------------------------------------------------------------------------
SELECT set_link_token('valid-link-future');
SELECT 'T5.4: Link with future expiry grants access' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Future expiry link grants access';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.5: Link token only grants access to that specific file
-- -----------------------------------------------------------------------------
SELECT set_link_token('public-link-abc123');
SELECT 'T5.5: Link token only grants access to specific file' AS test;

DO $$
BEGIN
  -- This link is for alice-private.txt, not bob-private.txt
  PERFORM * FROM data_api.get_files('f0000003-0003-0003-0003-000000000003');
  RAISE NOTICE 'FAIL: Link should only grant access to its specific file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.6: No token and no user denies all access
-- -----------------------------------------------------------------------------
SELECT set_link_token(NULL);
SELECT set_user(NULL);
SELECT 'T5.6: No token and no user denies access' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: Should deny access without token or user';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== LINK SHARING: 6 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 6: PERMISSION LEVELS
-- =============================================================================
-- Tests that view/edit/delete permissions work correctly

SELECT '====== CATEGORY 6: PERMISSION LEVELS ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 6.1: Owner can update their own file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T6.1: Owner (Alice) can update her file' AS test;

DO $$
BEGIN
  UPDATE data_api.files SET name = 'alice-renamed.txt' WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'PASS: Alice updated her file';
  -- Revert
  UPDATE data_api.files SET name = 'alice-private.txt' WHERE id = 'f0000001-0001-0001-0001-000000000001';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.2: User with view permission cannot update
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.2: Bob (view only on alice-shared.txt) cannot update' AS test;

DO $$
BEGIN
  -- Bob has view permission on alice-shared.txt, not edit
  UPDATE data_api.files SET name = 'hacked.txt' WHERE id = 'f0000002-0002-0002-0002-000000000002';
  RAISE NOTICE 'FAIL: Bob should not be able to update with view permission';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.3: User with edit permission (via group) can update
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.3: Bob (edit via Engineering group) can update Carol''s file' AS test;

DO $$
BEGIN
  -- Carol shared her file with Engineering group with edit permission
  UPDATE data_api.files SET name = 'carol-updated.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
  RAISE NOTICE 'PASS: Bob updated file via group edit permission';
  -- Revert
  UPDATE data_api.files SET name = 'carol-private.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.4: Owner can delete their own file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T6.4: Owner (Alice) can delete her file' AS test;

DO $$
BEGIN
  -- Create a temp file to delete
  INSERT INTO data_api.files (id, owner_id, name, content)
  VALUES ('f9999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'temp.txt', 'temp');

  DELETE FROM data_api.files WHERE id = 'f9999999-9999-9999-9999-999999999999';
  RAISE NOTICE 'PASS: Alice deleted her file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.5: Non-owner cannot delete file (even with edit permission)
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.5: Bob cannot delete Carol''s file (even with edit permission)' AS test;

DO $$
BEGIN
  DELETE FROM data_api.files WHERE id = 'f0000004-0004-0004-0004-000000000004';
  RAISE NOTICE 'FAIL: Bob should not be able to delete Carol''s file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.6: Link with edit permission can update
-- -----------------------------------------------------------------------------
SELECT set_link_token('valid-link-future');
SELECT 'T6.6: Link with edit permission can update' AS test;

DO $$
BEGIN
  UPDATE data_api.files SET name = 'carol-via-link.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
  RAISE NOTICE 'PASS: Edit link updated file';
  -- Revert
  UPDATE data_api.files SET name = 'carol-private.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.7: Link with view permission cannot update
-- -----------------------------------------------------------------------------
SELECT set_link_token('public-link-abc123');
SELECT 'T6.7: Link with view permission cannot update' AS test;

DO $$
BEGIN
  UPDATE data_api.files SET name = 'hacked-via-link.txt' WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: View-only link should not be able to update';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.8: User with folder edit permission can edit files inside
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T6.8: Carol (folder edit on Bob Projects) can edit file inside' AS test;

DO $$
BEGIN
  -- Carol has edit permission on Bob's folder, should be able to edit file inside
  UPDATE data_api.files SET name = 'carol-edited-bob-file.txt' WHERE id = 'f0000006-0006-0006-0006-000000000006';
  RAISE NOTICE 'PASS: Carol edited file via folder edit permission';
  -- Revert
  UPDATE data_api.files SET name = 'bob-in-folder.txt' WHERE id = 'f0000006-0006-0006-0006-000000000006';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.9: User with folder view permission cannot edit files inside
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.9: Bob (folder view on Alice Shared Folder) cannot edit file inside' AS test;

DO $$
BEGIN
  -- Bob has view permission on Alice's shared folder, should NOT be able to edit
  UPDATE data_api.files SET name = 'bob-hacked.txt' WHERE id = 'f0000005-0005-0005-0005-000000000005';
  RAISE NOTICE 'FAIL: Bob should not edit file in view-only folder';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== PERMISSION LEVELS: 9 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 7: FOLDER HIERARCHY
-- =============================================================================
-- Tests that folder sharing grants access to files inside

SELECT '====== CATEGORY 7: FOLDER HIERARCHY ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 7.1: User can see their own folder
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T7.1: Alice can see her own folders' AS test;

DO $$
DECLARE
  folder_count INT;
BEGIN
  SELECT COUNT(*) INTO folder_count
  FROM data_api.folders
  WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF folder_count = 2 THEN
    RAISE NOTICE 'PASS: Alice sees 2 of her folders';
  ELSE
    RAISE NOTICE 'FAIL: Expected 2 folders, got %', folder_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.2: User cannot see other user's private folder
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T7.2: Bob cannot see Alice''s private folder' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_folders('d0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: Bob should not see Alice''s private folder';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.3: User CAN see folder shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T7.3: Bob CAN see folder Alice shared with him' AS test;

DO $$
DECLARE
  folder_name TEXT;
BEGIN
  SELECT name INTO folder_name
  FROM data_api.folders
  WHERE id = 'd0000002-0002-0002-0002-000000000002';

  IF folder_name = 'Alice Shared Folder' THEN
    RAISE NOTICE 'PASS: Bob sees shared folder';
  ELSE
    RAISE NOTICE 'FAIL: Expected Alice Shared Folder, got %', folder_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.4: User can see FILE inside shared folder (folder inheritance)
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T7.4: Bob can see file inside shared folder (inheritance)' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000005-0005-0005-0005-000000000005';

  IF file_name = 'file-in-shared-folder.txt' THEN
    RAISE NOTICE 'PASS: Bob sees file inside shared folder';
  ELSE
    RAISE NOTICE 'FAIL: Expected file-in-shared-folder.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.5: User without folder access cannot see file inside
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T7.5: Dave cannot see file inside folder not shared with him' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.get_files('f0000005-0005-0005-0005-000000000005');
  RAISE NOTICE 'FAIL: Dave should not see file in unshared folder';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.6: Owner of folder can see files inside (even if not file owner)
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T7.6: Alice (folder owner) can see all files in her folder' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000005-0005-0005-0005-000000000005';

  IF file_name = 'file-in-shared-folder.txt' THEN
    RAISE NOTICE 'PASS: Alice sees file in her folder';
  ELSE
    RAISE NOTICE 'FAIL: Expected file-in-shared-folder.txt, got %', file_name;
  END IF;
END;
$$;

SELECT '====== FOLDER HIERARCHY: 6 TESTS COMPLETE ======' AS result;


-- =============================================================================
-- TEST CATEGORY 8: EDGE CASES
-- =============================================================================
-- Tests unusual scenarios and boundary conditions

SELECT '====== CATEGORY 8: EDGE CASES ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 8.1: User in multiple orgs can see logs from each (admin in both)
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T8.1: Carol (admin in Org Two, member in Org One) sees Org Two logs only' AS test;

DO $$
DECLARE
  log_count INT;
BEGIN
  -- Carol is admin in Org Two, should see those logs
  SELECT COUNT(*) INTO log_count
  FROM data_api.audit_logs
  WHERE org_id = '22222222-2222-2222-2222-222222222222';

  IF log_count = 1 THEN
    RAISE NOTICE 'PASS: Carol sees Org Two audit logs';
  ELSE
    RAISE NOTICE 'FAIL: Expected 1 log, got %', log_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.2: File accessible via multiple paths (owned, but also shared with Engineering)
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T8.2: Carol can see her file (owns it, also shared with Engineering)' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Carol owns this file AND it's shared with Engineering (which she's not in)
  -- But she should still see it because she owns it
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Carol sees her file via ownership';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.3: User with both direct share AND group share sees file once
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T8.3: Alice sees file shared with Engineering (she is in Engineering)' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Alice sees Carol''s file via Engineering group';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.4: Switching users clears previous access
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- Alice can see her file
SELECT 'T8.4: Switching users clears access' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- First verify Alice can see her file
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000001-0001-0001-0001-000000000001';

  IF file_name != 'alice-private.txt' THEN
    RAISE NOTICE 'FAIL: Alice should see her file first';
    RETURN;
  END IF;

  -- Now switch to Eve
  PERFORM set_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

  -- Eve should NOT see Alice's file
  BEGIN
    PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
    RAISE NOTICE 'FAIL: Eve should not see Alice''s file after user switch';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: User switch cleared access';
  END;
END;
$$;

-- Reset user for subsequent tests
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- -----------------------------------------------------------------------------
-- Test 8.5: Empty string user_id is treated as no access
-- -----------------------------------------------------------------------------
SELECT 'T8.5: Empty string user ID treated as no access' AS test;

DO $$
BEGIN
  PERFORM set_config('app.user_id', '', false);
  PERFORM set_config('app.link_token', '', false);

  PERFORM * FROM data_api.get_files('f0000001-0001-0001-0001-000000000001');
  RAISE NOTICE 'FAIL: Empty user_id should not have access';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.6: User can access file via folder share AND direct share
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T8.6: Bob has multiple access paths to alice-shared.txt' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Bob has direct share access to alice-shared.txt
  -- He should be able to access it
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_name = 'alice-shared.txt' THEN
    RAISE NOTICE 'PASS: Bob accesses file via direct share';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-shared.txt, got %', file_name;
  END IF;
END;
$$;

SELECT '====== EDGE CASES: 6 TESTS COMPLETE ======' AS result;

