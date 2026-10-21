-- Ikris Pharma Network — Logistics Control Tower
-- Core schema: enums, tables, constraints, indexes

create extension if not exists pgcrypto;

-- ---------- Enums (single source of truth for stages / roles / departments)
create type public.app_role as enum ('admin', 'npp', 'rare_disease');
create type public.department as enum ('NPP', 'RARE_DISEASE');
create type public.shipment_stage as enum (
  'Inquiry',
  'Payment received',
  'Import permit',
  'CDEC form signed',
  'CDEC approved',
  'Order placed',
  'Shipped',
  'In customs',
  'Cleared',
  'Delivered',
  'POD received'
);
create type public.gst_status as enum ('Not applicable', 'Pending', 'Paid');
create type public.stock_movement_type as enum ('receipt', 'reservation', 'release', 'dispatch', 'adjustment', 'return');

-- ---------- Profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Operational settings (one row)
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  stuck_days integer not null default 5 check (stuck_days between 1 and 60),
  customs_days integer not null default 7 check (customs_days between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
insert into public.app_settings (id) values (1);

-- ---------- Shipments
create sequence public.npp_shipment_seq;
create sequence public.rare_shipment_seq;

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_code text not null unique,
  department public.department not null,
  patient_reference text,
  patient_name text,
  hospital_name text,
  doctor_name text,
  medicine_name text not null,
  brand_name text,
  strength text,
  dosage_form text,
  pack_size text,
  quantity numeric(12, 2) check (quantity is null or quantity >= 0),
  quantity_unit text,
  quantity_text text,
  manufacturer text,
  supplier text,
  origin_country text,
  destination_country text default 'India',
  region text,
  current_stage public.shipment_stage not null default 'Inquiry',
  stage_entered_at timestamptz not null default now(),
  owner_id uuid references public.profiles (id),
  owner_name text,
  pi_number text,
  pi_amount numeric(14, 2) check (pi_amount is null or pi_amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  payment_account text,
  gst_status public.gst_status not null default 'Not applicable',
  is_foc boolean not null default false,
  payment_received_date date,
  import_permit_number text,
  import_permit_date date,
  cdec_signed_date date,
  cdec_approved_date date,
  order_placed_date date,
  tracking_number text,
  courier_name text,
  awb_number text,
  cha_name text,
  shipment_date date,
  estimated_delivery_date date,
  customs_entry_date date,
  customs_cleared_date date,
  delivery_date date,
  pod_received boolean not null default false,
  pod_received_date date,
  is_on_hold boolean not null default false,
  hold_reason text,
  needs_review boolean not null default false,
  review_note text,
  status_text text,
  last_activity_at timestamptz not null default now(),
  notes text,
  source text not null default 'app',
  source_ref text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archive_reason text,
  constraint hold_needs_reason check (not is_on_hold or coalesce(length(trim(hold_reason)), 0) > 0),
  constraint code_matches_dept check (
    (department = 'NPP' and shipment_code like 'NPM-%')
    or (department = 'RARE_DISEASE' and shipment_code like 'RDM-%')
  )
);

create index shipments_dept_idx on public.shipments (department);
create index shipments_stage_idx on public.shipments (current_stage);
create index shipments_owner_idx on public.shipments (owner_id);
create index shipments_owner_name_idx on public.shipments (owner_name);
create index shipments_last_activity_idx on public.shipments (last_activity_at);
create index shipments_delivery_idx on public.shipments (delivery_date);
create index shipments_archived_idx on public.shipments (archived_at);

-- ---------- Shipment history (append-only)
create table public.shipment_updates (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  previous_stage public.shipment_stage,
  new_stage public.shipment_stage,
  update_type text not null check (update_type in ('created', 'stage_change', 'stage_correction', 'note', 'hold', 'release', 'payment', 'migration', 'field_update')),
  update_message text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  source text not null default 'app',
  metadata jsonb not null default '{}'::jsonb,
  correction_reason text,
  constraint correction_needs_reason check (update_type <> 'stage_correction' or coalesce(length(trim(correction_reason)), 0) > 0)
);
create index shipment_updates_shipment_idx on public.shipment_updates (shipment_id, updated_at desc);

-- ---------- Payments (multiple per shipment)
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_date date not null default current_date,
  account text,
  reference_number text,
  notes text,
  idempotency_key text unique,
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index payments_shipment_idx on public.payments (shipment_id);

-- ---------- Stock
create table public.medicine_stock (
  id uuid primary key default gen_random_uuid(),
  department public.department not null,
  medicine_name text not null,
  brand_name text,
  strength text,
  dosage_form text,
  batch_number text,
  expiry_date date,
  available_quantity numeric(12, 2) not null default 0 check (available_quantity >= 0),
  reserved_quantity numeric(12, 2) not null default 0 check (reserved_quantity >= 0),
  reorder_level numeric(12, 2) not null default 0 check (reorder_level >= 0),
  warehouse_location text,
  storage_conditions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medicine_stock_dept_idx on public.medicine_stock (department);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.medicine_stock (id) on delete cascade,
  movement_type public.stock_movement_type not null,
  quantity numeric(12, 2) not null check (quantity <> 0),
  shipment_id uuid references public.shipments (id),
  reference_number text,
  reason text,
  idempotency_key text unique,
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index stock_movements_stock_idx on public.stock_movements (stock_id, created_at desc);

-- ---------- Audit log (written only by trusted triggers/functions)
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  department public.department,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
