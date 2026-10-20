import type { IconModel } from '../services/record-icons';
import { uploadRecordIconImage } from '../services/record-icons';
import type { RecordIcon } from '../types/index';

/** One selector shared by Event / Task / Wish editors; all sources are optional. */
export const RECORD_ICON_EMOJIS = ['📅', '🎉', '📚', '⚽', '🏠', '✈️', '🎁', '💡', '❤️', '⭐', '🍀', '✅'];

export type RecordIconEditState = {
  iconEmoji: string;
  iconFileId: string;
  iconImagePath: string;
  iconTouched: boolean;
};

export function originalIconState(icon?: RecordIcon | null): RecordIconEditState {
  return {
    iconEmoji: icon?.type === 'emoji' ? icon.value : '',
    iconFileId: icon?.type === 'image' ? icon.fileId : '',
    iconImagePath: '',
    iconTouched: false,
  };
}

/** Omitted presentation means no change on update, no metadata on create. */
export async function prepareRecordIcon(
  familyId: string,
  modelKey: IconModel,
  mode: 'create' | 'edit',
  state: RecordIconEditState,
): Promise<{ icon: RecordIcon | null } | undefined> {
  if (mode === 'edit' && !state.iconTouched) return undefined;
  if (mode === 'create' && !state.iconEmoji && !state.iconImagePath && !state.iconFileId) return undefined;
  let icon: RecordIcon | null = state.iconEmoji ? { type: 'emoji', value: state.iconEmoji } : null;
  if (state.iconFileId) icon = { type: 'image', fileId: state.iconFileId };
  else if (state.iconImagePath) {
    const fileId = await uploadRecordIconImage(familyId, modelKey, state.iconImagePath);
    icon = { type: 'image', fileId };
  }
  return { icon };
}
