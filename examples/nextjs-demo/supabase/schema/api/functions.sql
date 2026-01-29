-- API Functions - RPC endpoints for complex operations
-- Get post by slug with full details
CREATE
OR REPLACE FUNCTION api.get_post_by_slug(post_slug text) RETURNS TABLE (
    id uuid,
    title text,
    slug text,
    content text,
    excerpt text,
    published_at timestamptz,
    created_at timestamptz,
    author_username text,
    author_name text,
    author_avatar text,
    author_bio text,
    tags text [],
    comment_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $ $
SELECT
    p.id,
    p.title,
    p.slug,
    p.content,
    p.excerpt,
    p.published_at,
    p.created_at,
    pr.username,
    pr.full_name,
    pr.avatar_url,
    pr.bio,
    (
        SELECT
            ARRAY_AGG(t.name)
        FROM
            public.tags t
            JOIN public.post_tags pt ON pt.tag_id = t.id
        WHERE
            pt.post_id = p.id
    ),
    (
        SELECT
            COUNT(*)
        FROM
            public.comments c
        WHERE
            c.post_id = p.id
    )
FROM
    public.posts p
    JOIN public.profiles pr ON pr.id = p.user_id
WHERE
    p.slug = post_slug
    AND p.status = 'published';

$ $;

-- Search posts by title or content
CREATE
OR REPLACE FUNCTION api.search_posts(query text, max_results int DEFAULT 10) RETURNS TABLE (
    id uuid,
    title text,
    slug text,
    excerpt text,
    published_at timestamptz,
    author_username text,
    relevance real
) LANGUAGE sql STABLE SECURITY DEFINER AS $ $
SELECT
    p.id,
    p.title,
    p.slug,
    p.excerpt,
    p.published_at,
    pr.username,
    ts_rank(
        to_tsvector(
            'english',
            COALESCE(p.title, '') || ' ' || COALESCE(p.content, '')
        ),
        plainto_tsquery('english', query)
    ) AS relevance
FROM
    public.posts p
    JOIN public.profiles pr ON pr.id = p.user_id
WHERE
    p.status = 'published'
    AND to_tsvector(
        'english',
        COALESCE(p.title, '') || ' ' || COALESCE(p.content, '')
    ) @ @ plainto_tsquery('english', query)
ORDER BY
    relevance DESC
LIMIT
    max_results;

$ $;

-- Get posts by tag
CREATE
OR REPLACE FUNCTION api.get_posts_by_tag(tag_slug text) RETURNS TABLE (
    id uuid,
    title text,
    slug text,
    excerpt text,
    published_at timestamptz,
    author_username text,
    author_avatar text
) LANGUAGE sql STABLE SECURITY DEFINER AS $ $
SELECT
    p.id,
    p.title,
    p.slug,
    p.excerpt,
    p.published_at,
    pr.username,
    pr.avatar_url
FROM
    public.posts p
    JOIN public.profiles pr ON pr.id = p.user_id
    JOIN public.post_tags pt ON pt.post_id = p.id
    JOIN public.tags t ON t.id = pt.tag_id
WHERE
    t.slug = tag_slug
    AND p.status = 'published'
ORDER BY
    p.published_at DESC;

$ $;