-- =============================================================================
-- TEST CATEGORY 10: UPDATE MOVE (NEW value validation)
-- =============================================================================
-- Tests that UPDATE triggers validate NEW values against claims,
-- preventing users from moving files to folders they don't have access to.

SELECT '====== CATEGORY 10: UPDATE MOVE ======' AS category;

-- Recap of test data:
-- Alice owns folders: d0000001 (Alice Projects), d0000002 (Alice Shared Folder)
-- Bob owns folder: d0000003 (Bob Projects)
-- Alice's movable file: a0000001 in d0000001
-- Bob's movable file: b0000001 in d0000003
-- Bob has view access to d0000002 (Alice Shared Folder)
-- Carol has edit access to d0000003 (Bob Projects)

-- -----------------------------------------------------------------------------
-- Test 10.1: Alice moves her file to her other folder (success)
-- Alice owns both folders, so folder_id validation passes
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T10.1: Alice moves file to her other folder (success)' AS test;

DO $$
BEGIN
  UPDATE data_api.movable_files
  SET folder_id = 'd0000002-0002-0002-0002-000000000002'
  WHERE id = 'a0000001-0001-0001-0001-000000000001';

  IF FOUND THEN
    RAISE NOTICE 'PASS: Alice moved file to her shared folder';
  ELSE
    RAISE NOTICE 'FAIL: update returned not found';
  END IF;
END;
$$;

-- Move it back for subsequent tests
UPDATE public.movable_files
SET folder_id = 'd0000001-0001-0001-0001-000000000001'
WHERE id = 'a0000001-0001-0001-0001-000000000001';

-- -----------------------------------------------------------------------------
-- Test 10.2: Alice tries to move her file to Bob's folder (fail)
-- Alice doesn't have access to Bob's folder (d0000003)
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T10.2: Alice moves file to Bob''s folder (fail)' AS test;

DO $$
BEGIN
  UPDATE data_api.movable_files
  SET folder_id = 'd0000003-0003-0003-0003-000000000003'
  WHERE id = 'a0000001-0001-0001-0001-000000000001';

  RAISE NOTICE 'FAIL: should not be able to move to unauthorized folder';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 10.3: Bob tries to move Alice's file (fail - not owner)
-- Bob doesn't own the file, so owner_id validation fails
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T10.3: Bob tries to move Alice''s file (fail - not owner)' AS test;

DO $$
BEGIN
  UPDATE data_api.movable_files
  SET folder_id = 'd0000003-0003-0003-0003-000000000003'
  WHERE id = 'a0000001-0001-0001-0001-000000000001';

  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: not found (Bob cannot see Alice''s file)';
  ELSE
    RAISE NOTICE 'FAIL: Bob should not be able to update Alice''s file';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 10.4: Eve tries to move a file to any folder (fail - no access)
-- Eve has no folder access at all
-- -----------------------------------------------------------------------------
SELECT set_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
SELECT 'T10.4: Eve tries to move a file (fail - no access)' AS test;

DO $$
BEGIN
  UPDATE data_api.movable_files
  SET folder_id = 'd0000001-0001-0001-0001-000000000001'
  WHERE id = 'a0000001-0001-0001-0001-000000000001';

  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: not found (Eve has no access)';
  ELSE
    RAISE NOTICE 'FAIL: Eve should not see any movable files';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 10.5: Alice moves file to NULL folder (fail - NULL not in claim)
-- folder_id = NULL means no folder, which won't be in accessible_folder_ids
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T10.5: Alice moves file to NULL folder (fail)' AS test;

DO $$
BEGIN
  UPDATE data_api.movable_files
  SET folder_id = NULL
  WHERE id = 'a0000001-0001-0001-0001-000000000001';

  RAISE NOTICE 'FAIL: should not be able to move to NULL folder';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== UPDATE MOVE: 5 TESTS COMPLETE ======' AS result;
