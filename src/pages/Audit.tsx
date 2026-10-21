import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AuditLog, Profile } from '../lib/types';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Empty, PageHeader, Select, Skeleton } from '../components/ui';

const PAGE = 50;

export function Audit() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('profiles').select('id,full_name').then(({ data }) => {
      const m: Record<string, string> = {};
      for (const p of (data as Pick<Profile, 'id' | 'full_name'>[] | null) ?? []) m[p.id] = p.full_name;
      setNames(m);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (entity) q = q.eq('entity_type', entity);
    q.then(({ data }) => {
      setRows((data as AuditLog[] | null) ?? []);
      setLoading(false);
    });
  }, [entity, page]);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Written by database triggers. Nobody — including admins — can edit or delete entries from the app." />
      <Card
        action={
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }} className="w-auto !py-1" aria-label="Entity">
            <option value="">All entities</option>
            <option value="shipments">Shipments</option>
            <option value="payments">Payments</option>
            <option value="medicine_stock">Stock</option>
            <option value="profiles">Users</option>
            <option value="app_settings">Settings</option>
          </Select>
        }
        title="Recent activity"
      >
        {loading ? <Skeleton rows={10} /> : rows.length === 0 ? <Empty title="No entries" /> : (
          <div className="overflow-auto">
            <table className="data">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Changes</th><th>Reason</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="tnum whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className="whitespace-nowrap">{r.actor_id ? names[r.actor_id] ?? 'User' : 'System / import'}</td>
                    <td>{r.action}</td>
                    <td className="whitespace-nowrap text-muted">{r.entity_type}</td>
                    <td className="max-w-[420px] text-xs text-muted">
                      {r.action === 'update' && r.new_values
                        ? Object.keys(r.new_values).map((k) => `${k}: ${short(r.old_values?.[k])} → ${short(r.new_values?.[k])}`).join('; ')
                        : r.action === 'insert'
                          ? short((r.new_values as Record<string, unknown> | null)?.shipment_code ?? (r.new_values as Record<string, unknown> | null)?.medicine_name ?? 'created')
                          : ''}
                    </td>
                    <td className="text-xs">{r.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
          <Button variant="ghost" disabled={rows.length < PAGE} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      </Card>
    </>
  );
}

function short(v: unknown): string {
  if (v == null) return '∅';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
