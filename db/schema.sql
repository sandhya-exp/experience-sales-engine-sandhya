-- Sales Engine — Lead & Deal Workspace
-- P0 schema. Owned entirely by this feature: no shared graph/OS tables are
-- touched or assumed. Designed to run unmodified against a Supabase Postgres
-- instance (point DATABASE_URL at it) as well as local Postgres.

create extension if not exists "pgcrypto";

do $$ begin
  create type lead_status as enum ('new', 'contacted', 'qualified', 'quoted', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_type as enum ('call', 'email', 'message', 'note', 'status_change', 'qualification_change');
exception when duplicate_object then null; end $$;

do $$ begin
  create type qualification_status as enum ('not_started', 'in_progress', 'qualified');
exception when duplicate_object then null; end $$;

-- Internal Sales Engine users (P0: simple email/password login, not the
-- Admin discipline's org/role system).
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  -- 'sales' works the lifecycle up to Scheduled Tasks; 'admin' additionally
  -- has Ready to Contract and the handoff. Least privilege by default.
  role text not null default 'sales',
  created_at timestamptz not null default now()
);

-- Idempotent for databases created before the role existed.
alter table app_users add column if not exists role text not null default 'sales';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_role_check') then
    alter table app_users add constraint app_users_role_check check (role in ('admin', 'sales'));
  end if;
end $$;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique, -- P0 dedupe key: lowercased email domain, null for free-mail inquiries
  industry text,
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

-- one primary contact per company at a time
create unique index if not exists one_primary_contact_per_company
  on contacts (company_id)
  where is_primary;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  primary_contact_id uuid references contacts(id) on delete set null,
  owner_user_id uuid references app_users(id) on delete set null,

  number_of_users integer,
  interest text,
  requirements text,
  additional_info text,

  status lead_status not null default 'new',

  -- Qualification (P0: flexible jsonb; see architecture doc section 10).
  -- Keys used by the UI: number_of_users, current_solution, primary_need,
  -- decision_timeline, decision_maker, budget.
  qualification jsonb not null default '{}'::jsonb,
  qualification_status qualification_status not null default 'not_started',

  quote_requested_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on leads (status);
create index if not exists leads_company_idx on leads (company_id);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type activity_type not null,
  body text,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_name text, -- denormalized so the timeline still reads if the user is removed
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists activities_lead_idx on activities (lead_id, occurred_at desc);

create table if not exists ai_deal_briefs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  summary text not null,
  missing_info jsonb not null default '[]'::jsonb,
  next_action text not null,
  next_action_reason text,
  key_facts jsonb not null default '[]'::jsonb,
  generated_by text not null default 'heuristic', -- 'heuristic' | 'llm:<model>'
  generated_at timestamptz not null default now()
);

create index if not exists ai_deal_briefs_lead_idx on ai_deal_briefs (lead_id, generated_at desc);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();

-- AI Opportunity Intelligence: structured sections (customer need, quote
-- implications, gaps, next action, quote context) alongside the flat brief
-- columns. Idempotent — safe to re-run `npm run db:schema`.
alter table ai_deal_briefs add column if not exists intelligence jsonb not null default '{}'::jsonb;
