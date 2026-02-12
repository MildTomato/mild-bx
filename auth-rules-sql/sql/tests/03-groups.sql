-- =============================================================================
-- TEST CATEGORY 3: GROUP SHARING
-- =============================================================================
-- Tests that sharing with groups grants access to all group members

SELECT '====== CATEGORY 3: GROUP SHARING ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 3.1: Group member can see file shared with their group
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T3.1: Bob (in Engineering) can see file shared with Engineering' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Carol shared carol-private.txt with Engineering group
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Bob sees file shared with Engineering group';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 3.2: Another group member can also see group-shared file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T3.2: Alice (also in Engineering) can see file shared with Engineering' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Alice sees file shared with Engineering group';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 3.3: Non-group member cannot see group-shared file
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T3.3: Dave (not in Engineering) cannot see file shared with Engineering' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000004-0004-0004-0004-000000000004';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Dave should not see file shared with Engineering';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 3.4: User in different group cannot see file shared with other group
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T3.4: Carol (in Marketing, not Engineering) still sees her own file' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Carol owns this file, so she should see it regardless of group shares
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Carol sees her own file (owner access)';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

SELECT '====== GROUP SHARING: 4 TESTS COMPLETE ======' AS result;
