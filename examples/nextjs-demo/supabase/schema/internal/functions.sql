-- Internal functions for admin/backend operations
-- Soft delete a user and all their content
CREATE
OR REPLACE FUNCTION internal.soft_delete_user(target_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $ $ BEGIN -- Mark user as deleted
UPDATE
    public.users
SET
    deleted_at = now()
WHERE
    id = target_user_id;

-- Unpublish all their posts
UPDATE
    public.posts
SET
    status = 'draft'
WHERE
    user_id = target_user_id;

-- Anonymize profile
UPDATE
    public.profiles
SET
    username = 'deleted_' || target_user_id :: text,
    full_name = 'Deleted User',
    bio = NULL,
    avatar_url = NULL,
    website = NULL,
    twitter_handle = NULL
WHERE
    id = target_user_id;

END;

$ $;

-- Bulk publish scheduled posts
CREATE
OR REPLACE FUNCTION internal.publish_scheduled_posts() RETURNS TABLE (
    post_id uuid,
    title text,
    published boolean
) LANGUAGE plpgsql SECURITY DEFINER AS $ $ DECLARE rec RECORD;

BEGIN FOR rec IN
SELECT
    id,
    p.title
FROM
    public.posts p
WHERE
    p.status = 'draft'
    AND p.published_at IS NOT NULL
    AND p.published_at <= now() LOOP
UPDATE
    public.posts
SET
    status = 'published'
WHERE
    id = rec.id;

post_id := rec.id;

title := rec.title;

published := true;

RETURN NEXT;

END LOOP;

END;

$ $;

-- Get system stats for admin dashboard
CREATE
OR REPLACE FUNCTION internal.get_system_stats() RETURNS TABLE (
    total_users bigint,
    total_posts bigint,
    published_posts bigint,
    total_comments bigint,
    active_users_24h bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $ $
SELECT
    (
        SELECT
            COUNT(*)
        FROM
            public.profiles
    ),
    (
        SELECT
            COUNT(*)
        FROM
            public.posts
    ),
    (
        SELECT
            COUNT(*)
        FROM
            public.posts
        WHERE
            status = 'published'
    ),
    (
        SELECT
            COUNT(*)
        FROM
            public.comments
    ),
    (
        SELECT
            COUNT(DISTINCT user_id)
        FROM
            public.posts
        WHERE
            created_at > now() - interval '24 hours'
    );

$ $;

-- Cleanup orphaned tags (tags with no posts)
CREATE
OR REPLACE FUNCTION internal.cleanup_orphaned_tags() RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $ $ DECLARE deleted_count int;

BEGIN WITH deleted AS (
    DELETE FROM
        public.tags t
    WHERE
        NOT EXISTS (
            SELECT
                1
            FROM
                public.post_tags pt
            WHERE
                pt.tag_id = t.id
        ) RETURNING id
)
SELECT
    COUNT(*) INTO deleted_count
FROM
    deleted;

RETURN deleted_count;

END;

$ $;