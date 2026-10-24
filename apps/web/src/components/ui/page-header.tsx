import type { ReactNode } from 'react';
import { FamilyIdentity } from '../app-shell';
import { cn } from '../../lib/cn';

export function PageHeader({ title, mobileTitle, compactMobile = false, children }: {
  title: string;
  mobileTitle?: string;
  compactMobile?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={cn(
      'flex flex-wrap items-center justify-between gap-3',
      compactMobile && 'flex-nowrap gap-1.5 sm:gap-3',
    )}>
      <div className={cn('flex min-w-0 items-center gap-2', compactMobile && 'min-w-0 flex-1')}>
        <h1 className={cn(
          'min-w-0 truncate text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl',
          compactMobile && 'shrink-0 text-xl sm:text-3xl',
        )}>
          {mobileTitle ? <><span className="sm:hidden">{mobileTitle}</span><span className="hidden sm:inline">{title}</span></> : title}
        </h1>
        <div className={cn('w-28 min-w-0 lg:hidden', compactMobile && 'ml-auto w-[min(7rem,35vw)]')}>
          <FamilyIdentity mobile />
        </div>
      </div>
      {children ? <div className={cn(
        'flex flex-wrap items-center gap-2',
        compactMobile && 'shrink-0 flex-nowrap gap-1 sm:gap-2',
      )}>{children}</div> : null}
    </header>
  );
}
