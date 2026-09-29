import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { SetPassword } from '@/pages/SetPassword';
import { Dashboard } from '@/pages/Dashboard';
import { Products } from '@/pages/Products';
import { StockMovements } from '@/pages/StockMovements';
import { Sales } from '@/pages/Sales';
import { Purchases } from '@/pages/Purchases';
import { Expenses } from '@/pages/Expenses';
import { Employees } from '@/pages/Employees';
import { Salaries } from '@/pages/Salaries';
import { ProfitLoss } from '@/pages/ProfitLoss';
import { Reports } from '@/pages/Reports';
import { Settings } from '@/pages/Settings';
import { AuditLogs } from '@/pages/AuditLogs';
import { Suppliers } from '@/pages/Suppliers';
import { Receiving } from '@/pages/Receiving';
import { Automation } from '@/pages/Automation';
import { isTenantContextActive } from '@/lib/supabase';
import { invokeTenantOwnerBridge } from '@/lib/tenantOwnerBridge';

function AppContent() {
  const { session, profile, loading, isAdmin } = useAuth();
  const [passwordSetupPending, setPasswordSetupPending] = useState(
    () => new URLSearchParams(window.location.search).get('set_password') === '1',
  );
  const [currentPage, setCurrentPage] = useState(() => window.location.hash.replace(/^#\/?/, '') || 'dashboard');

  useEffect(() => {
    const syncPage = () => setCurrentPage(window.location.hash.replace(/^#\/?/, '') || 'dashboard');
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    if (!session || !profile || !isTenantContextActive()) return;
    const knownPages = new Set(['dashboard', 'products', 'sales', 'purchases', 'receiving', 'automation', 'stock-movements', 'reports', 'settings']);
    const metricPage = knownPages.has(currentPage) ? currentPage : 'other';
    // Send only a route bucket and increment; never include sales, stock,
    // employees, customers, or transaction details in owner telemetry.
    void invokeTenantOwnerBridge({ action: 'metric', page: metricPage }).catch(() => undefined);
  }, [currentPage, session?.user.id, profile?.id]);

  const navigate = (page: string) => {
    if (window.location.hash !== `#/${page}`) window.location.hash = `/${page}`;
    setCurrentPage(page);
  };

  const finishPasswordSetup = () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('set_password');
    window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    setPasswordSetupPending(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (passwordSetupPending) {
    return <SetPassword onContinue={finishPasswordSetup} onReturnToLogin={finishPasswordSetup} />;
  }

  if (!session || !profile) {
    return <Login />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'products': return <Products />;
      case 'stock-movements': return <StockMovements />;
      case 'sales': return <Sales />;
      case 'purchases': return <Purchases />;
      case 'receiving': return <Receiving />;
      case 'automation': return isAdmin ? <Automation /> : <Dashboard />;
      case 'suppliers': return <Suppliers />;
      case 'expenses': return <Expenses />;
      case 'employees': return <Employees />;
      case 'salaries': return <Salaries />;
      case 'profit-loss': return <ProfitLoss />;
      case 'reports': return <Reports />;
      case 'settings': return isAdmin ? <Settings /> : <Dashboard />;
      case 'audit-logs': return isAdmin ? <AuditLogs /> : <Dashboard />;
      default: return <Dashboard />;
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={navigate}>
      {renderPage()}
    </Layout>
  );
}

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
