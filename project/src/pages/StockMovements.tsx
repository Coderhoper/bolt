import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatNumber, formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { TrendingUp, ArrowUp, ArrowDown, Settings } from 'lucide-react';
import type { StockMovement, Product } from '@/types';

export function StockMovements() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustNewStock, setAdjustNewStock] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from('stock_movements').select('*, product:products(*)').order('created_at', { ascending: false }).limit(100),
      supabase.from('products').select('*').eq('status', 'active').order('name'),
    ]);
    setMovements(m || []);
    setProducts(p || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdjust = async () => {
    if (!adjustProductId || !adjustNewStock) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('record_stock_adjustment', {
      p_product_id: adjustProductId,
      p_new_stock: parseFloat(adjustNewStock),
      p_note: adjustNote || null,
    });
    if (error) {
      showToast(error.message, 'error');
    } else {
      const product = products.find(p => p.id === adjustProductId);
      showToast(`Stock adjusted for ${product?.name || 'product'}`, 'success');
      setModalOpen(false);
      setAdjustProductId('');
      setAdjustNewStock('');
      setAdjustNote('');
      loadData();
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Stock Movements"
        subtitle="Audit trail of all stock changes"
        actions={isAdmin && (
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
            <Settings size={18} /> Stock Adjustment
          </button>
        )}
      />

      {movements.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={TrendingUp} title="No stock movements yet" description="Stock movements are recorded automatically when you make sales or purchases." />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Quantity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {movements.map(m => (
                  <tr key={m.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-ink-900">{m.product?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.movement_type === 'purchase' ? 'bg-accent-100 text-accent-700' :
                        m.movement_type === 'sale' ? 'bg-accent-100 text-accent-700' :
                        m.movement_type === 'adjustment' ? 'bg-warning/10 text-warning' :
                        'bg-ink-100 text-ink-600'
                      }`}>
                        {m.movement_type === 'purchase' && <ArrowUp size={12} />}
                        {m.movement_type === 'sale' && <ArrowDown size={12} />}
                        {m.movement_type === 'adjustment' && <Settings size={12} />}
                        {m.movement_type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium text-right ${
                      m.quantity > 0 ? 'text-accent-500' : 'text-danger'
                    }`} data-numeric>
                      {m.quantity > 0 ? '+' : ''}{formatNumber(m.quantity)}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-500">{m.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Stock Adjustment">
        <div className="space-y-4">
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            Stock adjustments are recorded in the audit trail. Use this to correct discrepancies from physical stock counts.
          </p>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Product *</label>
            <select
              value={adjustProductId}
              onChange={e => {
                setAdjustProductId(e.target.value);
                const p = products.find(p => p.id === e.target.value);
                if (p) setAdjustNewStock(String(p.current_stock));
              }}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
            >
              <option value="">Select product...</option>
              {products.map(p => <option key={p.id} value={p.id} data-numeric>{p.name} (Current: {p.current_stock} {p.unit})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">New Stock Count *</label>
            <input
              type="number"
              step="0.01"
              value={adjustNewStock}
              onChange={e => setAdjustNewStock(e.target.value)}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              placeholder="Enter actual counted stock"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Reason</label>
            <textarea
              value={adjustNote}
              onChange={e => setAdjustNote(e.target.value)}
              rows={2}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none border-ink-200 bg-paper focus:border-accent-500"
              placeholder="e.g. Physical stock count discrepancy"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
          <button onClick={handleAdjust} disabled={saving} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Apply Adjustment'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
