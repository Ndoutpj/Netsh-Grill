-- BizBook SaaS database (v2, multi-company)
-- Replaces schema.sql. Run once in Supabase: SQL Editor > New query > paste > Run.
-- WARNING: this wipes the v1 tables. Fine now, since there is no real data yet.

-- ───────────── Clean out v1 ─────────────
drop policy if exists rec_admin      on storage.objects;
drop policy if exists rec_staff_add  on storage.objects;
drop policy if exists rec_staff_read on storage.objects;
drop table if exists audit_log, cash_closings, invoices, advances, workers, entries, profiles, businesses, organizations cascade;
drop function if exists is_admin(), my_business(), business_key(uuid), audit() cascade;

create extension if not exists pgcrypto;

-- ───────────── Companies (tenants) ─────────────
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text unique not null,            -- staff type this to log in
  currency      text not null default '$',
  plan          text not null default 'trial',   -- trial | starter | pro
  status        text not null default 'active',  -- active | past_due | cancelled
  trial_ends_at timestamptz not null default now() + interval '14 days',
  created_at    timestamptz not null default now()
);

-- One company can run many businesses. Each defines what its staff can record.
create table businesses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  unit_label  text,                                       -- e.g. 'Cars washed'; null = no counter
  kinds       text[] not null default '{sale,expense}'    -- allowed: sale, expense, equipment, stock
              check (kinds <@ array['sale','expense','equipment','stock']),
  created_at  timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  username    text not null,
  full_name   text not null,
  role        text not null check (role in ('admin','staff')),
  business_id uuid references businesses(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, username),
  check (role = 'admin' or business_id is not null)
);

-- ───────────── Helpers used by every rule ─────────────
create function my_org() returns uuid
  language sql stable security definer set search_path = public as
$$ select org_id from profiles where id = auth.uid() and active $$;

create function is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active) $$;

create function my_business() returns uuid
  language sql stable security definer set search_path = public as
$$ select business_id from profiles where id = auth.uid() and role = 'staff' and active $$;

create function business_in_org(b uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from businesses where id = b and org_id = my_org()) $$;

create function business_allows(b uuid, k text) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select k = any(kinds) from businesses where id = b), false) $$;

create function business_has_units(b uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select unit_label is not null from businesses where id = b), false) $$;

-- ───────────── Sign-up: a new company creates its workspace ─────────────
-- The app calls this right after a new owner signs up with email + password.
create function create_organization(org_name text, admin_name text) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare
  new_org uuid;
  new_code text;
  who text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'Already set up'; end if;
  loop
    new_code := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from organizations where code = new_code);
  end loop;
  insert into organizations (name, code) values (trim(org_name), new_code) returning id into new_org;
  select email into who from auth.users where id = auth.uid();
  insert into profiles (id, org_id, username, full_name, role) values (auth.uid(), new_org, who, trim(admin_name), 'admin');
  return new_org;
end $$;

-- ───────────── Money and records (every row belongs to a company) ─────────────
create table entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default my_org() references organizations(id) on delete cascade,
  business_id  uuid not null references businesses(id),
  kind         text not null check (kind in ('sale','expense','equipment','stock')),
  amount       numeric(14,2) not null check (amount > 0),
  units        int not null default 0 check (units >= 0),
  note         text,
  receipt_path text,
  entry_date   date not null default current_date,
  created_by   uuid not null default auth.uid() references profiles(id),
  created_at   timestamptz not null default now()
);
create index on entries (org_id, business_id, entry_date);

create table workers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default my_org() references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id),
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table advances (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default my_org() references organizations(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  business_id uuid not null references businesses(id),
  kind        text not null check (kind in ('advance','deduction')),
  amount      numeric(14,2) not null check (amount > 0),
  created_by  uuid not null default auth.uid() references profiles(id),
  created_at  timestamptz not null default now()
);

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default my_org() references organizations(id) on delete cascade,
  business_id    uuid not null references businesses(id),
  number         text not null,
  client_name    text,
  client_contact text,
  items          jsonb not null default '[]',
  tax_pct        numeric(5,2) not null default 0,
  total          numeric(14,2) not null default 0,
  created_at     timestamptz not null default now()
);

