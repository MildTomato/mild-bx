-- =============================================================================
-- TEST CATEGORY 8: EDGE CASES
-- =============================================================================
-- Tests unusual scenarios and boundary conditions

SELECT '====== CATEGORY 8: EDGE CASES ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 8.1: User in multiple orgs can see logs from each (admin in both)
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T8.1: Carol (admin in Org Two, member in Org One) sees Org Two logs only' AS test;

DO $$
DECLARE
  log_count INT;
BEGIN
  -- Carol is admin in Org Two, should see those logs
  SELECT COUNT(*) INTO log_count
  FROM data_api.audit_logs
  WHERE org_id = '22222222-2222-2222-2222-222222222222';

  IF log_count = 1 THEN
    RAISE NOTICE 'PASS: Carol sees Org Two audit logs';
  ELSE
    RAISE NOTICE 'FAIL: Expected 1 log, got %', log_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.2: File accessible via multiple paths (owned, but also shared with Engineering)
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T8.2: Carol can see her file (owns it, also shared with Engineering)' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Carol owns this file AND it's shared with Engineering (which she's not in)
  -- But she should still see it because she owns it
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Carol sees her file via ownership';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.3: User with both direct share AND group share sees file once
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T8.3: Alice sees file shared with Engineering (she is in Engineering)' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Alice sees Carol''s file via Engineering group';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.4: Switching users clears previous access
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- Alice can see her file
SELECT 'T8.4: Switching users clears access' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- First verify Alice can see her file
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000001-0001-0001-0001-000000000001';

  IF file_name != 'alice-private.txt' THEN
    RAISE NOTICE 'FAIL: Alice should see her file first';
    RETURN;
  END IF;

  -- Now switch to Eve
  PERFORM set_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

  -- Eve should NOT see Alice's file
  BEGIN
    PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
    RAISE NOTICE 'FAIL: Eve should not see Alice''s file after user switch';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: User switch cleared access';
  END;
END;
$$;

-- Reset user for subsequent tests
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- -----------------------------------------------------------------------------
-- Test 8.5: Empty string user_id is treated as no access
-- -----------------------------------------------------------------------------
SELECT 'T8.5: Empty string user ID treated as no access' AS test;

DO $$
BEGIN
  PERFORM set_config('app.user_id', '', false);
  PERFORM set_config('app.link_token', '', false);

  PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: Empty user_id should not have access';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 8.6: User can access file via folder share AND direct share
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T8.6: Bob has multiple access paths to alice-shared.txt' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  -- Bob has direct share access to alice-shared.txt
  -- He should be able to access it
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_name = 'alice-shared.txt' THEN
    RAISE NOTICE 'PASS: Bob accesses file via direct share';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-shared.txt, got %', file_name;
  END IF;
END;
$$;

SELECT '====== EDGE CASES: 6 TESTS COMPLETE ======' AS result;
