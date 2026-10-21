-- Make the RPC bypass flag single-use so it cannot leak to later statements in the same transaction
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
    else
      -- the RPC permission is single-use: consumed by the one row the RPC updates
      perform set_config('app.via_rpc', '', true);
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;


create or replace function private.stock_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.via_rpc', true), '') = 'on' then
    perform set_config('app.via_rpc', '', true);  -- single-use
    return new;
  end if;
  if auth.uid() is not null then
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
