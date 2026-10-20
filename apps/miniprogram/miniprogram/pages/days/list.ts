/**
 * 日子列表页
 *
 * 二级页面（不在 TabBar 中），提供页面内 FAB 新增入口。
 *
 * - 顶部筛选映射到 Core 的 status / kind / attentionOnly / sort 查询参数；
 * - cursor 分页 + 触底加载更多 + 下拉刷新；
 * - 家庭切换后清空旧数据重新加载，不短暂展示上一个家庭的数据；
 * - onShow 只消费 'days' 领域的脏标记，普通返回不重复请求。
 *
 * 状态与天数文案全部来自 Core 的 computed，本页不重新判断关注状态。
 */

import { listDayRecords, ListDayRecordsParams } from '../../services/day-records';
import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { consumeDirty, subscribe } from '../../stores/dirty';
import { showError, getErrorMessage } from '../../utils/index';
import { mapDayRecordView, DayRecordView } from '../../utils/day-record-view';
import { DayRecord } from '../../types/index';
import { downloadRecordIconImage } from '../../services/record-icons';

type FilterKey = 'all' | 'attention' | 'countdown' | 'life' | 'archived';

type Group = {
  key: string;
  title: string;
  items: DayRecordView[];
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'attention', label: '需要关注' },
  { key: 'countdown', label: '倒计时' },
  { key: 'life', label: '生活记录' },
  { key: 'archived', label: '已归档' },
];

const PAGE_SIZE = 20;

/** 筛选 → Core 查询参数映射 */
function queryForFilter(filter: FilterKey): ListDayRecordsParams {
  switch (filter) {
    case 'attention':
      return { status: 'active', attentionOnly: true, sort: 'attention' };
    case 'countdown':
      return { status: 'active', kind: 'countdown' };
    case 'life':
      return { status: 'active', kind: 'elapsed,cycle' };
    case 'archived':
      return { status: 'archived' };
    default:
      return { status: 'active' };
  }
}

