/**
 * 启动页
 *
 * 职责：
 * 1. 检查/执行登录
 * 2. 加载用户信息
 * 3. 加载家庭列表
 * 4. 根据状态跳转到对应页面：
 *    - 新用户 → 首次资料设置页
 *    - 无家庭 → 首页（显示空状态引导）
 *    - 有家庭 → 首页
 */

import { hasValidToken, loginAndSaveToken, clearAuth } from '../../services/auth';
import { loadCurrentUser } from '../../stores/index';
import { showLoading, hideLoading, showError } from '../../utils/index';

/** 最大自动重试次数（超过后改为手动重试，避免无限刷屏） */
const MAX_AUTO_RETRIES = 3;

Page({
  data: {
    statusText: '正在准备...',
    showRetry: false,
    errorText: '',
  },

  /** 已重试次数 */
  _retryCount: 0,
  /** 待执行的重试定时器，便于取消 */
  _retryTimer: null as ReturnType<typeof setTimeout> | null,

  async onLoad() {
    await this.init();
  },

  onUnload() {
    this._clearRetryTimer();
  },

  _clearRetryTimer(): void {
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  },

  /** 手动重试（点击按钮触发） */
  onManualRetry(): void {
    this._retryCount = 0;
    this.init();
  },

  async init(): Promise<void> {
    this._clearRetryTimer();
    this.setData({ showRetry: false, errorText: '' });
    try {
      this.setData({ statusText: '正在登录...' });

      // Step 1: 登录或刷新 token
      let isNewUser = false;
      if (!hasValidToken()) {
        const result = await loginAndSaveToken();
        isNewUser = result.isNewUser;
      }

      // Step 2: 加载用户信息
      this.setData({ statusText: '正在加载用户信息...' });
      const user = await loadCurrentUser();

      if (!user) {
        throw new Error('无法获取用户信息');
      }

      // 检查用户是否被禁用
      if (user.status === 'disabled') {
        clearAuth();
        wx.redirectTo({
          url: '/pages/launch/disabled',
        });
        return;
      }

      // Step 3: 新用户需要先设置资料
      if (isNewUser || !user.displayName || user.displayName.startsWith('微信用户')) {
        wx.redirectTo({
          url: '/pages/profile-setup/profile-setup',
        });
        return;
      }

      // Step 4: 加载家庭列表并跳转首页
      this.setData({ statusText: '正在加载家庭数据...' });
      const { loadFamilies, restoreCurrentFamily } = require('../../stores/index');
      const families = await loadFamilies();

      // 恢复或选择当前家庭
      const currentFamily = restoreCurrentFamily(families);

      // 跳转到首页（TabBar 页面）
      wx.switchTab({
        url: '/pages/home/home',
      });

    } catch (error: unknown) {
      console.error('[Launch] Init failed:', error);
      const err = error as { code?: string; message?: string };

      // 特殊处理：用户被禁用
      if (err?.code === 'FORBIDDEN' || err?.message?.includes('disabled')) {
        clearAuth();
        wx.redirectTo({ url: '/pages/launch/disabled' });
        return;
      }

      // 区分「域名/网络」类错误，给出更明确的提示
      const isNetwork =
        err?.code === 'NETWORK_ERROR' ||
        err?.message?.includes('网络') ||
        err?.message?.includes('域名');

      // 优先使用底层错误文案（如「登录失败: 未配置 JWT_SECRET」），
      // 其次是网络提示，最后是通用兜底文案
      const hint = isNetwork
        ? '网络连接失败，请检查网络后重试'
        : (err?.message || '初始化失败，请重试');

      // 未达上限：自动退避重试；已达上限：停下并展示手动重试按钮
      if (this._retryCount < MAX_AUTO_RETRIES) {
        this._retryCount += 1;
        const delay = 2000 * this._retryCount; // 2s / 4s / 6s 退避
        this.setData({ statusText: `${hint}（${this._retryCount}/${MAX_AUTO_RETRIES} 次重试中…）` });
        this._retryTimer = setTimeout(() => {
          this.init();
        }, delay);
      } else {
        this.setData({
          statusText: '',
          showRetry: true,
          errorText: hint,
        });
        showError(hint);
      }
    }
  },
});
