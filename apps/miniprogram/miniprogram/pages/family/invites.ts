/**
 * 家庭邀请管理页
 *
 * 支持：
 * - 查看邀请列表（状态：有效 / 已过期 / 已用完 / 已撤销）
 * - 创建邀请（成功后立即展示完整邀请码）
 * - 撤销邀请
 * - 复制新邀请码（不复制无法在微信聊天中点击的小程序内部路径）
 * - 微信分享（onShareAppMessage 使用 BFF 提供的 joinPath）
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

type InviteView = InviteListItem & { statusText: string; subText: string; expiresAtText: string };

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
    newInviteView: null as { expiresAtText: string; usesText: string } | null,
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
    return list.map(i => {
      const expiresAtText = formatDate(i.expiresAt, 'datetime');
      let subText = '';
      switch (i.status) {
        case 'active':
          subText = `有效期至 ${expiresAtText}`;
          break;
        case 'expired':
          subText = `已于 ${expiresAtText} 过期`;
          break;
        case 'exhausted':
          subText = '邀请次数已用完';
          break;
        case 'revoked':
          subText = '已撤销';
          break;
        default:
          subText = STATUS_TEXT[i.status] || i.status;
      }
      return {
        ...i,
        statusText: STATUS_TEXT[i.status] || i.status,
        expiresAtText,
        subText,
      };
    });
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
      this.setData({
        newInvite: created,
        newInviteView: {
          expiresAtText: formatDate(created.expiresAt, 'datetime'),
          usesText: `可加入人数：${created.maxUses} 人`,
        },
      });
      // 重新加载列表（列表项不含 code，仅用于状态追踪）
      await this.loadInvites();
      showSuccess('邀请已生成');
    } catch (error: unknown) {
      console.error('[Invites] Create failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    } finally {
      hideLoading();
      this.setData({ creating: false });
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

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const invite = this.data.newInvite;
    if (!invite) {
      return {
        title: '家事喵 · 一起管理家庭生活',
        path: '/pages/home/home',
      };
    }
    return {
      title: '家事喵 · 邀请你加入我们的家庭',
      path: invite.joinPath,
    };
  },
});
