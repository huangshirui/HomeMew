/**
 * 日程列表页
 *
 * 顶部日历 + 当日/全部日程列表。
 *
 * - 默认展示当月日历 + 当月全部日程列表。
 * - 点击日期：切换"选中日期"，列表显示该日日程；同时在标题右侧出现「全部」按钮可回到全部日程。
 * - 点击日期上有日程的圆点：定位到该日期。
 * - 月份翻页：上/下月按钮；切换月份会重新拉取该月份前后一个月范围内的事件以保证圆点完整。
 * - 右下角悬浮按钮：新建日程。
 * - 收到跳转参数 ?date=YYYY-MM-DD&attendee=me&familyId=xxx 时按需展示。
 */

import { listEvents } from '../../services/events';
import { currentFamilyStore } from '../../stores/index';
import { consumeDirty, subscribe } from '../../stores/dirty';
import {
  showError,
  getErrorMessage,
  parseDateOnly,
} from '../../utils/index';
import { Event } from '../../types/index';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

type EventView = {
  id: string;
  summary: string;
  isAllDay: boolean;
  startText: string;
  attendees: { userId: string; displayName: string }[];
  cancelled: boolean;
  raw: Event;
};

type DayCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasEvent: boolean;
};

Page({
  data: {
    weekLabels: WEEK_LABELS,
    monthLabel: '',
    /** 当前展示的年/月（用于切换与重新加载） */
    shownYear: 0,
    shownMonth: 0,
    calendar: [] as DayCell[][],
    selectedDate: '' as string | 'all',
    attendeeFilter: 'all' as 'all' | 'me',
    allEvents: [] as EventView[],
    displayedEvents: [] as EventView[],
    loaded: false,
    listError: false,
    noFamily: false,
    familyId: '' as string,
    monthLoading: false,
    listTitle: '',
    showTodayBtn: false,
  },

  /** 请求序号：用于丢弃过期（家庭切换 / 慢网络 / 翻月）返回结果 */
  _reqSeq: 0,

  // 脏标记订阅句柄：页面可见期间订阅，隐藏时取消，避免误刷新与泄漏
  _dirtyUnsubscribe: null as (() => void) | null,

  onLoad(options: { date?: string; familyId?: string; attendee?: string }): void {
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      this.setData({ loaded: true, noFamily: true });
      return;
    }
    const today = formatYmd(new Date());
    const initialDate = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
      ? options.date
      : 'all';
    // 带 date 参数进入时，日历展示该日期所在月份，而不是永远当前月
    const anchor = initialDate !== 'all' ? parseDateOnly(initialDate) : new Date();
    this.setData({
      familyId,
      noFamily: false,
      attendeeFilter: options?.attendee === 'me' ? 'me' : 'all',
      selectedDate: initialDate,
      shownYear: anchor.getFullYear(),
      shownMonth: anchor.getMonth() + 1,
    });
    this.refreshCalendar(today);
    this.loadEvents();
  },

  onShow(): void {
    this._subscribeDirty();
    const familyId = currentFamilyStore.value?.id || '';
    // 从无家庭恢复到有家庭
    if (familyId && this.data.noFamily) {
      this.setData({
        familyId,
        noFamily: false,
        shownYear: new Date().getFullYear(),
        shownMonth: new Date().getMonth() + 1,
      });
      this.refreshCalendar(formatYmd(new Date()));
      this.loadEvents();
      return;
    }
    // 家庭切换
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.setData({ familyId });
      this.refreshCalendar(formatYmd(new Date()));
      this.loadEvents();
      return;
    }
    // 变为无家庭
    if (!familyId && this.data.loaded && !this.data.noFamily) {
      this.setData({ noFamily: true });
      return;
    }
    if (this.data.loaded && !this.data.noFamily) {
      // 已加载：仅当数据被标记变更（新建 / 编辑 / 删除后返回）时才重新拉取
      if (consumeDirty('events')) {
        this.loadEvents();
      }
      return;
    }
  },

  refreshCalendar(today: string): void {
    const { shownYear, shownMonth } = this.data;
    const selected = this.data.selectedDate;
    const selectedDate = selected !== 'all' && selected ? new Date(selected + 'T00:00:00') : null;
    const now = new Date();
    const isCurMonth = shownYear === now.getFullYear() && shownMonth === now.getMonth() + 1;
    const showTodayBtn = !(selected !== 'all' && selected === today && isCurMonth);
    this.setData({
      monthLabel: `${shownYear}年${shownMonth}月`,
      calendar: this.buildCalendarMatrix(shownYear, shownMonth, today, selectedDate),
      showTodayBtn,
    });
  },

  buildCalendarMatrix(year: number, month: number, today: string, selectedDate: Date | null): DayCell[][] {
    const firstDay = new Date(year, month - 1, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells: DayCell[] = [];

    // 上个月末尾补充
    const prevMonthDays = new Date(year, month - 1, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const d = new Date(year, month - 2, day);
      cells.push({
        date: formatYmd(d),
        day,
        inMonth: false,
        isToday: false,
        isSelected: false,
        hasEvent: false,
      });
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      const dateStr = formatYmd(dt);
      cells.push({
        date: dateStr,
        day: d,
        inMonth: true,
        isToday: dateStr === today,
        isSelected: selectedDate ? sameDay(selectedDate, dt) : false,
        hasEvent: false,
      });
    }

    // 下个月开头补充，凑齐 42 格
    let nextDay = 1;
    while (cells.length < 42) {
      const d = new Date(year, month, nextDay);
      cells.push({
        date: formatYmd(d),
        day: nextDay,
        inMonth: false,
        isToday: false,
        isSelected: false,
        hasEvent: false,
      });
      nextDay++;
    }

    return chunk(cells, 7);
  },

  onRetry(): void {
    this.loadEvents();
  },

  /** 拉取当前展示月份前后 1 个月范围内的事件 */
  _subscribeDirty(): void {
    this._unsubscribeDirty();
    this._dirtyUnsubscribe = subscribe((domain) => {
      if (domain !== 'events') return;
      if (!this.data.loaded || this.data.noFamily) return;
      if (currentFamilyStore.value?.id !== this.data.familyId) return;
      this.loadEvents();
    });
  },

  _unsubscribeDirty(): void {
    if (this._dirtyUnsubscribe) {
      this._dirtyUnsubscribe();
      this._dirtyUnsubscribe = null;
    }
  },

  async loadEvents(): Promise<void> {
    const familyId = this.data.familyId;
    if (!familyId) return;
    const reqSeq = ++this._reqSeq;
    const { shownYear, shownMonth } = this.data;
    const rangeStart = new Date(shownYear, shownMonth - 2, 1);
    const rangeEnd = new Date(shownYear, shownMonth + 1, 0);
    // 月份切换 / 初次加载使用局部 loading，避免整页转圈
    this.setData({ monthLoading: true, listError: false });
    try {
      const events = await listEvents(familyId, {
        start: formatYmd(rangeStart),
        end: formatYmd(addDays(rangeEnd, 1)),
        ...(this.data.attendeeFilter === 'me' ? { attendeeId: 'me' } : {}),
      });
      // 家庭已切换 / 存在更新的请求（翻月等）：丢弃过期结果，避免旧数据覆盖当前页面
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      const views = this.mapEvents(events);
      this.setData({ allEvents: views, loaded: true, listError: false });
      this.markCalendarHasEvent();
      this.applyFilter();
    } catch (error: unknown) {
      if (reqSeq !== this._reqSeq || familyId !== this.data.familyId) return;
      console.error('[Events] Load failed:', error);
      const err = error as { code?: string; message?: string };
      // 网络失败设为 listError，避免被伪装成「本月没有日程」空状态
      this.setData({ loaded: true, listError: true });
      showError(getErrorMessage(err.code, err.message));
    } finally {
      if (reqSeq === this._reqSeq) {
        this.setData({ monthLoading: false });
      }
    }
  },

  mapEvents(events: Event[]): EventView[] {
    return events.map(e => ({
      id: e.id,
      summary: e.summary,
      isAllDay: e.isAllDay,
      startText: this.formatEventTime(e),
      attendees: e.attendees.map(a => ({ userId: a.userId, displayName: a.displayName })),
      cancelled: e.status === 'cancelled',
      raw: e,
    }));
  },

  formatEventTime(e: Event): string {
    if (e.isAllDay) return '全天';
    const start = new Date(e.start);
    const end = new Date(e.end);
    const startStr = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const endStr = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return `${startStr} - ${endStr}`;
  },

  markCalendarHasEvent(): void {
    const dates = new Set<string>();
    this.data.allEvents.forEach(ev => {
      const days = expandEventDays(ev.raw);
      days.forEach(d => dates.add(d));
    });
    const calendar = this.data.calendar.map(row =>
      row.map(c => ({ ...c, hasEvent: dates.has(c.date) })),
    );
    this.setData({ calendar });
  },

  applyFilter(): void {
    // 「只看我的」由服务端 attendeeId=me 过滤（见 loadEvents），此处仅做日期过滤。
    // allEvents 含前后月数据（仅用于日历圆点）；列表展示始终限定在当前展示月或选中日。
    const { allEvents, selectedDate, shownYear, shownMonth } = this.data;
    let list: EventView[];
    if (selectedDate === 'all') {
      const prefix = `${shownYear}-${pad(shownMonth)}`;
      list = allEvents.filter(ev => expandEventDays(ev.raw).some(d => d.slice(0, 7) === prefix));
    } else {
      list = allEvents.filter(ev => expandEventDays(ev.raw).includes(selectedDate as string));
    }
    this.setData({ displayedEvents: list, listTitle: this.friendlyListTitle(selectedDate) });
  },

  /** 列表标题：友好展示当前筛选日期 */
  friendlyListTitle(selectedDate: string | 'all'): string {
    if (selectedDate === 'all') return `${this.data.shownYear}年${this.data.shownMonth}月日程`;
    const today = formatYmd(new Date());
    if (selectedDate === today) return '今天';
    const tomorrow = formatYmd(addDays(new Date(), 1));
    if (selectedDate === tomorrow) return '明天';
    return friendlyDate(selectedDate);
  },

  onPrevMonth(): void {
    if (this.data.monthLoading) return;
    const cur = this.data;
    let y = cur.shownYear;
    let m = cur.shownMonth - 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    // 翻月清除旧月份的选中日期，避免继续按旧日期过滤
    this.setData({ shownYear: y, shownMonth: m, selectedDate: 'all' });
    this.refreshCalendar(formatYmd(new Date()));
    this.loadEvents();
  },

  onNextMonth(): void {
    if (this.data.monthLoading) return;
    const cur = this.data;
    let y = cur.shownYear;
    let m = cur.shownMonth + 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    // 翻月清除旧月份的选中日期，避免继续按旧日期过滤
    this.setData({ shownYear: y, shownMonth: m, selectedDate: 'all' });
    this.refreshCalendar(formatYmd(new Date()));
    this.loadEvents();
  },

  /** 回到今天：切回当前月并选中今天 */
  onBackToToday(): void {
    if (this.data.monthLoading) return;
    const now = new Date();
    const today = formatYmd(now);
    this.setData({
      shownYear: now.getFullYear(),
      shownMonth: now.getMonth() + 1,
      selectedDate: today,
    });
    this.refreshCalendar(today);
    this.loadEvents();
  },

  onDayTap(e: WechatMiniprogram.TouchEvent): void {
    const date = e.currentTarget.dataset.date as string;
    if (!date) return;
    this.setData({ selectedDate: date });
    this.refreshCalendar(date);
    this.applyFilter();
  },

  onShowAll(): void {
    this.setData({ selectedDate: 'all' });
    this.refreshCalendar(formatYmd(new Date()));
    this.applyFilter();
  },

  onToggleFilter(): void {
    const next = this.data.attendeeFilter === 'me' ? 'all' : 'me';
    this.setData({ attendeeFilter: next });
    // 「只看我的」需要服务端重新过滤，故重新拉取数据
    this.loadEvents();
  },

  onClearFilter(): void {
    this.setData({ attendeeFilter: 'all', selectedDate: 'all' });
    this.refreshCalendar(formatYmd(new Date()));
    this.loadEvents();
  },

  onCreateFamily(): void {
    wx.navigateTo({ url: '/pages/family/create' });
  },

  onJoinFamily(): void {
    wx.navigateTo({ url: '/pages/family/join' });
  },

  onEventTap(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/events/detail?id=${id}&familyId=${this.data.familyId}` });
  },

  onCreate(): void {
    const today = this.data.selectedDate && this.data.selectedDate !== 'all'
      ? this.data.selectedDate
      : formatYmd(new Date());
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.familyId}&date=${today}`,
    });
  },
});

/* ----------------- 工具函数 ----------------- */

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 将 YYYY-MM-DD 转成「M月D日 周X」或跨年时「YYYY年M月D日 周X」 */
function friendlyDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  const week = WEEK_CN[d.getDay()];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() === new Date().getFullYear()) {
    return `${m}月${day}日 周${week}`;
  }
  return `${d.getFullYear()}年${m}月${day}日 周${week}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * 展开日程占据的所有日期（用于日历点显示）。
 * - 全天日程：start..end（end 不包含，按 SPEC 9.5）
 * - 普通日程：仅 start 当天
 */
function expandEventDays(e: Event): string[] {
  if (e.isAllDay) {
    const start = new Date(e.start + 'T00:00:00');
    const end = new Date(e.end + 'T00:00:00');
    const days: string[] = [];
    let cur = new Date(start);
    while (cur < end) {
      days.push(formatYmd(cur));
      cur = addDays(cur, 1);
    }
    if (days.length === 0) days.push(formatYmd(start));
    return days;
  }
  return [formatYmd(new Date(e.start))];
}