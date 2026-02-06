-- =============================================================================
-- TEST CATEGORY 6: PERMISSION LEVELS
-- =============================================================================
-- Tests that view/edit/delete permissions work correctly

SELECT '====== CATEGORY 6: PERMISSION LEVELS ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 6.1: Owner can update their own file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T6.1: Owner (Alice) can update her file' AS test;

DO $$
BEGIN
  UPDATE data_api.files SET name = 'alice-renamed.txt' WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'PASS: Alice updated her file';
  -- Revert
  UPDATE data_api.files SET name = 'alice-private.txt' WHERE id = 'f0000001-0001-0001-0001-000000000001';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.2: User with view permission cannot update
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.2: Bob (view only on alice-shared.txt) cannot update' AS test;

DO $$
BEGIN
  -- Bob has view permission on alice-shared.txt, not edit
  UPDATE data_api.files SET name = 'hacked.txt' WHERE id = 'f0000002-0002-0002-0002-000000000002';
  RAISE NOTICE 'FAIL: Bob should not be able to update with view permission';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.3: User with edit permission (via group) can update
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.3: Bob (edit via Engineering group) can update Carol''s file' AS test;

DO $$
BEGIN
  -- Carol shared her file with Engineering group with edit permission
  UPDATE data_api.files SET name = 'carol-updated.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
  RAISE NOTICE 'PASS: Bob updated file via group edit permission';
  -- Revert
  UPDATE data_api.files SET name = 'carol-private.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.4: Owner can delete their own file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T6.4: Owner (Alice) can delete her file' AS test;

DO $$
BEGIN
  -- Create a temp file to delete
  INSERT INTO data_api.files (id, owner_id, name, content)
  VALUES ('f9999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'temp.txt', 'temp');

  DELETE FROM data_api.files WHERE id = 'f9999999-9999-9999-9999-999999999999';
  RAISE NOTICE 'PASS: Alice deleted her file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.5: Non-owner cannot delete file (even with edit permission)
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.5: Bob cannot delete Carol''s file (even with edit permission)' AS test;

DO $$
BEGIN
  DELETE FROM data_api.files WHERE id = 'f0000004-0004-0004-0004-000000000004';
  RAISE NOTICE 'FAIL: Bob should not be able to delete Carol''s file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.6: Link with edit permission can update
-- -----------------------------------------------------------------------------
SELECT set_link_token('valid-link-future');
SELECT 'T6.6: Link with edit permission can update' AS test;

DO $$
BEGIN
  UPDATE data_api.files SET name = 'carol-via-link.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
  RAISE NOTICE 'PASS: Edit link updated file';
  -- Revert
  UPDATE data_api.files SET name = 'carol-private.txt' WHERE id = 'f0000004-0004-0004-0004-000000000004';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.7: Link with view permission cannot update
-- -----------------------------------------------------------------------------
SELECT set_link_token('public-link-abc123');
SELECT 'T6.7: Link with view permission cannot update' AS test;

DO $$
BEGIN
  UPDATE data_api.files SET name = 'hacked-via-link.txt' WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: View-only link should not be able to update';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.8: User with folder edit permission can edit files inside
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T6.8: Carol (folder edit on Bob Projects) can edit file inside' AS test;

DO $$
BEGIN
  -- Carol has edit permission on Bob's folder, should be able to edit file inside
  UPDATE data_api.files SET name = 'carol-edited-bob-file.txt' WHERE id = 'f0000006-0006-0006-0006-000000000006';
  RAISE NOTICE 'PASS: Carol edited file via folder edit permission';
  -- Revert
  UPDATE data_api.files SET name = 'bob-in-folder.txt' WHERE id = 'f0000006-0006-0006-0006-000000000006';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAIL: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 6.9: User with folder view permission cannot edit files inside
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T6.9: Bob (folder view on Alice Shared Folder) cannot edit file inside' AS test;

DO $$
BEGIN
  -- Bob has view permission on Alice's shared folder, should NOT be able to edit
  UPDATE data_api.files SET name = 'bob-hacked.txt' WHERE id = 'f0000005-0005-0005-0005-000000000005';
  RAISE NOTICE 'FAIL: Bob should not edit file in view-only folder';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== PERMISSION LEVELS: 9 TESTS COMPLETE ======' AS result;
