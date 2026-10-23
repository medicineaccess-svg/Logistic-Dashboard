import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, Download, IndianRupee, Package, Users, Euro, ReceiptText } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { downloadCsv, fmtDateTime } from '../lib/format';
import { Button, Card, Empty, Input, Kpi, PageHeader, Select, Skeleton } from '../components/ui';
import { AccessDenied } from './AccessDenied';
import { CHART } from './Overview';

interface SaleRow {
  id: number;
  sheet_row: number;
  sales_person: string | null;
  month_label: string | null;
  sale_month: string | null;
  place: string | null;
  patient_name: string | null;
  hospital_doctor: string | null;
  product: string | null;
  quantity: number | null;
  price_per_pack_text: string | null;
  total_foreign: number | null;
  foreign_currency: 'EUR' | 'USD' | null;
  total_inr: number | null;
  synced_at: string;
}

const MARIGOLD = '#EAAA00';
const NO_MONTH = '__none__';
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
const inr = (v: number | null) => (v == null ? '—' : inrFmt.format(v));
const money = (v: number, cur: 'EUR' | 'USD') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v);
const monthName = (iso: string) => monthFmt.format(new Date(`${iso}T00:00:00`));
/** ₹ axis labels in lakh / crore */
const inrShort = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${Math.round(v / 1000)}k`);
const personKey = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ');
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const patientKey = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function MonthlySales() {
  const { isAdmin, profile } = useAuth();
  const allowed = isAdmin || profile?.role === 'rare_disease';
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('ALL');
  const [person, setPerson] = useState('ALL');
  const [product, setProduct] = useState('ALL');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('monthly_sales').select('*').order('sale_month', { ascending: true, nullsFirst: false }).order('sheet_row').limit(5000);
    setRows(
      ((data ?? []) as SaleRow[]).map((r) => ({ ...r, quantity: num(r.quantity), total_foreign: num(r.total_foreign), total_inr: num(r.total_inr) })),
    );
    setLoading(false);
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  useRealtimeRefresh('monthly-sales', ['monthly_sales'], load);

  const months = useMemo(() => [...new Set(rows.map((r) => r.sale_month).filter(Boolean) as string[])].sort(), [rows]);
  const people = useMemo(() => [...new Set(rows.map((r) => titleCase(personKey(r.sales_person))).filter(Boolean))].sort(), [rows]);
  const products = useMemo(() => [...new Set(rows.map((r) => (r.product ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
  const hasNoMonth = rows.some((r) => !r.sale_month);

  // filters except month (used by the month chart)
  const base = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (person === 'ALL' || titleCase(personKey(r.sales_person)) === person) &&
        (product === 'ALL' || (r.product ?? '').trim() === product) &&
        (!term || [r.patient_name, r.hospital_doctor, r.place, r.product].some((x) => (x ?? '').toLowerCase().includes(term))),
    );
  }, [rows, person, product, q]);
  const filtered = useMemo(
    () => base.filter((r) => month === 'ALL' || (month === NO_MONTH ? !r.sale_month : r.sale_month === month)),
    [base, month],
  );

  const kpi = useMemo(() => {
    let inrTotal = 0, eur = 0, usd = 0, units = 0, noInr = 0;
    const patients = new Set<string>();
    for (const r of filtered) {
      if (r.total_inr != null) inrTotal += r.total_inr;
      else noInr++;
      if (r.total_foreign != null && r.foreign_currency === 'EUR') eur += r.total_foreign;
      if (r.total_foreign != null && r.foreign_currency === 'USD') usd += r.total_foreign;
      units += r.quantity ?? 0;
      if (patientKey(r.patient_name)) patients.add(patientKey(r.patient_name));
    }
    return { inrTotal, eur, usd, units, noInr, patients: patients.size };
  }, [filtered]);

  const byMonth = useMemo(
    () =>
      months.map((m) => ({
        key: m,
        label: monthName(m),
        inr: base.filter((r) => r.sale_month === m).reduce((a, r) => a + (r.total_inr ?? 0), 0),
      })),
    [months, base],
  );
  const groupSum = (key: (r: SaleRow) => string) => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const k = key(r) || 'Not recorded';
      map.set(k, (map.get(k) ?? 0) + (r.total_inr ?? 0));
    }
    return [...map.entries()].map(([name, inr]) => ({ name, inr })).sort((a, b) => b.inr - a.inr);
  };
  const byProduct = useMemo(() => groupSum((r) => (r.product ?? '').trim()).slice(0, 10), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  const byPerson = useMemo(() => groupSum((r) => titleCase(personKey(r.sales_person))), [filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  const patients = useMemo(() => {
    const map = new Map<string, { name: string; hospital: string; place: string; products: Set<string>; months: Set<string>; units: number; inr: number; entries: SaleRow[] }>();
    for (const r of filtered) {
      const k = patientKey(r.patient_name);
      if (!k) continue;
      const p = map.get(k) ?? { name: (r.patient_name ?? '').trim(), hospital: '', place: '', products: new Set(), months: new Set(), units: 0, inr: 0, entries: [] };
      if (!p.hospital && r.hospital_doctor) p.hospital = r.hospital_doctor;
      if (!p.place && r.place) p.place = r.place;
      if (r.product) p.products.add(r.product.trim());
      p.months.add(r.sale_month ? monthName(r.sale_month) : r.month_label ?? '—');
      p.units += r.quantity ?? 0;
      p.inr += r.total_inr ?? 0;
      p.entries.push(r);
      map.set(k, p);
    }
    return [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.inr - a.inr);
  }, [filtered]);

  if (!allowed) return <AccessDenied message="Monthly sales are available to the Recordati team and admins." />;
  if (loading) return <Card><Skeleton rows={10} /></Card>;

  const lastSync = rows.reduce((a, r) => (r.synced_at > a ? r.synced_at : a), '');
  const monthLabel = month === 'ALL' ? 'All months' : month === NO_MONTH ? 'No month in sheet' : monthName(month);

  const exportCsv = () =>
    downloadCsv(
      `recordati-monthly-sales-${month === 'ALL' ? 'all' : month}.csv`,
      filtered.map((r) => ({ ...r, month: r.sale_month ? monthName(r.sale_month) : r.month_label })),
      [
        { key: 'month', label: 'Month' },
        { key: 'sales_person', label: 'Sales person' },
        { key: 'place', label: 'Place' },
        { key: 'patient_name', label: 'Patient' },
        { key: 'hospital_doctor', label: 'Hospital / Doctor' },
        { key: 'product', label: 'Product' },
        { key: 'quantity', label: 'Quantity' },
        { key: 'price_per_pack_text', label: 'Price per pack' },
        { key: 'total_foreign', label: 'Total (foreign)' },
        { key: 'foreign_currency', label: 'Currency' },
        { key: 'total_inr', label: 'Total INR' },
        { key: 'sheet_row', label: 'Sheet row' },
      ],
    );

  return (
    <>
      <PageHeader
        title="Monthly sales · Recordati"
        subtitle={<>Exact copy of the <b>Monthy Sales Data</b> tab in the Recordati All India Data sheet{lastSync ? ` · last synced ${fmtDateTime(lastSync)}` : ''}</>}
        actions={<Button onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>}
      />

      {rows.length === 0 ? (
        <Card>
          <Empty title="No sales data yet">
            The data arrives from the Recordati sheet. Update its Apps Script to the latest <code>Code.gs</code>, then use Ikris Control Tower → Sync now.
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                <option value="ALL">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
                {hasNoMonth && <option value={NO_MONTH}>No month in sheet (Pending / Biomarin…)</option>}
              </Select>
              <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Sales person">
                <option value="ALL">All sales people</option>
                {people.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
              <Select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
                <option value="ALL">All products</option>
                {products.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, hospital, place…" aria-label="Search" />
            </div>
          </Card>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label={`Sales (INR) · ${monthLabel}`} value={inrShort(kpi.inrTotal)} sub={kpi.noInr ? `${inr(kpi.inrTotal)} · ${kpi.noInr} row(s) have no INR in sheet` : inr(kpi.inrTotal)} icon={IndianRupee} />
            <Kpi label="Sales (EUR)" value={money(kpi.eur, 'EUR')} sub={kpi.usd ? `+ ${money(kpi.usd, 'USD')} in USD` : 'Total Price in Euro column'} icon={Euro} />
            <Kpi label="Patients" value={kpi.patients} sub="Distinct patient names" icon={Users} />
            <Kpi label="Units sold" value={kpi.units.toLocaleString('en-IN')} sub="Product quantity" icon={Package} />
            <Kpi label="Sales entries" value={filtered.length} sub="Rows in the sheet" icon={ReceiptText} />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <Card title="Sales by month (INR)" className="xl:col-span-2" action={<span className="text-xs text-muted">Click a bar to filter</span>}>
              <div className="h-72 px-2 py-3">
                <ResponsiveContainer>
                  <BarChart data={byMonth} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={{ fill: CHART.text, fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={52} tickLine={false} />
                    <YAxis tickFormatter={inrShort} tick={{ fill: CHART.text, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip formatter={(v) => [inr(Number(v)), 'Sales']} contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} />
                    <Bar dataKey="inr" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d: { payload?: { key?: string } }) => { const k = d?.payload?.key; if (k) setMonth(month === k ? 'ALL' : k); }}>
                      {byMonth.map((m) => (
                        <Cell key={m.key} fill={month === m.key ? MARIGOLD : CHART.navy} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={`By sales person · ${monthLabel}`}>
              <div className="h-72 px-2 py-3">
                <ResponsiveContainer>
                  <BarChart data={byPerson} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke={CHART.grid} />
                    <XAxis type="number" tickFormatter={inrShort} tick={{ fill: CHART.text, fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: CHART.text, fontSize: 11 }} width={80} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v) => [inr(Number(v)), 'Sales']} contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} />
                    <Bar dataKey="inr" fill={MARIGOLD} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title={`Top products · ${monthLabel}`} className="mb-4">
            <div className="h-72 px-2 py-3">
              <ResponsiveContainer>
                <BarChart data={byProduct} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={CHART.grid} />
                  <XAxis type="number" tickFormatter={inrShort} tick={{ fill: CHART.text, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: CHART.text, fontSize: 11 }} width={150} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [inr(Number(v)), 'Sales']} contentStyle={{ borderRadius: 8, border: '1px solid #E4E9F0', fontSize: 12 }} />
                  <Bar dataKey="inr" fill={CHART.blue} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title={`Patients · ${monthLabel} (${patients.length})`}>
            {patients.length === 0 ? (
              <Empty title="No patients match these filters" />
            ) : (
              <div className="max-h-[640px] overflow-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th />
                      <th>Patient</th>
                      <th>Hospital / Doctor</th>
                      <th>Place</th>
                      <th>Products</th>
                      <th>Month(s)</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Sales (INR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map((p) => (
                      <Fragment key={p.key}>
                        <tr className="cursor-pointer" onClick={() => setOpen(open === p.key ? null : p.key)}>
                          <td className="w-6 text-muted">{open === p.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                          <td className="font-medium text-ink">{p.name}</td>
                          <td>{p.hospital || '—'}</td>
                          <td>{p.place || '—'}</td>
                          <td>{[...p.products].join(', ')}</td>
                          <td>{[...p.months].join(', ')}</td>
                          <td className="tnum text-right">{p.units.toLocaleString('en-IN')}</td>
                          <td className="tnum text-right font-medium">{inr(p.inr)}</td>
                        </tr>
                        {open === p.key &&
                          p.entries.map((e) => (
                            <tr key={e.id} className="bg-mist text-[12px]">
                              <td />
                              <td className="text-muted">Sheet row {e.sheet_row}</td>
                              <td>{e.hospital_doctor ?? '—'}</td>
                              <td>{e.sales_person ?? '—'}</td>
                              <td>{e.product ?? '—'} {e.price_per_pack_text ? <span className="text-muted">@ {e.price_per_pack_text}</span> : null}</td>
                              <td>{e.sale_month ? monthName(e.sale_month) : e.month_label ?? '—'}</td>
                              <td className="tnum text-right">{e.quantity ?? '—'}</td>
                              <td className="tnum text-right">{inr(e.total_inr)}</td>
                            </tr>
                          ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="mt-3 text-[11px] text-muted">
            Amounts are copied as written in the sheet; a row with no INR amount counts as ₹0 in totals and shows “—”.
            Months written without a year (e.g. “April”) take the year of the rows around them; labels such as “Pending” or “Biomarin” are kept under “No month in sheet”.
          </p>
        </>
      )}
    </>
  );
}
