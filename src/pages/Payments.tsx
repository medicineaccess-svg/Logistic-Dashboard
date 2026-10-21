import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useOverviewData } from '../hooks/useOverviewData';
import { downloadCsv, fmtMoney } from '../lib/format';
import { Button, Card, DeptBadge, Empty, Kpi, PageHeader, PaymentBadge, Select, Skeleton, StageBadge } from '../components/ui';

export function Payments() {
  const { rows, loading } = useOverviewData();
  const { scope } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'outstanding';

  const list = useMemo(() => {
    const base = rows.filter((r) => {
      if (view === 'outstanding') return r.payment_status === 'Unpaid' || r.payment_status === 'Partial';
      if (view === 'gst') return r.gst_status === 'Pending';
      if (view === 'unknown') return r.payment_status === 'Unknown' && r.is_open;
      return true;
    });
    return base.sort((a, b) => (b.outstanding_amount ?? 0) - (a.outstanding_amount ?? 0));
  }, [rows, view]);

  // Totals are kept per currency — amounts in different currencies are never added together.
  const byCurrency = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.outstanding_amount && r.outstanding_amount > 0) m.set(r.currency ?? '—', (m.get(r.currency ?? '—') ?? 0) + r.outstanding_amount);
    }
    return [...m.entries()];
  }, [rows]);

  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Outstanding balance = PI amount − payments recorded in the same currency"
        actions={
          <Button
            onClick={() =>
              downloadCsv('payments.csv', list as unknown as Record<string, unknown>[], [
                { key: 'shipment_code', label: 'Shipment' },
                { key: 'department', label: 'Department' },
                { key: 'patient_name', label: 'Patient' },
                { key: 'medicine_name', label: 'Medicine' },
                { key: 'payment_status', label: 'Payment status' },
                { key: 'outstanding_amount', label: 'Outstanding' },
                { key: 'currency', label: 'Currency' },
                { key: 'gst_status', label: 'GST' },
                { key: 'owner_name', label: 'Owner' },
              ])
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Unpaid" value={count((r) => r.payment_status === 'Unpaid')} tone="alert" onClick={() => setParams({ view: 'outstanding' })} />
        <Kpi label="Partially paid" value={count((r) => r.payment_status === 'Partial')} tone="warn" onClick={() => setParams({ view: 'outstanding' })} />
        <Kpi label="GST pending" value={count((r) => r.gst_status === 'Pending')} tone="warn" onClick={() => setParams({ view: 'gst' })} />
        <Kpi
          label="Outstanding by currency"
          value={byCurrency.length === 0 ? '—' : <span className="text-lg">{byCurrency.map(([c, v]) => fmtMoney(v, c === '—' ? null : c)).join(' · ')}</span>}
          sub="Only shipments with a PI amount"
        />
      </div>
      <Card
        title={view === 'gst' ? 'GST pending' : view === 'unknown' ? 'Open shipments with no payment data' : view === 'all' ? 'All shipments' : 'Unpaid & partially paid'}
        action={
          <Select value={view} onChange={(e) => setParams({ view: e.target.value })} className="w-auto !py-1" aria-label="View">
            <option value="outstanding">Unpaid & partial</option>
            <option value="gst">GST pending</option>
            <option value="unknown">No payment recorded (open)</option>
            <option value="all">All</option>
          </Select>
        }
      >
        {loading ? (
          <Skeleton rows={8} />
        ) : list.length === 0 ? (
          <Empty title="Nothing here">{view === 'outstanding' ? 'Add a PI amount on a shipment to track its balance.' : undefined}</Empty>
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Shipment</th>
                  {scope === 'ALL' && <th>Dept</th>}
                  <th>Patient</th>
                  <th>Medicine</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th className="text-right">Outstanding</th>
                  <th>GST</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 500).map((r) => (
                  <tr key={r.id}>
                    <td><Link className="tnum font-mono text-xs font-semibold text-navy-800 hover:underline" to={`/shipments/${r.shipment_code}`}>{r.shipment_code}</Link></td>
                    {scope === 'ALL' && <td><DeptBadge dept={r.department} /></td>}
                    <td className="max-w-[160px] truncate">{r.patient_name ?? '—'}</td>
                    <td className="max-w-[200px] truncate">{r.medicine_name}</td>
                    <td><StageBadge stage={r.current_stage} /></td>
                    <td><PaymentBadge status={r.payment_status} /></td>
                    <td className="tnum text-right">{r.outstanding_amount != null ? fmtMoney(r.outstanding_amount, r.currency) : '—'}</td>
                    <td className="text-muted">{r.gst_status}</td>
                    <td>{r.owner_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
