import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScrollText, Search } from 'lucide-react';
import type { AuditLog } from '@/types';

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-accent-100 text-accent-700',
  UPDATE: 'bg-accent-100 text-accent-700',
  DELETE: 'bg-danger/10 text-danger',
  TERMINATE: 'bg-danger/10 text-danger',
};

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setLogs(data || []);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const filtered = logs.filter(l => {
    const matchesSearch = (l.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.user_name || '').toLowerCase().includes(search.toLowerCase()) ||
      l.action.toLowerCase().includes(search.toLowerCase());
    const matchesAction = filterAction === 'all' || l.action.startsWith(filterAction);
    return matchesSearch && matchesAction;
  });

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Complete trail of all administrative actions" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by action, user, or description..."
            className="w-full rounded-sm border py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent-500/20 outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
          />
        </div>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
        >
          <option value="all">All Actions</option>
          <option value="CREATE">Create</option>
          <option value="UPDATE">Update</option>
          <option value="DELETE">Delete</option>
          <option value="TERMINATE">Terminate</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={ScrollText} title="No audit logs found" description="Actions performed by administrators will appear here." />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Date & Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(log => {
                  const actionType = log.action.split('_')[0];
                  const colorClass = ACTION_COLORS[actionType] || 'bg-ink-100 text-ink-600';
                  return (
                    <tr key={log.id} className="hover:bg-ink-50">
                      <td className="px-4 py-3 text-sm text-ink-600 whitespace-nowrap" data-numeric>{formatDateTime(log.created_at)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-ink-900">{log.user_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-600">{log.description || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
