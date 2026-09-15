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
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg animate-slide-in ${
              toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200' :
              toast.type === 'error' ? 'bg-red-50 border border-red-200' :
              'bg-sky-50 border border-sky-200'
            }`}
          >
            {toast.type === 'success' && <CheckCircle className="text-emerald-600 flex-shrink-0 mt-0.5" size={18} />}
            {toast.type === 'error' && <XCircle className="text-red-600 flex-shrink-0 mt-0.5" size={18} />}
            {toast.type === 'info' && <Info className="text-sky-600 flex-shrink-0 mt-0.5" size={18} />}
            <p className={`text-sm flex-1 ${
              toast.type === 'success' ? 'text-emerald-800' :
              toast.type === 'error' ? 'text-red-800' :
              'text-sky-800'
            }`}>{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="text-slate-400 hover:text-slate-600">
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
