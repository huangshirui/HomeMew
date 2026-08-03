/**
 * 许愿池列表页
 *
 * 二级页面（不在 TabBar 中），提供页面内 FAB 新增入口。
 *
 * - 顶部筛选映射到 Core 的 status / ownerUserId / claimantUserId 查询参数；
 * - cursor 分页 + 触底加载更多 + 下拉刷新；
 * - 家庭切换后清空旧数据重新加载；
 * - 卡片上的「我来实现」使用 catchtap，避免同时进入详情；
 * - 并发认领失败时重新拉取该愿望最新状态，不做本地假成功。
 */

import { listWishes, claimWish, getWish, ListWishesParams } from '../../services/wishes';
import { currentFamilyStore, userStore, loadCurrentUser } from '../../stores/index';
import { consumeDirty, markDirty, subscribe } from '../../stores/dirty';
import { showError, showSuccess, showConfirm, getErrorMessage } from '../../utils/index';
import { mapWishView, WishView } from '../../utils/wish-view';
import { Wish } from '../../types/index';

type FilterKey = 'all' | 'mine' | 'claimed' | 'fulfilled' | 'archived';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我的愿望' },
  { key: 'claimed', label: '我认领的' },
  { key: 'fulfilled', label: '已实现' },
  { key: 'archived', label: '已归档' },
];

const PAGE_SIZE = 20;

/** 筛选 → Core 查询参数映射 */
function queryForFilter(filter: FilterKey): ListWishesParams {
  switch (filter) {
    case 'mine':
      return { ownerUserId: 'me', status: 'open,claimed,fulfilled' };
    case 'claimed':
      return { claimantUserId: 'me', status: 'claimed' };
    case 'fulfilled':
      return { status: 'fulfilled' };
    case 'archived':
      return { status: 'archived' };
    default:
      return { status: 'open,claimed,fulfilled', sort: 'default' };
  }
}

