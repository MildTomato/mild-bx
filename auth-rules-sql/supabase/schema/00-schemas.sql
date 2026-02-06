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
