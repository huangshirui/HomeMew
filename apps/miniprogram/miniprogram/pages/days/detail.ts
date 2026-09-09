/**
 * 日子详情页
 *
 * - 展示完全依赖 Core 返回的 computed，不在本页重新判断关注状态；
 * - elapsed 提供「今天又做了」、cycle 提供「今天已处理」，countdown 不显示 occurrence；
 * - 记录成功后使用接口返回的最新 record 更新页面（含新 version），并刷新历史；
 * - 归档后只读；恢复 / 软删除仍可用；
 * - 所有动作提交当前 version，遇冲突重新拉取详情，绝不覆盖他人修改。
 */

import {
  getDayRecord,
  deleteDayRecord,
  archiveDayRecord,
  restoreDayRecord,
  listDayRecordOccurrences,
  createDayRecordOccurrence,
} from '../../services/day-records';
import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { markDirty } from '../../stores/dirty';
import {
  showError,
  showSuccess,
  showConfirm,
  getErrorMessage,
  isVersionConflict,
  formatInstantInTimeZone,
} from '../../utils/index';
import { dayRecordTexts, dayRecordIcon, formatChineseDate } from '../../utils/day-record-view';
import { DayRecord, DayRecordOccurrence, DayAttentionLevel } from '../../types/index';

type MetaRow = { label: string; value: string };

type OccurrenceView = {
  id: string;
  dateText: string;
  intervalText: string;
  recorderText: string;
  noteText: string;
};

const OCCURRENCE_PAGE_SIZE = 15;

