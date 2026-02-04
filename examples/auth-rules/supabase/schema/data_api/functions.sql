-- =============================================================================
-- RECURSIVE FOLDER COUNT
-- =============================================================================
-- Counts descendants using data_api views (which enforce auth_rules).
-- Uses LIMIT to cap expensive queries on huge folders.
-- SECURITY INVOKER = runs as the calling user, respects all permissions.

CREATE OR REPLACE FUNCTION data_api.get_folder_item_count(p_folder_id UUID, p_limit INT DEFAULT 10000001)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH RECURSIVE descendant_folders AS (
    -- Direct child folders
    SELECT id FROM data_api.folders WHERE parent_id = p_folder_id
    UNION ALL
    -- Nested folders
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
