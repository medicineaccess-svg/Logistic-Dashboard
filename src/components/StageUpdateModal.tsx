import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { STAGES, isBackwards, nextStage, type Stage } from '../lib/constants';
import { notify } from '../lib/errors';
import { Button, Field, Modal, Select, StageBadge, Textarea } from './ui';

/** Stage change goes through the update_shipment_stage RPC, which writes the shipment and its history atomically. */
export function StageUpdateModal({
  open,
  onClose,
  shipment,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  shipment: { id: string; shipment_code: string; current_stage: Stage } | null;
  onDone?: () => void;
}) {
  const [stage, setStage] = useState<Stage>('Inquiry');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (shipment) {
      setStage(nextStage(shipment.current_stage) ?? shipment.current_stage);
      setMessage('');
      setReason('');
      setErr(null);
    }
  }, [shipment, open]);

  if (!shipment) return null;
  const backwards = isBackwards(shipment.current_stage, stage);
  const same = stage === shipment.current_stage;

  const submit = async () => {
    if (same) return setErr('Choose a different stage.');
    if (backwards && reason.trim().length < 3) return setErr('A correction reason is required when moving back.');
    setBusy(true);
    const { error } = await supabase.rpc('update_shipment_stage', {
      p_shipment_id: shipment.id,
      p_new_stage: stage,
      p_message: message.trim() || null,
      p_correction_reason: backwards ? reason.trim() : null,
    });
    setBusy(false);
    if (error) return notify.error(error);
    notify.success(`${shipment.shipment_code} updated to ${stage}.`);
    onDone?.();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Update stage · ${shipment.shipment_code}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={same}>
            {backwards ? 'Record correction' : 'Confirm update'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          Current: <StageBadge stage={shipment.current_stage} />
        </div>
        <Field label="New stage">
          <Select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s, i) => (
              <option key={s} value={s} disabled={s === shipment.current_stage}>
                {i + 1}. {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Update note (optional)" hint="Shown in the timeline, e.g. AWB number or what happens next.">
          <Textarea rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {backwards && (
          <Field label="Correction reason (required)" hint="Moving to an earlier stage is recorded as a correction in the audit trail.">
            <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {err && <p className="text-sm text-err">{err}</p>}
      </div>
    </Modal>
  );
}
