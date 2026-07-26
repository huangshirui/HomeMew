/**
 * 日程创建/编辑页
 *
 * 创建与编辑共用同一页面：
 * - 通过 ?id= 是否存在判断模式
 * - 标题：必填
 * - 日期：必填；起始日期 <= 结束日期
 * - 时间：默认全天（isAllDay=true）；关闭全天后开始/结束时间必填，结束 > 开始
 * - 参与人：多选 checkbox，从当前家庭成员列表中选择（按 SPEC 9.6 与用户要求）
 * - 地点：可选
 * - 备注：可选
 *
 * 全天日程的 end 在 UI 显示为包含式，提交时按 SPEC 9.5 加一天转换为不包含形式。
 */

import { getEvent, createEvent, updateEvent } from '../../services/events';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore, familiesStore } from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
  isVersionConflict,
  parseDateOnly,
  formatDateOnly,
  addDaysToDateOnly,
  zonedDateTimeToIso,
} from '../../utils/index';
import { Event, FamilyMember, CreateEventRequest, UpdateEventRequest } from '../../types/index';
import { markDirty } from '../../stores/dirty';

type MemberOption = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  selected: boolean;
};

type Mode = 'create' | 'edit';

Page({
  data: {
    mode: 'create' as Mode,
    familyId: '',
    eventId: '',
    version: 0,
    loaded: false,
    loadError: false,
    submitting: false,
    /** 家庭时区（IANA），用于带时间日程的正确转换 */
    timezone: 'Asia/Shanghai',
    members: [] as MemberOption[],
    summary: '',
    description: '',
    isAllDay: true,
    startDate: '',
    endDate: '',
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    /** 视图用派生 */
    dateRangeText: '',
    timeRangeText: '',
    /** picker 起始/结束日期最小值 */
    minDate: '',
  },

  onLoad(options: { familyId?: string; id?: string; date?: string }): void {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    const today = formatYmd(new Date());
    const initialDate = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
      ? options.date
      : today;
    this.setData({
      familyId,
      mode: options?.id ? 'edit' : 'create',
      eventId: options?.id || '',
      startDate: initialDate,
      endDate: initialDate,
      minDate: '1970-01-01',
      timezone: resolveFamilyTimezone(familyId),
    });
    wx.setNavigationBarTitle({
      title: options?.id ? '编辑日程' : '添加日程',
    });
    if (options?.id) {
      this.loadEvent();
    } else {
      this.loadMembersAndInit();
    }
  },

  onRetryLoad(): void {
    if (this.data.mode === 'edit') {
      this.loadEvent();
    } else {
      this.loadMembersAndInit();
    }
  },

  async loadEvent(): Promise<void> {
    showLoading('加载日程中...');
    this.setData({ loadError: false });
    try {
      const [event, members] = await Promise.all([
        getEvent(this.data.familyId, this.data.eventId),
        listFamilyMembers(this.data.familyId),
      ]);
      hideLoading();
      this.applyEvent(event, members);
    } catch (error: unknown) {
      hideLoading();
      console.error('[EventEdit] Load event failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true });
      showError(getErrorMessage(err.code, err.message) || '日程加载失败');
    }
  },

  async loadMembersAndInit(): Promise<void> {
    showLoading('加载成员中...');
    this.setData({ loadError: false });
    try {
      const members = await listFamilyMembers(this.data.familyId);
      hideLoading();
      this.setData({
        members: members.map(m => ({
          userId: m.userId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl || '/assets/images/default-avatar.png',
          selected: false,
        })),
        loaded: true,
      });
      this.refreshDerived();
    } catch (error: unknown) {
      hideLoading();
      console.error('[EventEdit] Load members failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true });
      showError(getErrorMessage(err.code, err.message) || '成员加载失败');
    }
  },

  applyEvent(event: Event, members: FamilyMember[]): void {
    const selectedIds = new Set(event.attendees.map(a => a.userId));
    let startDateStr: string;
    let endDateStr: string;
    let startTimeStr = '09:00';
    let endTimeStr = '10:00';
    if (event.isAllDay) {
      // 全天：start / end 为纯日期，按天解析（不走 UTC），end 为不包含式，显示时回退一天
      startDateStr = formatDateOnly(parseDateOnly(event.start));
      endDateStr = addDaysToDateOnly(formatDateOnly(parseDateOnly(event.end)), -1);
    } else {
      const start = new Date(event.start);
      const end = new Date(event.end);
      startDateStr = formatYmd(start);
      endDateStr = formatYmd(end);
      startTimeStr = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
      endTimeStr = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    }
    this.setData({
      summary: event.summary,
      description: event.description || '',
      isAllDay: event.isAllDay,
      startDate: startDateStr,
      endDate: endDateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      location: event.location || '',
      version: event.version,
      members: members.map(m => ({
        userId: m.userId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl || '/assets/images/default-avatar.png',
        selected: selectedIds.has(m.userId),
      })),
      loaded: true,
    });
    this.refreshDerived();
  },

  /* ----------------- 表单输入 ----------------- */

  onSummaryInput(e: WechatMiniprogram.Input): void {
    this.setData({ summary: e.detail.value });
  },

  onDescriptionInput(e: WechatMiniprogram.Input): void {
    this.setData({ description: e.detail.value });
  },

  onLocationInput(e: WechatMiniprogram.Input): void {
    this.setData({ location: e.detail.value });
  },

  onAllDayChange(e: WechatMiniprogram.SwitchChange): void {
    this.setData({ isAllDay: e.detail.value });
    this.refreshDerived();
  },

  onStartDateChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ startDate: e.detail.value as string });
    // 起始日期不能晚于结束日期
    if (this.data.endDate && this.data.startDate > this.data.endDate) {
      this.setData({ endDate: this.data.startDate });
    }
    this.refreshDerived();
  },

  onEndDateChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ endDate: e.detail.value as string });
    this.refreshDerived();
  },

  onStartTimeChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ startTime: e.detail.value as string });
    // 调整结束时间以保证 > 起始
    if (this.data.endTime <= this.data.startTime) {
      const [h, m] = this.data.startTime.split(':').map(Number);
      const next = (h + 1) % 24;
      this.setData({ endTime: `${pad(next)}:${pad(m)}` });
    }
    this.refreshDerived();
  },

  onEndTimeChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ endTime: e.detail.value as string });
    this.refreshDerived();
  },

  onMemberToggle(e: WechatMiniprogram.TouchEvent): void {
    const userId = e.currentTarget.dataset.id as string;
    const members = this.data.members.map(m =>
      m.userId === userId ? { ...m, selected: !m.selected } : m,
    );
    this.setData({ members });
  },

  onSelectAll(): void {
    const allSelected = this.data.members.length > 0 && this.data.members.every(m => m.selected);
    const members = this.data.members.map(m => ({ ...m, selected: !allSelected }));
    this.setData({ members });
  },

  /* ----------------- 派生展示文本 ----------------- */

  refreshDerived(): void {
    const { startDate, endDate, startTime, endTime, isAllDay } = this.data;
    let dateRangeText = '';
    if (startDate && endDate) {
      dateRangeText = startDate === endDate ? startDate : `${startDate} 至 ${endDate}`;
    } else if (startDate) {
      dateRangeText = startDate;
    }
    const timeRangeText = isAllDay ? '全天（不选）' : `${startTime} - ${endTime}`;
    this.setData({ dateRangeText, timeRangeText });
  },

  /* ----------------- 提交 ----------------- */

  async onSubmit(): Promise<void> {
    if (this.data.submitting) return;
    const summary = (this.data.summary || '').trim();
    if (!summary) {
      showError('请输入标题');
      return;
    }
    if (!this.data.startDate || !this.data.endDate) {
      showError('请选择日期');
      return;
    }
    // 纯日期比较：按天解析，避免 UTC 解析在负时区偏移
    if (parseDateOnly(this.data.startDate) > parseDateOnly(this.data.endDate)) {
      showError('结束日期不能早于开始日期');
      return;
    }
    const timezone = this.data.timezone || 'Asia/Shanghai';
    let startIso = '';
    let endIso = '';
    if (this.data.isAllDay) {
      // 全天：使用纯日期，end 为不包含式（显示的最后一天 +1）
      startIso = this.data.startDate;
      endIso = addDaysToDateOnly(this.data.endDate, 1);
    } else {
      if (!/^\d{1,2}:\d{2}$/.test(this.data.startTime) || !/^\d{1,2}:\d{2}$/.test(this.data.endTime)) {
        showError('请输入有效的时间');
        return;
      }
      // 按家庭时区把墙上时间转换为 UTC ISO，避免非东八区家庭产生偏移
      startIso = zonedDateTimeToIso(this.data.startDate, this.data.startTime, timezone);
      endIso = zonedDateTimeToIso(this.data.endDate, this.data.endTime, timezone);
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        showError('结束时间必须晚于开始时间');
        return;
      }
    }

    const attendeeIds = this.data.members.filter(m => m.selected).map(m => m.userId);
    const payload: CreateEventRequest = {
      summary,
      description: this.data.description.trim() || null,
      start: startIso,
      end: endIso,
      isAllDay: this.data.isAllDay,
      timezone,
      attendeeIds,
      location: this.data.location.trim() || null,
    };

    this.setData({ submitting: true });
    showLoading(this.data.mode === 'edit' ? '保存中...' : '创建中...');
    try {
      if (this.data.mode === 'edit') {
        const updatePayload: UpdateEventRequest = { ...payload, version: this.data.version };
        await updateEvent(this.data.familyId, this.data.eventId, updatePayload);
      } else {
        await createEvent(this.data.familyId, payload);
      }
      hideLoading();
      showSuccess(this.data.mode === 'edit' ? '已保存' : '已创建');
      markDirty('events');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[EventEdit] Submit failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError('该日程已被其他成员修改，请重新进入编辑');
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '保存失败，请重试');
    }
  },

  onCancel(): void {
    wx.navigateBack();
  },
});

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 根据 familyId 解析家庭时区（优先当前家庭，其次家庭列表，最后回退东八区） */
function resolveFamilyTimezone(familyId: string): string {
  const current = currentFamilyStore.value;
  if (current && current.id === familyId && current.timezone) {
    return current.timezone;
  }
  const found = familiesStore.value.find(f => f.id === familyId);
  return found?.timezone || 'Asia/Shanghai';
}