-- =============================================================================
-- TEST CATEGORY 7: FOLDER HIERARCHY
-- =============================================================================
-- Tests that folder sharing grants access to files inside

SELECT '====== CATEGORY 7: FOLDER HIERARCHY ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 7.1: User can see their own folder
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T7.1: Alice can see her own folders' AS test;

DO $$
DECLARE
  folder_count INT;
BEGIN
  SELECT COUNT(*) INTO folder_count
  FROM data_api.folders
  WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF folder_count = 2 THEN
    RAISE NOTICE 'PASS: Alice sees 2 of her folders';
  ELSE
    RAISE NOTICE 'FAIL: Expected 2 folders, got %', folder_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.2: User cannot see other user's private folder
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T7.2: Bob cannot see Alice''s private folder' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.folders WHERE id = 'd0000001-0001-0001-0001-000000000001';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Bob should not see Alice''s private folder';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.3: User CAN see folder shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T7.3: Bob CAN see folder Alice shared with him' AS test;

DO $$
DECLARE
  folder_name TEXT;
BEGIN
  SELECT name INTO folder_name
  FROM data_api.folders
  WHERE id = 'd0000002-0002-0002-0002-000000000002';

  IF folder_name = 'Alice Shared Folder' THEN
    RAISE NOTICE 'PASS: Bob sees shared folder';
  ELSE
    RAISE NOTICE 'FAIL: Expected Alice Shared Folder, got %', folder_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.4: User can see FILE inside shared folder (folder inheritance)
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T7.4: Bob can see file inside shared folder (inheritance)' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000005-0005-0005-0005-000000000005';

  IF file_name = 'file-in-shared-folder.txt' THEN
    RAISE NOTICE 'PASS: Bob sees file inside shared folder';
  ELSE
    RAISE NOTICE 'FAIL: Expected file-in-shared-folder.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.5: User without folder access cannot see file inside
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T7.5: Dave cannot see file inside folder not shared with him' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000005-0005-0005-0005-000000000005';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Dave should not see file in unshared folder';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 7.6: Owner of folder can see files inside (even if not file owner)
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T7.6: Alice (folder owner) can see all files in her folder' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000005-0005-0005-0005-000000000005';

  IF file_name = 'file-in-shared-folder.txt' THEN
    RAISE NOTICE 'PASS: Alice sees file in her folder';
  ELSE
    RAISE NOTICE 'FAIL: Expected file-in-shared-folder.txt, got %', file_name;
  END IF;
END;
$$;

SELECT '====== FOLDER HIERARCHY: 6 TESTS COMPLETE ======' AS result;
