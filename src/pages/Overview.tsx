import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, CreditCard, FileCheck2, Landmark, Package, RefreshCw } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useOverviewData, type OverviewRow } from '../hooks/useOverviewData';
import { DEPT_LABEL, DEPT_LONG_LABEL, OPEN_STAGES, STAGES } from '../lib/constants';
import { monthStartISO } from '../lib/format';
import { Button, Card, DeptBadge, Empty, Kpi, PageHeader, Skeleton, StageBadge } from '../components/ui';

export const CHART = {
  blue: '#5B2352',
  navy: '#3A0F34',
  sage: '#7B9A8B',
  pale: '#C9D8EA',
  amber: '#EAAA00',
  red: '#B95E65',
  grid: '#E4E9F0',
  text: '#758195',
};

const axisTick = { fill: CHART.text, fontSize: 11 };

export function Overview() {
  const { rows, stock, loading, error, reload } = useOverviewData();
  const { scope, isAdmin } = useAuth();
  const navigate = useNavigate();

  const m = useMemo(() => computeMetrics(rows), [rows]);
  const lowStock = stock.filter((s) => s.available_quantity <= s.reorder_level && s.reorder_level > 0);

  const title = scope === 'ALL' ? 'Operations overview' : `${DEPT_LONG_LABEL[scope]} overview`;

  if (loading) {
    return (
      <>
        <PageHeader title={title} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-xl border border-line bg-white" />
          ))}
        </div>
        <Card className="mt-4"><Skeleton rows={8} /></Card>
      </>
    );
  }

  if (error) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-6 text-center">
        <p className="text-sm text-ink">We couldn't load the dashboard.</p>
        <Button className="mt-3" onClick={reload}><RefreshCw className="h-4 w-4" /> Retry</Button>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${rows.length} shipments tracked · stuck = no update for 5+ days or in customs over 7 days`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Open shipments" value={m.open.length} icon={Package} sub="Not yet delivered" onClick={() => navigate('/shipments?view=open')} />
        <Kpi label="Needs attention" value={m.stuck.length} icon={AlertTriangle} tone={m.stuck.length ? 'alert' : 'good'} sub="Stuck, act today" onClick={() => navigate('/shipments?view=stuck')} />
        <Kpi label="In customs" value={m.inCustoms.length} icon={Landmark} tone={m.inCustoms.length ? 'warn' : 'default'} sub="Awaiting clearance" onClick={() => navigate('/shipments?stage=In%20customs')} />
        <Kpi label="Outstanding payments" value={m.outstanding.length} icon={CreditCard} tone={m.outstanding.length ? 'warn' : 'default'} sub={`${m.gstPending.length} GST pending`} onClick={() => navigate('/payments?view=outstanding')} />
        <Kpi label="Delivered this month" value={m.deliveredThisMonth.length} icon={CheckCircle2} tone="good" sub="By delivery date" onClick={() => navigate('/shipments?view=delivered_month')} />
        <Kpi label="POD pending" value={m.podPending.length} icon={FileCheck2} sub="Delivered, no POD" onClick={() => navigate('/shipments?stage=Delivered')} />
        <Kpi label="Low stock" value={lowStock.length} icon={Boxes} tone={lowStock.length ? 'warn' : 'default'} sub={stock.length ? 'At or below reorder level' : 'No stock items yet'} onClick={() => navigate('/stock?view=low')} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Pipeline · open shipments by stage" className="xl:col-span-2">
          <div className="h-72 px-2 py-3">
            <ResponsiveContainer>
              <BarChart data={m.pipeline} margin={{ top: 8, right: 8, left: -18, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="stage" tick={axisTick} interval={0} angle={-25} textAnchor="end" height={58} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: '#EAF1F8' }}
                  formatter={(v) => [`${v} (${m.open.length ? Math.round((Number(v) / m.open.length) * 100) : 0}%)`, 'Shipments']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => {
                  const st = (d as unknown as { stage?: string }).stage;
                  if (st) navigate(`/shipments?stage=${encodeURIComponent(st)}`);
                }}>
                  {m.pipeline.map((p) => (
                    <Cell key={p.stage} fill={p.stage === 'In customs' ? CHART.amber : CHART.blue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Needs action today" action={<button className="text-xs text-navy-600 hover:underline" onClick={() => navigate('/shipments?view=stuck')}>View all</button>}>
          {m.urgent.length === 0 ? (
            <Empty title="Nothing stuck">Every open shipment has a recent update.</Empty>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {m.urgent.slice(0, 12).map((r) => (
                <li key={r.id}>
                  <button onClick={() => navigate(`/shipments/${r.shipment_code}`)} className="flex w-full items-start justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-canvas">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="tnum font-mono text-xs font-semibold text-navy-800">{r.shipment_code}</span>
                        {scope === 'ALL' && <DeptBadge dept={r.department} />}
                      </div>
                      <div className="truncate text-[13px] text-ink">{r.medicine_name} · {r.patient_name ?? '—'}</div>
                      <div className="text-xs text-err">{r.stuck_reason}</div>
                    </div>
                    <StageBadge stage={r.current_stage} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Deliveries by month">
          <div className="h-60 px-2 py-3">
            {m.deliveriesByMonth.every((d) => d.count === 0) ? (
              <Empty title="No dated deliveries yet" />
            ) : (
              <ResponsiveContainer>
                <LineChart data={m.deliveriesByMonth} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                  <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" name="Delivered" stroke={CHART.blue} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="px-4 pb-3 text-[11px] text-muted">Only shipments with a recorded delivery date; legacy rows without one are not counted.</p>
        </Card>

        <Card title="Workload · open shipments by owner">
          <div className="h-60 px-2 py-3">
            {m.byOwner.length === 0 ? (
              <Empty title="No open shipments" />
            ) : (
              <ResponsiveContainer>
                <BarChart data={m.byOwner} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={CHART.grid} />
                  <XAxis type="number" allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="owner" width={92} tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} />
                  <Bar dataKey="open" name="Open" stackId="a" fill={CHART.blue} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="stuck" name="Stuck" stackId="a" fill={CHART.red} radius={[0, 4, 4, 0]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {isAdmin && scope === 'ALL' ? (
          <Card title="Department comparison">
            <div className="h-60 px-2 py-3">
              <ResponsiveContainer>
                <BarChart data={m.byDept} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="dept" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                  <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="open" name="Open" fill={CHART.blue} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delivered" name="Delivered" fill={CHART.sage} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ) : (
          <Card title="Data quality">
            <div className="space-y-3 p-4 text-sm">
              <QualityRow icon={ClipboardList} label="Imported rows needing review" value={m.review.length} onClick={() => navigate('/shipments?view=review')} />
              <QualityRow icon={AlertTriangle} label="On hold" value={m.onHold.length} onClick={() => navigate('/shipments?view=hold')} />
              <QualityRow icon={FileCheck2} label="Open without import permit date" value={m.missingPermit.length} onClick={() => navigate('/shipments?view=permits')} />
            </div>
          </Card>
        )}
      </div>

      {isAdmin && scope === 'ALL' && (
        <Card title="Data quality" className="mt-4">
          <div className="grid gap-3 p-4 text-sm sm:grid-cols-3">
            <QualityRow icon={ClipboardList} label="Imported rows needing review" value={m.review.length} onClick={() => navigate('/shipments?view=review')} />
            <QualityRow icon={AlertTriangle} label="On hold" value={m.onHold.length} onClick={() => navigate('/shipments?view=hold')} />
            <QualityRow icon={FileCheck2} label="Open without import permit date" value={m.missingPermit.length} onClick={() => navigate('/shipments?view=permits')} />
          </div>
        </Card>
      )}
    </>
  );
}

function QualityRow({ icon: Icon, label, value, onClick }: { icon: typeof Package; label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition hover:bg-canvas">
      <span className="flex items-center gap-2 text-ink">
        <Icon className="h-4 w-4 text-muted" /> {label}
      </span>
      <span className="tnum font-semibold text-navy-800">{value}</span>
    </button>
  );
}

export function computeMetrics(rows: OverviewRow[]) {
  const open = rows.filter((r) => r.is_open);
  const stuck = open.filter((r) => r.is_stuck);
  const monthStart = monthStartISO();
  const pipeline = OPEN_STAGES.map((stage) => ({ stage, count: open.filter((r) => r.current_stage === stage).length }));

  const months: { key: string; month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, month: d.toLocaleString('en-IN', { month: 'short' }), count: 0 });
  }
  for (const r of rows) {
    if (!r.delivery_date) continue;
    const mm = months.find((x) => x.key === r.delivery_date!.slice(0, 7));
    if (mm) mm.count++;
  }

  const ownerMap = new Map<string, { owner: string; open: number; stuck: number }>();
  for (const r of open) {
    const k = r.owner_name || 'Unassigned';
    const e = ownerMap.get(k) ?? { owner: k, open: 0, stuck: 0 };
    if (r.is_stuck) e.stuck++;
    else e.open++;
    ownerMap.set(k, e);
  }

  return {
    open,
    stuck,
    urgent: [...stuck].sort((a, b) => b.days_since_update - a.days_since_update),
    inCustoms: open.filter((r) => r.current_stage === 'In customs'),
    outstanding: rows.filter((r) => r.payment_status === 'Unpaid' || r.payment_status === 'Partial'),
    gstPending: rows.filter((r) => r.gst_status === 'Pending'),
    deliveredThisMonth: rows.filter((r) => r.delivery_date && r.delivery_date >= monthStart),
    podPending: rows.filter((r) => r.current_stage === 'Delivered' && !r.pod_received),
    review: rows.filter((r) => r.needs_review),
    onHold: open.filter((r) => r.is_on_hold),
    missingPermit: open.filter((r) => !r.import_permit_date && STAGES.indexOf(r.current_stage) >= 2),
    pipeline,
    deliveriesByMonth: months,
    byOwner: [...ownerMap.values()].sort((a, b) => b.open + b.stuck - (a.open + a.stuck)).slice(0, 10),
    byDept: (['NPP', 'RARE_DISEASE'] as const).map((d) => ({
      dept: DEPT_LABEL[d],
      open: open.filter((r) => r.department === d).length,
      delivered: rows.filter((r) => r.department === d && !r.is_open).length,
    })),
  };
}

