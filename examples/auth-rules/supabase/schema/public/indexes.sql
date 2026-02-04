-- =============================================================================
-- INDEXES
-- =============================================================================

-- For recursive folder traversal
CREATE INDEX folders_parent_id_idx ON public.folders(parent_id);

-- For finding files in folders
CREATE INDEX files_folder_id_idx ON public.files(folder_id);

-- For auth filtering (views filter by owner)
CREATE INDEX folders_owner_id_idx ON public.folders(owner_id);
CREATE INDEX files_owner_id_idx ON public.files(owner_id);
