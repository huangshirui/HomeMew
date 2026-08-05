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
  formatInstantInTimeZone,
  getWallTimeCandidates,
  buildTimeZoneOptions,
  searchTimeZoneOptions,
  timeZoneLabel,
} from '../../utils/index';
import { getViewingTimeZone } from '../../services/settings';
import type { TimeZoneOption } from '../../utils/index';
import {
  Event,
  FamilyMember,
  CreateEventRequest,
  UpdateEventRequest,
  EventCreationDraft,
} from '../../types/index';
import { markDirty } from '../../stores/dirty';
import { consumePendingDraft } from '../../stores/draft-buffer';

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
    deviceTimezone: 'Asia/Shanghai',
    startTimezone: 'Asia/Shanghai',
    endTimezone: 'Asia/Shanghai',
    startTimezoneMetadata: 'Asia/Shanghai' as string | null,
    endTimezoneMetadata: 'Asia/Shanghai' as string | null,
    startTimezoneLabel: '上海',
    endTimezoneLabel: '上海',
    timezoneTarget: 'start' as 'start' | 'end',
    timezoneQuery: '',
    timezoneOptions: [] as TimeZoneOption[],
    filteredTimezoneOptions: [] as TimeZoneOption[],
    showTimezoneSheet: false,
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
      ...initialTimeZoneState(familyId),
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
      this.applyConsumedDraft();
    } catch (error: unknown) {
      hideLoading();
      console.error('[EventEdit] Load members failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true });
      showError(getErrorMessage(err.code, err.message) || '成员加载失败');
    }
  },

  /** 喵一下：消费草稿后预填日程字段（创建模式、成员加载完成后调用） */
  applyConsumedDraft(): void {
    if (this.data.mode !== 'create') return;
    const draft = consumePendingDraft('event');
    if (!draft || draft.status !== 'ready' || draft.kind !== 'event') return;
    const d = (draft as EventCreationDraft).draft;
    const isAllDay = d.isAllDay == null ? true : d.isAllDay;
    const patch: Record<string, unknown> = { isAllDay };
    if (d.summary != null) patch.summary = d.summary;
    if (d.description != null) patch.description = d.description;
    if (d.location != null) patch.location = d.location;
    if (d.startDate != null) patch.startDate = d.startDate;
    if (d.endDate != null) patch.endDate = isAllDay ? d.endDate : d.endDate;
    if (!isAllDay) {
      if (d.startTime != null) patch.startTime = d.startTime;
      if (d.endTime != null) patch.endTime = d.endTime;
      if (d.startTimezone != null) {
        patch.startTimezone = d.startTimezone;
        patch.startTimezoneMetadata = d.startTimezone;
        patch.startTimezoneLabel = timeZoneLabel(d.startTimezone);
      }
      if (d.endTimezone != null) {
        patch.endTimezone = d.endTimezone;
        patch.endTimezoneMetadata = d.endTimezone;
        patch.endTimezoneLabel = timeZoneLabel(d.endTimezone);
      }
    }
    if (d.attendeeIds && d.attendeeIds.length) {
      patch.members = this.data.members.map((m) => ({
        ...m,
        selected: d.attendeeIds.includes(m.userId),
      }));
    }
    this.setData(patch);
    this.refreshDerived();
  },

  applyEvent(event: Event, members: FamilyMember[]): void {
    const selectedIds = new Set(event.attendees.map(a => a.userId));
    let startDateStr: string;
    let endDateStr: string;
    let startTimeStr = '09:00';
    let endTimeStr = '10:00';
    let startTimezone = this.data.deviceTimezone;
    let endTimezone = this.data.deviceTimezone;
    let startTimezoneMetadata: string | null = this.data.deviceTimezone;
    let endTimezoneMetadata: string | null = this.data.deviceTimezone;
    if (event.isAllDay) {
      startDateStr = formatDateOnly(parseDateOnly(event.startDate));
      endDateStr = addDaysToDateOnly(event.endDateExclusive, -1);
    } else {
      startTimezoneMetadata = event.startTimezone;
      endTimezoneMetadata = event.endTimezone;
      startTimezone = event.startTimezone || this.data.deviceTimezone;
      endTimezone = event.endTimezone || this.data.deviceTimezone;
      const start = formatInstantInTimeZone(event.startAt, startTimezone);
      const end = formatInstantInTimeZone(event.endAt, endTimezone);
      startDateStr = start.date;
      endDateStr = end.date;
      startTimeStr = start.time;
      endTimeStr = end.time;
    }
    const timezoneOptions = buildTimeZoneOptions([
      startTimezone,
      endTimezone,
      startTimezoneMetadata,
      endTimezoneMetadata,
      this.data.deviceTimezone,
      resolveFamilyTimezone(this.data.familyId),
    ]);
    this.setData({
      summary: event.summary,
      description: event.description || '',
      isAllDay: event.isAllDay,
      startDate: startDateStr,
      endDate: endDateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      startTimezone,
      endTimezone,
      startTimezoneMetadata,
      endTimezoneMetadata,
      startTimezoneLabel: timeZoneLabel(startTimezone),
      endTimezoneLabel: timeZoneLabel(endTimezone),
      timezoneOptions,
      filteredTimezoneOptions: timezoneOptions,
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
    const isAllDay = e.detail.value;
    this.setData(isAllDay ? { isAllDay } : {
      isAllDay,
      startTimezone: this.data.deviceTimezone,
      endTimezone: this.data.deviceTimezone,
      startTimezoneMetadata: this.data.deviceTimezone,
      endTimezoneMetadata: this.data.deviceTimezone,
      startTimezoneLabel: timeZoneLabel(this.data.deviceTimezone),
      endTimezoneLabel: timeZoneLabel(this.data.deviceTimezone),
    });
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

  onOpenTimezone(e: WechatMiniprogram.TouchEvent): void {
    const target = e.currentTarget.dataset.target as 'start' | 'end';
    this.setData({
      timezoneTarget: target,
      timezoneQuery: '',
      filteredTimezoneOptions: this.data.timezoneOptions,
      showTimezoneSheet: true,
    });
  },

  onCloseTimezone(): void {
    this.setData({ showTimezoneSheet: false, timezoneQuery: '' });
  },

  onTimezoneSearch(e: WechatMiniprogram.Input): void {
    const timezoneQuery = e.detail.value;
    this.setData({
      timezoneQuery,
      filteredTimezoneOptions: searchTimeZoneOptions(
        this.data.timezoneOptions,
        timezoneQuery,
      ),
    });
  },

  onSelectTimezone(e: WechatMiniprogram.TouchEvent): void {
    const timezone = e.currentTarget.dataset.id as string;
    if (!timezone) return;
    if (this.data.timezoneTarget === 'start') {
      this.setData({
        startTimezone: timezone,
        startTimezoneMetadata: timezone,
        startTimezoneLabel: timeZoneLabel(timezone),
        showTimezoneSheet: false,
      });
    } else {
      this.setData({
        endTimezone: timezone,
        endTimezoneMetadata: timezone,
        endTimezoneLabel: timeZoneLabel(timezone),
        showTimezoneSheet: false,
      });
    }
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
    const attendeeIds = this.data.members.filter(m => m.selected).map(m => m.userId);
    const common = {
      summary,
      description: this.data.description.trim() || null,
      attendeeIds,
      location: this.data.location.trim() || null,
    };
    let payload: CreateEventRequest;
    if (this.data.isAllDay) {
      // 全天：使用纯日期，end 为不包含式（显示的最后一天 +1）
      payload = {
        ...common,
        isAllDay: true,
        startDate: this.data.startDate,
        endDateExclusive: addDaysToDateOnly(this.data.endDate, 1),
      };
    } else {
      if (!/^\d{1,2}:\d{2}$/.test(this.data.startTime) || !/^\d{1,2}:\d{2}$/.test(this.data.endTime)) {
        showError('请输入有效的时间');
        return;
      }
      // 按家庭时区把墙上时间转换为 UTC ISO，避免非东八区家庭产生偏移
      const startCandidates = getWallTimeCandidates(
        this.data.startDate,
        this.data.startTime,
        this.data.startTimezone,
      );
      const endCandidates = getWallTimeCandidates(
        this.data.endDate,
        this.data.endTime,
        this.data.endTimezone,
      );
      const startIso = await chooseWallTimeCandidate('开始时间', startCandidates, this.data.startTimezone);
      if (!startIso) return;
      const endIso = await chooseWallTimeCandidate('结束时间', endCandidates, this.data.endTimezone);
      if (!endIso) return;
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        showError('结束时间必须晚于开始时间');
        return;
      }
      payload = {
        ...common,
        isAllDay: false,
        startAt: startIso,
        endAt: endIso,
        startTimezone: this.data.startTimezoneMetadata,
        endTimezone: this.data.endTimezoneMetadata,
      };
    }

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
function initialTimeZoneState(familyId: string): {
  deviceTimezone: string;
  startTimezone: string;
  endTimezone: string;
  startTimezoneMetadata: string;
  endTimezoneMetadata: string;
  startTimezoneLabel: string;
  endTimezoneLabel: string;
  timezoneOptions: TimeZoneOption[];
  filteredTimezoneOptions: TimeZoneOption[];
} {
  const familyTimezone = resolveFamilyTimezone(familyId);
  // 新建事件默认时区：跟随用户在「设置」中的时区偏好（指定时区 / 系统）
  const deviceTimezone = getViewingTimeZone(familyTimezone);
  const options = buildTimeZoneOptions([deviceTimezone, familyTimezone]);
  return {
    deviceTimezone,
    startTimezone: deviceTimezone,
    endTimezone: deviceTimezone,
    startTimezoneMetadata: deviceTimezone,
    endTimezoneMetadata: deviceTimezone,
    startTimezoneLabel: timeZoneLabel(deviceTimezone),
    endTimezoneLabel: timeZoneLabel(deviceTimezone),
    timezoneOptions: options,
    filteredTimezoneOptions: options,
  };
}

async function chooseWallTimeCandidate(
  label: string,
  candidates: string[],
  timezone: string,
): Promise<string | null> {
  if (candidates.length === 0) {
    showError(`${label}在 ${timezone} 中不存在，请更换时间`);
    return null;
  }
  if (candidates.length === 1) return candidates[0];
  try {
    const result = await wx.showActionSheet({
      alertText: `${label}在夏令时切换中出现两次，请选择`,
      itemList: [`第一次 ${candidates[0]}`, `第二次 ${candidates[1]}`],
    });
    return candidates[result.tapIndex] || null;
  } catch {
    return null;
  }
}

function resolveFamilyTimezone(familyId: string): string {
  const current = currentFamilyStore.value;
  if (current && current.id === familyId && current.timezone) {
    return current.timezone;
  }
  const found = familiesStore.value.find(f => f.id === familyId);
  return found?.timezone || 'Asia/Shanghai';
}
