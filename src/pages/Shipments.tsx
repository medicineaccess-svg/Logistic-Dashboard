import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Filter, Pause, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { DEPT_LABEL, OPEN_STAGES, STAGES } from '../lib/constants';
import type { ShipmentOverview } from '../lib/types';
import { daysLabel, downloadCsv, fmtDate, monthStartISO } from '../lib/format';
import { notify } from '../lib/errors';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { Badge, Button, Card, DeptBadge, Empty, Input, PageHeader, PaymentBadge, Select, Skeleton, StageBadge } from '../components/ui';
import { NewShipmentModal } from '../components/NewShipmentModal';
import { StageUpdateModal } from '../components/StageUpdateModal';

type Row = ShipmentOverview;

const VIEWS: Record<string, { title: string; subtitle: string }> = {
  all: { title: 'Shipments', subtitle: 'Every shipment you have access to' },
  open: { title: 'Open shipments', subtitle: 'Not yet delivered' },
  stuck: { title: 'Stuck shipments', subtitle: 'No update for 5+ days, or in customs for more than 7 days (on-hold excluded)' },
  permits: { title: 'Import permits & CDEC', subtitle: 'Open shipments between payment and CDEC approval' },
  delivered_month: { title: 'Delivered this month', subtitle: 'By recorded delivery date' },
  review: { title: 'Needs review', subtitle: 'Imported rows where the sheet was ambiguous or contradictory' },
  hold: { title: 'On hold', subtitle: 'Excluded from stuck alerts while on hold' },
};

const COLUMNS = [
  { key: 'department', label: 'Dept' },
  { key: 'patient', label: 'Patient' },
  { key: 'hospital', label: 'Hospital' },
  { key: 'medicine', label: 'Medicine' },
  { key: 'qty', label: 'Qty' },
  { key: 'stage', label: 'Stage' },
  { key: 'in_stage', label: 'In stage' },
  { key: 'owner', label: 'Owner' },
  { key: 'payment', label: 'Payment' },
  { key: 'awb', label: 'AWB / tracking' },
  { key: 'updated', label: 'Last update' },
  { key: 'eta', label: 'Expected' },
  { key: 'alert', label: 'Alert' },
] as const;
type ColKey = (typeof COLUMNS)[number]['key'];
const DEFAULT_HIDDEN: ColKey[] = ['hospital', 'awb', 'eta'];
const COLS_KEY = 'ikris.cols';

const SORTS: Record<string, string> = {
  code: 'shipment_code',
  updated: 'last_activity_at',
  stage: 'stage_order',
  medicine: 'medicine_name',
};

/** Strip characters that have meaning in PostgREST filter syntax so search text can't alter the query. */
function safeTerm(q: string) {
  return q.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60);
}

