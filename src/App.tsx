import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { supabaseConfigured } from './lib/supabase';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { Overview } from './pages/Overview';
import { Shipments } from './pages/Shipments';
import { ShipmentDetail } from './pages/ShipmentDetail';
import { Payments } from './pages/Payments';
import { Stock } from './pages/Stock';
import { Reports } from './pages/Reports';
import { Team } from './pages/Team';
import { Audit } from './pages/Audit';
import { SettingsPage } from './pages/Settings';
import type { ReactNode } from 'react';

function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  return (
    <RequireAuth adminOnly={adminOnly}>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

export function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        The app is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and rebuild.
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Protected><Overview /></Protected>} />
      <Route path="/shipments" element={<Protected><Shipments /></Protected>} />
      <Route path="/shipments/:code" element={<Protected><ShipmentDetail /></Protected>} />
      <Route path="/payments" element={<Protected><Payments /></Protected>} />
      <Route path="/stock" element={<Protected><Stock /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/team" element={<Protected adminOnly><Team /></Protected>} />
      <Route path="/audit" element={<Protected adminOnly><Audit /></Protected>} />
      <Route path="/settings" element={<Protected adminOnly><SettingsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
