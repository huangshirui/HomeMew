/**
 * 喵一下页
 *
 * 创建解析任务后轮询结果，避免 AI 需要 40–60 秒时触发微信请求超时。
 * 草稿只读、不直接写入日程、待办、日子或愿望表。
 */

import { currentFamilyStore } from '../../stores/index';
import {
  chooseCreationDraftKind,
  createCreationDraftJob,
  getCreationDraftJob,
} from '../../services/creation-drafts';
import { getViewingTimeZone } from '../../services/settings';
import { setPendingDraft, clearPendingDraft } from '../../stores/draft-buffer';
import { showError, getErrorMessage } from '../../utils/index';
import type { CreationDraftJob } from '../../types/creation-draft-jobs';
import {
  CreationDraftResult,
  CreationKind,
} from '../../types/index';

const KIND_LABELS: Record<CreationKind, string> = {
  event: '日程',
  task: '待办',
  day_record: '日子',
  wish: '愿望',
};

const THINKING_WORDS = ['日程', '待办', '日子', '愿望'];
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 90000;

const KIND_ICONS: Record<CreationKind, string> = {
  event: '📅',
  task: '✓',
  day_record: '⏱',
  wish: '⭐',
};

Page({
  data: {
    text: '',
    textLength: 0,
    submitting: false,
    error: '',
    hasResult: false,
    thinkingIndex: 0,
    thinkingWords: THINKING_WORDS,
    chooseKinds: [] as CreationKind[],
    sheetOpen: false as boolean,
    kindLabels: KIND_LABELS,
    kindIcons: KIND_ICONS,
    preview: [] as Array<{ label: string; value: string; empty: boolean }>,
    resultKind: '' as CreationKind | '',
    warnings: [] as { message: string }[],
  },

  _current: null as CreationDraftResult | null,
  _draftId: null as string | null,
  _thinkingTimer: null as number | null,
  _pollTimer: null as number | null,
  _pollToken: 0,
  _pollStartedAt: 0,
  _draftHandedOff: false as boolean,
  _sheetStartY: 0 as number,

  onUnload(): void {
    this.stopThinking();
    this.stopPolling();
    if (!this._draftHandedOff) clearPendingDraft();
  },

  onInput(e: WechatMiniprogram.TextareaInput): void {
    if (this.data.submitting) return;
    const text = (e.detail.value as string) || '';
    this.setData({ text, textLength: text.length, error: '' });
  },

  startThinking(): void {
    this.stopThinking();
    this.setData({ thinkingIndex: 0 });
    this._thinkingTimer = setInterval(() => {
      const next = (this.data.thinkingIndex + 1) % THINKING_WORDS.length;
      this.setData({ thinkingIndex: next });
    }, 600) as unknown as number;
  },

  stopThinking(): void {
    if (this._thinkingTimer != null) {
      clearInterval(this._thinkingTimer);
      this._thinkingTimer = null;
    }
  },

  stopPolling(): void {
    this._pollToken += 1;
    if (this._pollTimer != null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  fail(error: unknown): void {
    const err = error as { code?: string; message?: string };
    console.error('[Meow] async draft failed:', error);
    this.stopThinking();
    this.stopPolling();
    this.setData({
      error: getErrorMessage(err.code, err.message) || '解析失败，请稍后再试',
      submitting: false,
    });
  },

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

    this.stopPolling();
    this._current = null;
    this._draftId = null;
    this._draftHandedOff = false;
    this.setData({
      submitting: true,
      error: '',
      hasResult: false,
      chooseKinds: [],
      preview: [],
      warnings: [],
      resultKind: '' as CreationKind | '',
      sheetOpen: false,
    });
    this.startThinking();

    try {
      const job = await createCreationDraftJob(familyId, {
        text,
        viewingTimezone: getViewingTimeZone(family.timezone),
      });
      this._draftId = job.draftId;
      this.startPolling(familyId, job.draftId);
    } catch (error: unknown) {
      this.fail(error);
    }
  },

  startPolling(familyId: string, draftId: string): void {
    this.stopPolling();
    const token = this._pollToken;
    this._pollStartedAt = Date.now();

    const poll = async (): Promise<void> => {
      if (token !== this._pollToken) return;
      if (Date.now() - this._pollStartedAt >= POLL_TIMEOUT_MS) {
        this.fail({ code: 'AI_PROVIDER_TIMEOUT', message: 'AI processing timed out' });
        return;
      }
      try {
        const job = await getCreationDraftJob(familyId, draftId);
        if (token !== this._pollToken) return;
        if (job.status === 'processing') {
          this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS) as unknown as number;
          return;
        }
        this.handleJob(job);
      } catch (error: unknown) {
        const err = error as { code?: string };
        if (token !== this._pollToken) return;
        if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') {
          this._pollTimer = setTimeout(poll, POLL_INTERVAL_MS) as unknown as number;
          return;
        }
        this.fail(error);
      }
    };

    this._pollTimer = setTimeout(poll, 800) as unknown as number;
  },

  handleJob(job: CreationDraftJob): void {
    if (job.status === 'failed') {
      this.fail({ code: job.error.code });
      return;
    }
    if (job.status === 'choose_kind') {
      this.stopPolling();
      this.stopThinking();
      this._current = { status: 'choose_kind', candidateKinds: job.candidateKinds };
      this.setData({
        hasResult: true,
        chooseKinds: job.candidateKinds,
        sheetOpen: true,
        preview: [],
        warnings: [],
        resultKind: '' as CreationKind | '',
      });
      return;
    }

    const { draftId: _draftId, expiresAt: _expiresAt, ...result } = job;
    this.stopPolling();
    this._current = result as CreationDraftResult;
    this.onGoCreate();
  },

  onSheetClose(): void {
    this.stopThinking();
    this.setData({ sheetOpen: false, submitting: false });
  },

  noop(): void {
    // intentionally empty
  },

  onSheetTouchStart(e: WechatMiniprogram.TouchEvent): void {
    this._sheetStartY = e.touches[0] ? e.touches[0].clientY : 0;
  },

  onSheetTouchEnd(e: WechatMiniprogram.TouchEvent): void {
    const endY = e.changedTouches[0] ? e.changedTouches[0].clientY : 0;
    if (endY - this._sheetStartY > 60) this.onSheetClose();
  },

  async onChooseKind(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const kind = e.currentTarget.dataset.kind as CreationKind;
    const familyId = currentFamilyStore.value?.id;
    const draftId = this._draftId;
    if (!familyId || !draftId) {
      this.fail({ code: 'CREATION_DRAFT_NOT_FOUND' });
      return;
    }

    this.setData({ sheetOpen: false, submitting: true, error: '' });
    this.startThinking();
    try {
      await chooseCreationDraftKind(familyId, draftId, kind);
      this.startPolling(familyId, draftId);
    } catch (error: unknown) {
      this.fail(error);
    }
  },

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
    wx.redirectTo({ url: `${pages[result.kind]}?familyId=${familyId}` });
  },

  onReset(): void {
    this._current = null;
    this._draftId = null;
    this._draftHandedOff = false;
    this.stopThinking();
    this.stopPolling();
    this.setData({
      text: '',
      textLength: 0,
      error: '',
      submitting: false,
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
