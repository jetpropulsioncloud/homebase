-- HomeBase: run once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our Home',
  created_by uuid not null references auth.users(id),
  invite_code text not null unique default encode(gen_random_bytes(12), 'hex'),
  monthly_budget numeric(12,2) not null default 3000 check (monthly_budget >= 0),
  alex_share integer not null default 50 check (alex_share between 0 and 100),
  created_at timestamptz not null default now()
);
create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  nickname text not null default 'Household member',
  joined_at timestamptz not null default now()
);
create index if not exists memberships_household on public.memberships(household_id);

create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where household_id = hid and user_id = auth.uid());
$$;
revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  amount numeric(12,2) check (amount >= 0),
  due_day integer check (due_day between 1 and 31),
  category text not null default 'Other',
  payer text not null default 'Shared' check (payer in ('Shared','Alex','Sam')),
  merchant_keywords text[] not null default '{}',
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists bills_household on public.bills(household_id);

create table if not exists public.bill_payments (
  bill_id uuid not null references public.bills(id) on delete cascade,
  month text not null check (month ~ '^20[0-9][0-9]-(0[1-9]|1[0-2])$'),
  status text not null default 'unpaid' check (status in ('unpaid','paid','review')),
  source text not null default 'manual' check (source in ('manual','bank_match','bank_suggestion')),
  match_id uuid,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (bill_id,month)
);

-- Protected tables: bank secrets, raw transactions and push endpoint credentials.
-- These are NEVER granted to the browser client (service-role only).
create table if not exists public.bank_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  plaid_item_id text not null unique,
  access_token_ciphertext text not null,
  institution_name text not null default 'Linked bank',
  cursor text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bank_items_household on public.bank_items(household_id);
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_item_id uuid not null references public.bank_items(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  plaid_transaction_id text not null unique,
  pending_transaction_id text,
  account_id text not null,
  merchant_name text not null,
  amount numeric(12,2) not null,
  posted_on date not null,
  pending boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists tx_bank_item on public.bank_transactions(bank_item_id);
create index if not exists tx_date on public.bank_transactions(posted_on);
create table if not exists public.payment_matches (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  month text not null,
  transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  confidence integer not null check (confidence between 0 and 100),
  status text not null check (status in ('suggested','confirmed','dismissed')),
  created_at timestamptz not null default now(),
  unique (bill_id, month, transaction_id)
);
create unique index if not exists unique_active_transaction_match
  on public.payment_matches(transaction_id)
  where status in ('suggested','confirmed');

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  body text not null,
  dedupe_key text not null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user on public.notifications(user_id,created_at desc);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now()
);

alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;
alter table public.bank_items enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.payment_matches enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- Idempotent policies for a clean SQL Editor rerun.
drop policy if exists "households read" on public.households;
create policy "households read" on public.households for select to authenticated
  using (public.is_household_member(id));
drop policy if exists "households update" on public.households;
create policy "households update" on public.households for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "memberships read" on public.memberships;
create policy "memberships read" on public.memberships for select to authenticated
  using (public.is_household_member(household_id));
drop policy if exists "bills select" on public.bills;
create policy "bills select" on public.bills for select to authenticated
  using (public.is_household_member(household_id));
drop policy if exists "bills insert" on public.bills;
create policy "bills insert" on public.bills for insert to authenticated
  with check (public.is_household_member(household_id));
drop policy if exists "bills update" on public.bills;
create policy "bills update" on public.bills for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
drop policy if exists "bills delete" on public.bills;
create policy "bills delete" on public.bills for delete to authenticated
  using (public.is_household_member(household_id));
drop policy if exists "payments all" on public.bill_payments;
create policy "payments all" on public.bill_payments for all to authenticated
  using (exists(select 1 from public.bills b where b.id = bill_id and public.is_household_member(b.household_id)))
  with check (exists(select 1 from public.bills b where b.id = bill_id and public.is_household_member(b.household_id)));
