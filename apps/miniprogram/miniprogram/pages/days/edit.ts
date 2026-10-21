/**
 * 日子创建 / 编辑页
 *
 * 创建模式：先展示生活化的类型选择，再进入对应表单。
 * 编辑模式：不允许切换 kind。
 *
 * 契约要点（见 openapi.yaml UpdateDayRecordRequest）：
 * - 只有 countdown 允许通过 PATCH 修改 anchorDate；
 * - elapsed / cycle 的 anchorDate 必须通过新增 occurrence 推进，本页不提交；
 * - nextDueDate 只读；status 通过 archive / restore 动作接口变更；
 * - 所有修改都提交当前 version。
 *
 * 日期默认值使用当前家庭时区的今天，不使用设备本地日期。
 */

import {
  getDayRecord,
  createDayRecord,
  updateDayRecord,
} from '../../services/day-records';
import { uploadRecordIconImage, downloadRecordIconImage } from '../../services/record-icons';
import type { RecordIcon } from '../../types/index';
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { markDirty } from '../../stores/dirty';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
  isVersionConflict,
  formatInstantInTimeZone,
} from '../../utils/index';
import { pickerChangeState, type RecordIconPickerChange } from '../../utils/record-icon-edit';
import {
  DayRecord,
  DayRecordKind,
  FamilyMember,
  CreateDayRecordRequest,
  UpdateDayRecordRequest,
} from '../../types/index';

type Step = 'kind' | 'form';
type Mode = 'create' | 'edit';

type SubjectOption = {
  userId: string;
  displayName: string;
  avatarUrl: string;
};

/** 生活化的类型选择文案，不直接暴露 elapsed / countdown / cycle */
const KIND_CHOICES: { kind: DayRecordKind; icon: string; title: string; desc: string }[] = [
  {
    kind: 'elapsed',
    icon: '🕰',
    title: '记录已经过去多久',
    desc: '上次理发、开始健身、搬进新家',
  },
  {
    kind: 'countdown',
    icon: '🎯',
    title: '倒数一个重要日子',
    desc: '旅行、生日、考试、纪念日',
  },
  {
    kind: 'cycle',
    icon: '🔁',
    title: '定期要做的事情',
    desc: '换滤芯、洗车、宠物驱虫',
  },
];

const DEFAULT_COUNTDOWN_BEFORE_DAYS = 30;
const DEFAULT_CYCLE_BEFORE_DAYS = 7;

