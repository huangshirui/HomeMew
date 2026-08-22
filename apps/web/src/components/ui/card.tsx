import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-3xl bg-white shadow-sm ring-1 ring-stone-200/80', className)} {...props} />;
}

export function CardHeader({ children }: PropsWithChildren) {
  return <div className="flex items-center justify-between gap-4 px-5 pt-5">{children}</div>;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5 pt-4', className)} {...props} />;
}
