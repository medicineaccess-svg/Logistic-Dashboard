import type { Department, GstStatus, Role, Stage, StockMovementType } from './constants';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Shipment {
  id: string;
  shipment_code: string;
  department: Department;
  patient_reference: string | null;
  patient_name: string | null;
  hospital_name: string | null;
  doctor_name: string | null;
  medicine_name: string;
  brand_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  quantity_text: string | null;
  manufacturer: string | null;
  supplier: string | null;
  origin_country: string | null;
  destination_country: string | null;
  region: string | null;
  current_stage: Stage;
  stage_entered_at: string;
  owner_id: string | null;
  owner_name: string | null;
  pi_number: string | null;
  pi_amount: number | null;
  currency: string | null;
  payment_account: string | null;
  gst_status: GstStatus;
  is_foc: boolean;
  payment_received_date: string | null;
  import_permit_number: string | null;
  import_permit_date: string | null;
  cdec_signed_date: string | null;
  cdec_approved_date: string | null;
  order_placed_date: string | null;
  tracking_number: string | null;
  courier_name: string | null;
  awb_number: string | null;
  cha_name: string | null;
  shipment_date: string | null;
  estimated_delivery_date: string | null;
  customs_entry_date: string | null;
  customs_cleared_date: string | null;
  delivery_date: string | null;
  pod_received: boolean;
  pod_received_date: string | null;
  is_on_hold: boolean;
  hold_reason: string | null;
  needs_review: boolean;
  review_note: string | null;
  status_text: string | null;
  last_activity_at: string;
  notes: string | null;
  source: string;
  source_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archive_reason: string | null;
}

export type PaymentStatus = 'FOC' | 'Received' | 'Unknown' | 'Unpaid' | 'Partial' | 'Paid';

export interface ShipmentOverview extends Shipment {
  received_total: number;
  last_payment_date: string | null;
  other_currency_payments: number;
  payment_status: PaymentStatus;
  sheet_payment_status?: string | null;
  outstanding_amount: number | null;
  days_since_update: number;
  days_in_stage: number;
  is_open: boolean;
  is_stuck: boolean;
  stuck_reason: string | null;
  stage_order: number;
}

export interface ShipmentUpdate {
  id: string;
  shipment_id: string;
  previous_stage: Stage | null;
  new_stage: Stage | null;
  update_type: string;
  update_message: string | null;
  updated_by: string | null;
  updated_at: string;
  source: string;
  metadata: Record<string, unknown>;
  correction_reason: string | null;
}

export interface Payment {
  id: string;
  shipment_id: string;
  amount: number;
  currency: string;
  payment_date: string;
  account: string | null;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface StockItem {
  id: string;
  department: Department;
  medicine_name: string;
  brand_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  available_quantity: number;
  reserved_quantity: number;
  reorder_level: number;
  warehouse_location: string | null;
  storage_conditions: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  stock_id: string;
  movement_type: StockMovementType;
  quantity: number;
  shipment_id: string | null;
  reference_number: string | null;
  reason: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  department: Department | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface AppSettings {
  id: number;
  stuck_days: number;
  customs_days: number;
  updated_at: string;
}
