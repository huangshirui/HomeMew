/**
 * 愿望详情页。
 *
 * 业务生命周期只有「等待实现 -> 愿望成真」。任何拥有 LifeSpace Wish 写权限、
 * 且已映射为 Space Person 的用户都可以实现/撤销实现；内容编辑和删除仍由愿望主人控制。
 */

import { getWish, fulfillWish, reopenWish, deleteWish } from '../../services/wishes';
import { currentFamilyStore, userStore, loadCurrentUser } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
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
    celebrating: false,
    title: '',
    description: '',
    desiredDateText: '',
    status: 'open' as Wish['status'],
    statusLabel: '',
    ownerName: '',
    ownerAvatar: '',
    metaRows: [] as MetaRow[],
    canFulfill: false,
    isOwner: false,
    version: 0,

    /** 下拉刷新指示器状态（scroll-view refresher） */
    refreshing: false,
  },

  _wish: null as Wish | null,
  _celebrationTimer: null as ReturnType<typeof setTimeout> | null,

  async onLoad(options: { id?: string; familyId?: string }): Promise<void> {
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞详情加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[WishDetail] Runtime bootstrap failed:', error);
    }
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
    if (this.data.loaded && !this.data.celebrating) this.loadWish(true);
  },

  onUnload(): void {
    if (this._celebrationTimer) clearTimeout(this._celebrationTimer);
  },

  /** 下拉刷新：仅内容区下拉（nav-bar 固定），重新拉取愿望详情 */
  onRefresh(): void {
    this.setData({ refreshing: true });
    Promise.resolve(this.loadWish(true))
      .then(() => this.setData({ refreshing: false }))
      .catch(() => this.setData({ refreshing: false }));
  },

  async loadWish(silent = false): Promise<void> {
    if (!silent) this.setData({ loadError: false });
    try {
      const wish = await getWish(this.data.familyId, this.data.wishId);
      await this.applyWish(wish);
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
      metaRows: buildMetaRows(wish, view.ownerName),
      canFulfill: view.canFulfill,
      isOwner: view.isOwner,
      version: wish.version,
      loaded: true,
      loadError: false,
    });
  },

  onRetry(): void { this.loadWish(); },

  onEdit(): void {
    if (!this._wish || !this.data.isOwner) return;
    wx.navigateTo({ url: `/pages/wishes/edit?id=${this.data.wishId}&familyId=${this.data.familyId}` });
  },

  async onFulfill(): Promise<void> {
    if (this.data.submitting || !this._wish || this._wish.status !== 'open') return;
    this.setData({ submitting: true });
    try {
      const updated = await fulfillWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false, celebrating: true });
      markDirty('wishes');
      wx.vibrateShort({ type: 'light' });
      if (this._celebrationTimer) clearTimeout(this._celebrationTimer);
      this._celebrationTimer = setTimeout(() => {
        this.setData({ celebrating: false });
        this._celebrationTimer = null;
      }, 1500);
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onReopen(): Promise<void> {
    if (this.data.submitting || !this._wish || this._wish.status !== 'fulfilled') return;
    const ok = await showConfirm('撤销实现', '把这个愿望恢复为等待实现吗？');
    if (!ok) return;
    this.setData({ submitting: true });
    try {
      const updated = await reopenWish(this.data.familyId, this.data.wishId, this._wish.version);
      await this.applyWish(updated);
      this.setData({ submitting: false });
      markDirty('wishes');
      showSuccess('已恢复为等待实现');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      await this.handleActionError(error);
    }
  },

  async onDelete(): Promise<void> {
    if (this.data.submitting || !this._wish || !this.data.isOwner) return;
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

function buildMetaRows(wish: Wish, ownerName: string): MetaRow[] {
  const rows: MetaRow[] = [{ label: '许愿人', value: ownerName }];
  if (wish.desiredDate) rows.push({ label: '期望日期', value: wish.desiredDate });
  return rows;
}
