-- Lets the Apps Script in each Google Sheet register its web-app URL (called by the sheet-sync
-- Edge Function after the shared secret is verified). Service role only.
create or replace function public.set_sync_webapp_url(p_department public.department, p_url text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
    raise exception 'invalid web app url';
  end if;
  insert into private.sync_config(key, value, updated_at)
  values ('WEBAPP_URL_' || p_department::text, p_url, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function public.set_sync_webapp_url(public.department, text) from public, anon, authenticated;
grant execute on function public.set_sync_webapp_url(public.department, text) to service_role;
