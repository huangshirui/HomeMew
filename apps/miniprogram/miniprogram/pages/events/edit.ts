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

import { getEvent, createEvent, updateEvent, createEventsBatch } from '../../services/events';
import type { BatchCreateItemResult } from '../../services/events';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore, familiesStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
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
} from '../../types/index';
import { markDirty } from '../../stores/dirty';
import { consumeCloneSource } from '../../stores/clone-buffer';

/** 新增日程（非全天）的默认时间：开始取当前时间的下一个整点，结束 +1 小时；跨天则顺延日期 */
function nextWholeHourDefaults(now: Date): { startTime: string; endTime: string; dayOffset: number } {
  let startHour = now.getHours();
  if (now.getMinutes() > 0 || now.getSeconds() > 0) startHour += 1;
  let dayOffset = 0;
  if (startHour >= 24) {
    startHour -= 24;
    dayOffset = 1;
  }
  const endHour = (startHour + 1) % 24;
  const pad = (h: number) => String(h).padStart(2, '0');
  return { startTime: `${pad(startHour)}:00`, endTime: `${pad(endHour)}:00`, dayOffset };
}

type MemberOption = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  selected: boolean;
};

type Mode = 'create' | 'edit';

/** 批量创建时保留失败项，便于用户显式重试 */

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
    showAdvanced: false,
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
    /** 重复创建：连续 N 天（1 表示不重复），最长 7 天 */
    repeatDays: 1,
    repeatOptions: ['1', '2', '3', '4', '5', '6', '7'],
    repeatSummaryText: '不重复',
    /** 视图用派生 */
    dateRangeText: '',
    timeRangeText: '',
    /** picker 起始/结束日期最小值 */
    minDate: '',
    /** 月历弹层显隐 */
    showStartCalendar: false,
    showEndCalendar: false,
  },

  async onLoad(options: { familyId?: string; id?: string; date?: string; clone?: string }): Promise<void> {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞编辑页加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[EventEdit] Runtime bootstrap failed:', error);
    }
    const now = new Date();
    const today = formatYmd(now);
    const initialDate = options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
      ? options.date
      : today;
    // 新增日程默认非全天时间：当前时间的下一个整点，结束 +1 小时
    const times = nextWholeHourDefaults(now);
    const startDate = times.dayOffset ? addDaysToDateOnly(initialDate, times.dayOffset) : initialDate;
    this.setData({
      familyId,
      mode: options?.id ? 'edit' : 'create',
      eventId: options?.id || '',
      startDate,
      endDate: startDate,
      startTime: times.startTime,
      endTime: times.endTime,
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
      this.applyConsumedClone();
    } catch (error: unknown) {
      hideLoading();
      console.error('[EventEdit] Load members failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true });
      showError(getErrorMessage(err.code, err.message) || '成员加载失败');
    }
  },

  /** 复制入口：消费 clone buffer 中的源日程并预填创建表单（保留原日期，用户可改） */
  applyConsumedClone(): void {
    if (this.data.mode !== 'create') return;
    const source = consumeCloneSource();
    if (!source) return;
    const selectedIds = new Set(source.attendees.map(a => a.userId));
    let startDateStr: string;
    let endDateStr: string;
    // 同源（全天）克隆无真实时间，复用新增日程默认逻辑：当前时间的下一个整点，结束 +1 小时
    const cloneTimes = nextWholeHourDefaults(new Date());
    let startTimeStr = cloneTimes.startTime;
    let endTimeStr = cloneTimes.endTime;
    let startTimezone = this.data.deviceTimezone;
    let endTimezone = this.data.deviceTimezone;
    let startTimezoneMetadata: string | null = this.data.deviceTimezone;
    let endTimezoneMetadata: string | null = this.data.deviceTimezone;
    if (source.isAllDay) {
      startDateStr = formatDateOnly(parseDateOnly(source.startDate));
      endDateStr = addDaysToDateOnly(source.endDateExclusive, -1);
    } else {
      startTimezoneMetadata = source.startTimezone;
      endTimezoneMetadata = source.endTimezone;
      startTimezone = source.startTimezone || this.data.deviceTimezone;
      endTimezone = source.endTimezone || this.data.deviceTimezone;
      const start = formatInstantInTimeZone(source.startAt, startTimezone);
      const end = formatInstantInTimeZone(source.endAt, endTimezone);
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
      summary: source.summary,
      description: source.description || '',
      isAllDay: source.isAllDay,
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
      location: source.location || '',
      members: this.data.members.map((m) => ({
        ...m,
        selected: selectedIds.has(m.userId),
      })),
    });
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

  onToggleAdvanced(): void {
    if (!this.data.showAdvanced) {
      this.setData({ showAdvanced: true });
    }
  },


  onOpenStartDate(): void {
    this.setData({ showStartCalendar: true });
  },

  onCloseStartCalendar(): void {
    this.setData({ showStartCalendar: false });
  },

  onStartDateSelect(e: WechatMiniprogram.CustomEvent): void {
    const date = e.detail.date as string;
    if (!date) return;
    // 选开始日期后，结束日期同步到同一天
    this.setData({ startDate: date, endDate: date, showStartCalendar: false });
    this.refreshDerived();
  },

  onOpenEndDate(): void {
    this.setData({ showEndCalendar: true });
  },

  onCloseEndCalendar(): void {
    this.setData({ showEndCalendar: false });
  },

  onEndDateSelect(e: WechatMiniprogram.CustomEvent): void {
    const date = e.detail.date as string;
    if (!date) return;
    this.setData({ endDate: date, showEndCalendar: false });
    this.refreshDerived();
  },

  /** 连续重复天数选择（1=不重复，最长 7 天） */
  onRepeatChange(e: WechatMiniprogram.PickerChange): void {
    const raw = this.data.repeatOptions[Number(e.detail.value)];
    const repeatDays = raw ? Number(raw) : 1;
    this.setData({ repeatDays });
    this.refreshRepeatText();
  },

  refreshRepeatText(): void {
    const days = this.data.repeatDays;
    this.setData({
      repeatSummaryText: days <= 1 ? '不重复' : `连续 ${days} 天（含今天）`,
    });
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

  /**
   * 构建单条创建 payload。timed 事件需要按家庭时区把墙上时间转为 UTC ISO，
   * 可能弹出夏令时候选选择，故为异步；用户取消选择时返回 null。
   */
  async buildPayload(): Promise<CreateEventRequest | null> {
    const summary = (this.data.summary || '').trim();
    const attendeeIds = this.data.members.filter(m => m.selected).map(m => m.userId);
    const common = {
      summary,
      description: this.data.description.trim() || null,
      attendeeIds,
      location: this.data.location.trim() || null,
    };
    if (this.data.isAllDay) {
      return {
        ...common,
        isAllDay: true,
        startDate: this.data.startDate,
        endDateExclusive: addDaysToDateOnly(this.data.endDate, 1),
      };
    }
    if (!/^\d{1,2}:\d{2}$/.test(this.data.startTime) || !/^\d{1,2}:\d{2}$/.test(this.data.endTime)) {
      showError('请输入有效的时间');
      return null;
    }
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
    if (!startIso) return null;
    const endIso = await chooseWallTimeCandidate('结束时间', endCandidates, this.data.endTimezone);
    if (!endIso) return null;
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      showError('结束时间必须晚于开始时间');
      return null;
    }
    return {
      ...common,
      isAllDay: false,
      startAt: startIso,
      endAt: endIso,
      startTimezone: this.data.startTimezoneMetadata,
      endTimezone: this.data.endTimezoneMetadata,
    };
  },

  /**
   * 把单条 payload 按「连续 N 天」展开为 N 条独立 payload。
   * - 全天事件：日期整体平移 days 天（endDateExclusive 同样平移）；
   * - 定时事件：对目标天的墙上时间重新求该天的 UTC ISO（自动处理 DST 偏移）。
   */
  expandPayloads(base: CreateEventRequest, repeatDays: number): CreateEventRequest[] {
    const count = Math.min(Math.max(repeatDays, 1), 7);
    const payloads: CreateEventRequest[] = [];
    for (let i = 0; i < count; i++) {
      if (i === 0) {
        payloads.push(base);
        continue;
      }
      if (base.isAllDay) {
        payloads.push({
          ...base,
          isAllDay: true,
          startDate: addDaysToDateOnly(base.startDate, i),
          endDateExclusive: addDaysToDateOnly(base.endDateExclusive, i),
        });
      } else {
        const startCands = getWallTimeCandidates(
          addDaysToDateOnly(this.data.startDate, i),
          this.data.startTime,
          this.data.startTimezone,
        );
        const endCands = getWallTimeCandidates(
          addDaysToDateOnly(this.data.endDate, i),
          this.data.endTime,
          this.data.endTimezone,
        );
        if (startCands.length === 0 || endCands.length === 0) {
          continue;
        }
        const startIso = startCands[0];
        const endIso = endCands[0];
        payloads.push({
          ...base,
          isAllDay: false,
          startAt: startIso,
          endAt: endIso,
          startTimezone: this.data.startTimezoneMetadata,
          endTimezone: this.data.endTimezoneMetadata,
        });
      }
    }
    return payloads;
  },

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

    const basePayload = await this.buildPayload();
    if (!basePayload) return;

    // 编辑模式或仅单条：走原有单条逻辑
    if (this.data.mode === 'edit' || this.data.repeatDays <= 1) {
      this.setData({ submitting: true });
      showLoading(this.data.mode === 'edit' ? '保存中...' : '创建中...');
      try {
        if (this.data.mode === 'edit') {
          const updatePayload: UpdateEventRequest = { ...basePayload, version: this.data.version };
          await updateEvent(this.data.familyId, this.data.eventId, updatePayload);
        } else {
          await createEvent(this.data.familyId, basePayload);
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
      return;
    }

    // 批量创建（连续 N 天）：逐条独立 create，失败收集、用户显式重试
    const payloads = this.expandPayloads(basePayload, this.data.repeatDays);
    this.setData({ submitting: true });
    showLoading(`创建中 0/${payloads.length}`);
    try {
      const result = await createEventsBatch(this.data.familyId, payloads, {
        concurrency: 3,
        onProgress: (done, total) => showLoading(`创建中 ${done}/${total}`),
      });
      hideLoading();
      if (result.failed.length === 0) {
        showSuccess(`已创建 ${result.succeeded.length} 条日程`);
        markDirty('events');
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      // 部分失败：保留失败项，让用户显式重试
      await this.handleBatchPartialFailure(result.failed);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[EventEdit] Batch submit failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message) || '创建失败，请重试');
    }
  },

  /**
   * 批量创建部分失败处理：展示成功/失败数量，用户确认后仅对失败项重试一次。
   * 绝不自动整批重试，避免对成功项重复创建。
   */
  async handleBatchPartialFailure(
    failedItems: BatchCreateItemResult[],
  ): Promise<void> {
    const failedCount = failedItems.length;
    const confirmed = await showConfirm(
      '部分创建失败',
      `已创建 ${this.data.repeatDays - failedCount} 条，失败 ${failedCount} 条。是否重试失败的项？`,
    );
    if (!confirmed) {
      this.setData({ submitting: false });
      // 用户放弃重试也回退页面，已成功的已落库
      markDirty('events');
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    // 仅对失败项重新提交
    this.setData({ submitting: true });
    showLoading(`重试中 0/${failedItems.length}`);
    try {
      const retry = await createEventsBatch(
        this.data.familyId,
        failedItems.map(f => f.payload),
        {
          concurrency: 3,
          onProgress: (done, total) => showLoading(`重试中 ${done}/${total}`),
        },
      );
      hideLoading();
      if (retry.failed.length === 0) {
        showSuccess('全部已创建');
      } else {
        showError(`仍有 ${retry.failed.length} 条失败，可稍后在日程中手动补建`);
      }
    } finally {
      this.setData({ submitting: false });
      markDirty('events');
      setTimeout(() => wx.navigateBack(), 600);
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
