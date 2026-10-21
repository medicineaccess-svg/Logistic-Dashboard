import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui';

export function AccessDenied({ message }: { message?: string }) {
  const { signOut, session } = useAuth();
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
      <h1 className="mt-3 text-lg font-semibold text-slate-900">Access denied</h1>
      <p className="mt-1 text-sm text-slate-600">{message ?? 'Your role does not have access to this page.'}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={() => window.history.back()}>Go back</Button>
        {session && <Button onClick={() => signOut()}>Sign out</Button>}
      </div>
    </div>
  );
}
