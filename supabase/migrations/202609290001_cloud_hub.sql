-- All writes pass through the authenticated Edge Function. Public access is read-only.
create table public.hub_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.hub_admins enable row level security;
create policy admin_reads_self on public.hub_admins for select to authenticated using (user_id = auth.uid());
revoke all on public.hub_admins from anon, authenticated;
grant select on public.hub_admins to authenticated;
grant all on public.hub_admins to service_role;

create table public.hub_state (
  id integer primary key check (id = 1),
  revision bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.hub_state(id, data) values (1, '{"courses":[],"resources":[],"assignments":[],"events":[],"announcements":[],"schedule":[],"scheduleRevision":0}');
alter table public.hub_state enable row level security;
create policy public_reads_hub on public.hub_state for select to anon, authenticated using (true);
revoke all on public.hub_state from anon, authenticated;
grant select on public.hub_state to anon, authenticated;
grant all on public.hub_state to service_role;

-- A single versioned snapshot fits this small campus app and preserves global search.
-- CAS below prevents two administrators from overwriting unrelated simultaneous edits.
create table public.hub_assets (
  id uuid primary key,
  drive_id text not null unique,
  preview_path text not null unique,
  state text not null default 'staged' check (state in ('staged','active','pending')),
  created_at timestamptz not null default now(),
  last_error text
);
alter table public.hub_assets enable row level security;
revoke all on public.hub_assets from anon, authenticated;
grant all on public.hub_assets to service_role;

create function public.commit_hub(expected bigint, document jsonb, activate uuid default null, retire uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.hub_state where id=1 and revision=expected for update;
  if not found then return false; end if;
  if activate is not null then
    update public.hub_assets set state='active' where id=activate and state='staged';
    if not found then raise exception 'Upload expired; please upload again'; end if;
  end if;
  update public.hub_state set data=document, revision=revision+1, updated_at=now() where id=1;
  if retire is not null then update public.hub_assets set state='pending' where id=retire; end if;
  return true;
end $$;
revoke all on function public.commit_hub(bigint,jsonb,uuid,uuid) from public, anon, authenticated;
grant execute on function public.commit_hub(bigint,jsonb,uuid,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('previews','previews',true,262144,array['image/webp','image/jpeg'])
on conflict(id) do nothing;
-- Public downloads use the bucket URL; only the service role uploads/removes objects.
