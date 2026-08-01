/**
 * 凭证一次性展示页
 *
 * 从内存缓冲（credential-buffer）读取刚创建的完整明文凭证，仅本次展示。
 * - OAuth：展示 Token URL、Grant Type、Client ID、Client Secret；
 * - API Token：展示 API Base URL、Authentication、Token。
 *
 * 安全约束：
 * - 完整值只读取一次，读取后立即从缓冲清空；
 * - 不写入本地缓存、日志或持久化状态；
 * - 离开页面即失效，返回后无法再次查看。
 */

import { takeCredentialResult, clearCredentialResult, CredentialResultPayload } from '../../stores/credential-buffer';
import { getCoreBaseUrl } from '../../services/config';
import { showError, copyToClipboard } from '../../utils/index';

Page({
  data: {
    kind: '' as 'oauth' | 'api_token' | '',
    systemName: '',

    // 家庭 API 地址（含 familyId，末尾无斜杠）
    familyApiUrl: '',

    // OAuth 字段
    tokenUrl: '',
    grantType: 'Client Credentials',
    clientId: '',
    clientSecret: '',

    // API Token 字段
    authScheme: 'Bearer Token',
    token: '',

    loaded: false,
  },

  onLoad(options: { familyId?: string }): void {
    const payload = takeCredentialResult();
    if (!payload) {
      // 无缓冲数据（例如刷新或直接进入）：无法再次展示
      showError('凭证信息已失效');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.applyPayload(payload, options?.familyId);
  },

  applyPayload(payload: CredentialResultPayload, familyId?: string): void {
    const base = getCoreBaseUrl();
    // 家庭 API 根路径：所有 System 可访问的业务接口都以家庭路径为范围。
    const familyApiUrl = familyId ? `${base}/api/v1/families/${familyId}` : '';
    if (payload.kind === 'oauth' && payload.clientSecret) {
      this.setData({
        kind: 'oauth',
        systemName: payload.systemName,
        // OAuth 的 /oauth/token 不在家庭 API 路径下，需单独展示令牌地址
        tokenUrl: `${base}/oauth/token`,
        familyApiUrl,
        clientId: payload.clientSecret.clientId,
        clientSecret: payload.clientSecret.clientSecret,
        loaded: true,
      });
    } else if (payload.kind === 'api_token' && payload.apiToken) {
      this.setData({
        kind: 'api_token',
        systemName: payload.systemName,
        familyApiUrl,
        token: payload.apiToken.token,
        loaded: true,
      });
    } else {
      showError('凭证信息已失效');
      setTimeout(() => wx.navigateBack(), 1200);
    }
  },

  onUnload(): void {
    // 离开页面主动清空，避免残留
    clearCredentialResult();
  },

  onCopy(e: WechatMiniprogram.TouchEvent): void {
    const value = e.currentTarget.dataset.value as string;
    if (!value) return;
    copyToClipboard(value);
  },

  /** 一键复制全部配置 */
  onCopyAll(): void {
    let text = '';
    if (this.data.kind === 'oauth') {
      text = [
        `Token URL: ${this.data.tokenUrl}`,
        `Grant Type: ${this.data.grantType}`,
        `Client ID: ${this.data.clientId}`,
        `Client Secret: ${this.data.clientSecret}`,
      ].join('\n');
    } else if (this.data.kind === 'api_token') {
      text = [
        `Family API Base URL: ${this.data.familyApiUrl}`,
        `Authentication: ${this.data.authScheme}`,
        `Token: ${this.data.token}`,
      ].join('\n');
    }
    if (text) copyToClipboard(text);
  },

  onDone(): void {
    wx.navigateBack();
  },
});