Page({
  data: {
    filters: FILTERS,
    activeFilter: 'all' as FilterKey,

    items: [] as WishView[],
    familyId: '',
    currentUserId: '',
    noFamily: false,

    firstLoading: false,
    refreshing: false,
    loadingMore: false,
    loadError: false,
    hasMore: false,
    loaded: false,
  },

  _wishes: [] as Wish[],
  _cursor: null as string | null,
  _reqSeq: 0,
  _dirtyUnsubscribe: null as (() => void) | null,

  async onLoad(options: { familyId?: string }): Promise<void> {
    const familyId = currentFamilyStore.value?.id || options?.familyId || '';
    if (!familyId) {
      this.setData({ noFamily: true, loaded: true });
      return;
    }
    this.setData({ familyId, noFamily: false });
    await this.ensureUser();
    this.loadFirstPage();
  },

  /** owner / claimant 判断依赖当前用户 ID，需先确保已加载 */
  async ensureUser(): Promise<void> {
    let user = userStore.value;
    if (!user) {
      try {
        user = await loadCurrentUser();
      } catch (e) {
        console.error('[Wishes] Load user failed:', e);
      }
    }
    this.setData({ currentUserId: user?.id || '' });
  },

  onShow(): void {
    this._subscribeDirty();
    const familyId = currentFamilyStore.value?.id || '';

    if (familyId && this.data.noFamily) {
      this.setData({ familyId, noFamily: false });
      this.resetAndLoad();
      return;
    }
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.setData({ familyId });
      this.resetAndLoad();
      return;
    }
    if (!familyId && this.data.loaded && !this.data.noFamily) {
      this.setData({ noFamily: true });
      return;
    }
    if (this.data.loaded && !this.data.noFamily && consumeDirty('wishes')) {
      this.loadFirstPage();
    }
  },

  onHide(): void {
    this._unsubscribeDirty();
  },

  onUnload(): void {
    this._unsubscribeDirty();
  },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'wishes') return;
      if (!this.data.loaded || this.data.noFamily) return;
      if (currentFamilyStore.value?.id !== this.data.familyId) return;
      this.loadFirstPage();
    });
  },

  _unsubscribeDirty(): void {
    if (this._dirtyUnsubscribe) {
      this._dirtyUnsubscribe();
      this._dirtyUnsubscribe = null;
    }
  },

  /** 家庭切换：清空旧数据，避免残留上一个家庭的愿望 */
  resetAndLoad(): void {
    this._wishes = [];
    this._cursor = null;
    this.setData({ items: [], hasMore: false, loadError: false, loaded: false });
    this.loadFirstPage();
  },

  async loadFirstPage(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    const hasOld = this._wishes.length > 0;

    this.setData({
      firstLoading: !hasOld,
      refreshing: hasOld,
      loadError: false,
    });

    try {
      const result = await listWishes(familyId, {
        ...queryForFilter(this.data.activeFilter),
        limit: PAGE_SIZE,
      });
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;

      this._wishes = result.items ?? [];
      this._cursor = result.nextCursor;
      this.applyWishes();
      this.setData({
        firstLoading: false,
        refreshing: false,
        loaded: true,
        hasMore: !!result.nextCursor,
      });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Wishes] Load failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({
        firstLoading: false,
        refreshing: false,
        loaded: true,
        loadError: this._wishes.length === 0,
      });
      if (this._wishes.length > 0) showError(getErrorMessage(err.code, err.message));
    }
  },

  async onReachBottom(): Promise<void> {
    if (this.data.loadingMore || !this.data.hasMore || !this._cursor) return;
    const familyId = this.data.familyId;
    const reqSeq = this._reqSeq;
    this.setData({ loadingMore: true });

    try {
      const result = await listWishes(familyId, {
        ...queryForFilter(this.data.activeFilter),
        limit: PAGE_SIZE,
        cursor: this._cursor,
      });
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;

      this._wishes = this._wishes.concat(result.items ?? []);
      this._cursor = result.nextCursor;
      this.applyWishes();
      this.setData({ loadingMore: false, hasMore: !!result.nextCursor });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Wishes] Load more failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadingMore: false });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  async onPullDownRefresh(): Promise<void> {
    this._cursor = null;
    await this.loadFirstPage();
    wx.stopPullDownRefresh();
  },

  applyWishes(claimingId?: string): void {
    const currentUserId = this.data.currentUserId;
    const items = this._wishes.map((w) => {
      const view = mapWishView(w, currentUserId);
      if (claimingId && w.id === claimingId) view.claiming = true;
      return view;
    });
    this.setData({ items });
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent): void {
    const filter = e.currentTarget.dataset.key as FilterKey;
    if (!filter || filter === this.data.activeFilter) return;
    this._wishes = [];
    this._cursor = null;
    this.setData({
      activeFilter: filter,
      items: [],
      hasMore: false,
      loadError: false,
    });
    this.loadFirstPage();
  },

  onRetry(): void {
    this.loadFirstPage();
  },

  onWishTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.familyId) return;
    wx.navigateTo({
      url: `/pages/wishes/detail?id=${id}&familyId=${this.data.familyId}`,
    });
  },

  /** 卡片上的快速认领：catchtap，不进入详情 */
  async onQuickClaim(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const id = e.currentTarget.dataset.id as string;
    const wish = this._wishes.find((w) => w.id === id);
    const view = this.data.items.find((v) => v.id === id);
    if (!wish || !view || view.claiming) return;

    const ok = await showConfirm('认领愿望', '确认由你来帮助实现这个愿望？');
    if (!ok) return;

    const familyId = this.data.familyId;
    this.applyWishes(id);

    try {
      const updated = await claimWish(familyId, id, wish.version);
      if (familyId !== this.data.familyId) return;
      this.replaceWish(updated);
      markDirty('wishes');
      showSuccess('已认领');
    } catch (error: unknown) {
      if (familyId !== this.data.familyId) return;
      console.error('[Wishes] Claim failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
      // 并发冲突 / 状态已变化：拉取该愿望最新状态重新渲染，不做本地假成功
      await this.refreshSingleWish(id);
    }
  },

  /** 用最新数据替换单条愿望（认领成功后立即反映） */
  replaceWish(updated: Wish): void {
    const index = this._wishes.findIndex((w) => w.id === updated.id);
    if (index >= 0) {
      this._wishes = this._wishes.slice();
      this._wishes[index] = updated;
    }
    this.applyWishes();
  },

  /** 单条重新拉取；已不可见（如被归档移出筛选）时整页刷新 */
  async refreshSingleWish(wishId: string): Promise<void> {
    const familyId = this.data.familyId;
    try {
      const latest = await getWish(familyId, wishId);
      if (familyId !== this.data.familyId) return;
      this.replaceWish(latest);
    } catch (e) {
      console.error('[Wishes] Refresh single wish failed:', e);
      if (familyId === this.data.familyId) this.loadFirstPage();
    }
  },

  onCreate(): void {
    if (!this.data.familyId) return;
    wx.navigateTo({ url: `/pages/wishes/edit?familyId=${this.data.familyId}` });
  },

  onCreateFamily(): void {
    wx.navigateTo({ url: '/pages/family/create' });
  },

  onJoinFamily(): void {
    wx.navigateTo({ url: '/pages/family/join' });
  },
});
