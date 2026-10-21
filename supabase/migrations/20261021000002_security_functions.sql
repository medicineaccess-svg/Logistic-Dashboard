-- Security helpers, guard triggers, audit triggers, business RPCs, RLS, storage, realtime

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------- Identity helpers (always derived from auth.uid(), never from the client)
create or replace function private.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'admin', false)
$$;

create or replace function private.can_access_department(d public.department)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.current_app_role()
    when 'admin' then true
    when 'npp' then d = 'NPP'
    when 'rare_disease' then d = 'RARE_DISEASE'
    else false
  end
$$;

create or replace function private.can_access_shipment(p_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shipments s
    where s.id = p_id and private.can_access_department(s.department)
  )
$$;

-- Safe text → shipment check for storage paths (never throws on malformed input)
create or replace function private.can_access_shipment_folder(p_folder text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_access_shipment(p_folder::uuid);
end
$$;

create or replace function private.stage_index(s public.shipment_stage)
returns integer
language sql immutable set search_path = ''
as $$
  select array_position(enum_range(null::public.shipment_stage), s)
$$;

grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_access_department(public.department) to authenticated;
grant execute on function private.can_access_shipment(uuid) to authenticated;
grant execute on function private.can_access_shipment_folder(text) to authenticated;
grant execute on function private.stage_index(public.shipment_stage) to authenticated;

-- ---------- Shipment guard trigger
create or replace function private.shipments_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_via_rpc boolean := coalesce(current_setting('app.via_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if v_uid is not null or new.shipment_code is null then
      new.shipment_code := case new.department
        when 'NPP' then 'NPM-' || lpad(nextval('public.npp_shipment_seq')::text, 4, '0')
        else 'RDM-' || lpad(nextval('public.rare_shipment_seq')::text, 4, '0')
      end;
    end if;
    if v_uid is not null then
      new.current_stage := 'Inquiry';
      new.stage_entered_at := now();
      new.created_by := v_uid;
      new.source := 'app';
      new.source_ref := null;
      new.created_at := now();
      new.last_activity_at := now();
      new.archived_at := null;
      new.archive_reason := null;
      new.needs_review := false;
      new.is_on_hold := false;
      new.hold_reason := null;
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if v_uid is not null then
    if new.shipment_code <> old.shipment_code
       or new.department <> old.department
       or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at
       or new.source <> old.source
       or new.source_ref is distinct from old.source_ref then
      raise exception 'This field cannot be changed.' using errcode = '42501';
    end if;
    if not v_via_rpc and (
         new.current_stage <> old.current_stage
      or new.stage_entered_at <> old.stage_entered_at
      or new.is_on_hold <> old.is_on_hold
      or new.hold_reason is distinct from old.hold_reason
      or new.archived_at is distinct from old.archived_at
      or new.archive_reason is distinct from old.archive_reason
      or new.pod_received <> old.pod_received) then
      raise exception 'Use the stage, hold or archive actions to change this field.' using errcode = '42501';
    end if;
    if old.archived_at is not null and not v_via_rpc then
      raise exception 'Archived shipments cannot be edited.' using errcode = '42501';
    end if;
    if not v_via_rpc then
      new.last_activity_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger shipments_before_write
before insert or update on public.shipments
for each row execute function private.shipments_before_write();

-- "created" history event for shipments created in the app
create or replace function private.shipments_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then
    insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_by, source)
    values (new.id, null, new.current_stage, 'created', 'Shipment created', auth.uid(), 'app');
  end if;
  return new;
end
$$;

create trigger shipments_after_insert
after insert on public.shipments
for each row execute function private.shipments_after_insert();

-- ---------- Generic audit trigger
create or replace function private.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old_diff jsonb;
  v_new_diff jsonb;
  v_dept public.department;
  v_id uuid;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, value) into v_new_diff
    from jsonb_each(v_new) where v_old -> key is distinct from value and key not in ('updated_at', 'last_activity_at');
    if v_new_diff is null then
      return new;
    end if;
    select jsonb_object_agg(key, v_old -> key) into v_old_diff from jsonb_object_keys(v_new_diff) as key;
  else
    v_old_diff := v_old;
    v_new_diff := v_new;
  end if;

  if tg_table_name <> 'app_settings' then
    v_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  end if;
  if tg_table_name = 'shipments' or tg_table_name = 'medicine_stock' then
    v_dept := coalesce(v_new ->> 'department', v_old ->> 'department')::public.department;
  elsif tg_table_name = 'payments' then
    select s.department into v_dept from public.shipments s where s.id = coalesce(v_new ->> 'shipment_id', v_old ->> 'shipment_id')::uuid;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department, old_values, new_values, reason)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_dept, v_old_diff, v_new_diff,
          nullif(current_setting('app.audit_reason', true), ''));
  return coalesce(new, old);
