/**
 * 喵一下页
 *
 * 职责：
 * - 接收用户输入的自然语言文本（单文本框）；
 * - 调用 POST /families/{familyId}/creation-drafts/interpret 解析为草稿；
 * - 处理 ready（展示预览并跳转到对应创建页）与 choose_kind（让用户选择种类后重解析）；
 * - 草稿本身只读、不落库，最终由用户在创建页补全后通过既有接口提交。
 *
 * 解析结果通过 stores/draft-buffer 一次性转交给对应创建页，避免超长 query。
 */

import { currentFamilyStore } from '../../stores/index';
import { interpretCreationDraft } from '../../services/creation-drafts';
import { getViewingTimeZone } from '../../services/settings';
import { setPendingDraft, clearPendingDraft } from '../../stores/draft-buffer';
import {
  showError,
  getErrorMessage,
} from '../../utils/index';
import {
  CreationDraftResult,
  CreationKind,
  EventCreationDraft,
  TaskCreationDraft,
  DayRecordCreationDraft,
  WishCreationDraft,
} from '../../types/index';

const KIND_LABELS: Record<CreationKind, string> = {
  event: '日程',
  task: '待办',
  day_record: '日子',
  wish: '愿望',
};

/** 等待动效循环展示的词，让人知道仍在处理、没有卡住 */
const THINKING_WORDS = ['日程', '待办', '日子', '愿望'];

const KIND_ICONS: Record<CreationKind, string> = {
  event: '📅',
  task: '✓',
  day_record: '⏱',
  wish: '⭐',
};

type PreviewRow = { label: string; value: string; empty: boolean };

Page({
  data: {
    text: '',
    textLength: 0,
    submitting: false,
    error: '',
    hasResult: false,
    /** 等待动效当前展示的词索引 */
    thinkingIndex: 0,
    /** 等待动效循环词表 */
    thinkingWords: THINKING_WORDS,
    /** choose_kind 候选种类 */
    chooseKinds: [] as CreationKind[],
    /** choose_kind 底部选择框是否展开 */
    sheetOpen: false as boolean,
    kindLabels: KIND_LABELS,
    kindIcons: KIND_ICONS,
    /** ready 时展示的预览行 */
    preview: [] as PreviewRow[],
    resultKind: '' as CreationKind | '',
    warnings: [] as { message: string }[],
  },

  /** 暂存当前解析结果与已选 targetKind，便于 choose_kind 二次解析 */
  _current: null as CreationDraftResult | null,
  _targetKind: null as CreationKind | null,
  /** 等待动效定时器句柄 */
  _thinkingTimer: null as number | null,
  /** 草稿是否已转交给创建页；转交后 onUnload 不再清除 */
  _draftHandedOff: false as boolean,
  /** 底部选择框手势起点 Y，用于下滑关闭 */
  _sheetStartY: 0 as number,

  onUnload(): void {
    // 离开页面且未消费草稿时清空，避免误残留
    this.stopThinking();
    if (!this._draftHandedOff) {
      clearPendingDraft();
    }
  },

  onInput(e: WechatMiniprogram.TextareaInput): void {
    if (this.data.submitting) return;
    const text = (e.detail.value as string) || '';
    this.setData({ text, textLength: text.length, error: '' });
  },

  /** 开始循环展示「日程/待办/日子/愿望」等待动效 */
  startThinking(): void {
    this.stopThinking();
    this.setData({ thinkingIndex: 0 });
    this._thinkingTimer = setInterval(() => {
      const next = (this.data.thinkingIndex + 1) % THINKING_WORDS.length;
      this.setData({ thinkingIndex: next });
    }, 600) as unknown as number;
  },

  /** 停止等待动效轮播 */
  stopThinking(): void {
    if (this._thinkingTimer != null) {
      clearInterval(this._thinkingTimer);
      this._thinkingTimer = null;
    }
  },

  /** 点击「喵一下」：发起解析 */
  async onMeow(): Promise<void> {
    const text = (this.data.text || '').trim();
    if (!text) {
      showError('先说点什么吧');
      return;
    }
    const family = currentFamilyStore.value;
    const familyId = family?.id;
    if (!familyId) {
      showError('请先选择一个家庭');
      return;
    }

    // 进入处理态：输入框与按钮均锁定，并展示循环等待动效。
    // 注意：不在解析结束后立即恢复，跳转/选类型前保持锁定，避免按钮闪一下。
    this.setData({ submitting: true, error: '', chooseKinds: [], preview: [], warnings: [], resultKind: '' as CreationKind | '', sheetOpen: false });
    this._draftHandedOff = false;
    this.startThinking();
    try {
      const result = await interpretCreationDraft(familyId, {
        text,
        viewingTimezone: getViewingTimeZone(family.timezone),
        ...(this._targetKind ? { targetKind: this._targetKind } : {}),
      });
      this._current = result;
      this.renderResult(result);
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      console.error('[Meow] interpret failed:', error);
      this.stopThinking();
      this.setData({ error: getErrorMessage(err.code, err.message) || '解析失败，请稍后再试', submitting: false });
    }
  },

  /** 根据解析结果渲染：choose_kind 或 ready */
  renderResult(result: CreationDraftResult): void {
    if (result.status === 'choose_kind') {
      // 解析完成，停止等待动效；但保持 submitting 锁定，输入框/按钮仍不可用，
      // 直到用户选完类型（二次解析）或关闭选择框。
      this.stopThinking();
      this.setData({
        hasResult: true,
        chooseKinds: result.candidateKinds,
        sheetOpen: true,
        preview: [],
        warnings: [],
        resultKind: '' as CreationKind | '',
      });
      return;
    }
    // ready：跳转到对应创建页时直接 redirectTo，submitting 保持锁定至页面销毁，
    // 不会再让按钮闪回可点。
    this.onGoCreate();
  },

  /** 底部选择框：点遮罩关闭（未选类型，恢复输入） */
  onSheetClose(): void {
    this.stopThinking();
    this.setData({ sheetOpen: false, submitting: false });
  },

  /** 阻止点击面板内部冒泡到遮罩 */
  noop(): void {
    // intentionally empty
  },

  /** 记录手势起点 Y，用于下滑关闭面板 */
  onSheetTouchStart(e: WechatMiniprogram.TouchEvent): void {
    this._sheetStartY = e.touches[0] ? e.touches[0].clientY : 0;
  },

  /** 下滑超过阈值关闭面板 */
  onSheetTouchEnd(e: WechatMiniprogram.TouchEvent): void {
    const endY = e.changedTouches[0] ? e.changedTouches[0].clientY : 0;
    if (endY - this._sheetStartY > 60) {
      this.setData({ sheetOpen: false });
    }
  },

  /** choose_kind 时用户点选一个种类，重新解析 */
  onChooseKind(e: WechatMiniprogram.TouchEvent): void {
    const kind = e.currentTarget.dataset.kind as CreationKind;
    this._targetKind = kind;
    this.setData({ sheetOpen: false });
    this.onMeow();
  },

  /** ready：跳转到对应创建页并转交草稿 */
  onGoCreate(): void {
    const result = this._current;
    if (!result || result.status !== 'ready') return;
    const familyId = currentFamilyStore.value?.id;
    if (!familyId) {
      showError('请先选择一个家庭');
      return;
    }
    this._draftHandedOff = true;
    setPendingDraft(result.kind, result);

    const pages: Record<CreationKind, string> = {
      event: '/pages/events/edit',
      task: '/pages/tasks/edit',
      day_record: '/pages/days/edit',
      wish: '/pages/wishes/edit',
    };
    // 用 redirectTo 替换掉「喵一下」页：表单创建完成后 navigateBack 会直接回到
    // 原先打开喵一下的页面（如首页），而不是再退回喵一下的输入框。
    wx.redirectTo({ url: `${pages[result.kind]}?familyId=${familyId}` });
  },

  /** 重新输入 */
  onReset(): void {
    this._current = null;
    this._targetKind = null;
    this._draftHandedOff = false;
    this.stopThinking();
    this.setData({
      text: '',
      textLength: 0,
      error: '',
      hasResult: false,
      chooseKinds: [],
      sheetOpen: false,
      preview: [],
      warnings: [],
      resultKind: '' as CreationKind | '',
    });
    clearPendingDraft();
  },
});

