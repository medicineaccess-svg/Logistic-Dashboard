import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

let statusListeners: ((s: RealtimeStatus) => void)[] = [];
let currentStatus: RealtimeStatus = 'connecting';
let lastSync: Date | null = null;

function setGlobalStatus(s: RealtimeStatus) {
  currentStatus = s;
  if (s === 'live') lastSync = new Date();
  statusListeners.forEach((l) => l(s));
}

export function useRealtimeStatus(): { status: RealtimeStatus; lastSync: Date | null } {
  const [status, setStatus] = useState<RealtimeStatus>(currentStatus);
  useEffect(() => {
    statusListeners.push(setStatus);
    return () => {
      statusListeners = statusListeners.filter((l) => l !== setStatus);
    };
  }, []);
  return { status, lastSync };
}

/**
 * Subscribe to Postgres changes on the given tables and call `onChange` (debounced).
 * RLS is applied by Supabase Realtime, so users only receive events for rows they can read.
 * On (re)subscribe we call onChange once to reconcile any events missed while disconnected.
 */
export function useRealtimeRefresh(key: string, tables: string[], onChange: () => void, filter?: string) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscribedOnce = false;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 400);
    };
    let channel = supabase.channel(`rt-${key}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        fire,
      );
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setGlobalStatus('live');
        if (subscribedOnce) fire(); // reconnect: reconcile with the database
        subscribedOnce = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setGlobalStatus('offline');
      }
    });
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tables.join(','), filter]);
}
