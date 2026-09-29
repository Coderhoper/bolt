import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && (
          <p
            className={`mt-1 text-sm text-ink-500 ${/\d/.test(subtitle) ? 'font-mono tabular-nums' : ''}`}
            data-numeric={/\d/.test(subtitle) ? '' : undefined}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
