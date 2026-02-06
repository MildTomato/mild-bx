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
