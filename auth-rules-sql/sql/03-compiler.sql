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

-- Build WHERE clause using require() functions (raises errors instead of filtering)
CREATE OR REPLACE FUNCTION auth_rules._build_where_require(filter JSONB)
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
          RETURN format('auth_rules.require_user(%L, %I)', col, col);
        WHEN 'one_of' THEN
          claim := val->>'claim';
          RETURN format('auth_rules.require(%L, %L, %I)', claim, col, col);
        WHEN 'literal' THEN
          RETURN format('%I = %L', col, val->>'value');
        WHEN 'check' THEN
          claim := val->>'claim';
          -- Fall back to filter mode for check type (no require_check yet)
          RETURN format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
            col, col, claim, val->>'property', val->'values');
        ELSE
          RETURN format('%I = %L', col, val);
      END CASE;

    WHEN 'in' THEN
      col := filter->>'column';
      claim := filter->>'claim';
      IF filter->'check' IS NULL THEN
        RETURN format('auth_rules.require(%L, %L, %I)', claim, col, col);
      ELSE
        -- Fall back to filter mode for check conditions
        RETURN format('%I IN (SELECT %I FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = ANY(%L::text[]))',
          col, col, claim, filter->'check'->>'property', filter->'check'->'values');
      END IF;

    WHEN 'or' THEN
      SELECT '(' || string_agg(auth_rules._build_where_require(c), ' OR ') || ')'
      INTO result FROM jsonb_array_elements(filter->'conditions') c;
      RETURN result;

    WHEN 'and' THEN
      SELECT '(' || string_agg(auth_rules._build_where_require(c), ' AND ') || ')'
      INTO result FROM jsonb_array_elements(filter->'conditions') c;
      RETURN result;

    ELSE
      RAISE EXCEPTION 'Unknown filter type: %', ftype;
  END CASE;
END;
$$;

-- Generate SELECT view
CREATE OR REPLACE FUNCTION auth_rules._gen_select_view(p_table TEXT, p_cols TEXT[], p_filters JSONB, p_mode TEXT DEFAULT 'filter')
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  where_parts TEXT[];
  f JSONB;
BEGIN
  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' NOT IN ('select', 'insert', 'update', 'delete') THEN
      IF p_mode = 'require' THEN
        where_parts := array_append(where_parts, auth_rules._build_where_require(f));
      ELSE
        where_parts := array_append(where_parts, auth_rules._build_where(f));
      END IF;
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
  validations TEXT := '';
  set_parts TEXT[] := ARRAY[]::TEXT[];
  col_rec RECORD;
  f JSONB;
  col TEXT;
  val JSONB;
  vtype TEXT;