end
$$;

create trigger audit_shipments after insert or update or delete on public.shipments
for each row execute function private.audit_row();
create trigger audit_payments after insert or update or delete on public.payments
for each row execute function private.audit_row();
create trigger audit_stock after insert or update or delete on public.medicine_stock
for each row execute function private.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles
for each row execute function private.audit_row();
create trigger audit_settings after update on public.app_settings
for each row execute function private.audit_row();

-- updated_at helper for stock/profiles
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_stock before update on public.medicine_stock for each row execute function private.touch_updated_at();
create trigger touch_profiles before update on public.profiles for each row execute function private.touch_updated_at();

-- Stock records: department cannot be moved, quantities only via movements
create or replace function private.stock_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.via_rpc', true), '') <> 'on' then
    if tg_op = 'UPDATE' and (new.department <> old.department
        or new.available_quantity <> old.available_quantity
        or new.reserved_quantity <> old.reserved_quantity) then
      raise exception 'Record a stock movement to change quantities.' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and (new.available_quantity <> 0 or new.reserved_quantity <> 0) then
      raise exception 'New stock items start at zero; record a receipt.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger stock_guard before insert or update on public.medicine_stock for each row execute function private.stock_guard();

-- ---------- Business RPCs (identity always from auth.uid())
create or replace function public.update_shipment_stage(
  p_shipment_id uuid,
  p_new_stage public.shipment_stage,
  p_message text default null,
  p_correction_reason text default null
)
returns public.shipment_updates
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_type text;
  v_row public.shipment_updates;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
  v_reason text := nullif(trim(coalesce(p_correction_reason, '')), '');
begin
  if auth.uid() is null or private.current_app_role() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found or not private.can_access_department(s.department) then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;
  if s.archived_at is not null then
    raise exception 'Archived shipments cannot be updated.' using errcode = '42501';
  end if;
  if s.current_stage = p_new_stage then
    raise exception 'Shipment is already at stage %.', p_new_stage using errcode = '23505';
  end if;
  if length(coalesce(v_msg, '')) > 2000 or length(coalesce(v_reason, '')) > 1000 then
    raise exception 'Text is too long.' using errcode = '22001';
  end if;

  if private.stage_index(p_new_stage) < private.stage_index(s.current_stage) then
    if v_reason is null then
      raise exception 'Moving a shipment back to an earlier stage needs a correction reason.' using errcode = '22023';
    end if;
    v_type := 'stage_correction';
  else
    v_type := 'stage_change';
  end if;

  perform set_config('app.via_rpc', 'on', true);
  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);

  update public.shipments set
    current_stage = p_new_stage,
    stage_entered_at = now(),
    last_activity_at = now(),
    payment_received_date = case when p_new_stage = 'Payment received' then coalesce(payment_received_date, current_date) else payment_received_date end,
    import_permit_date = case when p_new_stage = 'Import permit' then coalesce(import_permit_date, current_date) else import_permit_date end,
    cdec_signed_date = case when p_new_stage = 'CDEC form signed' then coalesce(cdec_signed_date, current_date) else cdec_signed_date end,
    cdec_approved_date = case when p_new_stage = 'CDEC approved' then coalesce(cdec_approved_date, current_date) else cdec_approved_date end,
    order_placed_date = case when p_new_stage = 'Order placed' then coalesce(order_placed_date, current_date) else order_placed_date end,
    shipment_date = case when p_new_stage = 'Shipped' then coalesce(shipment_date, current_date) else shipment_date end,
    customs_entry_date = case when p_new_stage = 'In customs' then coalesce(customs_entry_date, current_date) else customs_entry_date end,
    customs_cleared_date = case when p_new_stage = 'Cleared' then coalesce(customs_cleared_date, current_date) else customs_cleared_date end,
    delivery_date = case when p_new_stage in ('Delivered', 'POD received') then coalesce(delivery_date, current_date) else delivery_date end,
    pod_received = case when p_new_stage = 'POD received' then true when v_type = 'stage_correction' then false else pod_received end,
    pod_received_date = case when p_new_stage = 'POD received' then coalesce(pod_received_date, current_date) when v_type = 'stage_correction' then null else pod_received_date end,
    status_text = coalesce(v_msg, status_text),
    needs_review = false
  where id = p_shipment_id;

  insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_by, source, correction_reason)
  values (p_shipment_id, s.current_stage, p_new_stage, v_type, v_msg, auth.uid(), 'app', v_reason)
  returning * into v_row;

  return v_row;
