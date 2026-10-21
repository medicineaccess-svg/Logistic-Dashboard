import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { FullPageSpinner } from '../components/ui';
import { AccessDenied } from '../pages/AccessDenied';

/**
 * UX-only route guard. Real authorisation happens in Postgres (RLS + SECURITY DEFINER functions);
 * hiding a page here never grants or removes access to data.
 */
export function RequireAuth({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, profile, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!profile || !profile.is_active) {
    return <AccessDenied message="Your account is not set up or has been deactivated. Ask an admin to grant access." />;
  }
  if (adminOnly && !isAdmin) return <AccessDenied />;
  return <>{children}</>;
}
