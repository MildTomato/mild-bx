-- =============================================================================
-- CLAIMS: Define what users have access to
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

-- accessible_file_ids: all files user can access
-- Uses descendant expansion with LIMIT to prevent explosion on huge folders
SELECT auth_rules.claim('accessible_file_ids', $$
  -- Files user owns
  SELECT owner_id AS user_id, id FROM public.files
  UNION
  -- Files shared directly with user
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM public.shares WHERE resource_type = 'file' AND shared_with_user_id IS NOT NULL
  UNION
  -- Files shared with groups user is in
  SELECT group_members.user_id, shares.resource_id AS id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'file'
  UNION
  -- Files in folders user owns
  SELECT folders.owner_id AS user_id, files.id
  FROM public.files
  JOIN public.folders ON files.folder_id = folders.id
  UNION
  -- Files in folders shared with user (capped at 100k folders to prevent timeout)
  SELECT shares.shared_with_user_id AS user_id, files.id
  FROM public.shares
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant_folders ON true
  JOIN public.files ON files.folder_id = descendant_folders.id
  WHERE shares.resource_type = 'folder' AND shares.shared_with_user_id IS NOT NULL
  UNION
  -- Files in folders shared with groups user is in (capped)
  SELECT group_members.user_id, files.id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant_folders ON true
  JOIN public.files ON files.folder_id = descendant_folders.id
  WHERE shares.resource_type = 'folder'
  UNION
  -- Files accessible via link token
  SELECT COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000') AS user_id, resource_id AS id
  FROM public.link_shares
  WHERE resource_type = 'file'
    AND token = current_link_token()
    AND (expires_at IS NULL OR expires_at > now())
$$);

-- editable_file_ids: files user can edit
-- Uses descendant expansion with LIMIT to prevent explosion on huge folders
SELECT auth_rules.claim('editable_file_ids', $$
  -- Files user owns
  SELECT owner_id AS user_id, id FROM public.files
  UNION
  -- Files shared with edit permission
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM public.shares WHERE resource_type = 'file' AND shared_with_user_id IS NOT NULL AND permission = 'edit'
  UNION
  -- Files shared with groups with edit permission
  SELECT group_members.user_id, shares.resource_id AS id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'file' AND shares.permission = 'edit'
  UNION
  -- Files in folders shared with edit permission (capped at 100k folders)
  SELECT shares.shared_with_user_id AS user_id, files.id
  FROM public.shares
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant_folders ON true
  JOIN public.files ON files.folder_id = descendant_folders.id
  WHERE shares.resource_type = 'folder' AND shares.shared_with_user_id IS NOT NULL AND shares.permission = 'edit'
  UNION
  -- Files in folders shared with groups with edit permission (capped)
  SELECT group_members.user_id, files.id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant_folders ON true
  JOIN public.files ON files.folder_id = descendant_folders.id
  WHERE shares.resource_type = 'folder' AND shares.permission = 'edit'
  UNION
  -- Link shares with edit permission
  SELECT COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000') AS user_id, resource_id AS id
  FROM public.link_shares
  WHERE resource_type = 'file'
    AND token = current_link_token()
    AND permission = 'edit'
    AND (expires_at IS NULL OR expires_at > now())
$$);

-- deletable_file_ids: only owner can delete
SELECT auth_rules.claim('deletable_file_ids', $$
  SELECT owner_id AS user_id, id FROM public.files
$$);

-- commentable_file_ids: files user can comment on (comment or edit permission)
-- Uses descendant expansion with LIMIT to prevent explosion on huge folders
SELECT auth_rules.claim('commentable_file_ids', $$
  -- Files user owns
  SELECT owner_id AS user_id, id FROM public.files
  UNION
  -- Files shared with comment or edit permission
  SELECT shared_with_user_id AS user_id, resource_id AS id
  FROM public.shares WHERE resource_type = 'file' AND shared_with_user_id IS NOT NULL AND permission IN ('comment', 'edit')
  UNION
  -- Files shared with groups with comment or edit permission
  SELECT group_members.user_id, shares.resource_id AS id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  WHERE shares.resource_type = 'file' AND shares.permission IN ('comment', 'edit')
  UNION
  -- Files in folders shared with comment or edit permission (capped at 100k folders)
  SELECT shares.shared_with_user_id AS user_id, files.id
  FROM public.shares
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant_folders ON true
  JOIN public.files ON files.folder_id = descendant_folders.id
  WHERE shares.resource_type = 'folder' AND shares.shared_with_user_id IS NOT NULL AND shares.permission IN ('comment', 'edit')
  UNION
  -- Files in folders shared with groups with comment or edit permission (capped)
  SELECT group_members.user_id, files.id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant_folders ON true
  JOIN public.files ON files.folder_id = descendant_folders.id
  WHERE shares.resource_type = 'folder' AND shares.permission IN ('comment', 'edit')
$$);

-- writable_folder_ids: folders user can write to (owns or has edit access)
-- Uses descendant expansion with LIMIT to prevent explosion on huge folders
SELECT auth_rules.claim('writable_folder_ids', $$
  SELECT owner_id AS user_id, id AS folder_id FROM public.folders
  UNION
  SELECT shares.shared_with_user_id AS user_id, descendant.id AS folder_id
  FROM public.shares
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant ON true
  WHERE shares.resource_type = 'folder'
    AND shares.shared_with_user_id IS NOT NULL
    AND shares.permission = 'edit'
$$);

-- writable_parent_ids: same as writable_folder_ids but aliased as parent_id for folders UPDATE rule
SELECT auth_rules.claim('writable_parent_ids', $$
  SELECT owner_id AS user_id, id AS parent_id FROM public.folders
  UNION
  SELECT shares.shared_with_user_id AS user_id, descendant.id AS parent_id
  FROM public.shares
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id FROM public.folders f JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant ON true
  WHERE shares.resource_type = 'folder'
    AND shares.shared_with_user_id IS NOT NULL
    AND shares.permission = 'edit'
$$);

-- accessible_folder_ids: folders user can access (including subfolders of shared folders)
-- Uses descendant expansion with LIMIT to prevent explosion on huge folders
SELECT auth_rules.claim('accessible_folder_ids', $$
  -- Folders user owns
  SELECT owner_id AS user_id, id FROM public.folders
  UNION
  -- Folders directly shared with user + subfolders (capped at 100k to prevent timeout)
  SELECT shared_with_user_id AS user_id, descendant.id
  FROM public.shares
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id, parent_id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id, f.parent_id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant ON true
  WHERE shares.resource_type = 'folder' AND shares.shared_with_user_id IS NOT NULL
  UNION
  -- Folders shared with groups user is in + subfolders (capped)
  SELECT group_members.user_id, descendant.id
  FROM public.shares
  JOIN public.group_members ON group_members.group_id = shares.shared_with_group_id
  JOIN LATERAL (
    WITH RECURSIVE folder_tree AS (
      SELECT id, parent_id FROM public.folders WHERE id = shares.resource_id
      UNION ALL
      SELECT f.id, f.parent_id FROM public.folders f
      JOIN folder_tree ft ON f.parent_id = ft.id
    )
    SELECT id FROM folder_tree LIMIT 100000
  ) descendant ON true
  WHERE shares.resource_type = 'folder'
$$);
