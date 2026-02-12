-- =============================================================================
-- DROPBOX-STYLE TABLES
-- =============================================================================
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
  content TEXT,
  size BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(content, ''))
  ) STORED
);

-- Direct shares (user-to-user or user-to-group)
CREATE TABLE public.shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('file', 'folder')),
  resource_id UUID NOT NULL,
  shared_with_user_id UUID,
  shared_with_group_id UUID,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'comment', 'edit')),
  created_by UUID NOT NULL DEFAULT auth.uid(),
  CHECK (
    shared_with_user_id IS NOT NULL
    OR shared_with_group_id IS NOT NULL
  )
);

-- Link shares (public URLs)
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

-- Comments on files
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(content, ''))
  ) STORED
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

-- Users view (exposes auth.users for sharing)
CREATE VIEW public.users WITH (security_invoker = false) AS
SELECT
  id,
  email
FROM
  auth.users;