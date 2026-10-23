-- Monthly sales copied from the Recordati sheet's "Monthy Sales Data" tab.
-- Visible to admin and the Recordati (rare_disease) team only. Replaced in full on every sync.
create table if not exists public.monthly_sales (
  id bigint generated always as identity primary key,
  department public.department not null default 'RARE_DISEASE',
  sheet_row integer not null,
  sales_person text,
  month_label text,            -- exactly as written in the sheet (e.g. "April", "Nov-25", "Pending")
  sale_month date,             -- first day of the month, null when the label is not a month
  place text,
  patient_name text,
  hospital_doctor text,
  product text,
  quantity numeric(12,2),
  price_per_pack_text text,    -- exactly as written
  total_foreign numeric(14,2),
  foreign_currency text check (foreign_currency in ('EUR', 'USD')),
  total_inr numeric(14,2),     -- null when the sheet has no INR amount
  synced_at timestamptz not null default now()
);
create index if not exists monthly_sales_dept_month_idx on public.monthly_sales (department, sale_month);

alter table public.monthly_sales enable row level security;
revoke all on public.monthly_sales from anon;
revoke insert, update, delete, truncate on public.monthly_sales from authenticated;
create policy monthly_sales_select on public.monthly_sales for select to authenticated
  using (private.can_access_department(department));

alter publication supabase_realtime add table public.monthly_sales;

-- Atomic full replace, called by the sheet-sync Edge Function (service role only).
create or replace function public.replace_monthly_sales(p_department public.department, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from public.monthly_sales where department = p_department;
  insert into public.monthly_sales (department, sheet_row, sales_person, month_label, sale_month, place, patient_name,
    hospital_doctor, product, quantity, price_per_pack_text, total_foreign, foreign_currency, total_inr)
  select p_department, (r->>'sheet_row')::int, r->>'sales_person', r->>'month_label', (r->>'sale_month')::date,
    r->>'place', r->>'patient_name', r->>'hospital_doctor', r->>'product', (r->>'quantity')::numeric,
    r->>'price_per_pack_text', (r->>'total_foreign')::numeric, r->>'foreign_currency', (r->>'total_inr')::numeric
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.replace_monthly_sales(public.department, jsonb) from public, anon, authenticated;
grant execute on function public.replace_monthly_sales(public.department, jsonb) to service_role;
