import { useEffect, useRef } from 'react';
import { getActiveTenantId, supabase } from '@/lib/supabase';

type Reload = (quiet?: boolean) => void | Promise<void>;

const APP_TABLES = [
  'categories', 'subcategories', 'suppliers', 'supplier_products', 'products', 'product_variants',
  'stock_movements', 'purchases', 'purchase_items', 'sales', 'sale_items', 'expenses', 'employees',
  'salary_records', 'profit_targets', 'audit_logs', 'system_settings', 'tenant_memberships',
  'supplier_purchase_orders', 'supplier_purchase_order_lines', 'supplier_asns', 'supplier_asn_lines',
  'receiving_documents', 'receiving_document_lines', 'automation_jobs', 'automation_events',
  'system_notifications', 'anomaly_flags', 'reconciliation_runs', 'inbound_channel_routes',
  'inbound_sender_allowlist', 'automation_settings', 'supplier_scorecards',
] as const;

export function useRealtimeRefresh(reload: Reload, tables: readonly string[] = APP_TABLES) {
  const reloadRef = useRef(reload);
  const tableKey = tables.join(',');

  useEffect(() => { reloadRef.current = reload; }, [reload]);

  useEffect(() => {
    const tenantId = getActiveTenantId();
    if (!tableKey) return;
    let refreshTimer: number | undefined;

    if (!tenantId) {
      const refreshWhenVisible = () => {
        if (!document.hidden) void reloadRef.current(true);
      };
      const interval = window.setInterval(refreshWhenVisible, 10_000);
      window.addEventListener('focus', refreshWhenVisible);
      document.addEventListener('visibilitychange', refreshWhenVisible);
      return () => {
        window.clearInterval(interval);
        window.removeEventListener('focus', refreshWhenVisible);
        document.removeEventListener('visibilitychange', refreshWhenVisible);
      };
    }

    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    const watchedTables = new Set(tableKey.split(','));

    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase.channel(`tenant:${tenantId}`, { config: { private: true } });
      channel.on('broadcast', { event: 'tenant-data-changed' }, (message) => {
        const payload = message.payload as { table?: string };
        if (!payload?.table || !watchedTables.has(payload.table)) return;
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => { void reloadRef.current(true); }, 250);
      });
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tableKey]);
}
