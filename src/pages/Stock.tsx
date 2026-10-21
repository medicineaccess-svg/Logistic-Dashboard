import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { History, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { DEPARTMENTS, DEPT_LABEL, ROLE_DEPARTMENT, STOCK_MOVEMENTS, type Department, type StockMovementType } from '../lib/constants';
import type { StockItem, StockMovement } from '../lib/types';
import { fmtDate, fmtDateTime, todayISO } from '../lib/format';
import { notify } from '../lib/errors';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { Badge, Button, Card, DeptBadge, Empty, Field, Input, Modal, PageHeader, Select, Skeleton } from '../components/ui';

function status(s: StockItem): { label: string; tone: 'red' | 'amber' | 'green' | 'slate' } {
  if (s.expiry_date && s.expiry_date < todayISO()) return { label: 'Expired', tone: 'red' };
  if (s.available_quantity <= 0) return { label: 'Out of stock', tone: 'red' };
  if (s.reorder_level > 0 && s.available_quantity <= s.reorder_level) return { label: 'Low', tone: 'amber' };
  if (s.expiry_date) {
    const days = (new Date(s.expiry_date).getTime() - Date.now()) / 86400000;
    if (days < 90) return { label: 'Near expiry', tone: 'amber' };
  }
  return { label: 'OK', tone: 'green' };
}

export function Stock() {
  const { scope, profile, isAdmin } = useAuth();
  const [params] = useSearchParams();
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(params.get('view') === 'low');
  const [adding, setAdding] = useState(false);
  const [moveFor, setMoveFor] = useState<StockItem | null>(null);
  const [historyFor, setHistoryFor] = useState<StockItem | null>(null);

  const load = useCallback(async () => {
    let query = supabase.from('medicine_stock').select('*').order('medicine_name').limit(2000);
    if (scope !== 'ALL') query = query.eq('department', scope);
    const { data, error } = await query;
    if (error) notify.error(error, 'stock');
    setItems((data as unknown as StockItem[] | null) ?? []);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtimeRefresh('stock', ['medicine_stock'], load);

  const list = useMemo(
    () =>
      items.filter((i) => {
        const t = q.trim().toLowerCase();
        if (t && !`${i.medicine_name} ${i.brand_name ?? ''} ${i.batch_number ?? ''}`.toLowerCase().includes(t)) return false;
        if (onlyLow && status(i).label === 'OK') return false;
        return true;
      }),
    [items, q, onlyLow],
  );

  const defaultDept: Department = (profile && ROLE_DEPARTMENT[profile.role]) || (scope !== 'ALL' ? scope : 'NPP');

  return (
    <>
      <PageHeader
        title="Stock & inventory"
        subtitle="Quantities change only through recorded movements (receipt, reservation, dispatch…), never by overwriting."
        actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add stock item</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input placeholder="Search medicine, brand, batch…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only alerts (low / expiry)
          </label>
        </div>
        {loading ? (
          <Skeleton rows={6} />
        ) : list.length === 0 ? (
          <Empty title={items.length ? 'No items match' : 'No stock items yet'}>
            {items.length ? undefined : 'The legacy "Stock Report" tab was empty, so nothing was imported. Add items to start tracking.'}
          </Empty>
        ) : (
          <div className="overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Medicine</th>
                  {scope === 'ALL' && <th>Dept</th>}
                  <th>Strength / form</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Location</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Reorder at</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((i) => {
                  const st = status(i);
                  return (
                    <tr key={i.id}>
                      <td className="font-medium text-ink">{i.medicine_name}{i.brand_name ? <span className="text-muted"> · {i.brand_name}</span> : null}</td>
                      {scope === 'ALL' && <td><DeptBadge dept={i.department} /></td>}
                      <td className="text-muted">{[i.strength, i.dosage_form].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="tnum">{i.batch_number ?? '—'}</td>
                      <td className="tnum">{fmtDate(i.expiry_date)}</td>
                      <td className="text-muted">{i.warehouse_location ?? '—'}</td>
                      <td className="tnum text-right font-semibold">{i.available_quantity}</td>
                      <td className="tnum text-right">{i.reserved_quantity}</td>
                      <td className="tnum text-right text-muted">{i.reorder_level}</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="whitespace-nowrap text-right">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setMoveFor(i)}>Movement</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setHistoryFor(i)} aria-label="History"><History className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AddItemModal open={adding} onClose={() => setAdding(false)} onDone={load} defaultDept={defaultDept} canChooseDept={isAdmin} />
      <MovementModal item={moveFor} onClose={() => setMoveFor(null)} onDone={load} />
      <HistoryModal item={historyFor} onClose={() => setHistoryFor(null)} />
    </>
  );
}

function AddItemModal({ open, onClose, onDone, defaultDept, canChooseDept }: { open: boolean; onClose: () => void; onDone: () => void; defaultDept: Department; canChooseDept: boolean }) {
  const blank = { department: defaultDept as string, medicine_name: '', brand_name: '', strength: '', dosage_form: '', batch_number: '', expiry_date: '', reorder_level: '0', warehouse_location: '', storage_conditions: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.medicine_name.trim().length < 2) return notify.error('Medicine name is required.');
    if (!/^\d+(\.\d{1,2})?$/.test(f.reorder_level)) return notify.error('Reorder level must be a non-negative number.');
    setBusy(true);
    const row: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(f)) row[k] = v.trim() === '' ? null : v.trim();
    row.reorder_level = Number(f.reorder_level);
    const { error } = await supabase.from('medicine_stock').insert(row);
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Stock item added. Record a receipt to add quantity.');
    setF(blank);
    onDone();
    onClose();
  };
  const inp = (k: keyof typeof blank, label: string, type = 'text') => (
    <Field label={label}><Input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <Modal open={open} onClose={onClose} wide title="Add stock item" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add item</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Department">
          <Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            {DEPARTMENTS.filter((d) => canChooseDept || d === defaultDept).map((d) => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
          </Select>
        </Field>
        {inp('medicine_name', 'Medicine *')}
        {inp('brand_name', 'Brand')}
        {inp('strength', 'Strength')}
        {inp('dosage_form', 'Dosage form')}
        {inp('batch_number', 'Batch number')}
        {inp('expiry_date', 'Expiry date', 'date')}
        {inp('reorder_level', 'Reorder level')}
        {inp('warehouse_location', 'Location')}
        {inp('storage_conditions', 'Storage conditions')}
      </div>
    </Modal>
  );
}

const MOVE_HELP: Record<StockMovementType, string> = {
  receipt: 'Stock arrives: adds to available.',
  reservation: 'Holds stock for a shipment: available → reserved.',
  release: 'Cancels a reservation: reserved → available.',
  dispatch: 'Stock leaves: taken from reserved first, then available.',
  adjustment: 'Correction (+ or −). Reason required.',
  return: 'Stock comes back: adds to available.',
};

function MovementModal({ item, onClose, onDone }: { item: StockItem | null; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<StockMovementType>('receipt');
  const [qty, setQty] = useState('');
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (!item) return null;
  const valid = type === 'adjustment' ? /^-?\d+(\.\d{1,2})?$/.test(qty) && Number(qty) !== 0 && reason.trim().length > 2 : /^\d+(\.\d{1,2})?$/.test(qty) && Number(qty) > 0;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('record_stock_movement', {
      p_stock_id: item.id,
      p_type: type,
      p_quantity: Number(qty),
      p_shipment_id: null,
      p_reference: ref || null,
      p_reason: reason || null,
      p_idempotency_key: key,
    });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Stock movement recorded.');
    setQty('');
    setRef('');
    setReason('');
    setKey(crypto.randomUUID());
    onDone();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Stock movement · ${item.medicine_name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>Record</Button></>}>
      <div className="space-y-3">
        <p className="tnum text-sm text-muted">Available {item.available_quantity} · Reserved {item.reserved_quantity}</p>
        <Field label="Type" hint={MOVE_HELP[type]}>
          <Select value={type} onChange={(e) => setType(e.target.value as StockMovementType)}>
            {STOCK_MOVEMENTS.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Quantity"><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Reference (invoice, shipment ID…)"><Input value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label={type === 'adjustment' ? 'Reason (required)' : 'Reason (optional)'}><Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function HistoryModal({ item, onClose }: { item: StockItem | null; onClose: () => void }) {
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  useEffect(() => {
    if (!item) return;
    setRows(null);
    supabase.from('stock_movements').select('*').eq('stock_id', item.id).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setRows((data as unknown as StockMovement[] | null) ?? []));
  }, [item]);
  if (!item) return null;
  return (
    <Modal open onClose={onClose} title={`Movement history · ${item.medicine_name}`} wide>
      {rows === null ? <Skeleton /> : rows.length === 0 ? <Empty title="No movements yet" /> : (
        <table className="data">
          <thead><tr><th>When</th><th>Type</th><th className="text-right">Qty</th><th>Reference</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}><td className="tnum">{fmtDateTime(m.created_at)}</td><td>{m.movement_type}</td><td className="tnum text-right">{m.quantity}</td><td>{m.reference_number ?? '—'}</td><td>{m.reason ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
