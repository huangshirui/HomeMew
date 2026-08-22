import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'default' | 'icon';
};

export function Button({
  className,
  variant = 'secondary',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:pointer-events-none disabled:opacity-50',
        size === 'icon' ? 'size-10' : 'h-10 px-4',
        variant === 'primary' && 'bg-emerald-600 text-white hover:bg-emerald-700',
        variant === 'secondary' && 'bg-white text-stone-700 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50',
        variant === 'ghost' && 'text-stone-600 hover:bg-stone-100',
        className,
      )}
      {...props}
    />
  );
}