create table cash_closings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default my_org() references organizations(id) on delete cascade,
  business_id  uuid not null references businesses(id),
  closing_date date not null default current_date,
  expected     numeric(14,2) not null,
  counted      numeric(14,2) not null,
  note         text,
  created_by   uuid not null default auth.uid() references profiles(id),
  created_at   timestamptz not null default now(),
  unique (business_id, closing_date)
);

-- ───────────── Audit trail ─────────────
create table audit_log (
  id         bigserial primary key,
  org_id     uuid default my_org(),
  table_name text not null,
  record_id  uuid,
  action     text not null,
  old_row    jsonb,
  new_row    jsonb,
  actor      uuid default auth.uid(),
  at         timestamptz not null default now()
);

create function audit() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  insert into audit_log (org_id, table_name, record_id, action, old_row, new_row)
  values (
    case when tg_op = 'DELETE' then old.org_id else new.org_id end,
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger audit_entries  after insert or update or delete on entries       for each row execute function audit();
create trigger audit_workers  after insert or update or delete on workers       for each row execute function audit();
create trigger audit_advances after insert or update or delete on advances      for each row execute function audit();
create trigger audit_invoices after insert or update or delete on invoices      for each row execute function audit();
create trigger audit_profiles after insert or update or delete on profiles      for each row execute function audit();
create trigger audit_closings after insert or update or delete on cash_closings for each row execute function audit();

-- ───────────── Security rules: a company only ever sees its own rows ─────────────
alter table organizations enable row level security;
alter table businesses    enable row level security;
alter table profiles      enable row level security;
alter table entries       enable row level security;
alter table workers       enable row level security;
alter table advances      enable row level security;
alter table invoices      enable row level security;
alter table cash_closings enable row level security;
alter table audit_log     enable row level security;

create policy org_read   on organizations for select to authenticated using (id = my_org());
create policy org_update on organizations for update to authenticated using (id = my_org() and is_admin()) with check (id = my_org());

create policy biz_read  on businesses for select to authenticated
  using (org_id = my_org() and (is_admin() or id = my_business()));
create policy biz_admin on businesses for all to authenticated
  using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin());

create policy prof_read  on profiles for select to authenticated
  using (id = auth.uid() or (org_id = my_org() and is_admin()));
create policy prof_admin on profiles for all to authenticated
  using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin());

-- Entries
create policy ent_admin on entries for all to authenticated
  using (org_id = my_org() and is_admin())
  with check (org_id = my_org() and is_admin() and business_in_org(business_id));
create policy ent_staff_read on entries for select to authenticated
  using (org_id = my_org() and business_id = my_business() and entry_date = current_date);
create policy ent_staff_add on entries for insert to authenticated
  with check (
    org_id = my_org() and business_id = my_business() and created_by = auth.uid()
    and entry_date = current_date
    and business_allows(business_id, kind)
    and (units = 0 or business_has_units(business_id))
  );

-- Admin-only tables
create policy wrk_admin on workers for all to authenticated
  using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin() and business_in_org(business_id));
create policy adv_admin on advances for all to authenticated
  using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin() and business_in_org(business_id));
create policy inv_admin on invoices for all to authenticated
  using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin() and business_in_org(business_id));
create policy aud_admin on audit_log for select to authenticated
  using (org_id = my_org() and is_admin());

-- Cash closing
create policy clo_admin on cash_closings for all to authenticated
  using (org_id = my_org() and is_admin()) with check (org_id = my_org() and is_admin() and business_in_org(business_id));
create policy clo_staff_read on cash_closings for select to authenticated
  using (org_id = my_org() and business_id = my_business());
create policy clo_staff_add on cash_closings for insert to authenticated
  with check (org_id = my_org() and business_id = my_business() and created_by = auth.uid() and closing_date = current_date);

-- ───────────── Receipt photos: folder = <org_id>/<business_id>/<file> ─────────────
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy rec_admin on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and is_admin() and (storage.foldername(name))[1] = my_org()::text)
  with check (bucket_id = 'receipts' and is_admin() and (storage.foldername(name))[1] = my_org()::text);
create policy rec_staff_add on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and my_business() is not null
              and (storage.foldername(name))[1] = my_org()::text
              and (storage.foldername(name))[2] = my_business()::text);
create policy rec_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and my_business() is not null
         and (storage.foldername(name))[1] = my_org()::text
         and (storage.foldername(name))[2] = my_business()::text);
