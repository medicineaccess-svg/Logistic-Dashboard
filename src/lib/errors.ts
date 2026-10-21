import { toast, type Id } from 'react-toastify';

interface PgLikeError {
  code?: string;
  message?: string;
}

/** Messages raised deliberately by our database functions are safe to show; anything else is replaced. */
const SAFE_MESSAGE_CODES = new Set(['22023', '23505', '22001', 'P0002']);

export function friendlyError(err: unknown): string {
  const e = (err ?? {}) as PgLikeError;
  const code = e.code ?? '';
  const msg = e.message ?? '';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    if (/^(Use the|Only an admin|You cannot|This field|Archived|Record a stock|New stock)/.test(msg)) return msg;
    return 'You do not have permission to perform this action.';
  }
  if (SAFE_MESSAGE_CODES.has(code) && msg && msg.length < 200) return msg;
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network/i.test(msg)) return 'Network problem. Check your connection and retry.';
  return 'Unable to save changes. Please retry.';
}

const TOAST_DEFAULTS = { autoClose: 3500 } as const;

export const notify = {
  success(msg: string, id?: string) {
    toast.success(msg, { ...TOAST_DEFAULTS, toastId: id ?? msg });
  },
  error(err: unknown, id?: string) {
    const msg = typeof err === 'string' ? err : friendlyError(err);
    toast.error(msg, { ...TOAST_DEFAULTS, autoClose: 5000, toastId: id ?? msg });
  },
  info(msg: string, id?: string) {
    toast.info(msg, { ...TOAST_DEFAULTS, toastId: id ?? msg });
  },
  loading(msg: string): Id {
    return toast.loading(msg);
  },
  done(id: Id, ok: boolean, msg: string) {
    toast.update(id, { render: msg, type: ok ? 'success' : 'error', isLoading: false, autoClose: ok ? 3000 : 5000 });
  },
};