drop policy if exists "notifications read" on public.notifications;
create policy "notifications read" on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Browser clients cannot fetch, modify, or enumerate these protected tables.
revoke all on public.bank_items, public.bank_transactions, public.payment_matches, public.push_subscriptions from anon, authenticated;

-- Atomic household creation; direct inserts into membership/households are disabled.
create or replace function public.create_household(household_name text default 'Our Home', person_name text default 'Alex')
returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from public.memberships where user_id=auth.uid()) then raise exception 'Already in a household'; end if;
  insert into public.households(name,created_by) values (left(household_name,80),auth.uid()) returning id into hid;
  insert into public.memberships(user_id,household_id,nickname) values(auth.uid(),hid,left(person_name,60));
  insert into public.bills(household_id,name,amount,due_day,category,merchant_keywords,confirmed)
  values
  (hid,'Apartment rent',1800,null,'Housing',array['demo property','example property management','demo rent portal'],true),
  (hid,'Xfinity internet',60,null,'Internet',array['xfinity','comcast'],false),
  (hid,'Electricity',null,null,'Utilities',array['potomac edison','firstenergy'],false),
  (hid,'Water / sewer',null,null,'Utilities',array[]::text[],false),
  (hid,'Renters insurance',null,null,'Insurance',array['state farm'],false);
  return hid;
end; $$;
revoke all on function public.create_household(text,text) from public;
grant execute on function public.create_household(text,text) to authenticated;

create or replace function public.join_household(code text, person_name text default 'Sam')
returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from public.memberships where user_id=auth.uid()) then raise exception 'Already in a household'; end if;
  select id into hid from public.households where invite_code=lower(trim(code));
  if hid is null then raise exception 'Invalid invitation'; end if;
  insert into public.memberships(user_id,household_id,nickname) values(auth.uid(),hid,left(person_name,60));
  return hid;
end; $$;
revoke all on function public.join_household(text,text) from public;
grant execute on function public.join_household(text,text) to authenticated;

create or replace function public.rotate_invite(hid uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare new_code text;
begin
  if not exists(select 1 from public.households where id=hid and created_by=auth.uid()) then raise exception 'Not authorized'; end if;
  new_code := encode(gen_random_bytes(12),'hex');
  update public.households set invite_code=new_code where id=hid;
  return new_code;
end; $$;
revoke all on function public.rotate_invite(uuid) from public;
grant execute on function public.rotate_invite(uuid) to authenticated;

-- Emit in-app updates when either household member records a payment.
create or replace function public.payment_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h uuid; bill_name text; recipient record;
begin
  if new.status='paid' and new.source='manual' and (tg_op='INSERT' or old.status is distinct from 'paid') then
    select b.household_id,b.name into h,bill_name from public.bills b where b.id=new.bill_id;
    for recipient in select user_id from public.memberships where household_id=h loop
      insert into public.notifications(user_id,household_id,title,body,dedupe_key)
      values(recipient.user_id,h,'Bill marked paid',bill_name || ' was marked paid for ' || new.month,
      'paid:'||new.bill_id::text||':'||new.month)
      on conflict (user_id,dedupe_key) do nothing;
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists payment_notice_trigger on public.bill_payments;
create trigger payment_notice_trigger after insert or update on public.bill_payments
for each row execute function public.payment_notice();

-- Enable Postgres changes for both users (table access still constrained by RLS).
do $$ begin
  alter publication supabase_realtime add table public.bills;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bill_payments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.households;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.memberships;
exception when duplicate_object then null; end $$;

-- Least-privilege browser grants (service_role bypasses RLS for server endpoints).
grant usage on schema public to authenticated;
grant select,update on public.households to authenticated;
grant select on public.memberships to authenticated;
grant select,insert,update,delete on public.bills to authenticated;
grant select,insert,update,delete on public.bill_payments to authenticated;
grant select,update on public.notifications to authenticated;
