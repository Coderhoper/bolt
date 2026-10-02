import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';

type PaymentStatus = { id: string; status: string; provider_receipt: string | null; failure_reason: string | null };
export function MpesaPaymentPrompt({ paymentId, amount, phone, mode = 'payment', onClose, onStatus }:
  { paymentId: string; amount: number; phone: string; mode?: 'payment' | 'refund'; onClose: () => void; onStatus: (status: string) => void }) {
  const [status, setStatus] = useState('PROCESSING');
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const onStatusRef = useRef(onStatus);

  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

  useEffect(() => {
    let active = true;
    let finished = false;
    const poll = async () => {
      if (finished) return;
      const { data, error: requestError } = await supabase.rpc('get_my_payment_status', { p_payment_id: paymentId });
      if (!active) return;
      if (requestError) { setError('Payment status is taking longer to load. Keep this receipt and check again shortly.'); return; }
      const row = (Array.isArray(data) ? data[0] : data) as PaymentStatus | null;
      if (!row) { setError('Payment status is unavailable. Your sale was saved; ask an administrator to check the payment ledger.'); return; }
      setStatus(row.status);
      setReceipt(row.provider_receipt || '');
      setError(row.failure_reason || '');
      onStatusRef.current(row.status);
      if (!['PROCESSING','PENDING'].includes(row.status)) finished = true;
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 3000);
    const ticker = window.setInterval(() => setSeconds(current => current + 1), 1000);
    return () => { active = false; window.clearInterval(interval); window.clearInterval(ticker); };
  }, [paymentId]);

  const pending = status === 'PROCESSING' || status === 'PENDING';
  const isRefund = mode === 'refund';
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/55 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="mpesa-payment-title" className="w-full max-w-md rounded-md border border-ink-100 bg-paper p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3"><div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">M-Pesa</p>
        <h2 id="mpesa-payment-title" className="mt-1 font-display text-xl font-semibold text-ink-900">{pending ? (isRefund ? 'Processing refund' : 'Waiting for payment') : status === 'SUCCESS' ? (isRefund ? 'Refund sent' : 'Payment received') : (isRefund ? 'Refund not completed' : 'Payment not completed')}</h2>
      </div><button onClick={onClose} aria-label="Close payment status" className="rounded-sm p-1 text-ink-500 hover:bg-ink-100"><X size={18} /></button></div>
      <div className="my-5 rounded-sm bg-ink-50 p-4 text-center">
        {pending ? <Clock3 className="mx-auto text-accent-700" size={28} /> : status === 'SUCCESS' ? <CheckCircle2 className="mx-auto text-success" size={28} /> : <XCircle className="mx-auto text-danger" size={28} />}
        <p className="mt-2 font-mono text-2xl font-semibold text-ink-900">{formatCurrency(amount)}</p>
        <p className="mt-1 text-sm text-ink-600">{isRefund ? 'Refund recipient: ' : 'M-Pesa prompt sent to '}<span className="font-mono">{phone}</span></p>
      </div>
      {pending && <p className="flex items-center justify-center gap-2 text-sm text-ink-600"><Loader2 className="animate-spin" size={16} /> {isRefund ? 'Safaricom is processing the refund. Checking for confirmation' : 'Enter the M-Pesa PIN on the customer’s phone. Checking for confirmation'}… ({Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2,'0')})</p>}
      {status === 'SUCCESS' && <p role="status" className="rounded-sm bg-accent-50 p-3 text-sm text-accent-900">{isRefund ? 'Refund confirmed' : 'Payment confirmed'}{receipt ? ` · receipt ${receipt}` : ''}. The saved sale receipt reflects the latest status.</p>}
      {(status === 'FAILED' || status === 'CANCELLED' || status === 'TIMEOUT' || status === 'REVIEW_REQUIRED') && <p role="alert" className="rounded-sm bg-danger/10 p-3 text-sm text-danger">{error || (status === 'REVIEW_REQUIRED' ? 'Payment details need administrator review.' : `Safaricom did not confirm ${isRefund ? 'the refund' : 'payment'}.`)}</p>}
      {error && pending && <p role="status" className="mt-3 text-center text-xs text-warning">{error}</p>}
      {pending && seconds >= 120 && <p className="mt-3 text-center text-xs text-ink-500">You can close this window while Safaricom processes the payment. The sale and pending status are saved.</p>}
      <div className="mt-5 flex justify-end"><button onClick={onClose} className="rounded-sm border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700">{pending ? 'Close' : 'Done'}</button></div>
    </section>
  </div>;
}
