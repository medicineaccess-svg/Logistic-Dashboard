-- Legacy sheet import (run only by the database owner / service role; not exposed to app users)
create or replace function private.import_legacy(p jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  c jsonb := p -> 'cols';
  r jsonb;
  rec jsonb;
  h jsonb;
  v_id uuid;
  v_last timestamptz;
  n integer := 0;
begin
  for r in select value from jsonb_array_elements(p -> 'rows') loop
    select jsonb_object_agg(c ->> (t.ord - 1)::int, t.val) into rec
    from jsonb_array_elements(r) with ordinality as t(val, ord);

    v_last := ((rec ->> 'last_activity_at') || ' 12:00:00+05:30')::timestamptz;

    insert into public.shipments (
      shipment_code, department, patient_reference, patient_name, hospital_name, doctor_name,
      medicine_name, strength, quantity, quantity_unit, quantity_text, manufacturer, region,
      current_stage, stage_entered_at, owner_name, payment_account, gst_status, is_foc,
      payment_received_date, import_permit_date, order_placed_date, awb_number, cha_name,
      delivery_date, needs_review, review_note, status_text, last_activity_at, notes,
      source, source_ref, archived_at, archive_reason
    ) values (
      rec ->> 'code',
      (rec ->> 'department')::public.department,
      rec ->> 'source_ref',
      rec ->> 'patient_name',
      rec ->> 'hospital_name',
      rec ->> 'doctor_name',
      rec ->> 'medicine_name',
      rec ->> 'strength',
      (rec ->> 'quantity')::numeric,
      rec ->> 'quantity_unit',
      rec ->> 'quantity_text',
      rec ->> 'manufacturer',
      rec ->> 'region',
      (rec ->> 'current_stage')::public.shipment_stage,
      v_last,
      rec ->> 'owner_name',
      rec ->> 'payment_account',
      coalesce((rec ->> 'gst_status')::public.gst_status, 'Not applicable'),
      coalesce((rec ->> 'is_foc')::int, 0) = 1,
      (rec ->> 'payment_received_date')::date,
      (rec ->> 'import_permit_date')::date,
      (rec ->> 'order_placed_date')::date,
      rec ->> 'awb_number',
      rec ->> 'cha_name',
      (rec ->> 'delivery_date')::date,
      coalesce((rec ->> 'needs_review')::int, 0) = 1,
      rec ->> 'review_note',
      rec ->> 'status_text',
      v_last,
      rec ->> 'notes',
      'sheet_import',
      rec ->> 'source_ref',
      case when rec ->> 'archive_reason' is not null then now() end,
      rec ->> 'archive_reason'
    )
    returning id into v_id;

    if jsonb_typeof(rec -> 'history') = 'array' then
      for h in select value from jsonb_array_elements(rec -> 'history') loop
        insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_at, source, metadata)
        values (v_id, null, (h ->> 2)::public.shipment_stage, 'migration', h ->> 1,
                ((h ->> 0) || ' 12:00:00+05:30')::timestamptz, 'sheet_import',
                jsonb_build_object('legacy_daily_column', h ->> 0));
      end loop;
    end if;

    insert into public.shipment_updates (shipment_id, previous_stage, new_stage, update_type, update_message, updated_at, source, metadata)
    values (v_id, null, (rec ->> 'current_stage')::public.shipment_stage, 'migration',
            'Imported from legacy sheet (' || (rec ->> 'source_ref') || ')' || coalesce('. Last status: ' || (rec ->> 'status_text'), ''),
            now(), 'sheet_import',
            jsonb_build_object('source_ref', rec ->> 'source_ref', 'needs_review', rec -> 'needs_review'));
    n := n + 1;
  end loop;
  return n;
end
$$;

revoke all on function private.import_legacy(jsonb) from public, anon, authenticated;
