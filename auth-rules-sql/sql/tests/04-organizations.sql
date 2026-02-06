-- =============================================================================
-- TEST CATEGORY 4: ORGANIZATIONS
-- =============================================================================
-- Tests organization membership and admin access

SELECT '====== CATEGORY 4: ORGANIZATIONS ======' AS category;

-- -----------------------------------------------------------------------------
-- Test 4.1: Org admin can see audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T4.1: Alice (admin of Org One) can see Org One audit logs' AS test;

DO $$
DECLARE
  log_count INT;
BEGIN
  SELECT COUNT(*) INTO log_count
  FROM data_api.audit_logs
  WHERE org_id = '11111111-1111-1111-1111-111111111111';

  IF log_count = 1 THEN
    RAISE NOTICE 'PASS: Alice sees 1 audit log for Org One';
  ELSE
    RAISE NOTICE 'FAIL: Expected 1 audit log, got %', log_count;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.2: Org member (non-admin) cannot see audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SELECT 'T4.2: Bob (member, not admin) cannot see Org One audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.audit_logs WHERE org_id = '11111111-1111-1111-1111-111111111111';
  RAISE NOTICE 'FAIL: Bob should not see audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.3: Admin of one org cannot see other org's audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT 'T4.3: Alice (admin of Org One) cannot see Org Two audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.audit_logs WHERE org_id = '22222222-2222-2222-2222-222222222222';
  RAISE NOTICE 'FAIL: Alice should not see Org Two audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.4: Admin of multiple orgs can see logs in both
-- -----------------------------------------------------------------------------
SELECT set_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
SELECT 'T4.4: Carol (admin of Org Two) can see Org Two audit logs' AS test;

DO $$
DECLARE
  log_action TEXT;
BEGIN
  SELECT action INTO log_action
  FROM data_api.audit_logs
  WHERE org_id = '22222222-2222-2222-2222-222222222222';

  IF log_action = 'member.added' THEN
    RAISE NOTICE 'PASS: Carol sees Org Two audit log';
  ELSE
    RAISE NOTICE 'FAIL: Expected member.added, got %', log_action;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.5: User with no orgs cannot see any audit logs
-- -----------------------------------------------------------------------------
SELECT set_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
SELECT 'T4.5: Eve (no orgs) cannot see any audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.audit_logs WHERE org_id = '11111111-1111-1111-1111-111111111111';
  RAISE NOTICE 'FAIL: Eve should not see any audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Test 4.6: Non-admin member cannot see audit logs even for their own org
-- -----------------------------------------------------------------------------
SELECT set_user('dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT 'T4.6: Dave (member of Org One, not admin) cannot see audit logs' AS test;

DO $$
BEGIN
  PERFORM * FROM data_api.audit_logs WHERE org_id = '11111111-1111-1111-1111-111111111111';
  RAISE NOTICE 'FAIL: Dave should not see audit logs';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS: %', SQLERRM;
END;
$$;

SELECT '====== ORGANIZATIONS: 6 TESTS COMPLETE ======' AS result;
