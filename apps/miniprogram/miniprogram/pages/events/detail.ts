/**
 * 日程详情页
 *
 * 展示日程完整信息并支持编辑、删除（任意有效家庭成员均可操作）。
 * 删除与版本冲突遵循 SPEC 9.7、9.8。
 */

import { getEvent, deleteEvent } from '../../services/events';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  formatDate,
  timeAgo,
} from '../../utils/index';
import { Event } from '../../types/index';

Page({
  data: {
    familyId: '',
    eventId: '',
    event: null as Event | null,
    /** 视图层使用的派生字段 */
    summary: '',
    description: '',
    isAllDay: false,
    dateText: '',
    timeText: '',
    location: '',
    locationText: '无',
    attendeeNames: '',
    createdByText: '',
    updatedByText: '',
    createdAtText: '',
    updatedAtText: '',
    loaded: false,
    deleting: false,
  },

  onLoad(options: { id?: string; familyId?: string }): void {
    const eventId = options?.id;
    const familyId = options?.familyId;
    if (!eventId || !familyId) {
      showError('缺少日程参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ eventId, familyId });
    this.loadEvent();
  },

  async loadEvent(): Promise<void> {
    try {
      const event = await getEvent(this.data.familyId, this.data.eventId);
      this.applyEvent(event);
    } catch (error: unknown) {
      console.error('[EventDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '日程加载失败');
      this.setData({ loaded: true });
    }
  },

  applyEvent(event: Event): void {
    const isAllDay = event.isAllDay;
    const start = new Date(event.start);
    const end = new Date(event.end);
    let dateText = '';
    let timeText = '';
    if (isAllDay) {
      // 全天：end 不包含，显示时使用 end-1 作为最后一天
      const inclusiveEnd = addDays(end, -1);
      dateText = sameYmd(start, inclusiveEnd)
        ? formatDate(event.start, 'date')
        : `${formatDate(event.start, 'date')} 至 ${formatDate(inclusiveEnd, 'date')}`;
      timeText = '全天';
    } else {
      dateText = formatDate(event.start, 'date');
      timeText = `${pad(start.getHours())}:${pad(start.getMinutes())} - ${pad(end.getHours())}:${pad(end.getMinutes())}`;
    }
    const attendees = event.attendees || [];
    this.setData({
      event,
      summary: event.summary,
      description: event.description || '',
      isAllDay,
      dateText,
      timeText,
      location: event.location || '',
      locationText: event.location ? event.location : '无',
      attendeeNames: attendees.length ? attendees.map(a => a.displayName).join('、') : '未指定',
      createdByText: event.createdBy?.displayName || '',
      updatedByText: event.updatedBy?.displayName || '',
      createdAtText: `${formatDate(event.createdAt, 'datetime')} · ${timeAgo(event.createdAt)}`,
      updatedAtText: `${formatDate(event.updatedAt, 'datetime')} · ${timeAgo(event.updatedAt)}`,
      loaded: true,
    });
  },

  onEdit(): void {
    if (!this.data.event) return;
    wx.navigateTo({
      url: `/pages/events/edit?familyId=${this.data.familyId}&id=${this.data.event.id}`,
    });
  },

  async onDelete(): Promise<void> {
    const event = this.data.event;
    if (!event || this.data.deleting) return;
    const confirmed = await showConfirm('删除日程', `确定要删除「${event.summary}」吗？`);
    if (!confirmed) return;
    this.setData({ deleting: true });
    showLoading('删除中...');
    try {
      await deleteEvent(this.data.familyId, event.id, event.version);
      hideLoading();
      showSuccess('已删除');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ deleting: false });
      console.error('[EventDetail] Delete failed:', error);
      const err = error as { code?: string; message?: string };
      if (err.code === 'CONFLICT' || err.code === 'VERSION_CONFLICT') {
        showError('内容已被其他家庭成员修改，请刷新后重试');
        this.loadEvent();
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '删除失败，请重试');
    }
  },
});

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameYmd(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}