/** 把 ready 草稿整理成可读预览行（空值标 empty） */
function buildPreview(result: CreationDraftResult): PreviewRow[] {
  if (result.status !== 'ready') return [];
  const rows: PreviewRow[] = [];

  const push = (label: string, value: string | null | undefined) => {
    const v = value == null || value === '' ? null : String(value);
    rows.push({ label, value: v ?? '', empty: v == null });
  };

  switch (result.kind) {
    case 'event': {
      const d = (result as EventCreationDraft).draft;
      push('标题', d.summary);
      push('全天', d.isAllDay == null ? null : d.isAllDay ? '是' : '否');
      push('开始', d.startDate || d.startTime);
      push('结束', d.endDate || d.endTime);
      push('地点', d.location);
      push('参与人', (d.attendeeIds || []).length ? `${d.attendeeIds.length} 人` : null);
      push('备注', d.description);
      break;
    }
    case 'task': {
      const d = (result as TaskCreationDraft).draft;
      push('名称', d.name);
      push('截止', d.dueDate);
      push('负责人', (d.assigneeIds || []).length ? `${d.assigneeIds.length} 人` : null);
      push('备注', d.description);
      break;
    }
    case 'day_record': {
      const d = (result as DayRecordCreationDraft).draft;
      push('名称', d.name);
      push('类型', d.dayRecordKind);
      push('日期', d.anchorDate);
      push('备注', d.description);
      break;
    }
    case 'wish': {
      const d = (result as WishCreationDraft).draft;
      push('标题', d.title);
      push('期望日期', d.desiredDate);
      push('备注', d.description);
      break;
    }
  }
  return rows;
}
