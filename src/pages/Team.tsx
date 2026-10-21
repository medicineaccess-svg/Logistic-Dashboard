import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import type { Profile } from '../lib/types';
import { ROLE_LABEL, type Role } from '../lib/constants';
import { fmtDate } from '../lib/format';
import { notify } from '../lib/errors';
import { Badge, Card, ConfirmModal, PageHeader, Select, Skeleton } from '../components/ui';

export function Team() {
  const { profile: me } = useAuth();
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ p: Profile; role: Role; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name');
    if (error) notify.error(error);
    setRows((data as Profile[] | null) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    // Server re-checks that the caller is an active admin and is not changing their own account.
    const { error } = await supabase.rpc('admin_update_profile', { p_user_id: pending.p.id, p_role: pending.role, p_is_active: pending.active, p_full_name: null });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success(`${pending.p.full_name} updated.`);
    setPending(null);
    load();
  };

  return (
    <>
      <PageHeader title="Team" subtitle="Roles decide which department's data each person can see. Changes are audited." />
      <Card>
        {loading ? (
          <Skeleton />
        ) : (
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Since</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-ink">{p.full_name}{p.id === me?.id && <span className="ml-1 text-xs text-muted">(you)</span>}</td>
                  <td className="text-muted">{p.email}</td>
                  <td>
                    <Select value={p.role} disabled={p.id === me?.id} className="w-auto !py-1" onChange={(e) => setPending({ p, role: e.target.value as Role, active: p.is_active })} aria-label={`Role for ${p.full_name}`}>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                  </td>
                  <td>
                    <button disabled={p.id === me?.id} onClick={() => setPending({ p, role: p.role, active: !p.is_active })} className="disabled:cursor-not-allowed">
                      <Badge tone={p.is_active ? 'green' : 'red'}>{p.is_active ? 'Active' : 'Deactivated'}</Badge>
                    </button>
                  </td>
                  <td className="tnum text-muted">{fmtDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          New accounts are created by an administrator in Supabase (Authentication → Users → Invite), then given a role here. Public sign-up should stay disabled.
        </p>
      </Card>
      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        loading={busy}
        onConfirm={apply}
        title="Confirm access change"
        body={pending && <p>Set <b>{pending.p.full_name}</b> to <b>{ROLE_LABEL[pending.role]}</b> and <b>{pending.active ? 'active' : 'deactivated'}</b>?</p>}
      />
    </>
  );
}
