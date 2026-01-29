-- Tables for public schema
CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE
    public.comments
ADD
    CONSTRAINT comments_pkey PRIMARY KEY (id);

ALTER TABLE
    public.comments
ADD
    CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE;

CREATE TABLE public.post_tags (post_id uuid NOT NULL, tag_id uuid NOT NULL);

ALTER TABLE
    public.post_tags
ADD
    CONSTRAINT post_tags_pkey PRIMARY KEY (post_id, tag_id);

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    slug text,
    content text,
    excerpt text,
    status post_status DEFAULT 'draft' :: post_status,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE
    public.posts
ADD
    CONSTRAINT posts_pkey PRIMARY KEY (id);

ALTER TABLE
    public.comments
ADD
    CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE
    public.post_tags
ADD
    CONSTRAINT post_tags_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE
    public.posts
ADD
    CONSTRAINT posts_slug_key UNIQUE (slug);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    username text,
    full_name text,
    avatar_url text,
    bio text,
    role user_role DEFAULT 'user' :: user_role,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    website text,
    location text,
    twitter_handle text
);

ALTER TABLE
    public.profiles
ADD
    CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE
    public.comments
ADD
    CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE
    public.posts
ADD
    CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE
    public.profiles
ADD
    CONSTRAINT profiles_username_key UNIQUE (username);

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL
);

ALTER TABLE
    public.tags
ADD
    CONSTRAINT tags_name_key UNIQUE (name);

ALTER TABLE
    public.tags
ADD
    CONSTRAINT tags_pkey PRIMARY KEY (id);

ALTER TABLE
    public.post_tags
ADD
    CONSTRAINT post_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;

ALTER TABLE
    public.tags
ADD
    CONSTRAINT tags_slug_key UNIQUE (slug);

CREATE TABLE public.favorites (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    post_id uuid not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);