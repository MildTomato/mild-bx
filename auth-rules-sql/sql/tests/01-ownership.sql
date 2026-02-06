-- =============================================================================
-- TEST CATEGORY 1: OWNERSHIP
-- =============================================================================
-- Tests that users can see their own files and cannot see others' files

SELECT '====== CATEGORY 1: OWNERSHIP ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 1.1: User can see their own files
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T1.1: Alice can see her own files' AS test;

DO $$
DECLARE
  file_count INT;
BEGIN
  SELECT COUNT(*) INTO file_count
  FROM data_api.files
  WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  IF file_count = 3 THEN
    RAISE NOTICE 'PASS: Alice sees 3 of her own files';
  ELSE
    RAISE NOTICE 'FAIL: Expected 3 files, got %', file_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.2: User cannot see other users' private files
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T1.2: Alice cannot see Bob''s private file' AS test;

DO $$
BEGIN
  -- Bob's private file (not shared)
  PERFORM * FROM data_api.files WHERE id = 'f0000003-0003-0003-0003-000000000003';
  RAISE NOTICE 'FAIL: Alice should not see Bob''s private file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.3: Different user can see their own files
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T1.3: Bob can see his own files' AS test;

DO $$
DECLARE
  file_count INT;
BEGIN
  SELECT COUNT(*) INTO file_count
  FROM data_api.files
  WHERE owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  IF file_count = 2 THEN
    RAISE NOTICE 'PASS: Bob sees 2 of his own files';
  ELSE
    RAISE NOTICE 'FAIL: Expected 2 files, got %', file_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.4: User with no access gets error when trying to access any file
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T1.4: Dave (no files, nothing shared) gets error accessing any file' AS test;

DO $$
BEGIN
  -- Try to access Alice's file
  PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: Dave should not be able to access any files';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 1.5: User with no auth sees nothing
-- -----------------------------------------------------------------------------
SELECT set_user(NULL);
SELECT 'T1.5: No user (NULL auth) cannot access files' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: NULL user should not see any files';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== OWNERSHIP: 5 TESTS COMPLETE ======' AS result;