BEGIN
  -- Build SET clause from all columns in the table
  FOR col_rec IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table
    ORDER BY ordinal_position
  LOOP
    set_parts := array_append(set_parts, format('%I = NEW.%I', col_rec.column_name, col_rec.column_name));
  END LOOP;

  -- ==========================================================================
  -- UPDATE TRIGGER FILTER BEHAVIOR
  -- ==========================================================================
  --
  -- Filters generate two things: WHERE conditions (which rows can be updated)
  -- and validations (what new values are acceptable). Different filter types
  -- map to these differently:
  --
  -- ┌──────────────────┬───────────────────┬────────────────────────────────┐
  -- │ Filter type      │ WHERE (OLD row)   │ Validation (NEW values)        │
  -- ├──────────────────┼───────────────────┼────────────────────────────────┤
  -- │ user_id_marker() │ ✓ col = auth.uid()│ ✓ NEW.col must = auth.uid()   │
  -- │ one_of(claim)    │ ✗ (skipped)       │ ✓ NEW.col must be in claim    │
  -- └──────────────────┴───────────────────┴────────────────────────────────┘
  --
  -- WHY one_of skips the WHERE clause:
  --   The WHERE clause on an UPDATE identifies which rows the user is allowed
  --   to modify. Ownership (user_id) is a source authorization — "can I touch
  --   this row?". Claim checks (one_of) are destination validations — "is the
  --   new value allowed?". Checking the OLD value against a claim would break
  --   operations like moving a file from root (folder_id = NULL) since
  --   NULL IN (...) is always false in SQL.
  --
  -- WHY one_of allows NULL:
  --   NULL means "no value" (e.g. parent_id = NULL means root-level folder).
  --   The claim check is skipped when NEW.col IS NULL. This is safe because:
  --   - If the column is nullable: NULL is intentionally valid (e.g. move to root)
  --   - If the column is NOT NULL: the database constraint on the underlying
  --     public table rejects the NULL when the trigger executes the UPDATE,
  --     so security is still enforced — just with a different error message.
  --   If you need to prevent NULLs, add a NOT NULL constraint on the column.
  --
  -- EXAMPLE — files UPDATE rule:
  --   eq('id', one_of('editable_file_ids'))     → validates NEW.id is editable
  --   eq('folder_id', one_of('writable_folder_ids')) → validates destination folder
  --   eq('owner_id', user_id_marker())           → WHERE owner_id = auth.uid()
  --                                                + validates NEW.owner_id
  -- ==========================================================================

  FOR f IN SELECT * FROM jsonb_array_elements(p_filters) LOOP
    IF f->>'type' = 'eq' THEN
      col := f->>'column';
      val := f->'value';
      vtype := val->>'type';

      IF vtype = 'user_id' THEN
        -- SOURCE AUTHORIZATION + NEW VALIDATION
        -- Added to WHERE: only rows owned by this user can be updated
        -- Added to validations: user can't transfer ownership to someone else
        where_parts := array_append(where_parts, format('%I = auth.uid()', col));
        validations := validations || format($v$
  IF NEW.%I IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '%I must match authenticated user' USING ERRCODE = '42501';
  END IF;$v$, col, col);

      ELSIF vtype = 'one_of' THEN
        -- DESTINATION VALIDATION ONLY (not added to WHERE)
        -- Checks that the new value is in the user's claim set.
        -- NULL values are allowed through — see comment block above for why.
        validations := validations || format($v$
  IF NEW.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = NEW.%I) THEN
    RAISE EXCEPTION '%I invalid' USING ERRCODE = '42501';
  END IF;$v$, col, val->>'claim', col, col, col);
      END IF;
    END IF;
  END LOOP;

  RETURN format($f$
CREATE OR REPLACE FUNCTION data_api.%I_update_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $t$
BEGIN%s
  UPDATE public.%I SET %s WHERE %s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not authorized' USING ERRCODE = 'P0002'; END IF;
  RETURN NEW;
END;
$t$;
DROP TRIGGER IF EXISTS %I_update ON data_api.%I;
CREATE TRIGGER %I_update INSTEAD OF UPDATE ON data_api.%I FOR EACH ROW EXECUTE FUNCTION data_api.%I_update_trigger();
$f$, p_table, validations, p_table, array_to_string(set_parts, ', '), array_to_string(where_parts, ' AND '), p_table, p_table, p_table, p_table, p_table);
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
  -- Build return columns
  return_cols := array_to_string(p_cols, ', ');

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
        where_parts := array_append(where_parts, format('%I = %I', col, param_name));

      ELSIF vtype = 'one_of' THEN
        -- one_of filter: param required, validate membership, add to WHERE
        claim := val->>'claim';
        param_defs := array_append(param_defs, format('%I UUID', param_name));
        validations := validations || format($v$
  IF NOT EXISTS (SELECT 1 FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = %I) THEN
    RAISE EXCEPTION 'Access denied: not authorized for this %I' USING ERRCODE = '42501';
  END IF;$v$, claim, col, param_name, col);
        where_parts := array_append(where_parts, format('%I = %I', col, param_name));

      ELSIF vtype = 'literal' THEN
        -- literal: just add to WHERE
        where_parts := array_append(where_parts, format('%I = %L', col, val->>'value'));

      ELSIF vtype = 'check' THEN
        -- check filter: param required, validate with role check
        claim := val->>'claim';
        param_defs := array_append(param_defs, format('%I UUID', param_name));
        validations := validations || format($v$
  IF NOT EXISTS (SELECT 1 FROM auth_rules_claims.%I WHERE user_id = auth.uid() AND %I = %I AND %I = ANY(%L::text[])) THEN
    RAISE EXCEPTION 'Access denied: insufficient role for this %I' USING ERRCODE = '42501';
  END IF;$v$, claim, col, param_name, val->>'property', val->'values', col);
        where_parts := array_append(where_parts, format('%I = %I', col, param_name));
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
