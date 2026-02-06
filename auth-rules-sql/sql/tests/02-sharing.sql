-- =============================================================================
-- TEST CATEGORY 2: DIRECT SHARING
-- =============================================================================
-- Tests that sharing files with users grants them access

SELECT '====== CATEGORY 2: DIRECT SHARING ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 2.1: User can see file shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T2.1: Bob can see file Alice shared with him' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_name = 'alice-shared.txt' THEN
    RAISE NOTICE 'PASS: Bob can see alice-shared.txt';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-shared.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.2: User cannot see file NOT shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T2.2: Bob cannot see Alice''s private file (not shared)' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: Bob should not see Alice''s private file';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.3: User can read content of file shared with them
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T2.3: Bob can read content of file Alice shared' AS test;

DO $$
DECLARE
  file_content TEXT;
BEGIN
  SELECT content INTO file_content
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_content = 'Alice shared content' THEN
    RAISE NOTICE 'PASS: Bob can read shared file content';
  ELSE
    RAISE NOTICE 'FAIL: Expected "Alice shared content", got %', file_content;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.4: Share is unidirectional - sharer can still see their own file
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T2.4: Alice can still see file she shared with Bob' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000002-0002-0002-0002-000000000002';

  IF file_name = 'alice-shared.txt' THEN
    RAISE NOTICE 'PASS: Alice still sees her shared file';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-shared.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 2.5: Third party cannot see shared file
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T2.5: Dave cannot see file shared between Alice and Bob' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000002-0002-0002-0002-000000000002';
  RAISE NOTICE 'FAIL: Dave should not see file shared between Alice and Bob';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== DIRECT SHARING: 5 TESTS COMPLETE ======' AS result;
