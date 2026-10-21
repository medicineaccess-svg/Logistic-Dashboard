import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/errors';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { DEPT_LABEL, type Department } from '../lib/constants';
import { cx } from './ui';

interface SyncRun {
  department: Department;
  trigger_source: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'error';
  created: number;
  updated: number;
}

interface DeptResult {
  ok?: boolean;
  error?: string;
  stats?: { created?: number; updated?: number; unchanged?: number; flagged?: number };
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** "Sync with Google Sheet" control shown in the header of every dashboard. */
export function SheetSyncButton() {
  const { scope } = useAuth();
  const [last, setLast] = useState<SyncRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    let q = supabase
      .from('sheet_sync_runs')
      .select('department,trigger_source,started_at,finished_at,status,created,updated')
      .eq('status', 'ok')
      .order('started_at', { ascending: false })
      .limit(1);
    if (scope !== 'ALL') q = q.eq('department', scope);
    const { data } = await q;
    setLast(((data ?? [])[0] as SyncRun | undefined) ?? null);
  }, [scope]);

  useEffect(() => {
    void load();
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [load]);
  useRealtimeRefresh('sheet-sync-runs', ['sheet_sync_runs'], load);

  const run = async () => {
    setBusy(true);
    const id = notify.loading('Syncing with Google Sheet…');
    try {
      const { data, error } = await supabase.functions.invoke('sheet-sync', {
        body: { action: 'sync', ...(scope !== 'ALL' ? { department: scope } : {}) },
      });
      if (error) {
        let msg = 'Sync failed. Please retry.';
        try {
          const ctx = (error as { context?: Response }).context;
          const body = ctx ? await ctx.json() : null;
          if (body?.error) msg = body.error;
        } catch {
          /* keep generic */
        }
        notify.done(id, false, msg);
        return;
      }
      const results = ((data as { results?: Record<string, DeptResult> })?.results ?? {}) as Record<string, DeptResult>;
      const parts: string[] = [];
      let ok = true;
      for (const [dept, r] of Object.entries(results)) {
        const label = DEPT_LABEL[dept as Department] ?? dept;
        if (r?.ok) {
          const s = r.stats ?? {};
          parts.push(`${label}: ${s.updated ?? 0} updated, ${s.created ?? 0} new`);
        } else {
          ok = false;
          parts.push(`${label}: ${r?.error ?? 'failed'}`);
        }
      }
      notify.done(id, ok, parts.join(' · ') || 'Sync finished');
      void load();
    } catch {
      notify.done(id, false, 'Network problem. Check your connection and retry.');
    } finally {
      setBusy(false);
    }
  };

  const when = last?.finished_at ?? last?.started_at;
  return (
    <button
      onClick={run}
      disabled={busy}
      title={last ? `Google Sheet last synced ${ago(when)} (${last.trigger_source.replace('_', ' ')}). Click to sync now.` : 'Sync with Google Sheet'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink transition hover:bg-canvas disabled:opacity-60"
      aria-label="Sync with Google Sheet"
    >
      {busy ? <RefreshCw className="h-4 w-4 animate-spin text-navy-600" aria-hidden /> : <FileSpreadsheet className="h-4 w-4 text-ok" aria-hidden />}
      <span className="hidden lg:inline">Sync sheet</span>
      <span className={cx('hidden text-xs text-muted 2xl:inline')}>· {ago(when)}</span>
    </button>
  );
}
