// Edge Function: two-way Google Sheets sync for the Logistics Control Tower.
//
//  POST {action:"push"}     from Apps Script (x-sync-secret) : sheet rows → shipments; returns CT values to write back
//  POST {action:"mirror"}   from Apps Script (x-sync-secret) : returns the read-only "CT Export (Supabase)" table
//  POST {action:"register"} from Apps Script (x-sync-secret) : stores the sheet's web-app URL
//  POST {action:"sync"}     from the dashboard (user JWT)    : asks each sheet's Apps Script web app to run a full sync
//
// Secrets live in private.sync_config (read via get_sync_config(), service role only). The browser never sees them.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  Columns,
  CT_HEADERS,
  isBlank,
  key,
  nppRecord,
  rowSignature,
  stageIndex,
  STAGES,
  totRecord,
  type Department,
  type SheetRecord,
  type Stage,
} from './mapping.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

let configCache: { at: number; values: Record<string, string> } | null = null;
async function config(): Promise<Record<string, string>> {
  if (configCache && Date.now() - configCache.at < 60_000) return configCache.values;
  const { data, error } = await admin.rpc('get_sync_config');
  if (error) throw new Error('config unavailable');
  const values: Record<string, string> = {};
  for (const r of (data ?? []) as { key: string; value: string }[]) values[r.key] = r.value;
  configCache = { at: Date.now(), values };
  return values;
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sha1(s: string) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MILESTONE: Partial<Record<Stage, string>> = {
  'Payment received': 'payment_received_date',
  'Import permit': 'import_permit_date',
  'CDEC form signed': 'cdec_signed_date',
  'CDEC approved': 'cdec_approved_date',
  'Order placed': 'order_placed_date',
  Shipped: 'shipment_date',
  'In customs': 'customs_entry_date',
  Cleared: 'customs_cleared_date',
  Delivered: 'delivery_date',
};

const istStamp = (d: string | Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

interface ShipRow {
  id: string;
  shipment_code: string;
  patient_name: string | null;
  medicine_name: string;
  source: string;
  source_ref: string | null;
  sheet_hash: string | null;
  current_stage: Stage;
  status_text: string | null;
  archived_at: string | null;
  payment_received_date: string | null;
  import_permit_date: string | null;
  order_placed_date: string | null;
  delivery_date: string | null;
  last_activity_at: string;
  [k: string]: unknown;
}

const FIELDS: (keyof SheetRecord)[] = [
  'patient_name',
  'hospital_name',
  'doctor_name',
  'medicine_name',
  'strength',
  'quantity',
  'quantity_unit',
  'quantity_text',
  'owner_name',
  'region',
  'manufacturer',
  'cha_name',
  'awb_number',
  'payment_account',
];

async function push(body: {
  department: Department;
  trigger?: string;
  triggered_by?: string;
  headers: string[];
  rows: { row: number; values: unknown[] }[];
  /** rows where a person edited the CT Stage cell (dropdown) — that value is applied exactly */
  stage_rows?: number[];
}) {
  const dept = body.department;
  if (dept !== 'NPP' && dept !== 'RARE_DISEASE') return json({ error: 'bad department' }, 400);
  if (!Array.isArray(body.headers) || !Array.isArray(body.rows) || body.rows.length > 3000) return json({ error: 'bad payload' }, 400);
  const trigger = ['sheet_edit', 'manual', 'scheduled', 'menu'].includes(body.trigger ?? '') ? body.trigger! : 'sheet_edit';
  let triggeredBy: string | null = null;
  if (body.triggered_by && /^[0-9a-f-]{36}$/.test(body.triggered_by)) {
    const { data } = await admin.from('profiles').select('id').eq('id', body.triggered_by).maybeSingle();
    triggeredBy = data ? body.triggered_by : null;
  }

  const { data: run } = await admin
    .from('sheet_sync_runs')
    .insert({ department: dept, trigger_source: trigger, triggered_by: triggeredBy, rows_seen: body.rows.length })
    .select('id')
    .single();
  const runId = (run as { id: number } | null)?.id;

  const cols = new Columns(body.headers.map((h) => String(h ?? '')));
  const [ctIdCol, ctStageCol] = cols.ctIndexes();
  const stageRows = new Set((body.stage_rows ?? []).filter((n) => Number.isInteger(n)));
  const tabPrefix = dept === 'NPP' ? 'NPP:NPM:' : 'TOT:';

  const { data: existing, error: exErr } = await admin.from('shipments').select('*').eq('department', dept).limit(10000);
  if (exErr) return json({ error: 'load failed' }, 500);
  const all = (existing ?? []) as ShipRow[];
  const byCode = new Map(all.map((s) => [s.shipment_code, s]));
  const claimed = new Set<string>();
  // Codes already written in the sheet (in this payload) are claimed by their rows.
  for (const r of body.rows) {
    const c = ctIdCol >= 0 ? String(r.values[ctIdCol] ?? '').trim() : '';
    if (byCode.has(c)) claimed.add(c);
  }

  const results: { row: number; code: string; stage: string; updated: string }[] = [];
  const stats = { created: 0, updated: 0, unchanged: 0, flagged: 0, skipped: 0 };
  const seenSignatures = new Map<string, string>();
  const now = new Date().toISOString();

  for (const r of body.rows) {
    const values = r.values ?? [];
    if (isBlank(cols, values, dept)) {
      stats.skipped++;
      continue;
    }
    const sig = rowSignature(cols, values);
    const hash = await sha1(sig);
    const rec = dept === 'NPP' ? nppRecord(cols, values) : totRecord(cols, values);
    let ship: ShipRow | undefined;
    const written = ctIdCol >= 0 ? String(values[ctIdCol] ?? '').trim() : '';
    if (written && byCode.has(written)) ship = byCode.get(written);

    if (!ship) {
      // First sync of a legacy row: match the imported shipment by patient + medicine (prefer same row number).
      const pk = key(rec.patient_name);
      const mk = key(rec.medicine_name);
      const samePatient = (s: ShipRow) =>
        !claimed.has(s.shipment_code) && pk !== '' && key(s.patient_name) === pk && (mk === '' || key(s.medicine_name) === mk || s.medicine_name === 'Not recorded');
      // 1) already linked to this sheet row (CT ID cell cleared or not yet written back)
      ship = all.find((s) => samePatient(s) && s.sheet_hash && s.sheet_row === r.row);
      if (!ship) {
        // 2) first link of a shipment imported from the sheet
        const cands = all.filter((s) => samePatient(s) && !s.sheet_hash && (s.source === 'sheet_import' || s.source === 'sheet_sync'));
        ship = cands.find((s) => s.source_ref === `${tabPrefix}${r.row}`) ?? cands[0];
      }
    }
    if (!ship && seenSignatures.has(hash)) {
      // Exact duplicate of a row already handled in this run — don't create a second shipment.
      const code = seenSignatures.get(hash)!;
      const s = byCode.get(code);
      results.push({ row: r.row, code, stage: s?.current_stage ?? '', updated: s ? istStamp(s.last_activity_at) : '' });
      stats.skipped++;
      continue;
    }

    if (!ship) {
      const insert: Record<string, unknown> = {
        department: dept,
        medicine_name: rec.medicine_name ?? 'Not recorded',
        current_stage: rec.stage,
        stage_entered_at: now,
        last_activity_at: now,
        source: 'sheet_sync',
        source_ref: `${tabPrefix}${r.row}`,
        patient_reference: `${tabPrefix}${r.row}`,
        status_text: rec.status_text,
        needs_review: !rec.confident || !!rec.review_note,
        review_note: rec.review_note,
        gst_status: rec.gst_pending ? 'Pending' : 'Not applicable',
        is_foc: rec.is_foc,
        sheet_hash: hash,
        sheet_row: r.row,
        sheet_synced_at: now,
        sheet_payment_status: rec.sheet_payment_status,
      };
      for (const f of FIELDS) if (f !== 'medicine_name' && rec[f] != null) insert[f] = rec[f];
      for (const f of ['payment_received_date', 'import_permit_date', 'order_placed_date', 'delivery_date'] as const) if (rec[f]) insert[f] = rec[f];
      const { data: created, error } = await admin.from('shipments').insert(insert).select('*').single();
      if (error || !created) {
        stats.flagged++;
        continue;
      }
      const c = created as ShipRow;
      await admin.from('shipment_updates').insert({
        shipment_id: c.id,
        new_stage: c.current_stage,
        update_type: 'sheet_sync',
        update_message: `Created from Google Sheet row ${r.row}${rec.status_text ? `. Status: ${rec.status_text}` : ''}`,
        source: 'google_sheet',
        metadata: { row: r.row, trigger },
      });
      all.push(c);
      byCode.set(c.shipment_code, c);
      claimed.add(c.shipment_code);
      seenSignatures.set(hash, c.shipment_code);
      stats.created++;
      results.push({ row: r.row, code: c.shipment_code, stage: c.current_stage, updated: istStamp(c.last_activity_at) });
      continue;
    }

    claimed.add(ship.shipment_code);
    seenSignatures.set(hash, ship.shipment_code);
    // A person picked a stage in the sheet's CT Stage dropdown: apply exactly that stage (forward or back).
    const picked = stageRows.has(r.row) && ctStageCol >= 0 ? String(values[ctStageCol] ?? '').trim() : '';
    const explicit = (STAGES as readonly string[]).includes(picked) && picked !== ship.current_stage ? (picked as Stage) : null;
    if ((ship.sheet_hash === hash && !explicit) || ship.archived_at) {
      stats.unchanged++;
      if (ship.sheet_row !== r.row) await admin.from('shipments').update({ sheet_row: r.row }).eq('id', ship.id);
      results.push({ row: r.row, code: ship.shipment_code, stage: ship.current_stage, updated: istStamp(ship.last_activity_at) });
      continue;
    }

    const patch: Record<string, unknown> = { sheet_hash: hash, sheet_row: r.row, sheet_synced_at: now };
    let meaningful = false;
    for (const f of FIELDS) {
      const v = rec[f];
      if (v == null || v === '' || (f === 'medicine_name' && v === 'Not recorded')) continue;
      if (String(ship[f] ?? '') !== String(v)) {
        patch[f] = v;
        meaningful = true;
      }
    }
    // Payment: the sheet's Payment status / Payment received date cells are copied exactly.
    if ((rec.sheet_payment_status ?? null) !== ((ship.sheet_payment_status as string | null) ?? null)) {
      patch.sheet_payment_status = rec.sheet_payment_status;
      meaningful = true;
    }
    if (rec.payment_not_received) {
      if (ship.payment_received_date) patch.payment_received_date = null;
    } else if (rec.payment_received_date && rec.payment_received_date !== ship.payment_received_date) {
      patch.payment_received_date = rec.payment_received_date;
    }
    if (rec.import_permit_date && !ship.import_permit_date) patch.import_permit_date = rec.import_permit_date;
    if (rec.order_placed_date && !ship.order_placed_date) patch.order_placed_date = rec.order_placed_date;
    if (rec.gst_pending) patch.gst_status = 'Pending';

    // First time a legacy (imported) row is linked to the sheet: only treat it as news if the stage moved;
    // small wording differences from the one-off import must not reset the 5-day clock or spam the timeline.
    const firstLink = !ship.sheet_hash;
    const textDiffers = (rec.status_text ?? '') !== (ship.status_text ?? '');
    const statusChanged = textDiffers && !(firstLink && rec.stage === ship.current_stage);
    const from = ship.current_stage;
    let to: Stage = from;
    let backward = false;
    // Only the milestone of the stage actually reached gets a date, taken from the sheet
    // (delivery date cell, or the date header of the column the status was read from). No invented dates.
    const setMilestone = (st: Stage) => {
      const col = MILESTONE[st];
      if (!col || col === 'payment_received_date' || ship![col]) return;
      const d = st === 'Delivered' ? rec.delivery_date ?? rec.last_dated : rec.last_dated;
      if (d) patch[col] = d;
    };
    if (explicit) {
      to = explicit;
      backward = stageIndex(to) < stageIndex(from);
      patch.current_stage = to;
      patch.stage_entered_at = now;
      patch.needs_review = false;
      patch.review_note = null;
    } else if (rec.payment_not_received && from === 'Payment received' && rec.stage === 'Inquiry') {
      // The only reason it was at Payment received was the payment; the sheet now says Not Received.
      to = 'Inquiry';
      backward = true;
      patch.current_stage = to;
      patch.stage_entered_at = now;
    } else if (rec.stage !== from) {
      if (stageIndex(rec.stage) > stageIndex(from)) {
        to = rec.stage;
        patch.current_stage = to;
        patch.stage_entered_at = now;
        setMilestone(to);
        patch.needs_review = !rec.confident;
        patch.review_note = rec.confident ? null : rec.review_note;
      } else if (statusChanged) {
        patch.needs_review = true;
        patch.review_note = `Google Sheet now says '${rec.status_text ?? ''}' (= ${rec.stage}) but the dashboard is at ${from}. Check which is correct.`;
        stats.flagged++;
      }
    }
    if (textDiffers) patch.status_text = rec.status_text;
    if (statusChanged || to !== from || (meaningful && !firstLink)) patch.last_activity_at = now;

    const { error } = await admin.from('shipments').update(patch).eq('id', ship.id);
    if (error) {
      stats.flagged++;
      results.push({ row: r.row, code: ship.shipment_code, stage: ship.current_stage, updated: istStamp(ship.last_activity_at) });
      continue;
    }
    if (to !== from || statusChanged) {
      const why = explicit
        ? `Stage set to ${to} in Google Sheet (row ${r.row})`
        : backward
          ? `Google Sheet payment status is '${rec.sheet_payment_status ?? ''}' (row ${r.row})`
          : `Updated from Google Sheet (row ${r.row})${rec.status_text ? `: ${rec.status_text}` : ''}`;
      await admin.from('shipment_updates').insert({
        shipment_id: ship.id,
        previous_stage: from,
        new_stage: to,
        update_type: backward ? 'stage_correction' : 'sheet_sync',
        update_message: why,
        correction_reason: backward ? why : null,
        source: 'google_sheet',
        metadata: { row: r.row, trigger, explicit: !!explicit },
      });
    }
    stats.updated++;
    results.push({ row: r.row, code: ship.shipment_code, stage: to, updated: istStamp(patch.last_activity_at ? now : ship.last_activity_at) });
  }

  if (runId) {
    await admin
      .from('sheet_sync_runs')
      .update({ finished_at: new Date().toISOString(), status: 'ok', created: stats.created, updated: stats.updated, unchanged: stats.unchanged, flagged: stats.flagged })
      .eq('id', runId);
  }
  return json({ ok: true, runId, ctHeaders: CT_HEADERS, results, stats });
}

async function mirror(dept: Department) {
  if (dept !== 'NPP' && dept !== 'RARE_DISEASE') return json({ error: 'bad department' }, 400);
  const { data, error } = await admin
    .from('shipment_overview')
    .select('shipment_code,current_stage,patient_name,hospital_name,doctor_name,medicine_name,strength,quantity_text,quantity,owner_name,payment_status,pi_amount,currency,gst_status,awb_number,delivery_date,pod_received,is_on_hold,hold_reason,stuck_reason,last_activity_at,status_text,archived_at')
    .eq('department', dept)
    .order('shipment_code')
    .limit(10000);
  if (error) return json({ error: 'load failed' }, 500);
  const header = ['Shipment ID', 'Stage', 'Patient', 'Hospital', 'Doctor', 'Medicine', 'Strength', 'Quantity', 'Owner', 'Payment status', 'PI amount', 'Currency', 'GST', 'AWB', 'Delivery date', 'POD received', 'On hold', 'Alert', 'Last update (IST)', 'Latest note', 'Archived'];
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => [
    r.shipment_code,
    r.current_stage,
    r.patient_name ?? '',
    r.hospital_name ?? '',
    r.doctor_name ?? '',
    r.medicine_name ?? '',
    r.strength ?? '',
    r.quantity_text ?? r.quantity ?? '',
    r.owner_name ?? '',
    r.payment_status ?? '',
    r.pi_amount ?? '',
    r.currency ?? '',
    r.gst_status ?? '',
    r.awb_number ?? '',
    r.delivery_date ?? '',
    r.pod_received ? 'Yes' : 'No',
    r.is_on_hold ? `Yes: ${r.hold_reason ?? ''}` : '',
    r.stuck_reason ?? '',
    istStamp(String(r.last_activity_at)),
    String(r.status_text ?? '').slice(0, 300),
    r.archived_at ? 'Archived' : '',
  ]);
  return json({ ok: true, header, rows, refreshed: istStamp(new Date()) });
}

async function dashboardSync(req: Request, body: { department?: string }) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: 'Sign in again.' }, 401);
  const { data: prof } = await admin.from('profiles').select('id,role,is_active').eq('id', u.user.id).maybeSingle();
  const p = prof as { id: string; role: string; is_active: boolean } | null;
  if (!p || !p.is_active) return json({ error: 'Not authorised.' }, 403);
  const allowed: Department[] = p.role === 'admin' ? ['NPP', 'RARE_DISEASE'] : p.role === 'npp' ? ['NPP'] : ['RARE_DISEASE'];
  const wanted = body.department === 'NPP' || body.department === 'RARE_DISEASE' ? [body.department as Department] : allowed;
  const depts = wanted.filter((d) => allowed.includes(d));
  if (depts.length === 0) return json({ error: 'Not authorised.' }, 403);

  // Simple abuse guard: at most one manual sync per department per 30 seconds.
  const since = new Date(Date.now() - 30_000).toISOString();
  const { count } = await admin.from('sheet_sync_runs').select('id', { count: 'exact', head: true }).in('department', depts).eq('trigger_source', 'manual').gte('started_at', since);
  if ((count ?? 0) > 0) return json({ error: 'A sync just ran. Try again in a few seconds.' }, 429);

  const cfg = await config();
  const out: Record<string, unknown> = {};
  for (const d of depts) {
    const url = cfg[`WEBAPP_URL_${d}`];
    if (!url) {
      out[d] = { ok: false, error: 'This Google Sheet is not connected yet (Apps Script not installed).' };
      continue;
    }
    try {
      const res = await fetch(`${url}?action=sync&token=${encodeURIComponent(cfg.SHEET_SYNC_SECRET)}&by=${p.id}`, { redirect: 'follow' });
      const txt = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(txt);
      } catch {
        parsed = null;
      }
      out[d] = parsed ?? { ok: false, error: 'The Google Sheet did not respond correctly.' };
    } catch {
      out[d] = { ok: false, error: 'Could not reach the Google Sheet.' };
    }
  }
  return json({ ok: true, results: out });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  try {
    const secret = req.headers.get('x-sync-secret') ?? String(body.secret ?? '');
    if (body.action === 'push' || body.action === 'mirror' || body.action === 'register') {
      const cfg = await config();
      if (!safeEqual(secret, cfg.SHEET_SYNC_SECRET ?? '')) return json({ error: 'unauthorised' }, 401);
      if (body.action === 'mirror') return await mirror(body.department as Department);
      if (body.action === 'register') {
        const d = body.department;
        if (d !== 'NPP' && d !== 'RARE_DISEASE') return json({ error: 'bad department' }, 400);
        const { error } = await admin.rpc('set_sync_webapp_url', { p_department: d, p_url: String(body.url ?? '') });
        if (error) return json({ error: 'The web app URL must end in /exec (Deploy > Manage deployments > Web app URL).' }, 400);
        configCache = null;
        return json({ ok: true });
      }
      return await push(body as unknown as Parameters<typeof push>[0]);
    }
    if (body.action === 'sync') return await dashboardSync(req, body as { department?: string });
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error('sheet-sync failure', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'Sync failed. Please retry.' }, 500);
  }
});

export type { SupabaseClient };
