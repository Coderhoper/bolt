import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative flex w-full ${sizeClasses[size]} max-h-[90vh] flex-col overflow-hidden rounded-lg border border-ink-100 bg-paper p-6 shadow-xl animate-scale-in`}>
        <div className="flex items-center justify-between border-b border-ink-100 pb-4">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-sm p-1.5 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pt-5">{children}</div>
      </div>
    </div>
  );
}
