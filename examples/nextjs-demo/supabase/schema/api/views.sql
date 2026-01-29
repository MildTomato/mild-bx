-- API Views - Read-only projections for the frontend
-- Published posts with author info (public feed)
CREATE
OR REPLACE VIEW api.posts_feed AS
SELECT
    p.id,
    p.title,
    p.slug,
    p.excerpt,
    p.published_at,
    p.created_at,
    pr.username AS author_username,
    pr.full_name AS author_name,
    pr.avatar_url AS author_avatar,
    (
        SELECT
            COUNT(*)
        FROM
            public.comments c
        WHERE
            c.post_id = p.id
    ) AS comment_count,
    (
        SELECT
            ARRAY_AGG(t.name)
        FROM
            public.tags t
            JOIN public.post_tags pt ON pt.tag_id = t.id
        WHERE
            pt.post_id = p.id
    ) AS tags
FROM
    public.posts p
    JOIN public.profiles pr ON pr.id = p.user_id
WHERE
    p.status = 'published'
ORDER BY
    p.published_at DESC;

-- User profile cards (public info only)
CREATE
OR REPLACE VIEW api.authors AS
SELECT
    pr.id,
    pr.username,
    pr.full_name,
    pr.avatar_url,
    pr.bio,
    pr.website,
    pr.twitter_handle,
    (
        SELECT
            COUNT(*)
        FROM
            public.posts p
        WHERE
            p.user_id = pr.id
            AND p.status = 'published'
    ) AS post_count
FROM
    public.profiles pr
WHERE
    pr.username IS NOT NULL;

-- Comments with author info (for post detail pages)
CREATE
OR REPLACE VIEW api.comments_with_author AS
SELECT
    c.id,
    c.post_id,
    c.parent_id,
    c.content,
    c.created_at,
    pr.username AS author_username,
    pr.full_name AS author_name,
    pr.avatar_url AS author_avatar
FROM
    public.comments c
    JOIN public.profiles pr ON pr.id = c.user_id
ORDER BY
    c.created_at ASC;

-- Tag cloud with post counts
CREATE
OR REPLACE VIEW api.tag_cloud AS
SELECT
    t.id,
    t.name,
    t.slug,
    COUNT(pt.post_id) AS post_count
FROM
    public.tags t
    LEFT JOIN public.post_tags pt ON pt.tag_id = t.id
    LEFT JOIN public.posts p ON p.id = pt.post_id
    AND p.status = 'published'
GROUP BY
    t.id,
    t.name,
    t.slug
HAVING
    COUNT(pt.post_id) > 0
ORDER BY
    post_count DESC;