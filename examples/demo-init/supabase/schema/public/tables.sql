create table users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    password text not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create table sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    token text not null,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);