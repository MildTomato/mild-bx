-- =============================================================================
-- SEED: Create 10,000 files and folders for new users
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := NEW.id;
  v_folder_id UUID;
  v_subfolder_id UUID;
  v_root_folders TEXT[] := ARRAY['Documents', 'Projects', 'Photos', 'Downloads', 'Archive', 'Work', 'Personal', 'Shared', 'Backups', 'Media'];
  v_subfolders TEXT[] := ARRAY['2024', '2023', '2022', 'Important', 'Draft', 'Final', 'Review', 'Archive', 'New', 'Old'];
  v_file_types TEXT[] := ARRAY['.pdf', '.docx', '.xlsx', '.md', '.txt', '.jpg', '.png', '.zip', '.json', '.csv'];
  v_prefixes TEXT[] := ARRAY['Report', 'Document', 'File', 'Data', 'Notes', 'Meeting', 'Project', 'Draft', 'Final', 'Backup'];
  i INTEGER;
  j INTEGER;
  k INTEGER;
  v_folder_ids UUID[];
  v_all_folder_ids UUID[];
  v_file_count INTEGER := 0;
  v_target_files INTEGER := 10000;
  v_size BIGINT;
BEGIN
  -- =========================================================================
  -- CREATE ROOT FOLDERS (10)
  -- =========================================================================
  FOR i IN 1..array_length(v_root_folders, 1) LOOP
    INSERT INTO public.folders (owner_id, name) 
    VALUES (v_user_id, v_root_folders[i]) 
    RETURNING id INTO v_folder_id;
    v_folder_ids := array_append(v_folder_ids, v_folder_id);
    v_all_folder_ids := array_append(v_all_folder_ids, v_folder_id);
  END LOOP;

  -- =========================================================================
  -- CREATE SUBFOLDERS (10 per root = 100 subfolders)
  -- =========================================================================
  FOREACH v_folder_id IN ARRAY v_folder_ids LOOP
    FOR i IN 1..array_length(v_subfolders, 1) LOOP
      INSERT INTO public.folders (owner_id, parent_id, name) 
      VALUES (v_user_id, v_folder_id, v_subfolders[i]) 
      RETURNING id INTO v_subfolder_id;
      v_all_folder_ids := array_append(v_all_folder_ids, v_subfolder_id);
    END LOOP;
  END LOOP;

  -- =========================================================================
  -- CREATE NESTED SUBFOLDERS (5 per subfolder = 500 more folders)
  -- =========================================================================
  FOR i IN 11..110 LOOP  -- subfolders start at index 11
    FOR j IN 1..5 LOOP
      INSERT INTO public.folders (owner_id, parent_id, name) 
      VALUES (v_user_id, v_all_folder_ids[i], 'Folder ' || j) 
      RETURNING id INTO v_subfolder_id;
      v_all_folder_ids := array_append(v_all_folder_ids, v_subfolder_id);
    END LOOP;
  END LOOP;

  -- =========================================================================
  -- CREATE 10,000 FILES distributed across folders
  -- =========================================================================
  WHILE v_file_count < v_target_files LOOP
    -- Pick a random folder
    v_folder_id := v_all_folder_ids[1 + floor(random() * array_length(v_all_folder_ids, 1))::int];
    
    -- Generate random size: 70% small (1KB-1MB), 20% medium (1-10MB), 10% large (10-100MB)
    IF random() < 0.7 THEN
      v_size := floor(random() * 1048576) + 1024;  -- 1KB - 1MB
    ELSIF random() < 0.9 THEN
      v_size := floor(random() * 9437184) + 1048576;  -- 1MB - 10MB
    ELSE
      v_size := floor(random() * 94371840) + 10485760;  -- 10MB - 100MB
    END IF;

    -- Insert file with random name
    INSERT INTO public.files (owner_id, folder_id, name, size) 
    VALUES (
      v_user_id, 
      v_folder_id, 
      v_prefixes[1 + floor(random() * array_length(v_prefixes, 1))::int] || '_' || 
        to_char(v_file_count, 'FM00000') || 
        v_file_types[1 + floor(random() * array_length(v_file_types, 1))::int],
      v_size
    );
    
    v_file_count := v_file_count + 1;
  END LOOP;

  -- =========================================================================
  -- ADD SOME ROOT FILES (no folder)
  -- =========================================================================
  INSERT INTO public.files (owner_id, folder_id, name, size) VALUES
    (v_user_id, NULL, 'Quick Notes.md', 1024),
    (v_user_id, NULL, 'TODO.md', 512),
    (v_user_id, NULL, 'Ideas.md', 2048),
    (v_user_id, NULL, 'Bookmarks.md', 1536),
    (v_user_id, NULL, 'scratch.txt', 256);

  RETURN NEW;
END;
$$;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_new_user();