end
$$;

create or replace function public.add_shipment_note(p_shipment_id uuid, p_message text)
returns public.shipment_updates
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_row public.shipment_updates;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
begin
  if v_msg is null or length(v_msg) > 2000 then
    raise exception 'Note must be between 1 and 2000 characters.' using errcode = '22023';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found or not private.can_access_department(s.department) then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;
  if s.archived_at is not null then
    raise exception 'Archived shipments cannot be updated.' using errcode = '42501';
  end if;
  perform set_config('app.via_rpc', 'on', true);
  update public.shipments set last_activity_at = now(), status_text = v_msg where id = p_shipment_id;
  insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_by, source)
  values (p_shipment_id, s.current_stage, s.current_stage, 'note', v_msg, auth.uid(), 'app')
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.set_shipment_hold(p_shipment_id uuid, p_on_hold boolean, p_reason text default null)
returns public.shipment_updates
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_row public.shipment_updates;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found or not private.can_access_department(s.department) then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;
  if s.archived_at is not null then
    raise exception 'Archived shipments cannot be updated.' using errcode = '42501';
  end if;
  if p_on_hold and v_reason is null then
    raise exception 'A reason is required to place a shipment on hold.' using errcode = '22023';
  end if;
  if s.is_on_hold = p_on_hold then
    raise exception 'No change.' using errcode = '23505';
  end if;
  perform set_config('app.via_rpc', 'on', true);
  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);
  update public.shipments set is_on_hold = p_on_hold, hold_reason = case when p_on_hold then v_reason end, last_activity_at = now()
  where id = p_shipment_id;
  insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_by, source)
  values (p_shipment_id, s.current_stage, s.current_stage, case when p_on_hold then 'hold' else 'release' end,
          case when p_on_hold then 'Placed on hold: ' || v_reason else 'Released from hold' || coalesce(': ' || v_reason, '') end,
          auth.uid(), 'app')
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.archive_shipment(p_shipment_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Only an admin can archive shipments.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  perform set_config('app.via_rpc', 'on', true);
  perform set_config('app.audit_reason', v_reason, true);
  update public.shipments set archived_at = now(), archive_reason = v_reason where id = p_shipment_id and archived_at is null;
  if not found then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;
end
$$;

create or replace function public.record_payment(
  p_shipment_id uuid,
  p_amount numeric,
  p_currency text,
  p_payment_date date default current_date,
  p_account text default null,
  p_reference text default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns public.payments
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_row public.payments;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found or not private.can_access_department(s.department) then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;
  if s.archived_at is not null then
    raise exception 'Archived shipments cannot be updated.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Amount must be a positive number.' using errcode = '22023';
  end if;
  if p_currency is null or upper(p_currency) !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a 3-letter code.' using errcode = '22023';
  end if;
  if p_idempotency_key is not null then
    select * into v_row from public.payments where idempotency_key = p_idempotency_key;
    if found then return v_row; end if;
  end if;
  insert into public.payments (shipment_id, amount, currency, payment_date, account, reference_number, notes, idempotency_key, recorded_by)
  values (p_shipment_id, round(p_amount, 2), upper(p_currency), coalesce(p_payment_date, current_date),
          left(p_account, 100), left(p_reference, 100), left(p_notes, 1000), p_idempotency_key, auth.uid())
  returning * into v_row;

  perform set_config('app.via_rpc', 'on', true);
  update public.shipments set last_activity_at = now(),
    currency = coalesce(currency, upper(p_currency)),
    payment_received_date = coalesce(payment_received_date, v_row.payment_date)
  where id = p_shipment_id;
  insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_by, source, metadata)
  values (p_shipment_id, s.current_stage, s.current_stage, 'payment',
          'Payment recorded: ' || upper(p_currency) || ' ' || to_char(v_row.amount, 'FM999,999,999,990.00'),
          auth.uid(), 'app', jsonb_build_object('payment_id', v_row.id));
  return v_row;
end
$$;

create or replace function public.record_stock_movement(
  p_stock_id uuid,
  p_type public.stock_movement_type,
  p_quantity numeric,
  p_shipment_id uuid default null,
  p_reference text default null,
  p_reason text default null,
  p_idempotency_key text default null
)
returns public.stock_movements
language plpgsql security definer set search_path = ''
as $$
declare
  st public.medicine_stock;
  v_row public.stock_movements;
  v_avail numeric;
  v_res numeric;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into st from public.medicine_stock where id = p_stock_id for update;
  if not found or not private.can_access_department(st.department) then
    raise exception 'Stock item not found.' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity = 0 or abs(p_quantity) > 1000000 then
    raise exception 'Quantity must be a non-zero number.' using errcode = '22023';
  end if;
  if p_type <> 'adjustment' and p_quantity < 0 then
    raise exception 'Quantity must be positive.' using errcode = '22023';
  end if;
  if p_type = 'adjustment' and v_reason is null then
    raise exception 'Adjustments need a reason.' using errcode = '22023';
  end if;
  if p_shipment_id is not null and not private.can_access_shipment(p_shipment_id) then
    raise exception 'Shipment not found.' using errcode = 'P0002';
  end if;
  if p_idempotency_key is not null then
    select * into v_row from public.stock_movements where idempotency_key = p_idempotency_key;
    if found then return v_row; end if;
  end if;

  v_avail := st.available_quantity;
  v_res := st.reserved_quantity;
  case p_type
    when 'receipt' then v_avail := v_avail + p_quantity;
    when 'return' then v_avail := v_avail + p_quantity;
    when 'adjustment' then v_avail := v_avail + p_quantity;
    when 'reservation' then v_avail := v_avail - p_quantity; v_res := v_res + p_quantity;
    when 'release' then v_avail := v_avail + p_quantity; v_res := v_res - p_quantity;
    when 'dispatch' then
      if v_res >= p_quantity then v_res := v_res - p_quantity; else v_avail := v_avail - p_quantity; end if;
  end case;
  if v_avail < 0 or v_res < 0 then
    raise exception 'Not enough stock for this movement.' using errcode = '22023';
  end if;

  perform set_config('app.via_rpc', 'on', true);
  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);
  update public.medicine_stock set available_quantity = v_avail, reserved_quantity = v_res where id = p_stock_id;
  insert into public.stock_movements (stock_id, movement_type, quantity, shipment_id, reference_number, reason, idempotency_key, recorded_by)
  values (p_stock_id, p_type, p_quantity, p_shipment_id, left(p_reference, 100), left(v_reason, 1000), p_idempotency_key, auth.uid())
  returning * into v_row;
  return v_row;
