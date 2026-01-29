-- Create users table
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table
  public.users enable row level security;

-- Policy: Users can read their own data
create policy "Users can read own data" on public.users for
select
  using (auth.uid() = id);

-- Policy: Users can update their own data
create policy "Users can update own data" on public.users for
update
  using (auth.uid() = id);