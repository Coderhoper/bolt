import { useState, ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  LayoutDashboard, Package, ShoppingCart, TrendingUp, Wallet,
  Users, FileText, Settings, ScrollText, LogOut, Menu, X,
  Building2, Receipt, Target, ChevronDown, Truck,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: typeof LayoutDashboard;
  page: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
  { label: 'Products', icon: Package, page: 'products' },
  { label: 'Variants', icon: Package, page: 'variants' },
  { label: 'Stock Movements', icon: TrendingUp, page: 'stock-movements' },
  { label: 'Sales', icon: ShoppingCart, page: 'sales' },
  { label: 'Purchases', icon: Receipt, page: 'purchases' },
  { label: 'Suppliers', icon: Truck, page: 'suppliers' },
  { label: 'Expenses', icon: Wallet, page: 'expenses' },
  { label: 'Employees', icon: Users, page: 'employees' },
  { label: 'Salaries', icon: Wallet, page: 'salaries' },
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
  const { showToast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin);

  const handleSignOut = async () => {
    await signOut();
    showToast('Signed out successfully', 'info');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 transform transition-transform lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 py-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500">
                <Building2 className="text-white" size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Business Manager</p>
                <p className="text-xs text-slate-400">Inventory & Sales</p>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
              <X size={20} />
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
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                    active
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-3">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">
                {profile?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-white">{profile?.name || 'User'}</p>
                <p className="truncate text-xs text-slate-400 capitalize">{profile?.role || 'user'}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
            >
              <LogOut size={18} />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 lg:px-8">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-600">
            <Menu size={24} />
          </button>
          <div className="hidden lg:block">
            <p className="text-sm text-slate-500">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-slate-100 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                {profile?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <ChevronDown size={16} className="text-slate-400" />
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-2 shadow-xl z-20">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-900">{profile?.name}</p>
                    <p className="text-xs text-slate-500">{profile?.email}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {isAdmin ? 'Administrator' : 'Owner (Read-only)'}
                    </span>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <LogOut size={16} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
