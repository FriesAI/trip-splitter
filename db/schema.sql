-- Trip Splitter — Postgres schema (Supabase)
--
-- Not applied yet: the app currently runs entirely on the local store, and this
-- is the server half, ready for Phase 4 when sync lands. It mirrors
-- src/domain/types.ts one-for-one so syncing stays a transport concern rather
-- than a translation one.
--
-- Conventions, all from docs/SPEC.md section 6:
--   * money is BIGINT minor units — sen, pence, aurar. Never NUMERIC, never
--     DOUBLE PRECISION. A float here is the bug this whole project is shaped
--     to avoid.
--   * timestamps are TIMESTAMPTZ, stored UTC.
--   * ids are UUIDs generated client-side, so two people creating expenses
--     offline can never collide (SYN-02).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- people ----
-- A person persists across trips, carrying their name, colour and devices.
create table if not exists people (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                    -- null until they claim a device
  display_name text not null check (length(trim(display_name)) > 0),
  color_index  int  not null default 0,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------- trips ----
create table if not exists trips (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  starts_on     date not null,
  ends_on       date not null,
  created_by    uuid not null references people (id),
  invite_token  text not null unique,
  created_at    timestamptz not null default now(),
  constraint trips_dates_ordered check (ends_on >= starts_on)
);

-- ------------------------------------------------------------ households ----
-- Declared before members so a member can reference their household.
create table if not exists households (
  id       uuid primary key default gen_random_uuid(),
  trip_id  uuid not null references trips (id) on delete cascade,
  name     text not null,
  -- Which member receives the household's settle-up payment. Nullable and set
  -- after the members exist; the app requires it before rolling up.
  settle_to_member_id uuid
);

-- --------------------------------------------------------------- members ----
-- No role column on purpose: every member is an admin (GRP-02). The only
-- asymmetry is trips.created_by, who cannot be removed.
create table if not exists members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips (id) on delete cascade,
  person_id    uuid not null references people (id),
  household_id uuid references households (id) on delete set null,
  joined_at    timestamptz not null default now(),
  unique (trip_id, person_id)
);

alter table households
  drop constraint if exists households_settle_to_member_fk;
alter table households
  add constraint households_settle_to_member_fk
  foreign key (settle_to_member_id) references members (id) on delete set null;

-- -------------------------------------------------------------- segments ----
create table if not exists segments (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips (id) on delete cascade,
  name             text not null,
  starts_on        date not null,
  ends_on          date not null,
  default_currency text not null check (default_currency ~ '^[A-Z]{3}$'),
  sort_order       int  not null default 0
);

-- ---------------------------------------------------------------- squads ----
-- A named participant subset. The trip's six distinct subsets are why this
-- table exists at all; see docs/SPEC.md section 1.
create table if not exists squads (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips (id) on delete cascade,
  name       text not null,
  member_ids uuid[] not null default '{}',
  sort_order int  not null default 0
);

