import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import type { ShipmentOverview, StockItem } from '../lib/types';
import { useRealtimeRefresh } from './useRealtime';

export const OVERVIEW_COLUMNS =
  'id,shipment_code,department,patient_name,hospital_name,medicine_name,quantity_text,current_stage,owner_name,payment_status,outstanding_amount,currency,gst_status,is_foc,delivery_date,pod_received,is_on_hold,needs_review,is_open,is_stuck,stuck_reason,days_since_update,days_in_stage,last_activity_at,import_permit_date,cdec_approved_date,estimated_delivery_date,stage_order,archived_at';

export type OverviewRow = Pick<
  ShipmentOverview,
  | 'id'
  | 'shipment_code'
  | 'department'
  | 'patient_name'
  | 'hospital_name'
  | 'medicine_name'
  | 'quantity_text'
  | 'current_stage'
  | 'owner_name'
  | 'payment_status'
  | 'outstanding_amount'
  | 'currency'
  | 'gst_status'
  | 'is_foc'
  | 'delivery_date'
  | 'pod_received'
  | 'is_on_hold'
  | 'needs_review'
  | 'is_open'
  | 'is_stuck'
  | 'stuck_reason'
  | 'days_since_update'
  | 'days_in_stage'
  | 'last_activity_at'
  | 'import_permit_date'
  | 'cdec_approved_date'
  | 'estimated_delivery_date'
  | 'stage_order'
  | 'archived_at'
>;

/** Loads the (RLS-filtered) shipment overview for the dashboard and keeps it live via Realtime. */
export function useOverviewData() {
  const { scope } = useAuth();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    let q = supabase.from('shipment_overview').select(OVERVIEW_COLUMNS).is('archived_at', null).limit(5000);
    let sq = supabase.from('medicine_stock').select('*').limit(2000);
    if (scope !== 'ALL') {
      q = q.eq('department', scope);
      sq = sq.eq('department', scope);
    }
    const [{ data, error: e1 }, { data: sdata, error: e2 }] = await Promise.all([q, sq]);
    if (e1 || e2) setError(true);
    setRows((data as OverviewRow[] | null) ?? []);
    setStock((sdata as StockItem[] | null) ?? []);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useRealtimeRefresh('overview', ['shipments', 'payments', 'medicine_stock'], load);

  return { rows, stock, loading, error, reload: load };
}
