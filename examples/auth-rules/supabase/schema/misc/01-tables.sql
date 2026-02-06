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
