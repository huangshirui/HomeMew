/**
 * 家庭邀请管理页
 *
 * 支持：
 * - 查看邀请列表（状态：有效 / 已过期 / 已用完 / 已撤销）
 * - 创建邀请（成功后立即展示完整邀请码与邀请路径）
 * - 撤销邀请
 * - 复制新邀请码 / 复制邀请路径
 * - 微信分享（onShareAppMessage 使用 joinPath）
 *
 * 历史邀请列表不假设仍返回完整邀请码，仅对本次创建成功的邀请提供复制。
 */

import { listInvites, createInvite, revokeInvite } from '../../services/families';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  copyToClipboard,
  formatDate,
} from '../../utils/index';
import { InviteListItem, InviteCreated } from '../../types/index';

type InviteView = InviteListItem & { statusText: string; expiresAtText: string };

const STATUS_TEXT: Record<string, string> = {
  active: '有效',
  expired: '已过期',
  exhausted: '已用完',
  revoked: '已撤销',
};

Page({
  data: {
    familyId: '',
    invites: [] as InviteView[],
    newInvite: null as InviteCreated | null,
    creating: false,
    loaded: false,
  },

  onLoad(options: { familyId?: string }): void {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ familyId });
    this.loadInvites();
  },

  onShow(): void {
    if (this.data.familyId && this.data.loaded) {
      this.loadInvites();
    }
  },

  mapInvites(list: InviteListItem[]): InviteView[] {
    return list.map(i => ({
      ...i,
      statusText: STATUS_TEXT[i.status] || i.status,
      expiresAtText: formatDate(i.expiresAt, 'datetime'),
    }));
  },

  async loadInvites(): Promise<void> {
    try {
      const invites = await listInvites(this.data.familyId);
      this.setData({ invites: this.mapInvites(invites), loaded: true });
    } catch (error: unknown) {
      console.error('[Invites] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  async onCreate(): Promise<void> {
    if (this.data.creating) return;
    this.setData({ creating: true });
    showLoading('生成邀请中...');
    try {
      const created = await createInvite(this.data.familyId);
      hideLoading();
      this.setData({ newInvite: created });
      // 重新加载列表（列表项不含 code，仅用于状态追踪）
      await this.loadInvites();
      showSuccess('邀请已生成');
    } catch (error: unknown) {
      hideLoading();
      this.setData({ creating: false });
      console.error('[Invites] Create failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  async onRevoke(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const inviteId = e.currentTarget.dataset.id as string;
    const confirmed = await showConfirm('撤销邀请', '确定要撤销该邀请吗？');
    if (!confirmed) return;

    showLoading('撤销中...');
    try {
      await revokeInvite(this.data.familyId, inviteId);
      hideLoading();
      showSuccess('已撤销');
      if (this.data.newInvite && this.data.newInvite.id === inviteId) {
        this.setData({ newInvite: null });
      }
      await this.loadInvites();
    } catch (error: unknown) {
      hideLoading();
      console.error('[Invites] Revoke failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  onCopyCode(): void {
    if (!this.data.newInvite) return;
    copyToClipboard(this.data.newInvite.code);
  },

  onCopyPath(): void {
    if (!this.data.newInvite) return;
    copyToClipboard(this.data.newInvite.joinPath);
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const invite = this.data.newInvite;
    if (!invite) {
      return {
        title: '家事喵 · 邀请你加入我们的家庭',
        path: '/pages/launch/launch',
      };
    }
    return {
      title: '家事喵 · 邀请你加入我们的家庭',
      path: invite.joinPath,
    };
  },
});
