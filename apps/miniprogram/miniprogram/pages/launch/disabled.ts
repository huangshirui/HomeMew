/**
 * 账号禁用页。
 *
 * 禁用是明确的业务状态，不属于 Token 过期或普通登录流程。
 * 用户主动重试后重新建立运行时；若账号恢复，返回触发本次启动的原始入口。
 */

import { retryDisabledEntry } from '../../services/entry-navigation';
import { showError } from '../../utils/index';

Page({
  data: {
    retrying: false,
  },

  async onRetry(): Promise<void> {
    if (this.data.retrying) return;
    this.setData({ retrying: true });
    try {
      await retryDisabledEntry();
    } catch (error) {
      const value = error as { code?: string; message?: string };
      if (value?.code === 'USER_DISABLED' || value?.message?.includes('禁用')) {
        showError('账号当前仍不可用');
      } else {
        showError('暂时无法检查账号状态，请稍后重试');
      }
      this.setData({ retrying: false });
    }
  },
});
