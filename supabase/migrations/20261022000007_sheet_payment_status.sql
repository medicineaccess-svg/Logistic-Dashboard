-- Exact copy of the Google Sheet "Payment status" cell, used as the payment truth when no payment rows exist.
-- (Applied together with an updated public.shipment_overview: payment_status now reads 'Unpaid' for
--  "Not Received"/"Pending" and 'Received' for "Received"; sheet_payment_status appended as the last column.)
alter table public.shipments add column if not exists sheet_payment_status text;
-- see Supabase migration 'sheet_payment_status' for the full view definition
