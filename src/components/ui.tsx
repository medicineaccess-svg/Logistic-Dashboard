import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Inbox, Loader2, X, type LucideIcon } from 'lucide-react';
import type { Stage } from '../lib/constants';
import { DEPT_LABEL, type Department } from '../lib/constants';
import type { PaymentStatus } from '../lib/types';

export const LOGO_URL = 'https://ikrispharmanetwork.com/assets/img/logo.png';

/** Official Ikris logo (served from the Ikris site; falls back to a text wordmark if it cannot load). */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src={LOGO_URL}
      alt="Ikris Pharma Network"
      className={cx('w-auto max-w-[180px] object-contain', className)}
      onError={(e) => {
        const el = e.currentTarget;
        el.style.display = 'none';
        const span = document.createElement('span');
        span.textContent = 'Ikris Pharma Network';
        span.className = 'text-sm font-semibold text-navy-800';
        el.parentElement?.appendChild(span);
      }}
    />
  );
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-line bg-white shadow-soft', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold text-navy-800">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-navy-800 text-white hover:bg-navy-600 border-navy-800',
    secondary: 'bg-white text-ink hover:bg-canvas border-line',
    ghost: 'bg-transparent text-muted hover:bg-canvas border-transparent',
    danger: 'bg-white text-err hover:bg-err/5 border-err/40',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-100 disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block text-sm', className)}>
      <span className="mb-1 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-err">{error}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-mist px-3 py-1.5 text-sm text-ink placeholder:text-muted/70 transition focus:border-navy-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-navy-100';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, props.className)} />;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-900/30 p-4 backdrop-blur-[2px] sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx('w-full animate-rise rounded-xl border border-line bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-base font-semibold text-navy-800">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-canvas" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const STAGE_TONE: Record<Stage, string> = {
  Inquiry: 'bg-canvas text-muted ring-line',
  'Payment received': 'bg-navy-50 text-navy-700 ring-navy-100',
  'Import permit': 'bg-navy-50 text-navy-700 ring-navy-100',
  'CDEC form signed': 'bg-navy-50 text-navy-800 ring-navy-100',
  'CDEC approved': 'bg-navy-50 text-navy-800 ring-navy-100',
  'Order placed': 'bg-info/10 text-info ring-info/20',
  Shipped: 'bg-info/10 text-info ring-info/20',
  'In customs': 'bg-warn/10 text-warn ring-warn/25',
  Cleared: 'bg-sage-50 text-sage-500 ring-sage-500/25',
  Delivered: 'bg-ok/10 text-ok ring-ok/25',
  'POD received': 'bg-ok/15 text-ok ring-ok/30',
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_TONE[stage])}>{stage}</span>;
}

export function DeptBadge({ dept }: { dept: Department }) {
  return (
    <span
      className={cx(
        'inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        dept === 'NPP' ? 'bg-navy-50 text-navy-700' : 'bg-sage-50 text-sage-500',
      )}
    >
      {DEPT_LABEL[dept]}
    </span>
  );
}

const PAY_TONE: Record<PaymentStatus, string> = {
  Paid: 'text-ok',
  Received: 'text-ok',
  FOC: 'text-muted',
  Partial: 'text-warn',
  Unpaid: 'text-err',
  Unknown: 'text-muted/70',
};
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className={cx('text-xs font-medium', PAY_TONE[status])}>{status === 'Unknown' ? 'Not recorded' : status}</span>;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'red' | 'amber' | 'green' | 'blue' }) {
  const t = {
    slate: 'bg-canvas text-muted ring-line',
    red: 'bg-err/10 text-err ring-err/20',
    amber: 'bg-warn/10 text-warn ring-warn/25',
    green: 'bg-ok/10 text-ok ring-ok/25',
    blue: 'bg-navy-50 text-navy-700 ring-navy-100',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', t)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-muted', className)} aria-label="Loading" />;
}

export function FullPageSpinner() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <BrandLogo className="h-10" />
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <Inbox className="mx-auto h-8 w-8 text-muted/50" aria-hidden />
      <p className="mt-2 text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-line/60" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
      ))}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'alert' | 'warn' | 'good';
  onClick?: () => void;
}) {
  const accent = { default: 'text-navy-800', alert: 'text-err', warn: 'text-warn', good: 'text-ok' }[tone];
  const chip = { default: 'bg-navy-50 text-navy-600', alert: 'bg-err/10 text-err', warn: 'bg-warn/10 text-warn', good: 'bg-sage-50 text-sage-500' }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cx(
        'group animate-rise rounded-xl border border-line bg-white p-4 text-left shadow-soft',
        onClick && 'transition duration-200 hover:-translate-y-px hover:border-navy-100 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-100',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-muted">{label}</div>
        {Icon && (
          <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', chip)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <div className={cx('tnum mt-1 text-[28px] font-semibold leading-tight', accent)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Comp>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight text-navy-800">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink">{body}</div>
    </Modal>
  );
}
