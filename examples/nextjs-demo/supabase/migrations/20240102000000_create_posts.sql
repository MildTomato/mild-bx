-- Create posts table
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  title text not null,
  content text,
  published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table
  public.posts enable row level security;

-- Policy: Anyone can read published posts
create policy "Anyone can read published posts" on public.posts for
select
  using (published = true);

-- Policy: Authors can read their own posts
create policy "Authors can read own posts" on public.posts for
select
  using (auth.uid() = user_id);

-- Policy: Authors can insert their own posts
create policy "Authors can insert own posts" on public.posts for
insert
  with check (auth.uid() = user_id);

-- Policy: Authors can update their own posts
create policy "Authors can update own posts" on public.posts for
update
  using (auth.uid() = user_id);

-- Policy: Authors can delete their own posts
create policy "Authors can delete own posts" on public.posts for delete using (auth.uid() = user_id);