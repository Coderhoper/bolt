import { Modal } from './Modal';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex gap-4">
        {danger && (
          <div className="flex-shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-danger/10">
              <AlertTriangle className="text-danger" size={20} />
            </div>
          </div>
        )}
        <p className="pt-2 text-sm text-ink-600">{message}</p>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-sm border border-ink-200 bg-paper px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`rounded-sm px-4 py-2 text-sm font-medium text-white transition-colors ${
            danger ? 'bg-danger hover:bg-danger/90' : 'bg-accent-500 hover:bg-accent-700'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
