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
import {
  showError,
  showLoading,
  hideLoading,
  getErrorMessage,
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
    familyId: '' as string,
  },

  onLoad(options: { date?: string; familyId?: string; attendee?: string }): void {
    const familyId = currentFamilyStore.value?.id || options.familyId || '';
    if (!familyId) {
      showError('缺少家庭信息');
      this.setData({ loaded: true });
      return;
    }
    const today = formatYmd(new Date());
    const initialDate = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
      ? options.date
      : 'all';
    this.setData({
      familyId,
      attendeeFilter: options?.attendee === 'me' ? 'me' : 'all',
      selectedDate: initialDate,
      shownYear: new Date().getFullYear(),
      shownMonth: new Date().getMonth() + 1,
    });
    this.refreshCalendar(today);
    this.loadEvents();
  },

  onShow(): void {
    const familyId = currentFamilyStore.value?.id;
    if (familyId && this.data.familyId && familyId !== this.data.familyId) {
      this.setData({ familyId });
      this.refreshCalendar(formatYmd(new Date()));
      this.loadEvents();
      return;
    }
    if (this.data.loaded) {
      this.loadEvents();
    }
  },

  refreshCalendar(today: string): void {
    const { shownYear, shownMonth } = this.data;
    const selected = this.data.selectedDate;
    const selectedDate = selected !== 'all' && selected ? new Date(selected + 'T00:00:00') : null;
    this.setData({
      monthLabel: `${shownYear}年${shownMonth}月`,
      calendar: this.buildCalendarMatrix(shownYear, shownMonth, today, selectedDate),
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

  /** 拉取当前展示月份前后 1 个月范围内的事件 */
  async loadEvents(): Promise<void> {
    if (!this.data.familyId) return;
    const { shownYear, shownMonth } = this.data;
    const rangeStart = new Date(shownYear, shownMonth - 2, 1);
    const rangeEnd = new Date(shownYear, shownMonth + 1, 0);
    showLoading('加载中...');
    try {
      const events = await listEvents(this.data.familyId, {
        start: formatYmd(rangeStart),
        end: formatYmd(addDays(rangeEnd, 1)),
      });
      hideLoading();
      const views = this.mapEvents(events);
      this.setData({ allEvents: views, loaded: true });
      this.markCalendarHasEvent();
      this.applyFilter();
    } catch (error: unknown) {
      hideLoading();
      console.error('[Events] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
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
    const { allEvents, selectedDate, attendeeFilter } = this.data;
    let list = allEvents;
    if (selectedDate !== 'all') {
      list = list.filter(ev => expandEventDays(ev.raw).includes(selectedDate as string));
    }
    if (attendeeFilter === 'me') {
      // 当前用户 id 在 attendees 中包含自己；这里用一个简单占位：
      // 通过 raw.attendees 列表无法直接知道"我"是谁，留作后续接入 currentUser 后再过滤。
      // 当前实现下 attendeeFilter='me' 仅控制是否显示"只看我的"按钮，不在数据层硬过滤。
    }
    this.setData({ displayedEvents: list });
  },

  onPrevMonth(): void {
    const cur = this.data;
    let y = cur.shownYear;
    let m = cur.shownMonth - 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    this.setData({ shownYear: y, shownMonth: m });
    this.refreshCalendar(formatYmd(new Date()));
    this.loadEvents();
  },

  onNextMonth(): void {
    const cur = this.data;
    let y = cur.shownYear;
    let m = cur.shownMonth + 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    this.setData({ shownYear: y, shownMonth: m });
    this.refreshCalendar(formatYmd(new Date()));
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
    this.applyFilter();
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