end
$$;

-- Team members visible to the caller (for owner pickers); admins see everyone
create or replace function public.list_team_members()
returns table (id uuid, full_name text, role public.app_role, is_active boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.is_active
  from public.profiles p
  where private.current_app_role() is not null
    and (private.is_admin()
         or p.role = 'admin'
         or p.role = private.current_app_role())
  order by p.full_name
$$;

create or replace function public.admin_update_profile(p_user_id uuid, p_role public.app_role, p_is_active boolean, p_full_name text default null)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare v_row public.profiles;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can manage users.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role or status.' using errcode = '42501';
  end if;
  update public.profiles set role = p_role, is_active = p_is_active,
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name)
  where id = p_user_id returning * into v_row;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  return v_row;
end
$$;

create or replace function public.update_settings(p_stuck_days integer, p_customs_days integer)
returns public.app_settings
language plpgsql security definer set search_path = ''
as $$
declare v_row public.app_settings;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can change settings.' using errcode = '42501';
  end if;
  update public.app_settings set stuck_days = p_stuck_days, customs_days = p_customs_days, updated_at = now(), updated_by = auth.uid()
  where id = 1 returning * into v_row;
  return v_row;
end
$$;

-- ---------- Overview view (RLS applies through security_invoker)
create or replace view public.shipment_overview
with (security_invoker = true)
as
select
  s.*,
  coalesce(pay.received_total, 0)::numeric(14, 2) as received_total,
  pay.last_payment_date,
  coalesce(pay.other_currency_count, 0) as other_currency_payments,
  case
    when s.is_foc then 'FOC'
    when s.pi_amount is null then case when coalesce(pay.received_total, 0) > 0 or s.payment_received_date is not null then 'Received' else 'Unknown' end
    when coalesce(pay.received_total, 0) = 0 then 'Unpaid'
    when pay.received_total < s.pi_amount then 'Partial'
    else 'Paid'
  end as payment_status,
  case when s.pi_amount is not null and not s.is_foc then greatest(s.pi_amount - coalesce(pay.received_total, 0), 0) end::numeric(14, 2) as outstanding_amount,
  (current_date - s.last_activity_at::date) as days_since_update,
  (current_date - s.stage_entered_at::date) as days_in_stage,
  (s.archived_at is null and s.current_stage not in ('Delivered', 'POD received')) as is_open,
  (
    s.archived_at is null and not s.is_on_hold
    and s.current_stage not in ('Delivered', 'POD received')
    and ((current_date - s.last_activity_at::date) >= cfg.stuck_days
         or (s.current_stage = 'In customs' and (current_date - s.stage_entered_at::date) > cfg.customs_days))
  ) as is_stuck,
  case
    when s.archived_at is not null or s.is_on_hold or s.current_stage in ('Delivered', 'POD received') then null
    when s.current_stage = 'In customs' and (current_date - s.stage_entered_at::date) > cfg.customs_days then 'In customs > ' || cfg.customs_days || ' days'
    when (current_date - s.last_activity_at::date) >= cfg.stuck_days then 'No update for ' || (current_date - s.last_activity_at::date) || ' days'
  end as stuck_reason,
  private.stage_index(s.current_stage) as stage_order
