/**
 * 愿望创建 / 编辑页。
 *
 * 创建成功后用短暂的「愿望入池」动画确认真实写入成功；编辑仍保持高效的普通反馈。
 */

import { getWish, createWish, updateWish } from '../../services/wishes';
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
import { CreateWishRequest, UpdateWishRequest, WishCreationDraft } from '../../types/index';
import { consumePendingDraft } from '../../stores/draft-buffer';

type Mode = 'create' | 'edit';

Page({
  data: {
    mode: 'create' as Mode,
    familyId: '',
    wishId: '',
    version: 0,
    loaded: false,
    loadError: false,
    submitting: false,
    wishCreated: false,
    title: '',
    description: '',
    desiredDate: '',
    familyToday: '',
  },

  _successTimer: null as ReturnType<typeof setTimeout> | null,

  async onLoad(options: { familyId?: string; id?: string }): Promise<void> {
    // 补全运行时上下文（用户/家庭/时区），失败也不阻塞编辑页加载（请求层会自动登录）
    try {
      await ensureRuntimeReady();
    } catch (error) {
      console.error('[WishEdit] Runtime bootstrap failed:', error);
    }
    const familyId = options?.familyId || currentFamilyStore.value?.id || '';
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    const isEdit = !!options?.id;
    this.setData({
      familyId,
      wishId: options?.id || '',
      mode: isEdit ? 'edit' : 'create',
      familyToday: this.resolveFamilyToday(),
      loaded: !isEdit,
    });
    wx.setNavigationBarTitle({ title: isEdit ? '编辑愿望' : '许个愿望' });
    if (isEdit) this.loadWish();
    else this.applyConsumedDraft();
  },

  onUnload(): void {
    if (this._successTimer) clearTimeout(this._successTimer);
  },

  applyConsumedDraft(): void {
    const draft = consumePendingDraft('wish');
    if (!draft || draft.status !== 'ready' || draft.kind !== 'wish') return;
    const d = (draft as WishCreationDraft).draft;
    const patch: Record<string, unknown> = {};
    if (d.title != null) patch.title = d.title;
    if (d.description != null) patch.description = d.description;
    if (d.desiredDate != null) patch.desiredDate = d.desiredDate;
    this.setData(patch);
  },

  resolveFamilyToday(): string {
    const timezone = currentFamilyStore.value?.timezone || 'Asia/Shanghai';
    return formatInstantInTimeZone(new Date().toISOString(), timezone).date;
  },

  async loadWish(): Promise<void> {
    showLoading('加载中...');
    this.setData({ loadError: false });
    try {
      const wish = await getWish(this.data.familyId, this.data.wishId);
      hideLoading();
      this.setData({
        title: wish.title,
        description: wish.description || '',
        desiredDate: wish.desiredDate || '',
        version: wish.version,
        loaded: true,
      });
    } catch (error: unknown) {
      hideLoading();
      console.error('[WishEdit] Load failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ loadError: true, loaded: true });
      showError(getErrorMessage(err.code, err.message));
    }
  },

  onRetryLoad(): void {
    if (this.data.mode === 'edit') this.loadWish();
  },

  onTitleInput(e: WechatMiniprogram.Input): void { this.setData({ title: e.detail.value }); },
  onDescriptionInput(e: WechatMiniprogram.Input): void { this.setData({ description: e.detail.value }); },
  onDesiredDateChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ desiredDate: e.detail.value as string });
  },

  async onSubmit(): Promise<void> {
    if (this.data.submitting || this.data.wishCreated) return;
    const title = (this.data.title || '').trim();
    if (!title) {
      showError('请填写愿望标题');
      return;
    }

    const payload = {
      title,
      description: this.data.description.trim() || null,
      desiredDate: this.data.desiredDate || null,
    };

    this.setData({ submitting: true });
    try {
      if (this.data.mode === 'edit') {
        const body = { ...payload, version: this.data.version } as UpdateWishRequest;
        await updateWish(this.data.familyId, this.data.wishId, body);
        markDirty('wishes');
        this.setData({ submitting: false });
        showSuccess('已保存');
        this._successTimer = setTimeout(() => wx.navigateBack(), 700);
        return;
      }

      await createWish(this.data.familyId, payload as CreateWishRequest);
      markDirty('wishes');
      this.setData({ submitting: false, wishCreated: true });
      wx.vibrateShort({ type: 'light' });
      this._successTimer = setTimeout(() => wx.navigateBack(), 1250);
    } catch (error: unknown) {
      this.setData({ submitting: false });
      console.error('[WishEdit] Submit failed:', error);
      const err = error as { code?: string; message?: string };
      if (isVersionConflict(err.code)) {
        showError('内容已被其他家庭成员修改，请刷新后重试');
        return;
      }
      showError(getErrorMessage(err.code, err.message) || '保存失败，请重试');
    }
  },

  onCancel(): void {
    if (!this.data.wishCreated) wx.navigateBack();
  },
});