Page({
  data: {
    familyId: '',
    dayRecordId: '',

    loaded: false,
    loadError: false,
    submitting: false,

    /** 展示字段 */
    name: '',
    icon: '',
    kind: '' as DayRecord['kind'] | '',
    status: 'active' as 'active' | 'archived',
    attentionLevel: 'none' as DayAttentionLevel,
    primaryText: '',
    secondaryText: '',
    description: '',
    metaRows: [] as MetaRow[],
    /** 主按钮文案；countdown 无主按钮 */
    actionText: '',
    canRecord: false,
    version: 0,

    /** 记录历史 */
    occurrences: [] as OccurrenceView[],
    occurrencesLoading: false,
    occurrencesHasMore: false,
    occurrencesLoadingMore: false,

    /** occurrence 表单弹层 */
    sheetOpen: false,
    sheetDate: '',
    sheetNote: '',
    sheetMinDate: '',
    sheetMaxDate: '',

    familyToday: '',
  },

  _record: null as DayRecord | null,
  _occurrenceCursor: null as string | null,

  async onLoad(options: { id?: string; familyId?: string }): Promise<void> {
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞详情加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[DayDetail] Runtime bootstrap failed:', error);
    }
    const familyId = options?.familyId || currentFamilyStore.value?.id || '';
    const dayRecordId = options?.id || '';
    if (!familyId || !dayRecordId) {
      showError('缺少必要参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({
      familyId,
      dayRecordId,
      familyToday: this.resolveFamilyToday(),
    });
    this.loadRecord();
  },

  /** 家庭时区下的今天 */
  resolveFamilyToday(): string {
    const timezone = currentFamilyStore.value?.timezone || 'Asia/Shanghai';
    return formatInstantInTimeZone(new Date().toISOString(), timezone).date;
  },

  onShow(): void {
    // 从编辑页返回时重新拉取最新详情（编辑成功会 markDirty('days')）
    if (this.data.loaded) this.loadRecord(true);
  },

  async onPullDownRefresh(): Promise<void> {
    await this.loadRecord(true);
    wx.stopPullDownRefresh();
  },

  async loadRecord(silent = false): Promise<void> {
    if (!silent) this.setData({ loadError: false });
    try {
      const record = await getDayRecord(this.data.familyId, this.data.dayRecordId);
      this.applyRecord(record);
      if (record.kind !== 'countdown') {
        this.loadOccurrences();
      }
    } catch (error: unknown) {
      console.error('[DayDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      if (!silent) this.setData({ loadError: true, loaded: true });
      else showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 用最新的 record 刷新全部展示字段（含 version） */
  applyRecord(record: DayRecord): void {
    this._record = record;
    const { primary, secondary } = dayRecordTexts(record);
    const isArchived = record.status === 'archived';
    const canRecord = !isArchived && record.kind !== 'countdown';

    this.setData({
      name: record.name,
      icon: dayRecordIcon(record),
      kind: record.kind,
      status: record.status,
      attentionLevel: record.computed.attentionLevel,
      primaryText: primary,
      secondaryText: secondary,
      description: record.description || '',
      metaRows: buildMetaRows(record),
      actionText: record.kind === 'elapsed' ? '今天又做了' : '今天已处理',
      canRecord,
      version: record.version,
      loaded: true,
      loadError: false,
    });
  },

  onRetry(): void {
    this.loadRecord();
  },

  /* ----------------- 记录历史 ----------------- */

  async loadOccurrences(): Promise<void> {
    this._occurrenceCursor = null;
    this.setData({ occurrencesLoading: true });
    try {
      const result = await listDayRecordOccurrences(
        this.data.familyId,
        this.data.dayRecordId,
        { limit: OCCURRENCE_PAGE_SIZE },
      );
      this._occurrenceCursor = result.nextCursor;
      this.setData({
        occurrences: (result.items ?? []).map(mapOccurrence),
        occurrencesLoading: false,
        occurrencesHasMore: !!result.nextCursor,
      });
    } catch (error: unknown) {
      console.error('[DayDetail] Load occurrences failed:', error);
      this.setData({ occurrencesLoading: false });
    }
  },

  async onLoadMoreOccurrences(): Promise<void> {
    if (this.data.occurrencesLoadingMore || !this._occurrenceCursor) return;
    this.setData({ occurrencesLoadingMore: true });
    try {
      const result = await listDayRecordOccurrences(
        this.data.familyId,
        this.data.dayRecordId,
        { limit: OCCURRENCE_PAGE_SIZE, cursor: this._occurrenceCursor },
      );
      this._occurrenceCursor = result.nextCursor;
      this.setData({
        occurrences: this.data.occurrences.concat((result.items ?? []).map(mapOccurrence)),
        occurrencesLoadingMore: false,
        occurrencesHasMore: !!result.nextCursor,
      });
    } catch (error: unknown) {
      console.error('[DayDetail] Load more occurrences failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ occurrencesLoadingMore: false });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /* ----------------- 记录一次发生 ----------------- */

  onOpenSheet(): void {
    if (!this.data.canRecord || this.data.submitting) return;
    const record = this._record;
    if (!record) return;
    // 可选范围：当前 anchorDate 之后 ~ 家庭今天；最终合法性由 Core 校验
    const familyToday = this.resolveFamilyToday();
    this.setData({
      sheetOpen: true,
      sheetDate: familyToday,
      sheetNote: '',
      sheetMinDate: record.anchorDate,
      sheetMaxDate: familyToday,
      familyToday,
    });
  },

  onCloseSheet(): void {
    if (this.data.submitting) return;
    this.setData({ sheetOpen: false });
  },

  noop(): void {},

  onSheetDateChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ sheetDate: e.detail.value as string });
  },

  onSheetNoteInput(e: WechatMiniprogram.Input): void {
    this.setData({ sheetNote: e.detail.value });
  },

  async onSubmitOccurrence(): Promise<void> {
    if (this.data.submitting) return;
    const record = this._record;
    if (!record || !this.data.sheetDate) return;

    this.setData({ submitting: true });
    try {
      const result = await createDayRecordOccurrence(
        this.data.familyId,
        this.data.dayRecordId,
        {
          occurredOn: this.data.sheetDate,
          note: this.data.sheetNote.trim() || null,
          version: record.version,
        },
      );
      // 必须改用返回的最新记录与 version，不能继续使用旧 version
      this.applyRecord(result.record);
      this.setData({ sheetOpen: false, submitting: false, sheetNote: '' });
      this.loadOccurrences();
      markDirty('days');

      const extra =
        result.record.kind === 'cycle'
          ? `，预计下次：${formatChineseDate(result.record.nextDueDate)}`
          : '';
      wx.showToast({
        title: `已记录，本次间隔 ${result.intervalDays} 天${extra}`,
        icon: 'none',
        duration: 2500,
      });
    } catch (error: unknown) {
      this.setData({ submitting: false });
      console.error('[DayDetail] Create occurrence failed:', error);
      await this.handleActionError(error);
    }
  },

  /* ----------------- 归档 / 恢复 / 删除 ----------------- */

  onEdit(): void {
    if (this.data.status === 'archived') {
      showError('已归档的日子不可编辑');
      return;
    }
    wx.navigateTo({
      url: `/pages/days/edit?id=${this.data.dayRecordId}&familyId=${this.data.familyId}`,
    });
  },

  async onArchive(): Promise<void> {
    if (this.data.submitting) return;
    const record = this._record;
    if (!record) return;
    const ok = await showConfirm('归档日子', '归档后不会出现在默认列表中，确定归档？');
    if (!ok) return;

    this.setData({ submitting: true });
    try {
      const updated = await archiveDayRecord(
        this.data.familyId,
        this.data.dayRecordId,
        record.version,
      );
      this.applyRecord(updated);
      this.setData({ submitting: false });
      markDirty('days');
      showSuccess('已归档');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      console.error('[DayDetail] Archive failed:', error);
      await this.handleActionError(error);
    }
  },

  async onRestore(): Promise<void> {
    if (this.data.submitting) return;
    const record = this._record;
    if (!record) return;

    this.setData({ submitting: true });
    try {
      const updated = await restoreDayRecord(
        this.data.familyId,
        this.data.dayRecordId,
        record.version,
      );
      this.applyRecord(updated);
      this.setData({ submitting: false });
      if (updated.kind !== 'countdown') this.loadOccurrences();
      markDirty('days');
      showSuccess('已恢复');
    } catch (error: unknown) {
      this.setData({ submitting: false });
      console.error('[DayDetail] Restore failed:', error);
      await this.handleActionError(error);
    }
  },

  async onDelete(): Promise<void> {
    if (this.data.submitting) return;
    const record = this._record;
    if (!record) return;
    const ok = await showConfirm('删除日子', '删除后无法在普通列表中查看，确定删除？');
    if (!ok) return;

    this.setData({ submitting: true });
    try {
      await deleteDayRecord(this.data.familyId, this.data.dayRecordId, record.version);
      markDirty('days');
      showSuccess('已删除');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      this.setData({ submitting: false });
      console.error('[DayDetail] Delete failed:', error);
      await this.handleActionError(error);
    }
  },

  /**
   * 统一处理动作失败：
   * 版本冲突时重新拉取最新详情并提示，绝不本地假成功或覆盖他人修改。
   */
  async handleActionError(error: unknown): Promise<void> {
    const err = error as { code?: string; message?: string };
    if (isVersionConflict(err.code)) {
      showError('内容已被其他家庭成员修改，请刷新后重试');
      await this.loadRecord(true);
      return;
    }
    showError(getErrorMessage(err.code, err.message) || '操作失败，请重试');
  },
});

/* ----------------- 工具函数 ----------------- */

/** 按 kind 组织详情页的信息行；nextDueDate 只读展示 */
function buildMetaRows(record: DayRecord): MetaRow[] {
  const rows: MetaRow[] = [];
  const subject = record.subject ? record.subject.displayName : '全家';

  if (record.kind === 'elapsed') {
    rows.push({ label: '最近一次', value: formatChineseDate(record.anchorDate) });
    rows.push({
      label: '提醒时间',
      value: record.attentionAfterDays === null ? '不提醒' : `${record.attentionAfterDays}天`,
    });
  } else if (record.kind === 'countdown') {
    rows.push({ label: '目标日期', value: formatChineseDate(record.anchorDate) });
    rows.push({
      label: '提前提醒',
      value: record.attentionBeforeDays === null ? '不提醒' : `${record.attentionBeforeDays}天`,
    });
  } else {
    rows.push({ label: '上次处理', value: formatChineseDate(record.anchorDate) });
    rows.push({ label: '建议周期', value: `${record.cycleDays}天` });
    rows.push({ label: '预计到期', value: formatChineseDate(record.nextDueDate) });
    rows.push({
      label: '提前提醒',
      value: record.attentionBeforeDays === null ? '不提醒' : `${record.attentionBeforeDays}天`,
    });
  }

  rows.push({ label: record.subject ? '关联成员' : '关联对象', value: subject });
  return rows;
}

function mapOccurrence(item: DayRecordOccurrence): OccurrenceView {
  return {
    id: item.id,
    dateText: formatChineseDate(item.occurredOn),
    intervalText:
      item.source === 'initial'
        ? '初始记录'
        : item.intervalDays !== null
          ? `本次间隔 ${item.intervalDays} 天`
          : '',
    recorderText: item.recordedBy ? `记录人：${item.recordedBy.name}` : '',
    noteText: item.note ? `备注：${item.note}` : '',
  };
}
