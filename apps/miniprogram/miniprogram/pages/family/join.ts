/**
 * 加入家庭页
 *
 * 支持：
 * - 手工输入邀请码
 * - 通过 ?code= 进入后自动预览
 * - 预览邀请（家庭名称 / 头像 / 人数 / 有效期）
 * - 确认加入，成功后刷新家庭列表并切换到新家庭
 *
 * 处理：
 * - 邀请不存在 / 已过期 / 已撤销 / 已用完 / 家庭已满 / 已是成员
 * - 网络错误与重复提交
 *
 * 注意：日志中不得输出完整邀请码。
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
    preview: null as InvitePreview | null,
    previewError: '',
    submitting: false,
    joined: false,
  },

  onLoad(options: { code?: string }): void {
    if (options?.code) {
      this.setData({ code: options.code });
      this.onPreview();
    }
  },

  onCodeInput(e: WechatMiniprogram.Input): void {
    this.setData({ code: e.detail.value, preview: null, previewError: '' });
  },

  async onPreview(): Promise<void> {
    const code = (this.data.code || '').trim();
    if (!code) {
      showError('请输入邀请码');
      return;
    }
    showLoading('验证邀请码...');
    try {
      const preview = await previewInvite(code);
      this.setData({ preview, previewError: '' });
    } catch (error: unknown) {
      console.error('[Join] Preview failed:', error);
      const err = error as { code?: string; message?: string };
      this.setData({ preview: null, previewError: getErrorMessage(err.code, err.message) });
    } finally {
      hideLoading();
    }
  },

  async onJoin(): Promise<void> {
    const code = (this.data.code || '').trim();
    if (!code) {
      showError('请输入邀请码');
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    showLoading('正在加入...');
    try {
      const result = await joinFamilyByCode(code);
      hideLoading();

      // 刷新家庭列表并切换到新加入的家庭
      const families = await loadFamilies();
      const joinedFamily = families.find(f => f.id === result.familyId) || null;
      if (joinedFamily) {
        setCurrentFamily(joinedFamily);
      } else {
        refreshFamilyState(families);
      }

      this.setData({ submitting: false, joined: true });
      showSuccess('已加入家庭');
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' });
      }, 1200);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ submitting: false });
      console.error('[Join] Join failed:', error);
      const err = error as { code?: string; message?: string };

      // 已经是该家庭成员：作为可恢复导航状态，引导进入家庭
      if (err.code === 'ALREADY_FAMILY_MEMBER') {
        const families = await loadFamilies().catch(() => null);
        if (families && families.length) {
          refreshFamilyState(families);
        }
        showError('你已经是该家庭成员');
        setTimeout(() => {
          wx.switchTab({ url: '/pages/home/home' });
        }, 1500);
        return;
      }

      showError(getErrorMessage(err.code, err.message));
    }
  },
});