from public.shipments s
cross join public.app_settings cfg
left join lateral (
  select
    sum(p.amount) filter (where p.currency = coalesce(s.currency, p.currency)) as received_total,
    max(p.payment_date) as last_payment_date,
    count(*) filter (where s.currency is not null and p.currency <> s.currency) as other_currency_count
  from public.payments p
  where p.shipment_id = s.id
) pay on true;

-- ---------- Row Level Security
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_updates enable row level security;
alter table public.payments enable row level security;
alter table public.medicine_stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;

-- No anonymous access to anything
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Authenticated users: writes only where intended; history/audit/payments/movements are RPC-only
revoke insert, update, delete, truncate on public.profiles, public.app_settings, public.shipment_updates,
  public.payments, public.stock_movements, public.audit_logs from authenticated;
revoke delete, truncate on public.shipments, public.medicine_stock from authenticated;

grant execute on function public.update_shipment_stage(uuid, public.shipment_stage, text, text) to authenticated;
grant execute on function public.add_shipment_note(uuid, text) to authenticated;
grant execute on function public.set_shipment_hold(uuid, boolean, text) to authenticated;
grant execute on function public.archive_shipment(uuid, text) to authenticated;
grant execute on function public.record_payment(uuid, numeric, text, date, text, text, text, text) to authenticated;
grant execute on function public.record_stock_movement(uuid, public.stock_movement_type, numeric, uuid, text, text, text) to authenticated;
grant execute on function public.list_team_members() to authenticated;
grant execute on function public.admin_update_profile(uuid, public.app_role, boolean, text) to authenticated;
grant execute on function public.update_settings(integer, integer) to authenticated;
grant select on public.shipment_overview to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_admin());

create policy settings_select on public.app_settings for select to authenticated
  using (private.current_app_role() is not null);

create policy shipments_select on public.shipments for select to authenticated
  using (private.can_access_department(department) and (archived_at is null or private.is_admin()));
create policy shipments_insert on public.shipments for insert to authenticated
  with check (private.can_access_department(department));
create policy shipments_update on public.shipments for update to authenticated
  using (private.can_access_department(department) and archived_at is null)
  with check (private.can_access_department(department));

create policy updates_select on public.shipment_updates for select to authenticated
  using (private.can_access_shipment(shipment_id));

create policy payments_select on public.payments for select to authenticated
  using (private.can_access_shipment(shipment_id));

create policy stock_select on public.medicine_stock for select to authenticated
  using (private.can_access_department(department));
create policy stock_insert on public.medicine_stock for insert to authenticated
  with check (private.can_access_department(department));
create policy stock_update on public.medicine_stock for update to authenticated
  using (private.can_access_department(department))
  with check (private.can_access_department(department));

create policy movements_select on public.stock_movements for select to authenticated
  using (exists (select 1 from public.medicine_stock m where m.id = stock_id and private.can_access_department(m.department)));

create policy audit_select on public.audit_logs for select to authenticated
  using (private.is_admin());

-- ---------- Private document storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shipment-documents', 'shipment-documents', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy docs_select on storage.objects for select to authenticated
  using (bucket_id = 'shipment-documents' and private.can_access_shipment_folder((storage.foldername(name))[1]));
create policy docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shipment-documents'
    and private.can_access_shipment_folder((storage.foldername(name))[1])
    and array_length(storage.foldername(name), 1) = 1
    and storage.filename(name) ~ '^[0-9]{13}-[A-Za-z0-9._-]{1,120}\.(pdf|png|jpe?g|webp)$'
  );
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shipment-documents' and private.is_admin());

-- ---------- Realtime (RLS is applied to postgres_changes subscribers)
alter publication supabase_realtime add table public.shipments, public.shipment_updates, public.payments, public.medicine_stock, public.stock_movements;
