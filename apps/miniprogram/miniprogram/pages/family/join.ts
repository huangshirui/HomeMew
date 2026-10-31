/**
 * 家庭加入页
 *
 * 微信分享卡片：页面携带 code，自动验证并直接展示邀请确认。
 * 手工邀请码：展示输入框，验证后再确认；已收到邀请可切换为手动输入。
 * 仅 LifeSpace/HomeMew Mini BFF 决定邀请码有效性与加入权限。
 * 不在日志中打印邀请码。
 */

import { previewInvite, joinFamilyByCode } from '../../services/families';
import { loadFamilies, setCurrentFamily, refreshFamilyState } from '../../stores/index';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  getErrorMessage,
} from '../../utils/index';
import { InvitePreview } from '../../types/index';

Page({
  data: {
    code: '',
    fromShare: false,
    preview: null as InvitePreview | null,
    previewCode: '',
    previewError: '',
    previewing: false,
    submitting: false,
    joined: false,
  },

  /** 丢弃修改邀请码后返回的过期预览响应 */
  _previewSeq: 0,

  onLoad(options: { code?: string }): void {
    if (options?.code) {
      this.setData({ code: options.code.trim(), fromShare: true });
      void this.onPreview();
    }
  },

  onCodeInput(e: WechatMiniprogram.Input): void {
    ++this._previewSeq;
    this.setData({
      code: e.detail.value,
      preview: null,
      previewCode: '',
      previewError: '',
      previewing: false,
    });
  },

  onUseAnotherCode(): void {
    ++this._previewSeq;
    this.setData({
      code: '',
      fromShare: false,
      preview: null,
      previewCode: '',
      previewError: '',
      previewing: false,
    });
  },

  async onPreview(): Promise<void> {
    const code = (this.data.code || '').trim();
    if (!code) {
      showError('请输入邀请码');
      return;
    }
    const seq = ++this._previewSeq;
    this.setData({ previewing: true, previewError: '' });
    try {
      const preview = await previewInvite(code);
      if (seq !== this._previewSeq || code !== (this.data.code || '').trim()) return;
      this.setData({ preview, previewCode: code });
    } catch (error: unknown) {
      if (seq !== this._previewSeq || code !== (this.data.code || '').trim()) return;
      console.error('[Join] Preview failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({
        preview: null,
        previewCode: '',
        previewError: getErrorMessage(err.code, err.message),
      });
    } finally {
      if (seq === this._previewSeq) this.setData({ previewing: false });
    }
  },

  async onJoin(): Promise<void> {
    const code = (this.data.code || '').trim();
    if (!code) {
      showError('请输入邀请码');
      return;
    }
    if (!this.data.preview) {
      showError('请先验证邀请码');
      return;
    }
    if (!this.data.preview.canJoin) {
      showError('当前邀请暂不可加入');
      return;
    }
    if (this.data.previewCode !== code) {
      this.setData({ preview: null, previewCode: '' });
      showError('邀请码已修改，请重新验证');
      return;
    }
    if (this.data.submitting || this.data.joined) return;

    this.setData({ submitting: true });
    showLoading('正在加入...');
    try {
      const result = await joinFamilyByCode(code);
      hideLoading();

      // 加入已提交成功。随后刷新家庭列表失败也不能提示“加入失败”或重试写入。
      this.setData({ submitting: false, joined: true });
      showSuccess('已加入家庭');
      try {
        const families = await loadFamilies();
        const joinedFamily = families.find(f => f.id === result.familyId) || null;
        if (joinedFamily) setCurrentFamily(joinedFamily);
        else refreshFamilyState(families);
      } catch (refreshError) {
        console.warn('[Join] Family refresh deferred after successful join:', refreshError);
      }
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 1000);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[Join] Join failed:', error);
      const err = error as { code?: string; message?: string };

      if (err.code === 'ALREADY_SPACE_MEMBER' || err.code === 'ALREADY_FAMILY_MEMBER') {
        const targetId = this.data.preview?.family.id;
        const families = await loadFamilies().catch(() => null);
        if (families) {
          const existing = families.find(f => f.id === targetId);
          if (existing) setCurrentFamily(existing);
          else refreshFamilyState(families);
        }
        this.setData({ joined: true });
        showSuccess('你已是该家庭成员');
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 1000);
        return;
      }

      showError(getErrorMessage(err.code, err.message));
    }
  },
});