-- -------------------------------------------------------------- expenses ----
create table if not exists expenses (
  id                uuid primary key,          -- client-generated (SYN-02)
  trip_id           uuid not null references trips (id) on delete cascade,
  segment_id        uuid references segments (id) on delete set null,
  description       text not null,
  category          text not null default 'other',

  amount_minor      bigint not null,
  currency          text   not null check (currency ~ '^[A-Z]{3}$'),
  -- Frozen on save and never recalculated: a rate that moved later must not
  -- move a balance somebody has already settled against.
  fx_rate           double precision not null default 1,
  fx_rate_date      date,
  fx_source         text,
  amount_base_minor bigint not null,

  split_method      text not null default 'equal',
  spent_at          timestamptz not null,
  is_prepaid        boolean not null default false,
  notes             text,

  created_by        uuid not null references members (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz                 -- soft delete, always recoverable
);

create index if not exists expenses_trip_spent_at_idx
  on expenses (trip_id, spent_at desc) where deleted_at is null;

create table if not exists expense_payers (
  id                uuid primary key default gen_random_uuid(),
  expense_id        uuid not null references expenses (id) on delete cascade,
  member_id         uuid not null references members (id),
  amount_minor      bigint not null,
  amount_base_minor bigint not null,
  unique (expense_id, member_id)
);

create table if not exists expense_splits (
  id                uuid primary key default gen_random_uuid(),
  expense_id        uuid not null references expenses (id) on delete cascade,
  member_id         uuid not null references members (id),
  weight            double precision not null default 1,
  amount_minor      bigint not null,
  amount_base_minor bigint not null,
  unique (expense_id, member_id)
);

create index if not exists expense_payers_expense_idx on expense_payers (expense_id);
create index if not exists expense_splits_expense_idx on expense_splits (expense_id);

-- The invariant from docs/SPEC.md section 6, enforced in the database as well
-- as in the engine. Both sides of an expense must foot to its total, or it does
-- not get stored. Deferred so a single transaction can write the parent and its
-- children in any order.
create or replace function assert_expense_balanced() returns trigger
language plpgsql as $$
declare
  target       uuid := coalesce(new.expense_id, old.expense_id);
  expense_total bigint;
  paid_total    bigint;
  owed_total    bigint;
begin
  select amount_minor into expense_total from expenses where id = target;
  if expense_total is null then
    return null;                       -- expense gone; cascade will clean up
  end if;

  select coalesce(sum(amount_minor), 0) into paid_total
    from expense_payers where expense_id = target;
  select coalesce(sum(amount_minor), 0) into owed_total
    from expense_splits where expense_id = target;

  if paid_total <> expense_total then
    raise exception 'expense % payers sum to % but the total is %',
      target, paid_total, expense_total;
  end if;
  if owed_total <> expense_total then
    raise exception 'expense % splits sum to % but the total is %',
      target, owed_total, expense_total;
  end if;
  return null;
end;
$$;

drop trigger if exists expense_payers_balanced on expense_payers;
create constraint trigger expense_payers_balanced
  after insert or update or delete on expense_payers
  deferrable initially deferred
  for each row execute function assert_expense_balanced();

drop trigger if exists expense_splits_balanced on expense_splits;
create constraint trigger expense_splits_balanced
  after insert or update or delete on expense_splits
  deferrable initially deferred
  for each row execute function assert_expense_balanced();

-- ------------------------------------------------------------- transfers ----
-- A settle-up payment. Deliberately not an expense: it moves balance without
-- changing what the trip cost.
create table if not exists transfers (
  id                uuid primary key,
  trip_id           uuid not null references trips (id) on delete cascade,
  from_member_id    uuid not null references members (id),
  to_member_id      uuid not null references members (id),
  amount_base_minor bigint not null check (amount_base_minor > 0),
  method            text   not null default 'bank',
  paid_at           timestamptz not null,
  note              text,
  created_by        uuid not null references members (id),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint transfers_distinct_parties check (from_member_id <> to_member_id)
);

-- ----------------------------------------------------------- attachments ----
create table if not exists attachments (
  id             uuid primary key,
  trip_id        uuid not null references trips (id) on delete cascade,
  expense_id     uuid references expenses (id) on delete cascade,
  kind           text not null check (kind in ('receipt', 'voucher')),
  filename       text not null,
  mime           text not null,
  -- Private bucket only, never a public URL: a receipt can carry a card's
  -- last four digits.
  storage_path   text not null,
  drive_url      text,
  created_at     timestamptz not null default now()
);

-- -------------------------------------------------------------- ocr_jobs ----
create table if not exists ocr_jobs (
  id            uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references attachments (id) on delete cascade,
  status        text not null default 'queued'
                check (status in ('queued', 'done', 'failed')),
  raw_text      text,
  parsed        jsonb,
  confidence    double precision,
  completed_at  timestamptz
);

-- -------------------------------------------------------------- fx_rates ----
create table if not exists fx_rates (
  base      text not null check (base ~ '^[A-Z]{3}$'),
  quote     text not null check (quote ~ '^[A-Z]{3}$'),
  rate_date date not null,
  rate      double precision not null check (rate > 0),
  source    text not null default 'ecb',
  primary key (base, quote, rate_date)
);

-- ------------------------------------------------------------- audit_log ----
-- Load-bearing, because every member is an admin and can delete anything.
create table if not exists audit_log (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips (id) on delete cascade,
  entity          text not null,
  entity_id       uuid not null,
  action          text not null check (action in ('create','update','delete','restore')),
  actor_member_id uuid references members (id),
  summary         text not null,
  before          jsonb,
  after           jsonb,
  at              timestamptz not null default now()
);

create index if not exists audit_log_trip_at_idx on audit_log (trip_id, at desc);

-- ------------------------------------------------------ row level security --
-- Everything is scoped to trip membership. Within a trip everyone may read and
-- write everything, which is the flat-admin model the group asked for; the
-- safety rails are soft deletes and the audit log, not permissions.

create or replace function is_trip_member(target_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from members m
      join people p on p.id = m.person_id
     where m.trip_id = target_trip
       and p.auth_user_id = auth.uid()
  );
$$;

alter table trips          enable row level security;
alter table members        enable row level security;
alter table households     enable row level security;
alter table segments       enable row level security;
alter table squads         enable row level security;
alter table expenses       enable row level security;
alter table expense_payers enable row level security;
alter table expense_splits enable row level security;
alter table transfers      enable row level security;
alter table attachments    enable row level security;
alter table audit_log      enable row level security;

drop policy if exists trips_member_access on trips;
create policy trips_member_access on trips
  for all using (is_trip_member(id)) with check (is_trip_member(id));

do $$
declare t text;
begin
  foreach t in array array[
    'members','households','segments','squads','expenses','transfers',
    'attachments','audit_log'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_member_access', t);
    execute format(
      'create policy %I on %I for all using (is_trip_member(trip_id))
         with check (is_trip_member(trip_id))',
      t || '_member_access', t);
  end loop;
end $$;

-- Child rows of an expense inherit their parent's trip.
drop policy if exists expense_payers_member_access on expense_payers;
create policy expense_payers_member_access on expense_payers for all
  using (exists (select 1 from expenses e
                  where e.id = expense_id and is_trip_member(e.trip_id)))
  with check (exists (select 1 from expenses e
                       where e.id = expense_id and is_trip_member(e.trip_id)));

drop policy if exists expense_splits_member_access on expense_splits;
create policy expense_splits_member_access on expense_splits for all
  using (exists (select 1 from expenses e
                  where e.id = expense_id and is_trip_member(e.trip_id)))
  with check (exists (select 1 from expenses e
                       where e.id = expense_id and is_trip_member(e.trip_id)));

-- fx_rates is public reference data: readable by any signed-in user, written
-- only by the server function that refreshes it.
alter table fx_rates enable row level security;
drop policy if exists fx_rates_read on fx_rates;
create policy fx_rates_read on fx_rates for select using (auth.role() = 'authenticated');
