import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Printer } from 'lucide-react';
import { useOverviewData } from '../hooks/useOverviewData';
import { OPEN_STAGES } from '../lib/constants';
import { Button, Card, Kpi, PageHeader, Skeleton } from '../components/ui';
import { CHART, computeMetrics } from './Overview';

export function Reports() {
  const { rows, loading } = useOverviewData();
  const m = useMemo(() => computeMetrics(rows), [rows]);

  const stats = useMemo(() => {
    const delivered = rows.filter((r) => !r.is_open);
    const withPod = delivered.filter((r) => r.pod_received).length;
    const byStage = OPEN_STAGES.map((s) => {
      const list = m.open.filter((r) => r.current_stage === s);
      const avg = list.length ? Math.round(list.reduce((a, r) => a + r.days_in_stage, 0) / list.length) : 0;
      return { stage: s, avgDays: avg, count: list.length };
    });
    return { delivered: delivered.length, podRate: delivered.length ? Math.round((withPod / delivered.length) * 100) : 0, byStage };
  }, [rows, m.open]);

  if (loading) return <Card><Skeleton rows={10} /></Card>;

  return (
    <>
      <PageHeader title="Reports" subtitle="Calculated live from the database. Archived shipments are excluded." actions={<Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Shipments tracked" value={rows.length} />
        <Kpi label="Open" value={m.open.length} />
        <Kpi label="Delivered (all time)" value={stats.delivered} tone="good" />
        <Kpi label="POD completion" value={`${stats.podRate}%`} sub="Delivered shipments with POD received" />
        <Kpi label="Overdue for update" value={m.stuck.length} tone={m.stuck.length ? 'alert' : 'good'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Average days in current stage (open shipments)">
          <div className="h-72 px-2 py-3">
            <ResponsiveContainer>
              <BarChart data={stats.byStage} margin={{ top: 8, right: 8, left: -18, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="stage" tick={{ fill: CHART.text, fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={58} tickLine={false} />
                <YAxis tick={{ fill: CHART.text, fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} formatter={(v) => [`${v} days`, 'Average']} />
                <Bar dataKey="avgDays" fill={CHART.blue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="px-4 pb-3 text-[11px] text-muted">For imported rows, "days in stage" counts from the last dated entry in the legacy sheet.</p>
        </Card>
        <Card title="Owner workload">
          <div className="max-h-80 overflow-auto">
            <table className="data">
              <thead><tr><th>Owner</th><th className="text-right">Open</th><th className="text-right">Stuck</th></tr></thead>
              <tbody>
                {m.byOwner.map((o) => (
                  <tr key={o.owner}><td>{o.owner}</td><td className="tnum text-right">{o.open + o.stuck}</td><td className="tnum text-right text-err">{o.stuck || ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
