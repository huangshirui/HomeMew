/**
 * 首页
 *
 * 有家庭时：展示当前家庭的工作台
 * - 当前家庭头部（图片 / 名称 / 人数 / 切换）
 * - 今日日程（占位，查看全部进入日程 Tab）
 * - 待办任务（占位，查看全部进入待办 Tab）
 *
 * 无家庭时：保留创建 / 加入家庭引导。
 *
 * 家庭管理（创建、加入、详情、成员、邀请）统一收归「我的」，
 * 首页只负责当前家庭的日常协作入口。
 */

import { currentFamilyStore, familiesStore, loadFamilies, setCurrentFamily, restoreCurrentFamily } from '../../stores/index';
import { showSuccess, showError } from '../../utils/index';
import { listEvents } from '../../services/events';
import { Event } from '../../types/index';

type FamilyView = {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  memberCount: number;
};

type TodayEventView = {
  id: string;
  summary: string;
  timeText: string;
  attendeeText: string;
};

Page({
  data: {
    currentFamily: null as FamilyView | null,
    families: [] as FamilyView[],
    canSwitch: false,
    loaded: false,
    todayEvents: [] as TodayEventView[],
    eventsLoading: false,
    eventsError: false,
  },

  /** 监听页面显示 */
  onShow(): void {
    this.loadData();
    // 订阅当前家庭变化
    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      const prevId = this.data.currentFamily?.id;
      this.setData({ currentFamily: family as FamilyView | null });
      const newId = (family as FamilyView | null)?.id;
      if (newId && newId !== prevId) {
        this.loadTodayEvents(newId);
      }
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      const cf = currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        canSwitch: (families as FamilyView[]).length > 1,
        loaded: true,
        currentFamily: (cf as FamilyView | null),
      });
    });
  },

  /** 取消订阅 */
  onHide(): void {
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
  },

  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,

  async loadData(): Promise<void> {
    try {
      const families = await loadFamilies();
      // 确保当前家庭已恢复并有效
      const current = restoreCurrentFamily(families) || currentFamilyStore.value;
      this.setData({
        families: families as FamilyView[],
        currentFamily: current as FamilyView | null,
        canSwitch: families.length > 1,
        loaded: true,
      });

      // 同步 globalData
      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = current;
      }

      // 今日日程独立加载，失败不影响页面其余部分
      if (current) {
        this.loadTodayEvents(current.id);
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true });
    }
  },

  /** 加载今日日程（独立于家庭信息加载） */
  async loadTodayEvents(familyId: string): Promise<void> {
    this.setData({ eventsLoading: true, eventsError: false });
    try {
      const today = new Date();
      const start = formatYmd(today);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const end = formatYmd(tomorrow);

      const events = await listEvents(familyId, { start, end, status: 'active' });
      // 家庭已切换则丢弃过期结果
      if (this.data.currentFamily?.id !== familyId) return;

      this.setData({
        todayEvents: events.map(mapTodayEvent),
        eventsLoading: false,
      });
    } catch (e) {
      console.error('[Home] Load today events failed:', e);
      if (this.data.currentFamily?.id !== familyId) return;
      this.setData({ eventsLoading: false, eventsError: true });
    }
  },

  /** 点击某条日程进入详情 */
  onEventTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/events/detail?id=${id}&familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 重试加载今日日程 */
  onRetryEvents(): void {
    if (!this.data.currentFamily) return;
    this.loadTodayEvents(this.data.currentFamily.id);
  },

  /** 切换家庭（仅在多个家庭时可用） */
  onSwitchFamily(): void {
    const { families, currentFamily } = this.data;
    if (!families || families.length <= 1) return;

    wx.showActionSheet({
      itemList: families.map(f => f.name),
      success: (res) => {
        const selected = families[res.tapIndex];
        if (selected.id !== currentFamily?.id) {
          setCurrentFamily(selected);
          showSuccess(`已切换到 ${selected.name}`);
        }
      },
    });
  },

  /** 创建家庭（独立页面） */
  onCreateFamily(): void {
    wx.navigateTo({
      url: '/pages/family/create',
    });
  },

  /** 加入家庭 */
  onJoinFamily(): void {
    wx.navigateTo({
      url: '/pages/family/join',
    });
  },

  /** 查看全部日程 */
  onViewEvents(): void {
    wx.switchTab({ url: '/pages/events/events' });
  },

  /** 查看全部待办 */
  onViewTasks(): void {
    wx.switchTab({ url: '/pages/tasks/tasks' });
  },

  /** 新建日程 */
  onCreateEvent(): void {
    if (!this.data.currentFamily) return;
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.currentFamily.id}`,
    });
  },

  /** 新建待办（暂未开放） */
  onCreateTask(): void {
    showError('功能即将上线');
  },
});

/* ----------------- 工具函数 ----------------- */

function formatYmd(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mapTodayEvent(e: Event): { id: string; summary: string; timeText: string; attendeeText: string } {
  let timeText = '全天';
  if (!e.isAllDay) {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const start = new Date(e.start);
    const end = new Date(e.end);
    timeText = `${pad(start.getHours())}:${pad(start.getMinutes())} - ${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }
  const names = e.attendees.map(a => a.displayName);
  const attendeeText = names.length > 0 ? names.join('、') : '';
  return { id: e.id, summary: e.summary, timeText, attendeeText };
}
