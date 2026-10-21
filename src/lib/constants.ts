// Single source of truth for the shipment workflow in the frontend.
// Must match the public.shipment_stage enum in supabase/migrations (enforced by the database).
export const STAGES = [
  'Inquiry',
  'Payment received',
  'Import permit',
  'CDEC form signed',
  'CDEC approved',
  'Order placed',
  'Shipped',
  'In customs',
  'Cleared',
  'Delivered',
  'POD received',
] as const;

export type Stage = (typeof STAGES)[number];

export const OPEN_STAGES: Stage[] = STAGES.filter((s) => s !== 'Delivered' && s !== 'POD received');

export type Department = 'NPP' | 'RARE_DISEASE';
export type Role = 'admin' | 'npp' | 'rare_disease';

export const DEPARTMENTS: Department[] = ['NPP', 'RARE_DISEASE'];

export const DEPT_LABEL: Record<Department, string> = {
  NPP: 'NPP',
  RARE_DISEASE: 'Recordati',
};

export const DEPT_LONG_LABEL: Record<Department, string> = {
  NPP: 'Named Patient Program',
  RARE_DISEASE: 'Recordati · Rare Disease',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  npp: 'NPP team',
  rare_disease: 'Recordati team',
};

export const ROLE_DEPARTMENT: Record<Role, Department | null> = {
  admin: null,
  npp: 'NPP',
  rare_disease: 'RARE_DISEASE',
};

export const GST_STATUSES = ['Not applicable', 'Pending', 'Paid'] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

export const STOCK_MOVEMENTS = ['receipt', 'reservation', 'release', 'dispatch', 'adjustment', 'return'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENTS)[number];

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function isBackwards(from: Stage, to: Stage): boolean {
  return stageIndex(to) < stageIndex(from);
}

export function nextStage(stage: Stage): Stage | null {
  const i = stageIndex(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}
