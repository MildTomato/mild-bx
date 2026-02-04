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
CREATE OR REPLACE FUNCTION auth_rules.require(claim TEXT, col TEXT, val UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
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
CREATE OR REPLACE FUNCTION auth_rules.require_user(col TEXT, val UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF val IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '% invalid', col USING ERRCODE = '42501';
  END IF;
  RETURN TRUE;
END;
$$;

-- Grant execute to service_role (rules are defined by admins)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth_rules TO service_role;
