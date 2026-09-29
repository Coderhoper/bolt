import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
}

const colorClasses = {
  blue: { bg: 'bg-accent-50', icon: 'text-accent-700', ring: 'ring-accent-100' },
  emerald: { bg: 'bg-accent-50', icon: 'text-accent-700', ring: 'ring-accent-100' },
  amber: { bg: 'bg-warning/10', icon: 'text-warning', ring: 'ring-warning/10' },
  rose: { bg: 'bg-danger/10', icon: 'text-danger', ring: 'ring-danger/10' },
  violet: { bg: 'bg-accent-50', icon: 'text-accent-700', ring: 'ring-accent-100' },
  slate: { bg: 'bg-ink-50', icon: 'text-ink-600', ring: 'ring-ink-100' },
};

export function StatCard({ label, value, icon: Icon, trend, trendUp, color = 'slate' }: StatCardProps) {
  const c = colorClasses[color];
  return (
    <div className="rounded-md border border-ink-100 bg-paper p-5 shadow-xs">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
          <p className="mt-2 font-mono text-2xl font-medium tracking-tight text-ink-900 tabular-nums" data-numeric>{value}</p>
          {trend && (
            <p className={`mt-1 font-mono text-xs font-medium tabular-nums ${trendUp ? 'text-success' : 'text-danger'}`} data-numeric>
              {trend}
            </p>
          )}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${c.bg} ring-1 ${c.ring}`}>
          <Icon className={c.icon} size={20} />
        </div>
      </div>
    </div>
  );
}
