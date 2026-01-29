-- Grants for internal schema - service_role only
GRANT EXECUTE ON FUNCTION internal.soft_delete_user(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION internal.publish_scheduled_posts() TO service_role;

GRANT EXECUTE ON FUNCTION internal.get_system_stats() TO service_role;

GRANT EXECUTE ON FUNCTION internal.cleanup_orphaned_tags() TO service_role;