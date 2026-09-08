/**
 * 启动页
 *
 * 职责：
 * 1. 检查/执行登录
 * 2. 并行加载用户信息与家庭列表
 * 3. 处理禁用用户
 * 4. 判断是否进入首次资料设置（displayName 为空或仅空白）
 * 5. 恢复当前家庭
 * 6. 进入首页
 *
 * 要求：
 * - 防止重复初始化（_initializing 守卫）
 * - 最多自动重试 3 次，超出后提供手动重试
 * - 页面卸载时清理定时器
 */

import { isTokenValid } from '../../services/config';
import { loginAndSaveToken, clearAuth } from '../../services/auth';
import { loadCurrentUser, loadFamilies, refreshFamilyState } from '../../stores/index';
import { showError } from '../../utils/index';

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
  /** 初始化进行中守卫，防止重复进入 */
  _initializing: false,

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
    if (this._initializing) return;
    this._initializing = true;

    this._clearRetryTimer();
    this.setData({ showRetry: false, errorText: '' });
    try {
      this.setData({ statusText: '正在登录...' });

      // Step 1: 登录或刷新 token
      if (!isTokenValid()) {
        await loginAndSaveToken();
      }

      // Step 2: 用户资料与家庭权限彼此独立，并行读取，避免两次约 400~500ms RTT 串行叠加。
      // 家庭列表在每次启动都 force 远端刷新，仍然满足“启动时重新校验家庭权限”的安全要求。
      this.setData({ statusText: '正在加载家庭数据...' });
      const [user, families] = await Promise.all([
        loadCurrentUser(),
        loadFamilies({ force: true }),
      ]);

      // Step 3: 检查用户是否被禁用
      if (user.status === 'disabled') {
        this.handleDisabled();
        return;
      }

      // Step 4: 首次资料设置以 displayName 是否为空 / 仅空白判断
      if (!user.displayName || !user.displayName.trim()) {
        wx.redirectTo({
          url: '/pages/profile-setup/profile-setup',
        });
        return;
      }

      // Step 5: 用刚刚远端校验过的家庭列表恢复当前家庭
      refreshFamilyState(families);

      // Step 6: 进入首页（TabBar 页面）
      wx.switchTab({
        url: '/pages/home/home',
      });

    } catch (error: unknown) {
      console.error('[Launch] Init failed:', error);
      const err = error as { code?: string; message?: string };

      // 特殊处理：用户被禁用 / 权限不足
      if (
        err?.code === 'USER_DISABLED' ||
        err?.code === 'FORBIDDEN' ||
        err?.message?.includes('disabled')
      ) {
        this.handleDisabled();
        return;
      }

      // 区分「域名/网络」类错误，给出更明确的提示
      const isNetwork =
        err?.code === 'NETWORK_ERROR' ||
        err?.message?.includes('网络') ||
        err?.message?.includes('域名');

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
    } finally {
      this._initializing = false;
    }
  },

  /** 处理禁用：清除登录信息并跳转禁用页（不产生死循环，由禁用页控制后续） */
  handleDisabled(): void {
    clearAuth();
    wx.redirectTo({
      url: '/pages/launch/disabled',
    });
  },
});
