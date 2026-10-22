import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, CreditCard, FileText, MessageSquarePlus, Pause, Pencil, Play, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import type { Payment, ShipmentOverview, ShipmentUpdate, TeamMember } from '../lib/types';
import { DEPT_LONG_LABEL } from '../lib/constants';
import { daysLabel, fmtDate, fmtDateTime, fmtMoney, todayISO } from '../lib/format';
import { notify } from '../lib/errors';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { StageProgress } from '../components/StageProgress';
import { StageUpdateModal } from '../components/StageUpdateModal';
import { Badge, Button, Card, ConfirmModal, DeptBadge, Empty, Field, Input, Modal, PaymentBadge, Select, Skeleton, StageBadge, Textarea } from '../components/ui';

const BUCKET = 'shipment-documents';
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

export function ShipmentDetail() {
  const { code } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [s, setS] = useState<ShipmentOverview | null>(null);
  const [updates, setUpdates] = useState<ShipmentUpdate[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [docs, setDocs] = useState<{ name: string; created_at: string | null; size: number }[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<null | 'stage' | 'note' | 'hold' | 'payment' | 'edit' | 'archive'>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('shipment_overview').select('*').eq('shipment_code', code ?? '').maybeSingle();
    if (error) notify.error(error, 'detail');
    const row = data as unknown as ShipmentOverview | null;
    setS(row);
    if (row) {
      const [u, p, d] = await Promise.all([
        supabase.from('shipment_updates').select('*').eq('shipment_id', row.id).order('updated_at', { ascending: false }).limit(500),
        supabase.from('payments').select('*').eq('shipment_id', row.id).order('payment_date', { ascending: false }),
        supabase.storage.from(BUCKET).list(row.id, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      ]);
      setUpdates((u.data as unknown as ShipmentUpdate[] | null) ?? []);
      setPayments((p.data as unknown as Payment[] | null) ?? []);
      setDocs(((d.data ?? []) as unknown as { name: string; created_at: string | null; metadata: { size?: number } | null }[]).map((f) => ({ name: f.name, created_at: f.created_at, size: f.metadata?.size ?? 0 })));
    }
    setLoading(false);
  }, [code]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    supabase.rpc('list_team_members').then(({ data }) => {
      const map: Record<string, string> = {};
      for (const m of (data as unknown as TeamMember[] | null) ?? []) map[m.id] = m.full_name;
      setPeople(map);
    });
  }, []);

  useRealtimeRefresh(`detail-${code}`, ['shipments', 'shipment_updates', 'payments'], load);

  if (loading) return <Card><Skeleton rows={12} /></Card>;
  if (!s) {
    return (
      <Card className="mx-auto max-w-md">
        <Empty title="Shipment not found">It may not exist, or it belongs to a department you can't access.</Empty>
        <div className="pb-6 text-center"><Button onClick={() => navigate('/shipments')}>Back to shipments</Button></div>
      </Card>
    );
  }

  const closed = !!s.archived_at;

  return (
    <>
      <div className="mb-4">
        <Link to="/shipments" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Shipments</Link>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="tnum font-mono text-2xl font-semibold text-navy-800">{s.shipment_code}</h1>
            <DeptBadge dept={s.department} />
            <StageBadge stage={s.current_stage} />
            {s.is_on_hold && <Badge tone="amber"><Pause className="h-3 w-3" /> On hold</Badge>}
            {s.is_stuck && <Badge tone="red">{s.stuck_reason}</Badge>}
            {s.needs_review && <Badge tone="amber">Needs review</Badge>}
            {closed && <Badge>Archived</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {s.medicine_name}{s.strength ? ` · ${s.strength}` : ''} · {s.patient_name ?? 'No patient name'} · {DEPT_LONG_LABEL[s.department]}
          </p>
        </div>
        {!closed && (
          <div className="flex flex-wrap gap-2">
            {s.current_stage !== 'POD received' && <Button variant="primary" onClick={() => setModal('stage')}>Update stage</Button>}
            <Button onClick={() => setModal('note')}><MessageSquarePlus className="h-4 w-4" /> Note</Button>
            <Button onClick={() => setModal('payment')}><CreditCard className="h-4 w-4" /> Payment</Button>
            <Button onClick={() => setModal('hold')}>{s.is_on_hold ? <><Play className="h-4 w-4" /> Release hold</> : <><Pause className="h-4 w-4" /> Hold</>}</Button>
            <Button onClick={() => setModal('edit')}><Pencil className="h-4 w-4" /> Edit</Button>
            {isAdmin && <Button variant="danger" onClick={() => setModal('archive')}><Archive className="h-4 w-4" /> Archive</Button>}
          </div>
        )}
      </div>

      {s.needs_review && s.review_note && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-ink">
          <span className="font-medium text-warn">Imported from the legacy sheet — please check: </span>{s.review_note}
          <span className="block text-xs text-muted">Recording any stage update clears this flag.</span>
        </div>
      )}
      {s.is_on_hold && s.hold_reason && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm"><span className="font-medium text-warn">On hold: </span>{s.hold_reason}</div>
      )}

      <Card className="mb-4 p-4">
        <StageProgress stage={s.current_stage} />
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <span>In this stage: <b className="tnum text-ink">{daysLabel(s.days_in_stage)}</b></span>
          <span>Last update: <b className="tnum text-ink">{fmtDateTime(s.last_activity_at)}</b> ({daysLabel(s.days_since_update)} ago)</span>
          {s.status_text && <span className="max-w-full">Latest: <span className="text-ink">{s.status_text}</span></span>}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3">
              <D label="Patient">{s.patient_name}</D>
              <D label="Patient reference">{s.patient_reference}</D>
              <D label="Hospital">{s.hospital_name}</D>
              <D label="Doctor">{s.doctor_name}</D>
              <D label="Medicine">{s.medicine_name}</D>
              <D label="Strength / form">{[s.strength, s.dosage_form].filter(Boolean).join(' · ') || null}</D>
              <D label="Quantity">{s.quantity_text ?? (s.quantity != null ? `${s.quantity} ${s.quantity_unit ?? ''}` : null)}</D>
              <D label="Manufacturer">{s.manufacturer}</D>
              <D label="Region">{s.region}</D>
              <D label="Owner">{s.owner_name}</D>
              <D label="Courier / CHA">{[s.courier_name, s.cha_name].filter(Boolean).join(' · ') || null}</D>
              <D label="AWB / tracking">{s.awb_number ?? s.tracking_number}</D>
              <D label="Import permit no.">{s.import_permit_number}</D>
              <D label="Source">{s.source === 'sheet_import' ? `Legacy sheet (${s.source_ref})` : s.source === 'sheet_sync' ? `Google Sheet (${s.source_ref})` : 'Created in app'}</D>
              <D label="Notes" wide>{s.notes}</D>
            </dl>
          </Card>

          <Card title={`Timeline · ${updates.length} events`}>
            {updates.length === 0 ? (
              <Empty title="No history yet" />
            ) : (
              <ol className="relative space-y-0 p-4">
                {updates.map((u, i) => (
                  <li key={u.id} className="relative flex gap-3 pb-4">
                    {i < updates.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-line" aria-hidden />}
                    <span className={dotCls(u.update_type)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium text-ink">{typeLabel(u)}</span>
                        {u.previous_stage && u.new_stage && u.previous_stage !== u.new_stage && (
                          <span className="flex items-center gap-1 text-xs"><StageBadge stage={u.previous_stage} /> → <StageBadge stage={u.new_stage} /></span>
                        )}
                        {!u.previous_stage && u.new_stage && u.update_type !== 'note' && <StageBadge stage={u.new_stage} />}
                      </div>
                      {u.update_message && <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink">{u.update_message}</p>}
                      {u.correction_reason && <p className="mt-0.5 text-[13px] text-warn">Correction reason: {u.correction_reason}</p>}
                      <p className="tnum mt-0.5 text-xs text-muted">
                        {fmtDateTime(u.updated_at)} · {u.updated_by ? people[u.updated_by] ?? 'Team member' : u.source === 'sheet_import' ? 'Sheet import' : u.source === 'google_sheet' ? 'Google Sheet sync' : 'System'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Milestones">
            <dl className="divide-y divide-line text-sm">
              {[
                ['Payment received', s.payment_received_date],
                ['Import permit', s.import_permit_date],
                ['CDEC signed', s.cdec_signed_date],
                ['CDEC approved', s.cdec_approved_date],
                ['Order placed', s.order_placed_date],
                ['Shipped', s.shipment_date],
                ['Customs entry', s.customs_entry_date],
                ['Customs cleared', s.customs_cleared_date],
                ['Expected delivery', s.estimated_delivery_date],
                ['Delivered', s.delivery_date],
                ['POD received', s.pod_received ? s.pod_received_date ?? 'Yes' : null],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between px-4 py-2">
                  <dt className="text-muted">{l}</dt>
                  <dd className="tnum text-ink">{v ? fmtDate(v) : '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Payment">
            <div className="space-y-1 p-4 text-sm">
              <Row label="Status"><PaymentBadge status={s.payment_status} /></Row>
              {s.sheet_payment_status && <Row label="Google Sheet says">{s.sheet_payment_status}</Row>}
              <Row label="PI">{s.pi_number ?? '—'} · {fmtMoney(s.pi_amount, s.currency)}</Row>
              <Row label="Received">{fmtMoney(s.received_total, s.currency)}</Row>
              <Row label="Outstanding">{s.outstanding_amount != null ? fmtMoney(s.outstanding_amount, s.currency) : '—'}</Row>
              <Row label="GST">{s.gst_status}</Row>
              <Row label="Account">{s.payment_account ?? '—'}</Row>
              {s.other_currency_payments > 0 && <p className="text-xs text-warn">{s.other_currency_payments} payment(s) in another currency need reconciliation.</p>}
            </div>
            {payments.length > 0 && (
              <ul className="divide-y divide-line border-t border-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between px-4 py-2">
                    <span className="text-muted">{fmtDate(p.payment_date)}{p.reference_number ? ` · ${p.reference_number}` : ''}</span>
                    <span className="tnum font-medium">{fmtMoney(p.amount, p.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <DocumentsCard shipmentId={s.id} docs={docs} disabled={closed} onChange={load} isAdmin={isAdmin} />
        </div>
      </div>

      <StageUpdateModal open={modal === 'stage'} shipment={s} onClose={() => setModal(null)} onDone={load} />
      <NoteModal open={modal === 'note'} id={s.id} onClose={() => setModal(null)} onDone={load} />
      <HoldModal open={modal === 'hold'} id={s.id} onHold={s.is_on_hold} onClose={() => setModal(null)} onDone={load} />
      <PaymentModal open={modal === 'payment'} id={s.id} currency={s.currency ?? 'INR'} onClose={() => setModal(null)} onDone={load} />
      <EditModal open={modal === 'edit'} s={s} onClose={() => setModal(null)} onDone={load} />
      <ArchiveModal open={modal === 'archive'} id={s.id} code={s.shipment_code} onClose={() => setModal(null)} onDone={() => navigate('/shipments')} />
    </>
  );
}

function D({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-3' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-ink">{children || <span className="text-muted/70">—</span>}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="tnum text-right text-ink">{children}</span>
    </div>
  );
}

function typeLabel(u: ShipmentUpdate) {
  return (
    {
      created: 'Shipment created',
      stage_change: 'Stage updated',
      stage_correction: 'Stage corrected',
      note: 'Note',
      hold: 'Placed on hold',
      release: 'Released from hold',
      payment: 'Payment recorded',
      migration: u.metadata && 'legacy_daily_column' in u.metadata ? 'Sheet entry' : 'Imported from sheet',
      field_update: 'Details edited',
    } as Record<string, string>
  )[u.update_type] ?? u.update_type;
}

function dotCls(t: string) {
  const base = 'relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 bg-white';
  if (t === 'stage_change' || t === 'created') return `${base} border-navy-600`;
  if (t === 'stage_correction' || t === 'hold') return `${base} border-warn`;
  if (t === 'payment') return `${base} border-ok`;
  return `${base} border-line`;
}

function NoteModal({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('add_shipment_note', { p_shipment_id: id, p_message: text.trim() });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Note added.');
    setText('');
    onDone();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add note" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!text.trim()}>Add note</Button></>}>
      <Field label="Note" hint="Counts as an update for the 5-day rule.">
        <Textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Modal>
  );
}

function HoldModal({ open, id, onHold, onClose, onDone }: { open: boolean; id: string; onHold: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!onHold && !reason.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_shipment_hold', { p_shipment_id: id, p_on_hold: !onHold, p_reason: reason.trim() || null });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success(onHold ? 'Released from hold.' : 'Shipment placed on hold.');
    setReason('');
    onDone();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={onHold ? 'Release from hold' : 'Place on hold'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!onHold && !reason.trim()}>Confirm</Button></>}>
      <Field label={onHold ? 'Note (optional)' : 'Reason (required)'} hint={onHold ? undefined : 'On-hold shipments are excluded from stuck alerts. This is not a stage.'}>
        <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function PaymentModal({ open, id, currency, onClose, onDone }: { open: boolean; id: string; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState(currency);
  const [date, setDate] = useState(todayISO());
  const [ref, setRef] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && /^[A-Za-z]{3}$/.test(cur);
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const { error } = await supabase.rpc('record_payment', {
      p_shipment_id: id,
      p_amount: Number(amount),
      p_currency: cur.toUpperCase(),
      p_payment_date: date,
      p_account: account || null,
      p_reference: ref || null,
      p_notes: null,
      p_idempotency_key: key, // double-clicks / retries cannot create duplicate payments
    });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Payment record saved successfully.');
    setAmount('');
    setRef('');
    setKey(crypto.randomUUID());
    onDone();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Record payment" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!valid}>Save payment</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" error={amount && !valid ? 'Enter a positive amount (max 2 decimals)' : undefined}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Currency"><Input maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} /></Field>
        <Field label="Payment date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Account"><Select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">—</option><option>Indian account</option><option>HKG account</option><option>Institutional order</option></Select></Field>
        <Field label="Reference no." className="sm:col-span-2"><Input value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const EDITABLE: { key: keyof ShipmentOverview; label: string; type?: 'date' | 'number' | 'gst' }[] = [
  { key: 'patient_name', label: 'Patient name' },
  { key: 'patient_reference', label: 'Patient reference' },
  { key: 'hospital_name', label: 'Hospital' },
  { key: 'doctor_name', label: 'Doctor' },
  { key: 'medicine_name', label: 'Medicine' },
  { key: 'strength', label: 'Strength' },
  { key: 'dosage_form', label: 'Dosage form' },
  { key: 'quantity_text', label: 'Quantity (text)' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'owner_name', label: 'Owner' },
  { key: 'pi_number', label: 'PI number' },
  { key: 'pi_amount', label: 'PI amount', type: 'number' },
  { key: 'currency', label: 'Currency' },
  { key: 'gst_status', label: 'GST status', type: 'gst' },
  { key: 'import_permit_number', label: 'Import permit no.' },
  { key: 'import_permit_date', label: 'Import permit date', type: 'date' },
  { key: 'cdec_signed_date', label: 'CDEC signed', type: 'date' },
  { key: 'cdec_approved_date', label: 'CDEC approved', type: 'date' },
  { key: 'courier_name', label: 'Courier' },
  { key: 'awb_number', label: 'AWB number' },
  { key: 'tracking_number', label: 'Tracking number' },
  { key: 'cha_name', label: 'CHA' },
  { key: 'estimated_delivery_date', label: 'Expected delivery', type: 'date' },
  { key: 'delivery_date', label: 'Delivery date', type: 'date' },
  { key: 'notes', label: 'Notes' },
];

function EditModal({ open, s, onClose, onDone }: { open: boolean; s: ShipmentOverview; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      const f: Record<string, string> = {};
      for (const e of EDITABLE) f[e.key] = s[e.key] == null ? '' : String(s[e.key]);
      setForm(f);
    }
  }, [open, s]);

  const save = async () => {
    const patch: Record<string, string | number | null> = {};
    for (const e of EDITABLE) {
      const raw = (form[e.key] ?? '').trim();
      const before = s[e.key] == null ? '' : String(s[e.key]);
      if (raw === before) continue;
      if (e.type === 'number') {
        if (raw && !/^\d+(\.\d{1,2})?$/.test(raw)) return notify.error(`${e.label} must be a non-negative number.`);
        patch[e.key] = raw ? Number(raw) : null;
      } else if (e.key === 'currency') {
        if (raw && !/^[A-Za-z]{3}$/.test(raw)) return notify.error('Currency must be a 3-letter code.');
        patch[e.key] = raw ? raw.toUpperCase() : null;
      } else if (e.key === 'medicine_name') {
        if (raw.length < 2) return notify.error('Medicine name is required.');
        patch[e.key] = raw;
      } else if (e.type === 'gst') {
        patch[e.key] = raw || 'Not applicable';
      } else {
        patch[e.key] = raw ? raw.slice(0, 2000) : null;
      }
    }
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    const { error } = await supabase.from('shipments').update(patch).eq('id', s.id);
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Shipment details saved.');
    onDone();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} wide title={`Edit ${s.shipment_code}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save changes</Button></>}>
      <p className="mb-3 text-xs text-muted">Stage, hold and POD are changed through their own actions so every change is recorded in the timeline. All edits are written to the audit log.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {EDITABLE.map((e) => (
          <Field key={e.key} label={e.label} className={e.key === 'notes' ? 'sm:col-span-3' : undefined}>
            {e.type === 'gst' ? (
              <Select value={form[e.key] ?? ''} onChange={(ev) => setForm({ ...form, [e.key]: ev.target.value })}>
                <option>Not applicable</option><option>Pending</option><option>Paid</option>
              </Select>
            ) : e.key === 'notes' ? (
              <Textarea rows={3} value={form[e.key] ?? ''} onChange={(ev) => setForm({ ...form, [e.key]: ev.target.value })} />
            ) : (
              <Input type={e.type === 'date' ? 'date' : 'text'} value={form[e.key] ?? ''} onChange={(ev) => setForm({ ...form, [e.key]: ev.target.value })} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function ArchiveModal({ open, id, code, onClose, onDone }: { open: boolean; id: string; code: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!reason.trim()) return notify.error('A reason is required.');
    setBusy(true);
    const { error } = await supabase.rpc('archive_shipment', { p_shipment_id: id, p_reason: reason.trim() });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success(`${code} archived.`);
    onDone();
  };
  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      danger
      loading={busy}
      title={`Archive ${code}?`}
      confirmLabel="Archive"
      onConfirm={go}
      body={
        <div className="space-y-3">
          <p>Archived shipments disappear from team views but stay in the database and audit log. History is never deleted.</p>
          <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      }
    />
  );
}

function DocumentsCard({ shipmentId, docs, disabled, onChange, isAdmin }: { shipmentId: string; docs: { name: string; created_at: string | null; size: number }[]; disabled: boolean; onChange: () => void; isAdmin: boolean }) {
  const [busy, setBusy] = useState(false);
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) return notify.error('Only PDF, PNG, JPG or WEBP files are allowed.');
    if (file.size > MAX_BYTES) return notify.error('Files must be 10 MB or smaller.');
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg');
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'document';
    // Path is constrained again by the storage policy: <shipment uuid>/<13-digit timestamp>-<safe name>.<ext>
    const path = `${shipmentId}/${Date.now()}-${base}.${ext}`;
    setBusy(true);
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Document uploaded.');
    onChange();
  };
  const open = async (name: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(`${shipmentId}/${name}`, 60);
    if (error || !data) return notify.error(error ?? 'Could not open the document.');
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  return (
    <Card
      title="Documents"
      action={
        !disabled && (
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-navy-600 hover:underline">
            <Upload className="h-3.5 w-3.5" /> {busy ? 'Uploading…' : 'Upload'}
            <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={upload} disabled={busy} />
          </label>
        )
      }
    >
      {docs.length === 0 ? (
        <Empty title="No documents">PI, permits, CDEC forms, AWB and POD files are stored privately here.</Empty>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {docs.map((d) => (
            <li key={d.name} className="flex items-center justify-between gap-2 px-4 py-2">
              <button onClick={() => open(d.name)} className="flex min-w-0 items-center gap-2 text-left text-navy-600 hover:underline">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{d.name.replace(/^\d{13}-/, '')}</span>
              </button>
              <span className="tnum shrink-0 text-xs text-muted">{fmtDate(d.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && docs.length > 0 && <p className="px-4 pb-3 text-[11px] text-muted">Links are signed and expire after 60 seconds.</p>}
    </Card>
  );
}
