import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.slice(-3).map(toast => (
          <div
            key={toast.id}
            className={`flex items-start gap-3 rounded-md border-l-4 bg-ink-900 px-4 py-3 text-white shadow-lg animate-slide-in ${
              toast.type === 'success' ? 'border-success' :
              toast.type === 'error' ? 'border-danger' :
              'border-info'
            }`}
          >
            {toast.type === 'success' && <CheckCircle className="mt-0.5 flex-shrink-0 text-success" size={18} />}
            {toast.type === 'error' && <XCircle className="mt-0.5 flex-shrink-0 text-danger" size={18} />}
            {toast.type === 'info' && <Info className="mt-0.5 flex-shrink-0 text-info" size={18} />}
            <p className="flex-1 text-sm text-white">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} aria-label="Dismiss notification" className="rounded-sm text-ink-400 transition-colors hover:text-white">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
