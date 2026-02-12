-- =============================================================================
-- RECURSIVE FOLDER COUNT
-- =============================================================================
-- Counts descendants using data_api views (which enforce auth_rules).
-- Uses LIMIT to cap expensive queries on huge folders.
-- SECURITY INVOKER = runs as the calling user, respects all permissions.

CREATE OR REPLACE FUNCTION data_api.get_folder_item_count(p_folder_id UUID, p_limit INT DEFAULT 5001)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH RECURSIVE descendant_folders AS (
    SELECT id FROM data_api.folders WHERE parent_id = p_folder_id
    UNION ALL
    SELECT f.id FROM data_api.folders f
    JOIN descendant_folders d ON f.parent_id = d.id
  ),
  limited_folders AS (
    SELECT id FROM descendant_folders LIMIT p_limit
  ),
  direct_files AS (
    SELECT id FROM data_api.files WHERE folder_id = p_folder_id LIMIT p_limit
  ),
  nested_files AS (
    SELECT f.id FROM data_api.files f
    WHERE f.folder_id IN (SELECT id FROM limited_folders)
    LIMIT p_limit
  )
  SELECT
    (SELECT COUNT(*) FROM limited_folders) +
    (SELECT COUNT(*) FROM direct_files) +
    (SELECT COUNT(*) FROM nested_files)
$$;

GRANT EXECUTE ON FUNCTION data_api.get_folder_item_count(UUID, INT) TO authenticated;

-- =============================================================================
-- FULL-TEXT SEARCH
-- =============================================================================
-- Unified search across files, folders, and comments through data_api views.
-- SECURITY INVOKER = runs as the calling user, auth filtering is automatic.
-- Uses inline to_tsvector() through views (no direct public table access needed).

-- =============================================================================
-- FULL-TEXT SEARCH
-- =============================================================================
-- Unified search across files, folders, and comments through data_api views.
-- SECURITY INVOKER = runs as the calling user, auth filtering is automatic.
-- Uses inline to_tsvector() through views (no direct public table access needed).

CREATE OR REPLACE FUNCTION data_api.search(
  p_query TEXT,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  result_type TEXT,
  id UUID,
  name TEXT,
  parent_id UUID,
  snippet TEXT,
  rank REAL,
  file_size BIGINT,
  owner_id UUID
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  -- Files: FTS on content + ILIKE fallback on name
  (
    SELECT 'file'::TEXT, f.id, f.name, f.folder_id,
      CASE WHEN to_tsvector('english', coalesce(f.name, '') || ' ' || coalesce(f.content, '')) @@ plainto_tsquery('english', p_query)
        THEN ts_headline('english', coalesce(f.content, f.name), plainto_tsquery('english', p_query),
          'MaxWords=20, MinWords=10, StartSel=**, StopSel=**')
        ELSE f.name
      END,
      CASE WHEN to_tsvector('english', coalesce(f.name, '') || ' ' || coalesce(f.content, '')) @@ plainto_tsquery('english', p_query)
        THEN ts_rank(to_tsvector('english', coalesce(f.name, '') || ' ' || coalesce(f.content, '')), plainto_tsquery('english', p_query))
        ELSE 0.1
      END::REAL,
      f.size,
      f.owner_id
    FROM data_api.files f
    WHERE to_tsvector('english', coalesce(f.name, '') || ' ' || coalesce(f.content, '')) @@ plainto_tsquery('english', p_query)
      OR f.name ILIKE '%' || p_query || '%'
    ORDER BY 6 DESC
    LIMIT p_limit
  )
  UNION ALL
  -- Folders: case-insensitive name match (already auth-filtered by view)
  (
    SELECT 'folder'::TEXT, fo.id, fo.name, fo.parent_id,
      fo.name,
      CASE WHEN lower(fo.name) = lower(p_query) THEN 1.0
           WHEN lower(fo.name) LIKE lower(p_query) || '%' THEN 0.8
           ELSE 0.5
      END::REAL,
      (SELECT COUNT(*) FROM data_api.folders sub WHERE sub.parent_id = fo.id) +
      (SELECT COUNT(*) FROM data_api.files fi WHERE fi.folder_id = fo.id),
      fo.owner_id
    FROM data_api.folders fo
    WHERE fo.name ILIKE '%' || p_query || '%'
    ORDER BY CASE WHEN lower(fo.name) = lower(p_query) THEN 1.0
                  WHEN lower(fo.name) LIKE lower(p_query) || '%' THEN 0.8
                  ELSE 0.5
             END DESC
    LIMIT p_limit
  )
  UNION ALL
  -- Comments: full-text search on content
  (
    SELECT 'comment'::TEXT, c.id,
      ts_headline('english', c.content, plainto_tsquery('english', p_query),
        'MaxWords=20, MinWords=10, StartSel=**, StopSel=**'),
      c.file_id,
      c.content,
      ts_rank(to_tsvector('english', coalesce(c.content, '')), plainto_tsquery('english', p_query)),
      NULL::BIGINT,
      c.user_id
    FROM data_api.comments c
    WHERE to_tsvector('english', coalesce(c.content, '')) @@ plainto_tsquery('english', p_query)
    ORDER BY ts_rank(to_tsvector('english', coalesce(c.content, '')), plainto_tsquery('english', p_query)) DESC
    LIMIT p_limit
  )
$$;

GRANT EXECUTE ON FUNCTION data_api.search(TEXT, INT) TO authenticated;

-- =============================================================================
-- RESOURCE SHARES (with inherited)
-- =============================================================================
-- Given an array of resource IDs (files or folders), returns all shares
-- including inherited shares from ancestor folders.
-- Walks up the folder tree via parent_id to find the nearest share.
-- SECURITY INVOKER = runs as the calling user, respects auth_rules.

CREATE OR REPLACE FUNCTION data_api.get_resource_shares(p_resource_ids UUID[])
RETURNS TABLE (
  resource_id UUID,
  shared_with_user_id UUID,
  shared_with_email TEXT,
  permission TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH RECURSIVE
  -- Start: map each resource to itself, plus files to their folder_id
  seeds AS (
    -- Direct: check shares on the resource itself
    SELECT unnest(p_resource_ids) AS original_id, unnest(p_resource_ids) AS check_id
    UNION
    -- Files: also check the parent folder
    SELECT f.id, f.folder_id FROM data_api.files f WHERE f.id = ANY(p_resource_ids) AND f.folder_id IS NOT NULL
    UNION
    -- Folders: also check the parent folder
    SELECT fo.id, fo.parent_id FROM data_api.folders fo WHERE fo.id = ANY(p_resource_ids) AND fo.parent_id IS NOT NULL
  ),
  -- Walk up the folder tree
  ancestors AS (
    SELECT original_id, check_id FROM seeds
    UNION ALL
    SELECT a.original_id, fo.parent_id
    FROM ancestors a
    JOIN data_api.folders fo ON fo.id = a.check_id
    WHERE fo.parent_id IS NOT NULL
  ),
  -- Find shares on any ancestor
  found_shares AS (
    SELECT DISTINCT a.original_id, s.shared_with_user_id, s.permission
    FROM ancestors a
    JOIN data_api.shares s ON s.resource_id = a.check_id
    WHERE s.shared_with_user_id IS NOT NULL
  )
  SELECT
    fs.original_id,
    fs.shared_with_user_id,
    u.email,
    fs.permission
  FROM found_shares fs
  LEFT JOIN data_api.users u ON u.id = fs.shared_with_user_id
$$;

GRANT EXECUTE ON FUNCTION data_api.get_resource_shares(UUID[]) TO authenticated;
