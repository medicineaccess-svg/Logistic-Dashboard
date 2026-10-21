import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardCheck,
  CreditCard,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { DEPT_LABEL, ROLE_LABEL } from '../lib/constants';
import { useRealtimeStatus } from '../hooks/useRealtime';
import { BrandLogo, cx } from './ui';
import { SheetSyncButton } from './SheetSyncButton';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  show?: boolean;
}

export function Layout({ children }: { children: ReactNode }) {
  const { profile, isAdmin, scope, setScope, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const here = location.pathname + location.search;
  const { status } = useRealtimeStatus();

  const canNpp = isAdmin || profile?.role === 'npp';
  const canRare = isAdmin || profile?.role === 'rare_disease';

  const items: NavItem[] = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/shipments', label: isAdmin ? 'All shipments' : 'Shipments', icon: Package },
    { to: '/shipments?dept=NPP', label: 'NPP shipments', icon: Truck, show: isAdmin && canNpp },
    { to: '/shipments?dept=RARE_DISEASE', label: 'Recordati shipments', icon: Truck, show: isAdmin && canRare },
    { to: '/shipments?view=stuck', label: 'Stuck & alerts', icon: AlertTriangle },
    { to: '/shipments?view=permits', label: 'Import permits & CDEC', icon: ClipboardCheck },
    { to: '/payments', label: 'Payments', icon: CreditCard },
    { to: '/stock', label: 'Stock & inventory', icon: Boxes },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    { to: '/team', label: 'Team', icon: Users, show: isAdmin },
    { to: '/audit', label: 'Audit log', icon: FileClock, show: isAdmin },
    { to: '/settings', label: 'Settings', icon: Settings, show: isAdmin },
  ];

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/shipments?q=${encodeURIComponent(term)}` : '/shipments');
    setOpen(false);
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
      {items
        .filter((i) => i.show !== false)
        .map((i) => (
          <Link
            key={i.to}
            to={i.to}
            onClick={() => setOpen(false)}
            aria-current={here === i.to ? 'page' : undefined}
            className={cx(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150',
              here === i.to ? 'bg-navy-50 font-medium text-navy-800' : 'text-muted hover:bg-canvas hover:text-ink',
            )}
          >
            <i.icon className="h-4 w-4 shrink-0" aria-hidden />
            {i.label}
          </Link>
        ))}
    </nav>
  );

  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <Brand />
        {nav}
        <SidebarFooter />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 animate-rise flex-col bg-white">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            <SidebarFooter />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur">
          <button className="rounded p-1.5 text-muted hover:bg-canvas lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <form onSubmit={onSearch} className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search shipment ID, patient, medicine, hospital, AWB…"
              className="w-full rounded-lg border border-line bg-mist py-1.5 pl-8 pr-3 text-sm focus:border-navy-600 focus:bg-white focus:outline-none"
              aria-label="Search shipments"
            />
          </form>
          <div className="ml-auto flex items-center gap-3">
            {isAdmin ? (
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink"
                aria-label="Department"
              >
                <option value="ALL">All departments</option>
                <option value="NPP">{DEPT_LABEL.NPP}</option>
                <option value="RARE_DISEASE">{DEPT_LABEL.RARE_DISEASE}</option>
              </select>
            ) : (
              scope !== 'ALL' && <span className="hidden rounded-lg bg-navy-50 px-2 py-1 text-xs font-semibold text-navy-700 sm:inline">{DEPT_LABEL[scope]}</span>
            )}
            <span
              className={cx('hidden items-center gap-1.5 text-xs md:flex', status === 'live' ? 'text-ok' : status === 'offline' ? 'text-err' : 'text-muted')}
              title={status === 'live' ? 'Live updates connected' : status === 'offline' ? 'Live updates disconnected – data may be stale' : 'Connecting…'}
            >
              <span className={cx('h-2 w-2 rounded-full', status === 'live' ? 'bg-ok' : status === 'offline' ? 'bg-err' : 'bg-line')} />
              {status === 'live' ? 'Live' : status === 'offline' ? 'Offline' : '…'}
            </span>
            <span className="hidden text-xs text-muted xl:inline">{today}</span>
            <SheetSyncButton />
            <button onClick={() => navigate('/shipments?new=1')} className="inline-flex items-center gap-1 rounded-lg bg-navy-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-navy-600">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New shipment</span>
            </button>
            <div className="hidden text-right leading-tight md:block">
              <div className="text-sm font-medium text-ink">{profile?.full_name}</div>
              <div className="text-xs text-muted">{profile ? ROLE_LABEL[profile.role] : ''}</div>
            </div>
            <button onClick={() => signOut().then(() => navigate('/login'))} className="rounded-lg p-1.5 text-muted hover:bg-canvas" title="Sign out" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main key={location.pathname} className="mx-auto w-full max-w-[1400px] flex-1 animate-rise p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center px-5 py-4">
      <BrandLogo className="h-9" />
    </div>
  );
}

function SidebarFooter() {
  const { profile } = useAuth();
  if (!profile) return null;
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-semibold text-navy-800">
        {profile.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-medium text-ink">{profile.full_name}</div>
        <div className="truncate text-[11px] text-muted">{ROLE_LABEL[profile.role]} · {profile.email}</div>
      </div>
    </div>
  );
}
