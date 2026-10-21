import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { DEPARTMENTS, DEPT_LABEL, ROLE_DEPARTMENT, type Department } from '../lib/constants';
import { notify } from '../lib/errors';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';

const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Max ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null));
const optDate = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD')
  .transform((v) => (v ? v : null));
const optNum = z
  .string()
  .optional()
  .refine((v) => !v || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), 'Enter a non-negative number')
  .transform((v) => (v ? Number(v) : null));

export const shipmentSchema = z.object({
  department: z.enum(['NPP', 'RARE_DISEASE']),
  patient_reference: optText(60),
  patient_name: optText(120),
  hospital_name: optText(),
  doctor_name: optText(120),
  medicine_name: z.string().trim().min(2, 'Medicine name is required').max(200),
  strength: optText(60),
  dosage_form: optText(60),
  quantity: optNum,
  quantity_unit: optText(30),
  manufacturer: optText(120),
  pi_number: optText(60),
  pi_amount: optNum,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || /^[A-Z]{3}$/.test(v), '3-letter code, e.g. INR, USD, EUR')
    .transform((v) => (v ? v : null)),
  gst_status: z.enum(['Not applicable', 'Pending', 'Paid']),
  is_foc: z.boolean(),
  import_permit_number: optText(60),
  courier_name: optText(60),
  awb_number: optText(60),
  estimated_delivery_date: optDate,
  owner_name: optText(80),
  notes: optText(2000),
});

type FormIn = z.input<typeof shipmentSchema>;
type FormOut = z.output<typeof shipmentSchema>;

export function NewShipmentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (code: string) => void }) {
  const { profile, isAdmin, scope } = useAuth();
  const fixedDept: Department | null = profile ? ROLE_DEPARTMENT[profile.role] : null;
  const defaultDept: Department = fixedDept ?? (scope !== 'ALL' ? scope : 'NPP');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(shipmentSchema),
    defaultValues: { department: defaultDept, gst_status: 'Not applicable', is_foc: false, currency: 'INR', owner_name: profile?.full_name ?? '' },
  });

  const onSubmit = async (v: FormOut) => {
    // shipment_code, stage, created_by and timestamps are set by the database trigger.
    const { data, error } = await supabase.from('shipments').insert(v).select('shipment_code').single();
    if (error) return notify.error(error);
    const code = (data as unknown as { shipment_code: string }).shipment_code;
    notify.success(`Shipment ${code} created successfully.`);
    reset();
    onCreated(code);
  };

  const E = (k: keyof FormIn) => errors[k]?.message as string | undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New shipment"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            Create shipment
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Section title="Department & patient">
          <Field label="Department" error={E('department')}>
            <Select {...register('department')}>
              {DEPARTMENTS.filter((d) => isAdmin || d === fixedDept).map((d) => (
                <option key={d} value={d}>{DEPT_LABEL[d]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Patient reference" error={E('patient_reference')} hint="Internal reference; avoid phone/ID numbers.">
            <Input {...register('patient_reference')} />
          </Field>
          <Field label="Patient name" error={E('patient_name')}>
            <Input {...register('patient_name')} />
          </Field>
        </Section>
        <Section title="Hospital & doctor">
          <Field label="Hospital" error={E('hospital_name')}><Input {...register('hospital_name')} /></Field>
          <Field label="Prescribing doctor" error={E('doctor_name')}><Input {...register('doctor_name')} /></Field>
        </Section>
        <Section title="Medicine & quantity">
          <Field label="Medicine *" error={E('medicine_name')}><Input {...register('medicine_name')} /></Field>
          <Field label="Strength" error={E('strength')}><Input {...register('strength')} placeholder="e.g. 150 mg" /></Field>
          <Field label="Dosage form" error={E('dosage_form')}><Input {...register('dosage_form')} placeholder="Capsule, vial…" /></Field>
          <Field label="Quantity" error={E('quantity')}><Input inputMode="decimal" {...register('quantity')} /></Field>
          <Field label="Unit" error={E('quantity_unit')}><Input {...register('quantity_unit')} placeholder="packs" /></Field>
          <Field label="Manufacturer" error={E('manufacturer')}><Input {...register('manufacturer')} /></Field>
        </Section>
        <Section title="Payment & proforma invoice">
          <Field label="PI number" error={E('pi_number')}><Input {...register('pi_number')} /></Field>
          <Field label="PI amount" error={E('pi_amount')}><Input inputMode="decimal" {...register('pi_amount')} /></Field>
          <Field label="Currency" error={E('currency')}><Input {...register('currency')} maxLength={3} /></Field>
          <Field label="GST status" error={E('gst_status')}>
            <Select {...register('gst_status')}>
              <option>Not applicable</option>
              <option>Pending</option>
              <option>Paid</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input type="checkbox" {...register('is_foc')} className="h-4 w-4 rounded border-line" /> Free of charge (FOC)
          </label>
        </Section>
        <Section title="Permit, logistics & ownership">
          <Field label="Import permit no." error={E('import_permit_number')}><Input {...register('import_permit_number')} /></Field>
          <Field label="Courier" error={E('courier_name')}><Input {...register('courier_name')} /></Field>
          <Field label="AWB number" error={E('awb_number')}><Input {...register('awb_number')} /></Field>
          <Field label="Expected delivery" error={E('estimated_delivery_date')}><Input type="date" {...register('estimated_delivery_date')} /></Field>
          <Field label="Owner" error={E('owner_name')}><Input {...register('owner_name')} /></Field>
        </Section>
        <Field label="Notes" error={E('notes')}>
          <Textarea rows={2} {...register('notes')} />
        </Field>
      </form>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}
