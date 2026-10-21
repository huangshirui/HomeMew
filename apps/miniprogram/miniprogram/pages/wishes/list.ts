/**
 * 许愿池列表页。
 *
 * 许愿池只表达「等待实现 / 愿望成真」两态；实现动作放在详情页承载，
 * 列表保持轻量浏览，避免误触。
 */

import { listWishes, ListWishesParams } from '../../services/wishes';
import { currentFamilyStore, userStore, loadCurrentUser } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { consumeDirty, subscribe } from '../../stores/dirty';
import { showError, getErrorMessage } from '../../utils/index';
import { mapWishView, WishView } from '../../utils/wish-view';
import { Wish } from '../../types/index';
import { downloadRecordIconImage } from '../../services/record-icons';

type FilterKey = 'all' | 'mine' | 'fulfilled';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '愿望' },
  { key: 'mine', label: '我的愿望' },
  { key: 'fulfilled', label: '已实现' },
];

const PAGE_SIZE = 20;

function queryForFilter(filter: FilterKey): ListWishesParams {
  switch (filter) {
    case 'mine':
      return { ownerUserId: 'me' };
    case 'fulfilled':
      return { status: 'fulfilled' };
    default:
      return { status: 'open', sort: 'default' };
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
  _iconPaths: {} as Record<string, string>,
  _loadingIcons: new Set<string>(),
  _cursor: null as string | null,
  _reqSeq: 0,
  /** 缓存 onLoad 入参，供初始化失败后重试复用 */
  _initOptions: null as { familyId?: string } | null,
  _dirtyUnsubscribe: null as (() => void) | null,

  async onLoad(options: { familyId?: string }): Promise<void> {
    this._initOptions = options;
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[Wishes] Runtime bootstrap failed:', error);
      this.setData({ noFamily: false, loaded: true, loadError: true });
      return;
    }
    const familyId = currentFamilyStore.value?.id || options?.familyId || '';
    if (!familyId) {
      this.setData({ noFamily: true, loaded: true });
      return;
    }
    this.setData({ familyId, noFamily: false });
    await this.ensureUser();
    this.loadFirstPage();
  },

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

  onHide(): void { this._unsubscribeDirty(); },
  onUnload(): void { this._unsubscribeDirty(); },

  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'wishes' || !this.data.loaded || this.data.noFamily) return;
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
    this.setData({ firstLoading: !hasOld, refreshing: hasOld, loadError: false });

    try {
      const result = await listWishes(familyId, {
        ...queryForFilter(this.data.activeFilter),
        limit: PAGE_SIZE,
      });
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      this._wishes = result.items ?? [];
      this._cursor = result.nextCursor;
      this.applyWishes();
      this.setData({ firstLoading: false, refreshing: false, loaded: true, hasMore: !!result.nextCursor });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Wishes] Load failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ firstLoading: false, refreshing: false, loaded: true, loadError: this._wishes.length === 0 });
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

  /** 下拉刷新：仅内容区下拉（nav-bar 固定），重新拉取许愿池列表 */
  onRefresh(): void {
    this.setData({ refreshing: true });
    this._cursor = null;
    Promise.resolve(this.loadFirstPage())
      .then(() => this.setData({ refreshing: false }))
      .catch(() => this.setData({ refreshing: false }));
  },

  applyWishes(): void {
    const familyId = this.data.familyId;
    const items = this._wishes.map(wish => {
      const view = mapWishView(wish, this.data.currentUserId);
      if (wish.presentation?.icon?.type === 'image') {
        const fileId = wish.presentation.icon.fileId;
        const key = `${familyId}:${wish.id}:${fileId}`;
        view.iconImagePath = this._iconPaths[key] || '';
        if (!view.iconImagePath && !this._loadingIcons.has(key)) {
          this._loadingIcons.add(key);
          void downloadRecordIconImage(familyId, 'wish', wish.id, fileId)
            .then(path => {
              if (this.data.familyId !== familyId
                || !this._wishes.some(w => w.id === wish.id && w.presentation?.icon?.type === 'image'
                  && w.presentation.icon.fileId === fileId)) return;
              this._iconPaths[key] = path;
              this.applyWishes();
            }).catch(() => undefined).then(() => this._loadingIcons.delete(key));
        }
      }
      return view;
    });
    this.setData({ items });
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent): void {
    const filter = e.currentTarget.dataset.key as FilterKey;
    if (!filter || filter === this.data.activeFilter) return;
    this._wishes = [];
    this._cursor = null;
    this.setData({ activeFilter: filter, items: [], hasMore: false, loadError: false });
    this.loadFirstPage();
  },

  onRetry(): void {
    // 既覆盖首屏数据加载失败，也覆盖运行时初始化失败：重新走完整 onLoad
    this.onLoad(this._initOptions || {});
  },

  onWishTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.familyId) return;
    wx.navigateTo({ url: `/pages/wishes/detail?id=${id}&familyId=${this.data.familyId}` });
  },

  onCreate(): void {
    if (!this.data.familyId) return;
    wx.navigateTo({ url: `/pages/wishes/edit?familyId=${this.data.familyId}` });
  },

  onCreateFamily(): void { wx.navigateTo({ url: '/pages/family/create' }); },
  onJoinFamily(): void { wx.navigateTo({ url: '/pages/family/join' }); },
});
