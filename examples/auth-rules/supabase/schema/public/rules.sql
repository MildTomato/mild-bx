-- =============================================================================
-- RULES: Define access rules for tables
-- =============================================================================

-- Files: SELECT
SELECT auth_rules.rule('files',
  auth_rules.select('id', 'folder_id', 'owner_id', 'name', 'content', 'size', 'created_at'),
  auth_rules.eq('id', auth_rules.one_of('accessible_file_ids'))
);

-- Files: UPDATE (need edit permission + destination folder must be writable)
SELECT auth_rules.rule('files',
  auth_rules.update(),
  auth_rules.eq('id', auth_rules.one_of('editable_file_ids')),
  auth_rules.eq('folder_id', auth_rules.one_of('writable_folder_ids'))
);

-- Files: DELETE (owner only)
SELECT auth_rules.rule('files',
  auth_rules.delete(),
  auth_rules.eq('id', auth_rules.one_of('deletable_file_ids'))
);

-- Folders: SELECT (accessible folders)
SELECT auth_rules.rule('folders',
  auth_rules.select('id', 'name', 'parent_id', 'owner_id', 'org_id'),
  auth_rules.eq('id', auth_rules.one_of('accessible_folder_ids'))
);

-- Folders: UPDATE (owner only + destination must be writable)
SELECT auth_rules.rule('folders',
  auth_rules.update(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker()),
  auth_rules.eq('parent_id', auth_rules.one_of('writable_parent_ids'))
);

-- Folders: DELETE (owner only)
SELECT auth_rules.rule('folders',
  auth_rules.delete(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker())
);

-- Audit logs: only org admins can see
SELECT auth_rules.rule('audit_logs',
  auth_rules.select('id', 'org_id', 'user_id', 'action', 'resource_type', 'resource_id', 'created_at'),
  auth_rules.eq('org_id', auth_rules.one_of('admin_org_ids'))
);

-- =============================================================================
-- INSERT RULES
-- =============================================================================

-- Files: INSERT (any authenticated user can create files they own)
SELECT auth_rules.rule('files',
  auth_rules.insert(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker())
);

-- Folders: INSERT (any authenticated user can create folders they own)
SELECT auth_rules.rule('folders',
  auth_rules.insert(),
  auth_rules.eq('owner_id', auth_rules.user_id_marker())
);

-- =============================================================================
-- SHARES TABLE
-- =============================================================================

-- Shares: SELECT (can see shares you created or shares with you)
SELECT auth_rules.rule('shares',
  auth_rules.select('id', 'resource_type', 'resource_id', 'shared_with_user_id', 'shared_with_group_id', 'permission', 'created_by'),
  auth_rules.or_(
    auth_rules.eq('created_by', auth_rules.user_id_marker()),
    auth_rules.eq('shared_with_user_id', auth_rules.user_id_marker())
  )
);

-- Shares: INSERT (can share files/folders you own)
SELECT auth_rules.rule('shares',
  auth_rules.insert(),
  auth_rules.eq('created_by', auth_rules.user_id_marker())
);

-- Shares: DELETE (can delete shares you created)
SELECT auth_rules.rule('shares',
  auth_rules.delete(),
  auth_rules.eq('created_by', auth_rules.user_id_marker())
);

-- =============================================================================
-- LINK SHARES TABLE
-- =============================================================================

-- Link shares: SELECT (can see link shares you created)
SELECT auth_rules.rule('link_shares',
  auth_rules.select('id', 'resource_type', 'resource_id', 'token', 'permission', 'expires_at', 'created_by'),
  auth_rules.eq('created_by', auth_rules.user_id_marker())
);

-- Link shares: INSERT (can create link shares for resources you own)
SELECT auth_rules.rule('link_shares',
  auth_rules.insert(),
  auth_rules.eq('created_by', auth_rules.user_id_marker())
);

-- Link shares: DELETE (can delete link shares you created)
SELECT auth_rules.rule('link_shares',
  auth_rules.delete(),
  auth_rules.eq('created_by', auth_rules.user_id_marker())
);

-- =============================================================================
-- COMMENTS TABLE
-- =============================================================================

-- Comments: SELECT (can see comments on files with comment or edit permission)
SELECT auth_rules.rule('comments',
  auth_rules.select('id', 'file_id', 'user_id', 'content', 'created_at'),
  auth_rules.eq('file_id', auth_rules.one_of('commentable_file_ids'))
);

-- Comments: INSERT (can comment on files with comment or edit permission)
SELECT auth_rules.rule('comments',
  auth_rules.insert(),
  auth_rules.and_(
    auth_rules.eq('user_id', auth_rules.user_id_marker()),
    auth_rules.eq('file_id', auth_rules.one_of('commentable_file_ids'))
  )
);

-- Comments: DELETE (can delete your own comments)
SELECT auth_rules.rule('comments',
  auth_rules.delete(),
  auth_rules.eq('user_id', auth_rules.user_id_marker())
);

-- =============================================================================
-- USERS VIEW (for sharing search)
-- =============================================================================

-- Users: SELECT (all authenticated users can search users by email)
SELECT auth_rules.rule('users',
  auth_rules.select('id', 'email')
);
