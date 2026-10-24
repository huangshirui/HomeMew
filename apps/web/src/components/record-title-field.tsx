import type { ReactNode } from 'react';
import { RecordIconField, type IconModel, type RecordIcon, type RecordIconDraft } from './record-icon';

/**
 * Shared title row for all record editors. The optional icon occupies the same
 * 40px-high row as the name input, below one full-width field label.
 * This keeps the icon out of the label column and makes it genuinely optional.
 */
export function RecordTitleField({ label, icon, onIconChange, disabled, original, spaceId, modelKey, recordId, children }: {
  label: string;
  icon: RecordIconDraft;
  onIconChange: (value: RecordIconDraft) => void;
  disabled?: boolean;
  original?: RecordIcon | null;
  spaceId: string;
  modelKey: IconModel;
  recordId?: string;
  children: ReactNode;
}) {
  return <div className="min-w-0 space-y-1.5">
    <div className="text-sm font-medium text-stone-700">{label}</div>
    <div className="flex min-w-0 items-center gap-2.5">
      <RecordIconField icon={icon} onChange={onIconChange} disabled={disabled}
        original={original} spaceId={spaceId} modelKey={modelKey} recordId={recordId} />
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        {children}
      </label>
    </div>
  </div>;
}
