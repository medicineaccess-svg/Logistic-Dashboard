import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AppSettings } from '../lib/types';
import { notify } from '../lib/errors';
import { Button, Card, Field, Input, PageHeader, Skeleton } from '../components/ui';

export function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [stuck, setStuck] = useState('5');
  const [customs, setCustoms] = useState('7');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('id', 1).single().then(({ data }) => {
      const v = data as AppSettings | null;
      setS(v);
      if (v) {
        setStuck(String(v.stuck_days));
        setCustoms(String(v.customs_days));
      }
    });
  }, []);

  const save = async () => {
    const a = Number(stuck);
    const b = Number(customs);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a > 60 || b > 60) return notify.error('Use whole numbers between 1 and 60.');
    setBusy(true);
    const { error } = await supabase.rpc('update_settings', { p_stuck_days: a, p_customs_days: b });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success('Thresholds saved. Stuck flags update immediately.');
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Operational thresholds used for stuck-shipment alerts" />
      <Card className="max-w-lg">
        {!s ? <Skeleton /> : (
          <div className="space-y-4 p-5">
            <Field label="Flag as stuck after (days without an update)">
              <Input type="number" min={1} max={60} value={stuck} onChange={(e) => setStuck(e.target.value)} />
            </Field>
            <Field label="Flag customs delay after (days in customs)">
              <Input type="number" min={1} max={60} value={customs} onChange={(e) => setCustoms(e.target.value)} />
            </Field>
            <p className="text-xs text-muted">On-hold shipments are never flagged. Notes, payments and edits all count as updates.</p>
            <Button variant="primary" loading={busy} onClick={save}>Save</Button>
          </div>
        )}
      </Card>
    </>
  );
}
