-- Seed data: Demo profiles and posts
-- This file creates sample data for development/testing
-- Note: Uses fixed UUIDs for reproducibility

-- Create demo users in auth.users first (required for FK constraint)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'john@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    ('22222222-2222-2222-2222-222222222222', 'jane@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    ('33333333-3333-3333-3333-333333333333', 'bot@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Demo profiles
INSERT INTO public.profiles (id, username, full_name, bio, role, website) VALUES
    ('11111111-1111-1111-1111-111111111111', 'johndoe', 'John Doe', 'Full-stack developer and blogger', 'admin', 'https://johndoe.dev'),
    ('22222222-2222-2222-2222-222222222222', 'janedoe', 'Jane Doe', 'Frontend specialist and UI/UX enthusiast', 'user', 'https://janedoe.design'),
    ('33333333-3333-3333-3333-333333333333', 'devbot', 'Dev Bot', 'Automated testing account', 'user', NULL)
ON CONFLICT (id) DO NOTHING;

-- Demo posts
INSERT INTO public.posts (id, user_id, title, slug, content, excerpt, status, published_at) VALUES
    (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111',
        'Getting Started with Supabase',
        'getting-started-with-supabase',
        'Supabase is an open source Firebase alternative. This guide will help you get started...',
        'Learn how to set up your first Supabase project.',
        'published',
        NOW() - INTERVAL '7 days'
    ),
    (
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '11111111-1111-1111-1111-111111111111',
        'Building a Blog with Next.js and Supabase',
        'building-blog-nextjs-supabase',
        'In this tutorial, we will build a full-featured blog using Next.js and Supabase...',
        'A complete guide to building a blog platform.',
        'published',
        NOW() - INTERVAL '3 days'
    ),
    (
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        '22222222-2222-2222-2222-222222222222',
        'Designing for Developers',
        'designing-for-developers',
        'Tips and tricks for creating developer-friendly UIs...',
        'Make your dev tools beautiful and functional.',
        'draft',
        NULL
    )
ON CONFLICT (slug) DO NOTHING;

-- Link posts to tags
INSERT INTO public.post_tags (post_id, tag_id) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e5f6a7b8-c9d0-4123-efab-234567890123'), -- Supabase
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd4e5f6a7-b8c9-4012-defa-123456789012'), -- Database
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'c3d4e5f6-a7b8-4901-cdef-012345678901'), -- Web Development
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e5f6a7b8-c9d0-4123-efab-234567890123'), -- Supabase
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'b2c3d4e5-f6a7-4890-bcde-f01234567890')  -- Programming
ON CONFLICT DO NOTHING;

-- Demo comments
INSERT INTO public.comments (id, post_id, user_id, content) VALUES
    (
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '22222222-2222-2222-2222-222222222222',
        'Great introduction! Very helpful for beginners.'
    ),
    (
        'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '33333333-3333-3333-3333-333333333333',
        'Thanks for sharing this guide!'
    )
ON CONFLICT (id) DO NOTHING;
