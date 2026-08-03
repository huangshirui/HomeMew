/**
 * 愿望创建 / 编辑页
 *
 * 契约要点（见 openapi.yaml）：
 * - 创建请求只含 title / description / desiredDate；owner 由 Core 设为当前用户；
 * - 编辑请求只含 title / description / desiredDate，且必须带 version；
 * - desiredDate 为纯日期，不做 UTC 转换，直接使用家庭时区下的今天作为默认值。
 */

import { getWish, createWish, updateWish } from '../../services/wishes';
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
import { Wish, CreateWishRequest, UpdateWishRequest } from '../../types/index';

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

    title: '',
    description: '',
    /** 期望日期（纯日期 YYYY-MM-DD）；空串表示未设置 */
    desiredDate: '',
    /** 家庭时区下的今天，用于 picker 默认值与边界 */
    familyToday: '',
  },

  onLoad(options: { familyId?: string; id?: string }): void {
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
      // 创建模式无需请求后端，直接进入可编辑态；编辑模式等 loadWish 完成
      loaded: !isEdit,
    });
    wx.setNavigationBarTitle({ title: isEdit ? '编辑愿望' : '许个愿望' });

    if (isEdit) this.loadWish();
  },

  /** 家庭时区下的今天（不使用设备本地日期，也不使用 UTC 日期） */
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
      if (wish.status === 'archived') {
        showError('已归档的愿望不可编辑');
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
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

  onTitleInput(e: WechatMiniprogram.Input): void {
    this.setData({ title: e.detail.value });
  },

  onDescriptionInput(e: WechatMiniprogram.Input): void {
    this.setData({ description: e.detail.value });
  },

  onDesiredDateChange(e: WechatMiniprogram.PickerChange): void {
    this.setData({ desiredDate: e.detail.value as string });
  },

  async onSubmit(): Promise<void> {
    if (this.data.submitting) return;

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
      } else {
        await createWish(this.data.familyId, payload as CreateWishRequest);
      }
      markDirty('wishes');
      showSuccess(this.data.mode === 'edit' ? '已保存' : '已许愿');
      setTimeout(() => wx.navigateBack(), 800);
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
    wx.navigateBack();
  },
});
