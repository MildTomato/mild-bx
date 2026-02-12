-- =============================================================================
-- TEST CATEGORY 5: LINK SHARING
-- =============================================================================
-- Tests that link tokens grant access to files

SELECT '====== CATEGORY 5: LINK SHARING ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 5.1: Valid link token grants access (anonymous)
-- -----------------------------------------------------------------------------
SELECT set_link_token('public-link-abc123');
SELECT 'T5.1: Anonymous user with valid link can see file' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000001-0001-0001-0001-000000000001';

  IF file_name = 'alice-private.txt' THEN
    RAISE NOTICE 'PASS: Anonymous user sees file via link token';
  ELSE
    RAISE NOTICE 'FAIL: Expected alice-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.2: Invalid link token denies access
-- -----------------------------------------------------------------------------
SELECT set_link_token('invalid-token-wrong');
SELECT 'T5.2: Invalid link token denies access' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Invalid token should not grant access';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.3: Expired link token denies access
-- -----------------------------------------------------------------------------
SELECT set_link_token('expired-link-xyz789');
SELECT 'T5.3: Expired link token denies access' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000003-0003-0003-0003-000000000003';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Expired token should not grant access';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.4: Future expiry link token grants access
-- -----------------------------------------------------------------------------
SELECT set_link_token('valid-link-future');
SELECT 'T5.4: Link with future expiry grants access' AS test;

DO $$
DECLARE
  file_name TEXT;
BEGIN
  SELECT name INTO file_name
  FROM data_api.files
  WHERE id = 'f0000004-0004-0004-0004-000000000004';

  IF file_name = 'carol-private.txt' THEN
    RAISE NOTICE 'PASS: Future expiry link grants access';
  ELSE
    RAISE NOTICE 'FAIL: Expected carol-private.txt, got %', file_name;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.5: Link token only grants access to that specific file
-- -----------------------------------------------------------------------------
SELECT set_link_token('public-link-abc123');
SELECT 'T5.5: Link token only grants access to specific file' AS test;

DO $$
BEGIN
  -- This link is for alice-private.txt, not bob-private.txt
  PERFORM * FROM data_api.files WHERE id = 'f0000003-0003-0003-0003-000000000003';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Link should only grant access to its specific file';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 5.6: No token and no user denies all access
-- -----------------------------------------------------------------------------
SELECT set_link_token(NULL);
SELECT set_user(NULL);
SELECT 'T5.6: No token and no user denies access' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.files WHERE id = 'f0000001-0001-0001-0001-000000000001';
  IF NOT FOUND THEN
    RAISE NOTICE 'PASS: no access (filtered)';
  ELSE
    RAISE NOTICE 'FAIL: Should deny access without token or user';
  END IF;
END;
$$;

SELECT '====== LINK SHARING: 6 TESTS COMPLETE ======' AS result;
