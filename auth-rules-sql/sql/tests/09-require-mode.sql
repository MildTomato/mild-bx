-- =============================================================================
-- TEST CATEGORY 9: REQUIRE MODE (select_strict)
-- =============================================================================
-- Tests that select_strict() rules raise explicit errors on unauthorized access
-- instead of silently filtering rows.

SELECT '====== CATEGORY 9: REQUIRE MODE ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 9.1: Owner can see their own strict_file (require_user positive)
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T9.1: Alice can see her own strict file' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.strict_files
  WHERE id = '5f000001-0001-0001-0001-000000000001';

  IF file_name = 'alice-strict.txt' THEN
    RAISE NOTICE 'PASS: Alice sees her strict file';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-strict.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.2: Non-owner gets error on strict_file (require_user negative)
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T9.2: Bob gets error accessing Alice''s strict file' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.strict_files WHERE id = '5f000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: Bob should get an error accessing Alice''s strict file';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: error raised - %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.3: Org member can see strict_doc (require claim positive)
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T9.3: Alice (Org One member) can see Org One strict doc' AS test;

DO $$
DECLARE
  doc_title TEXT;
BEGIN
  SELECT title INTO doc_title
  FROM data_api.strict_docs
  WHERE id = '5d000001-0001-0001-0001-000000000001';

  IF doc_title = 'Org One Doc' THEN
    RAISE NOTICE 'PASS: Alice sees Org One strict doc';
  ELSE
    RAISE NOTICE 'FAIL: Expected Org One Doc, got %', doc_title;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.4: Non-member gets error on strict_doc (require claim negative)
-- -----------------------------------------------------------------------------
SELECT set_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
SELECT 'T9.4: Eve (no orgs) gets error accessing Org One strict doc' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.strict_docs WHERE id = '5d000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: Eve should get an error accessing Org One strict doc';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: error raised - %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.5: Member of wrong org gets error (require claim negative)
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T9.5: Alice (not in Org Two) gets error accessing Org Two strict doc' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.strict_docs WHERE id = '5d000002-0002-0002-0002-000000000002';
  RAISE NOTICE 'FAIL: Alice should get an error accessing Org Two strict doc';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: error raised - %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.6: Bob can see his own strict_file (require_user positive)
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T9.6: Bob can see his own strict file' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.strict_files
  WHERE id = '5f000002-0002-0002-0002-000000000002';

  IF file_name = 'bob-strict.txt' THEN
    RAISE NOTICE 'PASS: Bob sees his strict file';
  ELSE
    RAISE NOTICE 'FAIL: Expected bob-strict.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.7: Carol (in both orgs) can see strict_doc from Org Two
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T9.7: Carol (in Org One and Org Two) can see Org Two strict doc' AS test;

DO $$
DECLARE
  doc_title TEXT;
BEGIN
  SELECT title INTO doc_title
  FROM data_api.strict_docs
  WHERE id = '5d000002-0002-0002-0002-000000000002';

  IF doc_title = 'Org Two Doc' THEN
    RAISE NOTICE 'PASS: Carol sees Org Two strict doc';
  ELSE
    RAISE NOTICE 'FAIL: Expected Org Two Doc, got %', doc_title;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 9.8: NULL user gets error on strict_file (require_user negative)
-- -----------------------------------------------------------------------------
SELECT set_user(NULL);
SELECT 'T9.8: NULL user gets error on strict file' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.strict_files WHERE id = '5f000001-0001-0001-0001-000000000001';
  RAISE NOTICE 'FAIL: NULL user should get an error';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: error raised - %', SQLERRM;
END;
$$;

SELECT '====== REQUIRE MODE: 8 TESTS COMPLETE ======' AS result;
