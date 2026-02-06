-- =============================================================================
-- AUTH RULES: HELPER FUNCTIONS
-- =============================================================================

-- Get current link token from session
CREATE OR REPLACE FUNCTION current_link_token()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.link_token', true), '')
$$;

-- Set link token (for testing/API use)
CREATE OR REPLACE FUNCTION set_link_token(p_token TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.link_token', p_token, false);
END;
$$;

GRANT EXECUTE ON FUNCTION current_link_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_link_token(TEXT) TO service_role;

-- Look up user ID by email (returns null if not found)
CREATE OR REPLACE FUNCTION lookup_user_by_mail(p_mail TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM auth.users WHERE email = p_mail LIMIT 1
$$;

-- Look up user email by ID (returns null if not found)
CREATE OR REPLACE FUNCTION lookup_mail_by_user(p_user_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT email FROM auth.users WHERE id = p_user_id LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION lookup_user_by_mail(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION lookup_mail_by_user(UUID) TO authenticated;
