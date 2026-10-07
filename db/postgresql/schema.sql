-- Referência da estrutura aplicada pelo conector Supabase em 2026-10-07.
-- Migrações remotas: directfuel_private_foundation e directfuel_reference_indexes.
-- Destino: projeto de testes Directfuel Vixpar, região sa-east-1.
-- Não aplicar ao banco do Site atual. Não contém dados operacionais ou segredos.


create schema directfuel;
revoke all on schema directfuel from public, anon, authenticated;
grant usage on schema directfuel to service_role;

create table directfuel.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique check (email = lower(trim(email))),
  display_name text not null default '',
  profile text not null check (profile in ('Administrador', 'Master', 'Gestor', 'Usuário')),
  active boolean not null default false,
  permissions jsonb not null default '[]'::jsonb check (jsonb_typeof(permissions) = 'array'),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  unit_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(unit_ids) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table directfuel.state_revision (
  id text primary key check (id = 'main'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references directfuel.members(id)
);
insert into directfuel.state_revision(id) values ('main');

create table directfuel.collections (
  name text primary key check (name ~ '^[A-Za-z][A-Za-z0-9_]*$' and name not in ('__proto__', 'prototype', 'constructor')),
  kind text not null check (kind in ('array', 'value')),
  updated_at timestamptz not null default now()
);

create table directfuel.records (
  collection_name text not null references directfuel.collections(name),
  record_id text not null check (length(record_id) > 0),
  sort_order bigint not null default 0 check (sort_order >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection_name, record_id)
);
create index records_collection_order_idx on directfuel.records(collection_name, sort_order, record_id);

create table directfuel.documents (
  id text primary key,
  measurement_id text not null,
  bucket_id text not null,
  object_path text not null,
  original_filename text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references directfuel.members(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references directfuel.members(id),
  unique (bucket_id, object_path)
);
create index documents_measurement_idx on directfuel.documents(measurement_id) where removed_at is null;

create table directfuel.backups (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  object_path text not null,
  state_revision bigint not null check (state_revision >= 0),
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  validated_at timestamptz,
  created_by uuid references directfuel.members(id),
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);
create index backups_validated_created_idx on directfuel.backups(created_at desc) where validated_at is not null;

create table directfuel.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references directfuel.members(id),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on directfuel.audit_events(created_at desc);
create index audit_events_actor_created_idx on directfuel.audit_events(actor_id, created_at desc);

alter table directfuel.members enable row level security;
alter table directfuel.state_revision enable row level security;
alter table directfuel.collections enable row level security;
alter table directfuel.records enable row level security;
alter table directfuel.documents enable row level security;
alter table directfuel.backups enable row level security;
alter table directfuel.audit_events enable row level security;

revoke all on all tables in schema directfuel from public, anon, authenticated;
grant select, insert, update, delete on directfuel.members, directfuel.collections, directfuel.records, directfuel.documents, directfuel.backups to service_role;
grant select, update on directfuel.state_revision to service_role;
grant select, insert on directfuel.audit_events to service_role;
alter default privileges in schema directfuel revoke all on tables from public, anon, authenticated;
alter default privileges in schema directfuel revoke execute on functions from public, anon, authenticated;

comment on schema directfuel is 'DirectFuel migration staging. Client roles have no direct access. Backend must validate Supabase identity, membership, profiles and unit permissions before reading or writing.';
comment on table directfuel.records is 'Operational state stored by collection and record, without a single 8 MB state row. Revision locking, fiscal checks and API handlers are not implemented by this foundation.';
comment on table directfuel.backups is 'Retention may remove old backups only after validating a new backup. Keep the five latest validated backups.';

CREATE INDEX backups_created_by_idx ON directfuel.backups (created_by);
CREATE INDEX documents_created_by_idx ON directfuel.documents (created_by);
CREATE INDEX documents_removed_by_idx ON directfuel.documents (removed_by);
CREATE INDEX state_revision_updated_by_idx ON directfuel.state_revision (updated_by);
