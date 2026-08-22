/**
 * 家庭成员列表页
 *
 * 展示：头像 / 昵称 / 角色 / 加入时间 / 当前用户标记。
 *
 * 管理员可：
 * - 升级为管理员
 * - 降级为普通成员
 * - 移除成员
 *
 * 要求：
 * - 二次确认
 * - 不能从成员列表移除自己
 * - 最后一个管理员降级/移除给出明确中文提示
 * - 操作成功后刷新成员、家庭详情（角色）和家庭列表（成员数）
 */

import { getFamily, listFamilyMembers, updateMemberRole, removeFamilyMember } from '../../services/families';
import {
  loadCurrentUser,
  loadFamilies,
  currentFamilyStore,
  setCurrentFamily,
} from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  formatDate,
} from '../../utils/index';
import { FamilyMember } from '../../types/index';

const DEFAULT_AVATAR_URL = '/assets/images/default-avatar.png';

type MemberView = FamilyMember & { joinedAtText: string; isSelf: boolean };

Page({
  data: {
    familyId: '',
    members: [] as MemberView[],
    currentUserId: '',
    isAdmin: false,
    loaded: false,
    processing: false,
  },

  onLoad(options: { familyId?: string }): void {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ familyId });
    this.loadAll();
  },

  onShow(): void {
    if (this.data.familyId && this.data.loaded) {
      this.loadAll();
    }
  },

  async loadAll(): Promise<void> {
    try {
      const [user, detail, members] = await Promise.all([
        loadCurrentUser(),
        getFamily(this.data.familyId),
        listFamilyMembers(this.data.familyId),
      ]);
      this.setData({
        currentUserId: user.id,
        isAdmin: detail.currentUserRole === 'admin',
        members: members.map(m => ({
          ...m,
          joinedAtText: formatDate(m.joinedAt, 'date'),
          isSelf: m.userId === user.id,
        })),
        loaded: true,
      });
    } catch (error: unknown) {
      console.error('[Members] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  onAvatarError(e: WechatMiniprogram.CustomEvent): void {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.members.length) return;
    const member = this.data.members[index];
    if (!member || member.avatarUrl === DEFAULT_AVATAR_URL) return;
    this.setData({
      members: this.data.members.map((item, itemIndex) => (
        itemIndex === index ? { ...item, avatarUrl: DEFAULT_AVATAR_URL } : item
      )),
    });
  },

  async onPromote(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const userId = e.currentTarget.dataset.id as string;
    await this.changeRole(userId, 'admin', '升级为管理员');
  },

  async onDemote(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const userId = e.currentTarget.dataset.id as string;
    await this.changeRole(userId, 'member', '降级为普通成员');
  },

  async changeRole(userId: string, role: 'admin' | 'member', actionLabel: string): Promise<void> {
    if (this.data.processing) return;
    const confirmed = await showConfirm('成员管理', `确定要${actionLabel}吗？`);
    if (!confirmed) return;

    this.setData({ processing: true });
    showLoading('处理中...');
    try {
      await updateMemberRole(this.data.familyId, userId, role);
      hideLoading();
      showSuccess('操作成功');
      await this.refreshAfterChange();
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[Members] Change role failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'LAST_ADMIN_CANNOT_BE_REMOVED') {
        showError('无法调整最后一名管理员的角色');
        return;
      }
      showError(getErrorMessage(err.code, err.message));
    }
  },

  async onRemove(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const userId = e.currentTarget.dataset.id as string;
    if (userId === this.data.currentUserId) {
      showError('不能移除你自己');
      return;
    }
    if (this.data.processing) return;
    const confirmed = await showConfirm('移除成员', '确定要移除该成员吗？此操作不可撤销');
    if (!confirmed) return;

    this.setData({ processing: true });
    showLoading('处理中...');
    try {
      await removeFamilyMember(this.data.familyId, userId);
      hideLoading();
      showSuccess('已移除');
      await this.refreshAfterChange();
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[Members] Remove failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'LAST_ADMIN_CANNOT_BE_REMOVED') {
        showError('无法移除最后一名管理员');
        return;
      }
      if (err.code === 'CANNOT_REMOVE_SELF') {
        showError('不能移除你自己');
        return;
      }
      showError(getErrorMessage(err.code, err.message));
    }
  },

  async refreshAfterChange(): Promise<void> {
    try {
      const [detail, members] = await Promise.all([
        getFamily(this.data.familyId),
        listFamilyMembers(this.data.familyId),
        loadFamilies(),
      ]);
      this.setData({
        isAdmin: detail.currentUserRole === 'admin',
        members: members.map(m => ({
          ...m,
          joinedAtText: formatDate(m.joinedAt, 'date'),
          isSelf: m.userId === this.data.currentUserId,
        })),
        processing: false,
      });
      // 同步当前家庭成员数
      const current = currentFamilyStore.value;
      if (current && current.id === this.data.familyId) {
        setCurrentFamily({ ...current, memberCount: members.length });
      }
    } catch (error: unknown) {
      this.setData({ processing: false });
      console.error('[Members] Refresh failed:', error);
    }
  },
});