export function Shipments() {
  const { scope, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [owners, setOwners] = useState<string[]>([]);
  const [showCols, setShowCols] = useState(false);
  const [hidden, setHidden] = useState<ColKey[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') ?? DEFAULT_HIDDEN;
    } catch {
      return DEFAULT_HIDDEN;
    }
  });
  const [stageTarget, setStageTarget] = useState<Row | null>(null);

  const view = params.get('view') ?? 'all';
  const q = params.get('q') ?? '';
  const stage = params.get('stage') ?? '';
  const owner = params.get('owner') ?? '';
  const pay = params.get('pay') ?? '';
  const deptParam = params.get('dept') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const archived = params.get('archived') === '1';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const size = [25, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 25;
  const sort = params.get('sort') ?? 'updated';
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const dept = deptParam === 'NPP' || deptParam === 'RARE_DISEASE' ? deptParam : scope !== 'ALL' ? scope : '';

  const set = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const buildQuery = useCallback(
    (forExport = false) => {
      let query = supabase.from('shipment_overview').select('*', { count: forExport ? undefined : 'exact' });
      if (!archived) query = query.is('archived_at', null);
      if (dept) query = query.eq('department', dept);
      if (stage) query = query.eq('current_stage', stage);
      if (owner) query = owner === '__none' ? query.is('owner_name', null) : query.eq('owner_name', owner);
      if (pay) query = query.eq('payment_status', pay);
      if (from) query = query.gte('last_activity_at', from);
      if (to) query = query.lte('last_activity_at', `${to}T23:59:59`);
      const term = safeTerm(q);
      if (term) {
        const like = `%${term}%`;
        query = query.or(
          ['shipment_code', 'patient_name', 'patient_reference', 'medicine_name', 'hospital_name', 'awb_number', 'tracking_number', 'owner_name']
            .map((c) => `${c}.ilike.${like}`)
            .join(','),
        );
      }
      switch (view) {
        case 'open':
          query = query.eq('is_open', true);
          break;
        case 'stuck':
          query = query.eq('is_stuck', true);
          break;
        case 'permits':
          query = query.eq('is_open', true).in('current_stage', ['Inquiry', 'Payment received', 'Import permit', 'CDEC form signed', 'CDEC approved']);
          break;
        case 'delivered_month':
          query = query.gte('delivery_date', monthStartISO());
          break;
        case 'review':
          query = query.eq('needs_review', true);
          break;
        case 'hold':
          query = query.eq('is_on_hold', true);
          break;
      }
      const col = SORTS[sort] ?? 'last_activity_at';
      query = query.order(col, { ascending: dir === 'asc' }).order('shipment_code', { ascending: true });
      return query;
    },
    [archived, dept, stage, owner, pay, from, to, q, view, sort, dir],
  );

  const load = useCallback(async () => {
    const start = (page - 1) * size;
    const { data, error, count: c } = await buildQuery().range(start, start + size - 1);
    if (error) notify.error(error, 'list-load');
    setRows((data as unknown as Row[] | null) ?? []);
    setCount(c ?? 0);
    setLoading(false);
  }, [buildQuery, page, size]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    let oq = supabase.from('shipments').select('owner_name').not('owner_name', 'is', null).limit(5000);
    if (dept) oq = oq.eq('department', dept);
    oq.then(({ data }) => {
      const set = new Set(((data as unknown as { owner_name: string }[] | null) ?? []).map((r) => r.owner_name));
      setOwners([...set].sort());
    });
  }, [dept]);

  useRealtimeRefresh('shipments-list', ['shipments', 'payments'], load);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(hidden));
    } catch {
      /* ignore */
    }
  }, [hidden]);

  const exportCsv = async () => {
    const { data, error } = await buildQuery(true).range(0, 4999);
    if (error) return notify.error(error);
    const list = (data as unknown as Row[]) ?? [];
    downloadCsv(`shipments-${new Date().toISOString().slice(0, 10)}.csv`, list as unknown as Record<string, unknown>[], [
      { key: 'shipment_code', label: 'Shipment ID' },
      { key: 'department', label: 'Department' },
      { key: 'patient_name', label: 'Patient' },
      { key: 'hospital_name', label: 'Hospital' },
      { key: 'medicine_name', label: 'Medicine' },
      { key: 'quantity_text', label: 'Quantity' },
      { key: 'current_stage', label: 'Stage' },
      { key: 'owner_name', label: 'Owner' },
      { key: 'payment_status', label: 'Payment' },
      { key: 'awb_number', label: 'AWB' },
      { key: 'last_activity_at', label: 'Last update' },
      { key: 'stuck_reason', label: 'Alert' },
      { key: 'status_text', label: 'Latest note' },
    ]);
    notify.success(`Exported ${list.length} rows.`);
  };

  const meta = VIEWS[view] ?? VIEWS.all;
  const deptTitle = dept && scope === 'ALL' ? ` · ${DEPT_LABEL[dept]}` : '';
  const pages = Math.max(1, Math.ceil(count / size));
  const show = (k: ColKey) => !hidden.includes(k);
  const activeFilters = [stage && `Stage: ${stage}`, owner && `Owner: ${owner === '__none' ? 'Unassigned' : owner}`, pay && `Payment: ${pay}`, q && `Search: ${q}`, from && `From ${from}`, to && `To ${to}`].filter(Boolean);

  const SortHead = ({ k, label }: { k: string; label: string }) => (
    <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => set({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' }, false)}>
      {label}
      {sort === k && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  const stageOptions = useMemo(() => (view === 'open' || view === 'stuck' ? OPEN_STAGES : STAGES), [view]);

  return (
    <>
      <PageHeader
        title={meta.title + deptTitle}
        subtitle={meta.subtitle}
        actions={
          <>
            <Button onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
            <Button variant="primary" onClick={() => set({ new: '1' }, false)}><Plus className="h-4 w-4" /> New shipment</Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <div className="min-w-[200px] flex-1">
            <Input
              placeholder="Search ID, patient, medicine, hospital, AWB, owner…"
              defaultValue={q}
              key={q}
              onKeyDown={(e) => e.key === 'Enter' && set({ q: (e.target as HTMLInputElement).value })}
              onBlur={(e) => e.target.value !== q && set({ q: e.target.value })}
              aria-label="Search"
            />
          </div>
          <Select value={view} onChange={(e) => set({ view: e.target.value === 'all' ? null : e.target.value })} className="w-auto" aria-label="View">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="stuck">Stuck</option>
            <option value="permits">Permits & CDEC</option>
            <option value="delivered_month">Delivered this month</option>
            <option value="review">Needs review</option>
            <option value="hold">On hold</option>
          </Select>
          {isAdmin && scope === 'ALL' && (
            <Select value={deptParam} onChange={(e) => set({ dept: e.target.value })} className="w-auto" aria-label="Department">
              <option value="">All departments</option>
              <option value="NPP">NPP</option>
              <option value="RARE_DISEASE">Recordati</option>
            </Select>
          )}
          <Select value={stage} onChange={(e) => set({ stage: e.target.value })} className="w-auto" aria-label="Stage">
            <option value="">All stages</option>
            {stageOptions.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => set({ owner: e.target.value })} className="w-auto max-w-[160px]" aria-label="Owner">
            <option value="">All owners</option>
            <option value="__none">Unassigned</option>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
          <Select value={pay} onChange={(e) => set({ pay: e.target.value })} className="w-auto" aria-label="Payment status">
            <option value="">Any payment</option>
            {['Unpaid', 'Partial', 'Paid', 'Received', 'FOC', 'Unknown'].map((p) => (
              <option key={p} value={p}>{p === 'Unknown' ? 'Not recorded' : p}</option>
            ))}
          </Select>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-canvas">
              <Filter className="h-4 w-4" /> Dates
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-64 animate-rise space-y-2 rounded-lg border border-line bg-white p-3 shadow-lg">
              <label className="block text-xs text-muted">Last update from<Input type="date" value={from} onChange={(e) => set({ from: e.target.value })} /></label>
              <label className="block text-xs text-muted">to<Input type="date" value={to} onChange={(e) => set({ to: e.target.value })} /></label>
              {isAdmin && (
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input type="checkbox" checked={archived} onChange={(e) => set({ archived: e.target.checked ? '1' : null })} /> Include archived
                </label>
              )}
            </div>
          </details>
          <div className="relative">
            <Button variant="ghost" onClick={() => setShowCols(!showCols)} aria-expanded={showCols}><Columns3 className="h-4 w-4" /> Columns</Button>
            {showCols && (
              <div className="absolute right-0 z-20 mt-1 w-48 animate-rise rounded-lg border border-line bg-white p-2 shadow-lg">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-canvas">
                    <input type="checkbox" checked={show(c.key)} onChange={() => setHidden(show(c.key) ? [...hidden, c.key] : hidden.filter((h) => h !== c.key))} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
            {activeFilters.map((f) => (
              <Badge key={f as string} tone="blue">{f}</Badge>
            ))}
            <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => set({ stage: null, owner: null, pay: null, q: null, from: null, to: null })}>
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}

        {loading ? (
          <Skeleton rows={10} />
        ) : rows.length === 0 ? (
          <Empty title="No shipments match">Try clearing filters, or create a new shipment.</Empty>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden max-h-[70vh] overflow-auto md:block">
              <table className="data">
                <thead>
                  <tr>
                    <th><SortHead k="code" label="Shipment" /></th>
                    {show('department') && scope === 'ALL' && <th>Dept</th>}
                    {show('patient') && <th>Patient</th>}
                    {show('hospital') && <th>Hospital</th>}
                    {show('medicine') && <th><SortHead k="medicine" label="Medicine" /></th>}
                    {show('qty') && <th>Qty</th>}
                    {show('stage') && <th><SortHead k="stage" label="Stage" /></th>}
                    {show('in_stage') && <th>In stage</th>}
                    {show('owner') && <th>Owner</th>}
                    {show('payment') && <th>Payment</th>}
                    {show('awb') && <th>AWB / tracking</th>}
                    {show('updated') && <th><SortHead k="updated" label="Last update" /></th>}
                    {show('eta') && <th>Expected</th>}
                    {show('alert') && <th>Alert</th>}
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/shipments/${r.shipment_code}`)}>
                      <td className="whitespace-nowrap">
                        <Link to={`/shipments/${r.shipment_code}`} className="tnum font-mono text-xs font-semibold text-navy-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.shipment_code}
                        </Link>
                      </td>
                      {show('department') && scope === 'ALL' && <td><DeptBadge dept={r.department} /></td>}
                      {show('patient') && <td className="max-w-[160px] truncate">{r.patient_name ?? '—'}</td>}
                      {show('hospital') && <td className="max-w-[180px] truncate text-muted">{r.hospital_name ?? '—'}</td>}
                      {show('medicine') && <td className="max-w-[200px] truncate font-medium text-ink">{r.medicine_name}</td>}
                      {show('qty') && <td className="tnum max-w-[110px] truncate text-muted">{r.quantity_text ?? r.quantity ?? '—'}</td>}
                      {show('stage') && <td><StageBadge stage={r.current_stage} /></td>}
                      {show('in_stage') && <td className="tnum whitespace-nowrap text-muted">{r.is_open ? daysLabel(r.days_in_stage) : '—'}</td>}
                      {show('owner') && <td className="whitespace-nowrap">{r.owner_name ?? <span className="text-muted">—</span>}</td>}
                      {show('payment') && <td><PaymentBadge status={r.payment_status} /></td>}
                      {show('awb') && <td className="tnum text-xs text-muted">{r.awb_number ?? r.tracking_number ?? '—'}</td>}
                      {show('updated') && <td className="tnum whitespace-nowrap text-muted">{fmtDate(r.last_activity_at)}</td>}
                      {show('eta') && <td className="tnum whitespace-nowrap text-muted">{fmtDate(r.estimated_delivery_date)}</td>}
                      {show('alert') && (
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {r.is_stuck && <Badge tone="red">{r.stuck_reason}</Badge>}
                            {r.is_on_hold && <Badge tone="amber"><Pause className="h-3 w-3" /> On hold</Badge>}
                            {r.needs_review && <Badge tone="amber">Review</Badge>}
                            {r.current_stage === 'Delivered' && !r.pod_received && <Badge>POD pending</Badge>}
                            {r.archived_at && <Badge>Archived</Badge>}
                          </div>
                        </td>
                      )}
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {!r.archived_at && r.current_stage !== 'POD received' && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setStageTarget(r)}>Update</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/shipments/${r.shipment_code}`} className="min-w-0">
                      <div className="tnum font-mono text-xs font-semibold text-navy-800">{r.shipment_code}</div>
                      <div className="truncate text-sm font-medium text-ink">{r.medicine_name}</div>
                      <div className="truncate text-xs text-muted">{r.patient_name ?? '—'} · {r.owner_name ?? 'Unassigned'}</div>
                    </Link>
                    <StageBadge stage={r.current_stage} />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {r.is_stuck && <Badge tone="red">{r.stuck_reason}</Badge>}
                      {r.is_on_hold && <Badge tone="amber">On hold</Badge>}
                    </div>
                    {!r.archived_at && r.current_stage !== 'POD received' && (
                      <Button className="!px-2 !py-1 text-xs" onClick={() => setStageTarget(r)}>Update stage</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm text-muted">
          <div className="tnum">
            {count === 0 ? '0' : `${(page - 1) * size + 1}–${Math.min(page * size, count)}`} of {count}
          </div>
          <div className="flex items-center gap-2">
            <Select value={size} onChange={(e) => set({ size: e.target.value })} className="w-auto !py-1" aria-label="Rows per page">
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </Select>
            <Button variant="ghost" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, false)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="tnum">{page} / {pages}</span>
            <Button variant="ghost" disabled={page >= pages} onClick={() => set({ page: String(page + 1) }, false)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>

      <NewShipmentModal
        open={params.get('new') === '1'}
        onClose={() => set({ new: null }, false)}
        onCreated={(code) => navigate(`/shipments/${code}`)}
      />
      <StageUpdateModal open={!!stageTarget} shipment={stageTarget} onClose={() => setStageTarget(null)} onDone={load} />
    </>
  );
}

