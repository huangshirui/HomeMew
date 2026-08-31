/**
 * 许愿池（Wish）展示文案与视图映射。
 *
 * 权限相关的可见性判断只用于控制界面显隐，真正的授权始终由 LifeSpace 负责。
 */

import { Wish, WishStatus } from '../types/index';
import { formatChineseDate } from './day-record-view';

export const WISH_STATUS_LABELS: Record<WishStatus, string> = {
  open: '等待实现',
  fulfilled: '愿望成真',
};

/** 列表卡片视图模型 */
export type WishView = {
  id: string;
  title: string;
  descriptionBrief: string;
  desiredDateText: string;
  status: WishStatus;
  statusLabel: string;
  ownerName: string;
  ownerAvatar: string;
  isOwner: boolean;
  canFulfill: boolean;
  version: number;
};

const DESCRIPTION_BRIEF_MAX = 40;

function brief(text: string | null): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > DESCRIPTION_BRIEF_MAX
    ? `${normalized.slice(0, DESCRIPTION_BRIEF_MAX)}…`
    : normalized;
}

export function mapWishView(wish: Wish, currentUserId: string): WishView {
  return {
    id: wish.id,
    title: wish.title,
    descriptionBrief: brief(wish.description),
    desiredDateText: wish.desiredDate ? `期望：${formatChineseDate(wish.desiredDate)}` : '',
    status: wish.status,
    statusLabel: WISH_STATUS_LABELS[wish.status],
    ownerName: wish.owner.displayName,
    ownerAvatar: wish.owner.avatarUrl || '/assets/images/default-avatar.png',
    isOwner: wish.owner.userId === currentUserId,
    canFulfill: wish.status === 'open',
    version: wish.version,
  };
}
