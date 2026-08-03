/**
 * 愿望详情页
 *
 * - 展示完全依赖 Core 返回的 Wish 与其字段；
 * - owner / claimant / fulfilledBy 由 Core 维护，本页只做可见性判断（非安全控制）；
 * - 状态动作（认领 / 放弃认领 / 标记实现 / 重新打开 / 归档 / 恢复）均提交当前 version；
 * - 并发冲突时重新拉取最新愿望，绝不覆盖他人修改或本地假成功；
 * - 删除（软删除）需二次确认，且提交时禁止重复点击。
 */

import {
  getWish,
  claimWish,
  unclaimWish,
  fulfillWish,
  reopenWish,
  archiveWish,
  restoreWish,
  deleteWish,
} from '../../services/wishes';
import { currentFamilyStore, userStore, loadCurrentUser } from '../../stores/index';
import { markDirty } from '../../stores/dirty';
import {
  showError,
  showSuccess,
  showConfirm,
  getErrorMessage,
  isVersionConflict,
} from '../../utils/index';
import { mapWishView } from '../../utils/wish-view';
import { Wish } from '../../types/index';

type MetaRow = { label: string; value: string };

Page({
  data: {
    familyId: '',
    wishId: '',

    loaded: false,
    loadError: false,
    submitting: false,

    title: '',
    description: '',
    desiredDateText: '',
    status: 'open' as Wish['status'],
    statusLabel: '',
    ownerName: '',
    ownerAvatar: '',
    claimText: '',
    metaRows: [] as MetaRow[],

    canQuickClaim: false,
    isOwner: false,
    isClaimant: false,
    version: 0,
  },

  _wish: null as Wish | null,

  onLoad(options: { id?: string; familyId?: string }): void {
    const familyId = options?.familyId || currentFamilyStore.value?.id || '';
    const wishId = options?.id || '';
    if (!familyId || !wishId) {
      showError('缺少必要参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ familyId, wishId });
    this.loadWish();
  },

  onShow(): void {
    // 从编辑页返回时重新拉取最新详情（编辑成功会 markDirty('wishes')）
    if (this.data.loaded) this.loadWish(true);
  },

  async onPullDownRefresh(): Promise<void> {
    await this.loadWish(true);
    wx.stopPullDownRefresh();
  },

  async loadWish(silent = false): Promise<void> {
    if (!silent) this.setData({ loadError: false });
    try {
      const wish = await getWish(this.data.familyId, this.data.wishId);
      this.applyWish(wish);
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (!silent) this.setData({ loadError: true, loaded: true });
      else showError(getErrorMessage(err.code, err.message));
    }
  },

  async ensureUser(): Promise<string> {
    let user = userStore.value;
    if (!user) {
      try {
        user = await loadCurrentUser();
      } catch (e) {
        console.error('[WishDetail] Load user failed:', e);
      }
    }
    return user?.id || '';
  },

  async applyWish(wish: Wish): Promise<void> {
    this._wish = wish;
    const currentUserId = await this.ensureUser();
    const view = mapWishView(wish, currentUserId);
    this.setData({
      title: view.title,
      description: wish.description || '',
      desiredDateText: view.desiredDateText,
      status: wish.status,
      statusLabel: view.statusLabel,
      ownerName: view.ownerName,
      ownerAvatar: view.ownerAvatar,
      claimText: view.claimText,
      metaRows: buildMetaRows(wish, view.ownerName),
      canQuickClaim: view.canQuickClaim,
      isOwner: view.isOwner,
      isClaimant: view.isClaimant,
      version: wish.version,
      loaded: true,
      loadError: false,
    });
  },

  onRetry(): void {
    this.loadWish();
  },

  onEdit(): void {
    if (!this._wish) return;
    if (this.data.status === 'archived') {
      showError('已归档的愿望不可编辑');
      return;
    }
    wx.navigateTo({
      url: `/pages/wishes/edit?id=${this.data.wishId}&familyId=${this.data.familyId}`,
    });
  },

  /* ----------------- 状态动作 ----------------- */

  async onClaim(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    const ok = await showConfirm('认领愿望', '确认由你来帮助实现这个愿望？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      const updated = await claimWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已认领');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onUnclaim(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    const ok = await showConfirm('放弃认领', '放弃后这个愿望会重新开放给大家认领，确定吗？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      const updated = await unclaimWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已取消认领');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onFulfill(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    const ok = await showConfirm('标记已实现', '确认这个愿望已经实现？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      const updated = await fulfillWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已实现');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onReopen(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    const ok = await showConfirm('重新打开', '重新打开后这个愿望会恢复为已实现前的状态，确定吗？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      const updated = await reopenWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已重新打开');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onArchive(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    const ok = await showConfirm('归档愿望', '归档后不会出现在默认列表中，确定归档？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      const updated = await archiveWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已归档');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onRestore(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    this.setData({ submitting: true });
    try {
      const updated = await restoreWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已恢复');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onDelete(): Promise<void> {
    if (this.data.submitting || !this._wish) return;
    const ok = await showConfirm('删除愿望', '删除后无法在普通列表中查看，确定删除？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      await deleteWish(this.data.familyId, this.data.wishId, this._wish.version);
      markDirty('wishes');
      showSuccess('已删除');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async handleActionError(error: unknown): Promise<void> {
    const err = error as { code?: string; message?: string };
    if (isVersionConflict(err.code)) {
      showError('内容已被其他家庭成员修改，请刷新后重试');
      await this.loadWish(true);
      return;
    }
    showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
  },
});

/* ----------------- 工具函数 ----------------- */

function buildMetaRows(wish: Wish, ownerName: string): MetaRow[] {
  const rows: MetaRow[] = [{ label: '许愿人', value: ownerName }];
  if (wish.claimant) rows.push({ label: '认领人', value: wish.claimant.displayName });
  if (wish.fulfilledBy) rows.push({ label: '实现人', value: wish.fulfilledBy.displayName });
  if (wish.desiredDate) rows.push({ label: '期望日期', value: wish.desiredDate });
  return rows;
}
