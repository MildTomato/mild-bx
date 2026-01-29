-- Grants for API schema objects
-- Views are readable by everyone
GRANT
SELECT
    ON api.posts_feed TO anon,
    authenticated,
    service_role;

GRANT
SELECT
    ON api.authors TO anon,
    authenticated,
    service_role;

GRANT
SELECT
    ON api.comments_with_author TO anon,
    authenticated,
    service_role;

GRANT
SELECT
    ON api.tag_cloud TO anon,
    authenticated,
    service_role;

-- Functions are callable by everyone
GRANT EXECUTE ON FUNCTION api.get_post_by_slug(text) TO anon,
authenticated,
service_role;

GRANT EXECUTE ON FUNCTION api.search_posts(text, int) TO anon,
authenticated,
service_role;

GRANT EXECUTE ON FUNCTION api.get_posts_by_tag(text) TO anon,
authenticated,
service_role;