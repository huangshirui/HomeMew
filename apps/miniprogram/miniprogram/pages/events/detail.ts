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
  isVersionConflict,
  formatDate,
  timeAgo,
  parseDateOnly,
  formatDateOnly,
  addDaysToDateOnly,
} from '../../utils/index';
import { Event } from '../../types/index';
import { markDirty } from '../../stores/dirty';

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
    createdBySystem: false,
    updatedByText: '',
    updatedBySystem: false,
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

  onShow(): void {
    // 从编辑页返回后刷新，避免继续展示编辑前的旧数据
    if (this.data.loaded && this.data.eventId) {
      this.loadEvent();
    }
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
    let dateText = '';
    let timeText = '';
    if (isAllDay) {
      // 全天：start / end 为纯日期，按天解析（不走 UTC），end 为不包含式，显示回退一天
      const startStr = formatDateOnly(parseDateOnly(event.start));
      const inclusiveEndStr = addDaysToDateOnly(formatDateOnly(parseDateOnly(event.end)), -1);
      dateText = startStr === inclusiveEndStr
        ? formatDate(startStr, 'date')
        : `${formatDate(startStr, 'date')} 至 ${formatDate(inclusiveEndStr, 'date')}`;
      timeText = '全天';
    } else {
      const start = new Date(event.start);
      const end = new Date(event.end);
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
      createdByText: event.createdBy?.name || '',
      createdBySystem: event.createdBy?.type === 'system',
      updatedByText: event.updatedBy?.name || '',
      updatedBySystem: event.updatedBy?.type === 'system',
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
      markDirty('events');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ deleting: false });
      console.error('[EventDetail] Delete failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError(getErrorMessage(err.code) || '内容已被其他家庭成员修改，请刷新后重试');
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