Page({
  data: {
    filters: FILTERS,
    activeFilter: 'all' as FilterKey,

    /** 非「全部」模式下的平铺列表 */
    items: [] as DayRecordView[],
    /** 「全部」模式下的分组列表 */
    groups: [] as Group[],
    useGroups: false,

    familyId: '',
    noFamily: false,

    firstLoading: false,
    refreshing: false,
    loadingMore: false,
    loadError: false,
    hasMore: false,
    loaded: false,
  },

  /** 原始数据，用于分组与追加 */
  _records: [] as DayRecord[],
  _imagePaths: {} as Record<string, string>,
  _loadingImages: new Set<string>(),
  _cursor: null as string | null,
  /** 请求序号：丢弃家庭切换 / 筛选切换造成的过期响应 */
  _reqSeq: 0,
  /** 缓存 onLoad 入参，供初始化失败后重试复用 */
  _initOptions: null as { familyId?: string } | null,
  _dirtyUnsubscribe: null as (() => void) | null,

  async onLoad(options: { familyId?: string }): Promise<void> {
    this._initOptions = options;
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[Days] Runtime bootstrap failed:', error);
      this.setData({ noFamily: false, loaded: true, loadError: true });
      return;
    }
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ noFamily: true, loaded: true });
      return;
    }
    this.setData({ familyId, noFamily: false });
    this.loadFirstPage();
  },

  onShow(): void {
    this._subscribeDirty();
    const familyId = currentFamilyStore.value?.id || '';

    // 从无家庭恢复
    if (familyId && this.data.noFamily) {
      this.setData({ familyId, noFamily: false });
      this.resetAndLoad();
      return;
    }
    // 家庭切换：清空旧家庭数据后重新加载
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.setData({ familyId });
      this.resetAndLoad();
      return;
    }
    // 变为无家庭
    if (!familyId && this.data.loaded && !this.data.noFamily) {
      this.setData({ noFamily: true });
      return;
    }
    if (this.data.loaded && !this.data.noFamily && consumeDirty('days')) {
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
      if (domain !== 'days') return;
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

  /** 家庭切换：先清空展示数据，避免残留上一个家庭的内容 */
  resetAndLoad(): void {
    this._records = [];
    this._cursor = null;
    this.setData({
      items: [],
      groups: [],
      hasMore: false,
      loadError: false,
      loaded: false,
    });
    this.loadFirstPage();
  },

  async loadFirstPage(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    const hasOld = this._records.length > 0;

    this.setData({
      firstLoading: !hasOld,
      refreshing: hasOld,
      loadError: false,
    });

    try {
      const result = await listDayRecords(familyId, {
        ...queryForFilter(this.data.activeFilter),
        limit: PAGE_SIZE,
      });
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;

      this._records = result.items ?? [];
      this._cursor = result.nextCursor;
      this.applyRecords();
      this.setData({
        firstLoading: false,
        refreshing: false,
        loaded: true,
        hasMore: !!result.nextCursor,
      });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Days] Load failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({
        firstLoading: false,
        refreshing: false,
        loaded: true,
        loadError: this._records.length === 0,
      });
      if (this._records.length > 0) {
        showError(getErrorMessage(err.code, err.message));
      }
    }
  },

  /** 触底加载下一页；已在加载或无更多时直接返回，避免重复请求 */
  async onReachBottom(): Promise<void> {
    if (this.data.loadingMore || !this.data.hasMore || !this._cursor) return;
    const familyId = this.data.familyId;
    const reqSeq = this._reqSeq;
    this.setData({ loadingMore: true });

    try {
      const result = await listDayRecords(familyId, {
        ...queryForFilter(this.data.activeFilter),
        limit: PAGE_SIZE,
        cursor: this._cursor,
      });
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;

      this._records = this._records.concat(result.items ?? []);
      this._cursor = result.nextCursor;
      this.applyRecords();
      this.setData({ loadingMore: false, hasMore: !!result.nextCursor });
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Days] Load more failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadingMore: false });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 下拉刷新：仅内容区下拉（nav-bar 固定），重新拉取日子列表 */
  onRefresh(): void {
    this.setData({ refreshing: true });
    this._cursor = null;
    Promise.resolve(this.loadFirstPage())
      .then(() => this.setData({ refreshing: false }))
      .catch(() => this.setData({ refreshing: false }));
  },

  /**
   * 生成展示数据。
   * 「全部」模式按客户端分组；同一条记录只归入优先级最高的一组。
   */
  applyRecords(): void {
    const familyId = this.data.familyId;
    const views = this._records.map(record => {
      const view = mapDayRecordView(record);
      if (record.presentation?.icon?.type === 'image') {
        const fileId = record.presentation.icon.fileId;
        const key = `${familyId}:${record.id}:${fileId}`;
        view.iconImagePath = this._imagePaths[key] || '';
        if (!view.iconImagePath && !this._loadingImages.has(key)) {
          this._loadingImages.add(key);
          void downloadRecordIconImage(familyId, record.id, fileId)
            .then(path => {
              if (this.data.familyId !== familyId || !this._records.some(r => r.id === record.id && r.presentation?.icon?.type === 'image' && r.presentation.icon.fileId === fileId)) return;
              this._imagePaths[key] = path;
              this.applyRecords();
            })
            .catch(() => undefined)
            .finally(() => this._loadingImages.delete(key));
        }
      }
      return view;
    });
    if (this.data.activeFilter !== 'all') {
      this.setData({ items: views, groups: [], useGroups: false });
      return;
    }

    const attention: DayRecordView[] = [];
    const countdown: DayRecordView[] = [];
    const life: DayRecordView[] = [];
    views.forEach((view) => {
      if (view.isAttentionRequired) attention.push(view);
      else if (view.kind === 'countdown') countdown.push(view);
      else life.push(view);
    });

    const groups: Group[] = [];
    if (attention.length) groups.push({ key: 'attention', title: '需要处理', items: attention });
    if (countdown.length) groups.push({ key: 'countdown', title: '期待的日子', items: countdown });
    if (life.length) groups.push({ key: 'life', title: '生活记录', items: life });

    this.setData({ items: [], groups, useGroups: true });
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent): void {
    const filter = e.currentTarget.dataset.key as FilterKey;
    if (!filter || filter === this.data.activeFilter) return;
    this._records = [];
    this._cursor = null;
    this.setData({
      activeFilter: filter,
      items: [],
      groups: [],
      hasMore: false,
      loadError: false,
    });
    this.loadFirstPage();
  },

  onRetry(): void {
    // 既覆盖首屏数据加载失败，也覆盖运行时初始化失败：重新走完整 onLoad
    this.onLoad(this._initOptions || {});
  },

  onRecordTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.familyId) return;
    wx.navigateTo({
      url: `/pages/days/detail?id=${id}&familyId=${this.data.familyId}`,
    });
  },

  onCreate(): void {
    if (!this.data.familyId) return;
    wx.navigateTo({ url: `/pages/days/edit?familyId=${this.data.familyId}` });
  },

  onCreateFamily(): void {
    wx.navigateTo({ url: '/pages/family/create' });
  },

  onJoinFamily(): void {
    wx.navigateTo({ url: '/pages/family/join' });
  },
});
