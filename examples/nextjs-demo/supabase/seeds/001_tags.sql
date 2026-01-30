-- Seed data: Tags
-- This file creates initial tag data for the blog
INSERT INTO
    public.tags (id, name, slug)
VALUES
    (
        'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
        'Technology',
        'technology'
    ),
    (
        'b2c3d4e5-f6a7-4890-bcde-f01234567890',
        'Programming',
        'programming'
    ),
    (
        'c3d4e5f6-a7b8-4901-cdef-012345678901',
        'Web Development',
        'web-development'
    ),
    (
        'd4e5f6a7-b8c9-4012-defa-123456789012',
        'Database',
        'database'
    ),
    (
        'e5f6a7b8-c9d0-4123-efab-234567890123',
        'Supabase',
        'supabase'
    ) ON CONFLICT (slug) DO NOTHING;