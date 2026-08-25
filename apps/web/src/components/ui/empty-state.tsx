import type { ReactNode } from 'react';
import { Button } from './button';
import { Card } from './card';

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Card className="grid min-h-52 place-items-center p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-stone-100 text-stone-400">{icon}</div>
        <p className="mt-4 font-medium text-stone-700">{title}</p>
        {description ? <p className="mt-1.5 text-sm leading-6 text-stone-500">{description}</p> : null}
        {actionLabel && onAction ? <Button variant="secondary" className="mt-5" onClick={onAction}>{actionLabel}</Button> : null}
      </div>
    </Card>
  );
}
