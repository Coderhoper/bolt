import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-md bg-ink-50">
        <Icon className="text-ink-300" size={32} />
      </div>
      <h3 className="mt-4 text-base font-medium text-ink-700">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4 [&>button]:rounded-sm [&>button]:border [&>button]:border-ink-200 [&>button]:bg-paper [&>button]:px-4 [&>button]:py-2 [&>button]:text-sm [&>button]:font-medium [&>button]:text-ink-700 [&>button]:hover:bg-ink-50">{action}</div>}
    </div>
  );
}
