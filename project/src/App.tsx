import { useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
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

function AppContent() {
  const { session, profile, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
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
      case 'suppliers': return <Suppliers />;
      case 'expenses': return <Expenses />;
      case 'employees': return <Employees />;
      case 'salaries': return <Salaries />;
      case 'profit-loss': return <ProfitLoss />;
      case 'reports': return <Reports />;
      case 'settings': return <Settings />;
      case 'audit-logs': return <AuditLogs />;
      default: return <Dashboard />;
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
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