Page({
  data: {
    mode: 'create' as Mode,
    step: 'kind' as Step,
    kindChoices: KIND_CHOICES,

    familyId: '',
    dayRecordId: '',
    version: 0,
    kind: '' as DayRecordKind | '',

    loaded: false,
    loadError: false,
    submitting: false,

    /** 公共字段 */
    name: '',
    description: '',
    icon: '',
    iconImagePath: '',
    iconFileId: '',
    iconTouched: false,
    subjectUserId: '' as string,
    subjectText: '全家',
    members: [] as SubjectOption[],

    /** elapsed / countdown / cycle 的日期（编辑模式下 elapsed / cycle 只读展示） */
    anchorDate: '',
    /** elapsed：超过多少天后提醒；空串表示关闭 */
    attentionAfterDays: '',
    /** countdown / cycle：提前多少天提醒 */
    attentionBeforeDays: '',
    /** cycle：建议周期天数 */
    cycleDays: '',

    /** 家庭时区下的今天，用于日期默认值与 picker 边界 */
    familyToday: '',
    /** 月历弹层显隐与边界 */
    showCalendar: false,
    anchorMinDate: '',
    anchorMaxDate: '',
  },

  async onLoad(options: { familyId?: string; id?: string }): Promise<void> {
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞编辑页加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[DayEdit] Runtime bootstrap failed:', error);
    }
    const familyId = options?.familyId || currentFamilyStore.value?.id || '';
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    const familyToday = this.resolveFamilyToday();
    const isEdit = !!options?.id;
    this.setData({
      familyId,
      dayRecordId: options?.id || '',
      mode: isEdit ? 'edit' : 'create',
      step: isEdit ? 'form' : 'kind',
      familyToday,
    });
    wx.setNavigationBarTitle({ title: isEdit ? '编辑日子' : '添加日子' });

    if (isEdit) {
      this.loadRecord();
    } else {
      this.loadMembers();
    }
  },

  /** 家庭时区下的今天（不使用设备本地日期，也不使用 UTC 日期） */
  resolveFamilyToday(): string {
    const timezone = currentFamilyStore.value?.timezone || 'Asia/Shanghai';
    return formatInstantInTimeZone(new Date().toISOString(), timezone).date;
  },

  onRetryLoad(): void {
    if (this.data.mode === 'edit') this.loadRecord();
    else this.loadMembers();
  },

  async loadMembers(): Promise<void> {
    this.setData({ loadError: false });
    try {
      const members = await listFamilyMembers(this.data.familyId);
      this.setData({ members: mapMembers(members), loaded: true });
    } catch (error: unknown) {
      console.error('[DayEdit] Load members failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true, loaded: true });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  async loadRecord(): Promise<void> {
    showLoading('加载中...');
    this.setData({ loadError: false });
    try {
      const [record, members] = await Promise.all([
        getDayRecord(this.data.familyId, this.data.dayRecordId),
        listFamilyMembers(this.data.familyId),
      ]);
      hideLoading();
      if (record.status === 'archived') {
        showError('已归档的日子不可编辑');
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
      this.applyRecord(record, members);
    } catch (error: unknown) {
      hideLoading();
      console.error('[DayEdit] Load record failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true, loaded: true });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  applyRecord(record: DayRecord, members: FamilyMember[]): void {
    const memberOptions = mapMembers(members);
    const subjectUserId = record.subject?.userId || '';
    this.setData({
      kind: record.kind,
      version: record.version,
      name: record.name,
      description: record.description || '',
      icon: record.presentation?.icon?.type === 'emoji' ? record.presentation.icon.value : '',
      iconFileId: record.presentation?.icon?.type === 'image' ? record.presentation.icon.fileId : '',
      iconImagePath: '',
      iconTouched: false,

      subjectUserId,
      subjectText: subjectName(memberOptions, subjectUserId, record.subject?.displayName),
      members: memberOptions,
      anchorDate: record.anchorDate,
      attentionAfterDays:
        record.kind === 'elapsed' && record.attentionAfterDays !== null
          ? String(record.attentionAfterDays)
          : '',
      attentionBeforeDays:
        (record.kind === 'countdown' || record.kind === 'cycle') &&
        record.attentionBeforeDays !== null
          ? String(record.attentionBeforeDays)
          : '',
      cycleDays: record.kind === 'cycle' ? String(record.cycleDays) : '',
      loaded: true,
      step: 'form',
    });
    if (record.presentation?.icon?.type === 'image') {
      const { fileId } = record.presentation.icon;
      void downloadRecordIconImage(this.data.familyId, 'day_record', record.id, fileId)
        .then(path => {
          if (!this.data.iconTouched && this.data.iconFileId === fileId) this.setData({ iconImagePath: path });
        })
        .catch(() => undefined);
    }
  },

  /* ----------------- 类型选择（仅创建模式） ----------------- */

  onKindSelect(e: WechatMiniprogram.TouchEvent): void {
    const kind = e.currentTarget.dataset.kind as DayRecordKind;
    if (!kind) return;
    // 按 kind 填入契约默认值与家庭今天
    this.setData({
      kind,
      step: 'form',
      anchorDate: this.data.familyToday,
      attentionAfterDays: '',
      attentionBeforeDays:
        kind === 'countdown'
          ? String(DEFAULT_COUNTDOWN_BEFORE_DAYS)
          : kind === 'cycle'
            ? String(DEFAULT_CYCLE_BEFORE_DAYS)
            : '',
      cycleDays: '',
    });
  },

  onBackToKind(): void {
    if (this.data.mode === 'edit') return;
    this.setData({ step: 'kind' });
  },

  /* ----------------- 表单输入 ----------------- */

  onNameInput(e: WechatMiniprogram.Input): void {
    this.setData({ name: e.detail.value });
  },

  onDescriptionInput(e: WechatMiniprogram.Input): void {
    this.setData({ description: e.detail.value });
  },

  onRecordIconChange(e: WechatMiniprogram.CustomEvent<RecordIconPickerChange>): void {
    const state = pickerChangeState(e.detail);
    this.setData({
      icon: state.iconEmoji,
      iconImagePath: state.iconImagePath,
      iconFileId: state.iconFileId,
      iconTouched: state.iconTouched,
    });
  },

  onSubjectTap(): void {
    const options = ['全家', ...this.data.members.map((m) => m.displayName)];
    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ subjectUserId: '', subjectText: '全家' });
          return;
        }
        const member = this.data.members[res.tapIndex - 1];
        if (member) {
          this.setData({ subjectUserId: member.userId, subjectText: member.displayName });
        }
      },
    });
  },

  onOpenAnchorCalendar(): void {
    if (this.data.mode !== 'create') return;
    // elapsed / cycle 只能选今天及之前（与旧 picker 的 end=familyToday 一致）
    const maxDate = this.data.kind === 'countdown' ? '' : this.data.familyToday;
    this.setData({ showCalendar: true, anchorMaxDate: maxDate });
  },

  onCloseCalendar(): void {
    this.setData({ showCalendar: false });
  },

  onAnchorCalendarSelect(e: WechatMiniprogram.CustomEvent): void {
    const date = e.detail.date as string;
    if (!date) return;
    this.setData({ anchorDate: date, showCalendar: false });
  },

  onAttentionAfterInput(e: WechatMiniprogram.Input): void {
    this.setData({ attentionAfterDays: digitsOnly(e.detail.value) });
  },

  onAttentionBeforeInput(e: WechatMiniprogram.Input): void {
    this.setData({ attentionBeforeDays: digitsOnly(e.detail.value) });
  },

  onCycleDaysInput(e: WechatMiniprogram.Input): void {
    this.setData({ cycleDays: digitsOnly(e.detail.value) });
  },

  /* ----------------- 提交 ----------------- */

  async onSubmit(): Promise<void> {
    if (this.data.submitting) return;

    const name = (this.data.name || '').trim();
    if (!name) {
      showError('请输入名称');
      return;
    }
    const kind = this.data.kind;
    if (!kind) {
      showError('请选择日子类型');
      return;
    }
    if (kind === 'cycle') {
      const cycleDays = Number(this.data.cycleDays);
      if (!cycleDays || cycleDays < 1 || cycleDays > 3650) {
        showError('请输入 1 ~ 3650 之间的建议周期天数');
        return;
      }
    }
    if (this.data.mode === 'create' && !this.data.anchorDate) {
      showError('请选择日期');
      return;
    }

    this.setData({ submitting: true });
    try {
      if (this.data.mode === 'edit') {
        await this.submitUpdate(name, kind);
      } else {
        await this.submitCreate(name, kind);
      }
      markDirty('days');
      showSuccess(this.data.mode === 'edit' ? '已保存' : '已创建');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      this.setData({ submitting: false });
      console.error('[DayEdit] Submit failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError('内容已被其他家庭成员修改，请刷新后重试');
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '保存失败，请重试');
    }
  },

  async submitCreate(name: string, kind: DayRecordKind): Promise<void> {
    const presentation = await this.prepareIconPresentation();
    const common = {
      ...(presentation ? { presentation } : {}),
      name,
      description: this.data.description.trim() || null,
      anchorDate: this.data.anchorDate,
      subjectUserId: this.data.subjectUserId || null,
    };

    let payload: CreateDayRecordRequest;
    if (kind === 'elapsed') {
      payload = {
        ...common,
        kind: 'elapsed',
        attentionAfterDays: optionalNumber(this.data.attentionAfterDays),
      };
    } else if (kind === 'countdown') {
      payload = {
        ...common,
        kind: 'countdown',
        attentionBeforeDays: optionalNumber(this.data.attentionBeforeDays),
      };
    } else {
      payload = {
        ...common,
        kind: 'cycle',
        cycleDays: Number(this.data.cycleDays),
        attentionBeforeDays: optionalNumber(this.data.attentionBeforeDays),
      };
    }
    await createDayRecord(this.data.familyId, payload);
  },

  /**
   * 编辑提交。
   * 只提交当前 kind 允许修改的字段；elapsed / cycle 的 anchorDate 不在其中。
   */
  async submitUpdate(name: string, kind: DayRecordKind): Promise<void> {
    const fields: Record<string, unknown> = {
      name,
      description: this.data.description.trim() || null,
      subjectUserId: this.data.subjectUserId || null,
    };

    if (kind === 'elapsed') {
      fields.attentionAfterDays = optionalNumber(this.data.attentionAfterDays);
    } else if (kind === 'countdown') {
      // 只有 countdown 允许修改目标日期
      fields.anchorDate = this.data.anchorDate;
      fields.attentionBeforeDays = optionalNumber(this.data.attentionBeforeDays);
    } else {
      fields.cycleDays = Number(this.data.cycleDays);
      fields.attentionBeforeDays = optionalNumber(this.data.attentionBeforeDays);
    }

    const presentation = await this.prepareIconPresentation();
    const payload = {
      ...fields,
      ...(presentation ? { presentation } : {}),
      version: this.data.version,
    } as unknown as UpdateDayRecordRequest;
    await updateDayRecord(this.data.familyId, this.data.dayRecordId, payload);
  },

  async prepareIconPresentation(): Promise<{ icon: RecordIcon | null } | undefined> {
    // No metadata is required. Editing unrelated fields never touches the Icon.
    if (this.data.mode === 'edit' && !this.data.iconTouched) return undefined;
    if (this.data.mode === 'create' && !this.data.icon && !this.data.iconFileId && !this.data.iconImagePath) return undefined;
    let icon: RecordIcon | null = this.data.icon ? { type: 'emoji', value: this.data.icon } : null;
    if (this.data.iconFileId) icon = { type: 'image', fileId: this.data.iconFileId };
    else if (this.data.iconImagePath) {
      const fileId = await uploadRecordIconImage(this.data.familyId, 'day_record', this.data.iconImagePath);
      icon = { type: 'image', fileId };
    }
    return { icon };
  },

  onCancel(): void {
    wx.navigateBack();
  },
});

/* ----------------- 工具函数 ----------------- */

function mapMembers(members: FamilyMember[]): SubjectOption[] {
  return members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl || '/assets/images/default-avatar.png',
  }));
}

function subjectName(
  members: SubjectOption[],
  userId: string,
  fallback?: string,
): string {
  if (!userId) return '全家';
  const found = members.find((m) => m.userId === userId);
  return found?.displayName || fallback || '全家';
}

function digitsOnly(value: string): string {
  return (value || '').replace(/\D/g, '');
}

/** 空串表示「关闭提醒」，按契约提交 null */
function optionalNumber(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
