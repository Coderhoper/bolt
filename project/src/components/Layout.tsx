import { useState, ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useCurrentTime } from '@/hooks/useCurrentTime';
import { isTenantContextActive } from '@/lib/supabase';
import { BrandLogo } from '@/components/BrandLogo';
import {
  LayoutDashboard, Package, ShoppingCart, TrendingUp, Wallet,
  Users, FileText, Settings, ScrollText, LogOut, Menu, X,
  Receipt, Target, ChevronDown, Truck, ClipboardCheck, Workflow,
  BarChart3, ContactRound,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: typeof LayoutDashboard;
  page: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
  { label: 'Analytics', icon: BarChart3, page: 'analytics', adminOnly: true },
  { label: 'Products', icon: Package, page: 'products' },
  { label: 'Stock Movements', icon: TrendingUp, page: 'stock-movements' },
  { label: 'Sales', icon: ShoppingCart, page: 'sales' },
  { label: 'Purchases', icon: Receipt, page: 'purchases' },
  { label: 'Receiving', icon: ClipboardCheck, page: 'receiving' },
  { label: 'Automation', icon: Workflow, page: 'automation', adminOnly: true },
  { label: 'Suppliers', icon: Truck, page: 'suppliers' },
  { label: 'Customers', icon: ContactRound, page: 'customers', adminOnly: true },
  { label: 'Expenses', icon: Wallet, page: 'expenses' },
  { label: 'Employees', icon: Users, page: 'employees' },
  { label: 'Salaries', icon: Wallet, page: 'salaries', adminOnly: true },
  { label: 'Profit & Loss', icon: Target, page: 'profit-loss' },
  { label: 'Reports', icon: FileText, page: 'reports' },
  { label: 'Settings', icon: Settings, page: 'settings', adminOnly: true },
  { label: 'Audit Logs', icon: ScrollText, page: 'audit-logs', adminOnly: true },
];

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { profile, isAdmin, signOut } = useAuth();
  const salesOnly = isTenantContextActive() && profile?.role === 'user';
  const { showToast } = useToast();
  const now = useCurrentTime();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const visibleItems = navItems.filter(item => salesOnly
    ? item.page === 'sales'
    : !item.adminOnly || isAdmin);

  const handleSignOut = async () => {
    await signOut();
    showToast('Signed out successfully', 'info');
  };

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink-900/40 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-ink-900 transform transition-transform duration-300 ease-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
            <BrandLogo size="sm" inverse tagline />
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-ink-400 hover:text-white transition-colors"
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {visibleItems.map(item => {
              const Icon = item.icon;
              const active = currentPage === item.page;
              return (
                <button
                  key={item.page}
                  onClick={() => {
                    onNavigate(item.page);
                    setSidebarOpen(false);
                  }}
                  className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors duration-150 ${
                    active
                      ? 'bg-accent-500 text-white shadow-md shadow-accent-950/20'
                      : 'text-ink-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={active ? 2.2 : 1.9}
                    className={active ? 'text-white' : 'text-ink-400 group-hover:text-white'}
                  />
                  <span>{item.label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/10 p-3">
            <div className="flex items-center gap-3 rounded-xl bg-white/5 px-2 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-[12px] font-semibold text-white">
                {profile?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] font-medium text-white leading-tight">
                  {profile?.name || 'User'}
                </p>
                <p className="truncate text-[11px] text-ink-400 capitalize mt-0.5">
                  {profile?.role === 'user' ? 'Staff' : profile?.role || 'User'}
                </p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="mt-1 flex w-full items-center gap-3 rounded-sm px-3 py-2 text-[13px] font-medium text-ink-400 hover:bg-ink-800/60 hover:text-white transition-colors duration-150"
            >
              <LogOut size={16} strokeWidth={1.9} />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-ink-100 bg-paper/90 backdrop-blur-xl px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-ink-700 hover:text-ink-900 transition-colors"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <div className="hidden lg:block">
            <p className="font-mono text-[12px] tabular-nums text-ink-500" data-numeric>
              {now.toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-ink-50 transition-colors duration-150"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
                {profile?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <ChevronDown
                size={14}
                className={`text-ink-400 transition-transform duration-200 ${
                  userMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-60 rounded-xl border border-ink-100 bg-paper py-1.5 shadow-xl z-20 animate-scale-in origin-top-right">
                  <div className="px-4 py-3 border-b border-ink-100">
                    <p className="text-[13px] font-semibold text-ink-900 leading-tight">
                      {profile?.name}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5 truncate">{profile?.email}</p>
                    <span
                      className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        isAdmin ? 'bg-accent-50 text-accent-700' : 'bg-ink-100 text-ink-600'
                      }`}
                    >
                      <span className="h-1 w-1 rounded-full bg-current" />
                      {isAdmin ? 'Administrator' : profile?.role === 'user' ? 'Sales staff' : 'Owner'}
                    </span>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 px-4 py-2 text-[13px] text-ink-700 hover:bg-ink-50 transition-colors duration-150"
                  >
                    <LogOut size={14} strokeWidth={1.9} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="p-4 sm:p-5 lg:px-8 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
