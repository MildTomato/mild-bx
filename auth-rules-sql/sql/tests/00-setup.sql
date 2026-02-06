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
