import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FamilyIdentity } from '../app-shell';

/** One mobile title bar for every primary HomeMew Web page, independent from desktop headers. */
export function PageHeader({ title, mobileTitle, mobileActions, mobileBackTo, children }: {
  title: string;
  mobileTitle?: string;
  mobileActions?: ReactNode;
  mobileBackTo?: string;
  children?: ReactNode;
  compactMobile?: boolean; // compatibility for previously adopted Calendar header
}) {
  const heading = mobileTitle ?? title;
  return (
    <header>
      <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 lg:hidden">
        <div className="min-w-0 justify-self-start">
          {mobileBackTo ? <Link to={mobileBackTo} aria-label="返回上一级" className="flex min-h-10 items-center gap-0.5 rounded-lg pr-2 text-sm text-stone-700">
            <ChevronLeft aria-hidden="true" className="size-5" /> 返回
          </Link> : <FamilyIdentity mobile />}
        </div>
        <h1 className="max-w-[min(8rem,30vw)] truncate text-center text-[20px] font-semibold leading-7 tracking-tight text-stone-950">{heading}</h1>
        <div className="flex min-w-0 items-center justify-end gap-1 justify-self-end">
          {mobileActions}
        </div>
      </div>
      {mobileActions === undefined && children ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2 lg:hidden">{children}</div>
      ) : null}
      <div className="hidden items-center justify-between gap-3 lg:flex">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">{title}</h1>
        {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </header>
  );
}
