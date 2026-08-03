/**
 * 许愿池（Wish）展示文案与视图映射。
 *
 * 权限相关的可见性判断（能否认领 / 编辑 / 归档）只用于控制界面显隐，
 * 真正的授权始终由 Core 负责。
 */

import { Wish, WishStatus } from '../types/index';
import { formatChineseDate } from './day-record-view';

export const WISH_STATUS_LABELS: Record<WishStatus, string> = {
  open: '等待实现',
  claimed: '已有人认领',
  fulfilled: '已实现',
  archived: '已归档',
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
  /** 「Shirui 正在帮忙实现」等辅助说明；无则为空串 */
  claimText: string;
  isOwner: boolean;
  isClaimant: boolean;
  /** 是否显示卡片上的「我来实现」快捷按钮 */
  canQuickClaim: boolean;
  version: number;
  claiming: boolean;
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
  const isOwner = wish.owner.userId === currentUserId;
  const isClaimant = !!wish.claimant && wish.claimant.userId === currentUserId;

  let claimText = '';
  if (wish.status === 'claimed' && wish.claimant) {
    claimText = isClaimant
      ? '你正在帮忙实现'
      : `${wish.claimant.displayName} 正在帮忙实现`;
  } else if (wish.status === 'fulfilled' && wish.fulfilledBy) {
    claimText = `由 ${wish.fulfilledBy.displayName} 实现`;
  }

  return {
    id: wish.id,
    title: wish.title,
    descriptionBrief: brief(wish.description),
    desiredDateText: wish.desiredDate ? `期望：${formatChineseDate(wish.desiredDate)}` : '',
    status: wish.status,
    statusLabel: WISH_STATUS_LABELS[wish.status],
    ownerName: wish.owner.displayName,
    ownerAvatar: wish.owner.avatarUrl || '/assets/images/default-avatar.png',
    claimText,
    isOwner,
    isClaimant,
    canQuickClaim: wish.status === 'open' && !isOwner,
    version: wish.version,
    claiming: false,
  };
}
