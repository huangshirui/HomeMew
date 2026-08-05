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
import { listFamilyMembers } from '../../services/families';
import { currentFamilyStore } from '../../stores/index';
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
import { ICON_CHOICES } from '../../utils/day-record-view';
import {
  DayRecord,
  DayRecordKind,
  FamilyMember,
  CreateDayRecordRequest,
  UpdateDayRecordRequest,
  DayRecordCreationDraft,
} from '../../types/index';
import { consumePendingDraft } from '../../stores/draft-buffer';

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
    iconChoices: ICON_CHOICES,

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
  },

  onLoad(options: { familyId?: string; id?: string }): void {
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
      this.applyConsumedDraft();
    } catch (error: unknown) {
      console.error('[DayEdit] Load members failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true, loaded: true });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 喵一下：消费草稿后预填日子字段（创建模式、成员加载完成后调用） */
  applyConsumedDraft(): void {
    if (this.data.mode !== 'create') return;
    const draft = consumePendingDraft('day_record');
    if (!draft || draft.status !== 'ready' || draft.kind !== 'day_record') return;
    const d = (draft as DayRecordCreationDraft).draft;
    const kind = (d.dayRecordKind || 'elapsed') as DayRecordKind;
    const patch: Record<string, unknown> = { step: 'form', kind };
    if (d.name != null) patch.name = d.name;
    if (d.description != null) patch.description = d.description;
    if (d.icon != null) patch.icon = d.icon;
    if (d.anchorDate != null) patch.anchorDate = d.anchorDate;
    if (d.subjectUserId != null) {
      patch.subjectUserId = d.subjectUserId;
      const subject = this.data.members.find((m) => m.userId === d.subjectUserId);
      patch.subjectText = subject ? subject.displayName : '全家';
    }
    if (d.attentionAfterDays != null && kind === 'elapsed') {
      patch.attentionAfterDays = String(d.attentionAfterDays);
    }
    if (d.attentionBeforeDays != null && (kind === 'countdown' || kind === 'cycle')) {
      patch.attentionBeforeDays = String(d.attentionBeforeDays);
    }
    if (d.cycleDays != null && kind === 'cycle') {
      patch.cycleDays = String(d.cycleDays);
    }
    this.setData(patch);
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
      icon: record.icon || '',
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

  /** 图标只能从内置 Emoji 中选择，禁止提交任意图片 URL */
  onIconSelect(e: WechatMiniprogram.TouchEvent): void {
    const icon = e.currentTarget.dataset.icon as string;
    this.setData({ icon: this.data.icon === icon ? '' : icon });
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

  onAnchorDateChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ anchorDate: e.detail.value as string });
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
    const common = {
      name,
      description: this.data.description.trim() || null,
      anchorDate: this.data.anchorDate,
      subjectUserId: this.data.subjectUserId || null,
      icon: this.data.icon || null,
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
      icon: this.data.icon || null,
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

    const payload = {
      ...fields,
      version: this.data.version,
    } as unknown as UpdateDayRecordRequest;
    await updateDayRecord(this.data.familyId, this.data.dayRecordId, payload);
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
