/**
 * 外部系统详情页
 *
 * 展示：名称、说明、状态、权限、创建人、创建时间、最近使用、凭证列表。
 * 支持：修改名称/说明/权限（跳转编辑页）、启用/停用、新增 Client Secret、
 * 新增 API Token、吊销单条凭证、删除外部系统。
 *
 * 危险操作二次确认：停用、吊销凭证、删除系统。
 * 凭证列表只显示尾号，完整值仅在创建结果页一次性展示。
 */

import {
  getIntegration,
  updateIntegration,
  deleteIntegration,
  listCredentials,
  createClientSecret,
  createApiToken,
  revokeCredential,
} from '../../services/integrations';
import { setCredentialResult } from '../../stores/credential-buffer';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  formatDate,
  timeAgo,
  summarizePermissions,
} from '../../utils/index';
import { Integration, IntegrationCredential } from '../../types/index';

type CredentialView = IntegrationCredential & {
  typeText: string;
  maskedText: string;
  statusText: string;
  subText: string;
};

const CRED_TYPE_TEXT: Record<string, string> = {
  oauth_client_secret: 'OAuth Client Secret',
  api_token: 'API Token',
};

Page({
  data: {
    familyId: '',
    integrationId: '',
    integration: null as Integration | null,
    credentials: [] as CredentialView[],

    // 派生展示字段
    statusText: '',
    permissionSummary: '',
    permissionLabels: [] as string[],
    createdByText: '',
    createdAtText: '',
    lastUsedText: '',

    loaded: false,
    processing: false,
  },

  onLoad(options: { familyId?: string; id?: string; created?: string }): void {
    const familyId = options?.familyId;
    const integrationId = options?.id;
    if (!familyId || !integrationId) {
      showError('缺少参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ familyId, integrationId });
    this.loadAll();

    // 刚创建时引导生成凭证
    if (options.created === '1') {
      setTimeout(() => {
        showSuccess('创建成功，请生成凭证');
      }, 900);
    }
  },

  onShow(): void {
    // 从编辑页返回时刷新
    if (this.data.familyId && this.data.loaded) {
      this.loadAll();
    }
  },

  async loadAll(): Promise<void> {
    try {
      const [integration, credentials] = await Promise.all([
        getIntegration(this.data.familyId, this.data.integrationId),
        listCredentials(this.data.familyId, this.data.integrationId),
      ]);
      this.applyData(integration, credentials);
    } catch (error: unknown) {
      console.error('[IntegrationDetail] Load failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  applyData(integration: Integration, credentials: IntegrationCredential[]): void {
    const statusMap: Record<string, string> = {
      active: '已启用',
      disabled: '已停用',
      deleted: '已删除',
    };
    this.setData({
      integration,
      statusText: statusMap[integration.status] || integration.status,
      permissionSummary: summarizePermissions(integration.permissions),
      createdByText: integration.createdBy?.name || '',
      createdAtText: formatDate(integration.createdAt, 'datetime'),
      lastUsedText: integration.lastUsedAt
        ? `${formatDate(integration.lastUsedAt, 'datetime')} · ${timeAgo(integration.lastUsedAt)}`
        : '尚未使用',
      credentials: credentials.map(c => this.mapCredential(c)),
      loaded: true,
      processing: false,
    });
  },

  mapCredential(c: IntegrationCredential): CredentialView {
    const isRevoked = c.status === 'revoked';
    let subText = `创建于 ${formatDate(c.createdAt, 'date')}`;
    if (isRevoked && c.revokedAt) {
      subText += ` · 已于 ${formatDate(c.revokedAt, 'date')} 吊销`;
    } else if (c.lastUsedAt) {
      subText += ` · 最近使用 ${formatDate(c.lastUsedAt, 'date')}`;
    } else {
      subText += ' · 尚未使用';
    }
    return {
      ...c,
      typeText: CRED_TYPE_TEXT[c.type] || c.type,
      maskedText: `····${c.suffix}`,
      statusText: isRevoked ? '已吊销' : '有效',
      subText,
    };
  },

  /** 修改名称/说明/权限 */
  onEdit(): void {
    wx.navigateTo({
      url: `/pages/integrations/edit?familyId=${this.data.familyId}&id=${this.data.integrationId}`,
    });
  },

  /** 启用 / 停用 */
  async onToggleStatus(): Promise<void> {
    const integration = this.data.integration;
    if (!integration || this.data.processing) return;
    const disable = integration.status === 'active';

    if (disable) {
      const confirmed = await showConfirm(
        '停用外部系统',
        `停用后，“${integration.name}”将立即无法访问本家庭。是否继续？`,
      );
      if (!confirmed) return;
    }

    this.setData({ processing: true });
    showLoading(disable ? '停用中...' : '启用中...');
    try {
      await updateIntegration(this.data.familyId, this.data.integrationId, {
        status: disable ? 'disabled' : 'active',
      });
      hideLoading();
      showSuccess(disable ? '已停用' : '已启用');
      this.loadAll();
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[IntegrationDetail] Toggle status failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 新增 Client Secret */
  async onCreateClientSecret(): Promise<void> {
    if (this.data.processing || !this.data.integration) return;
    this.setData({ processing: true });
    showLoading('生成中...');
    try {
      const created = await createClientSecret(this.data.familyId, this.data.integrationId);
      hideLoading();
      this.setData({ processing: false });
      setCredentialResult({
        kind: 'oauth',
        systemName: this.data.integration.name,
        clientSecret: created,
      });
      wx.navigateTo({ url: `/pages/integrations/credential?familyId=${this.data.familyId}&id=${this.data.integrationId}` });
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[IntegrationDetail] Create client secret failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 新增 API Token */
  async onCreateApiToken(): Promise<void> {
    if (this.data.processing || !this.data.integration) return;
    this.setData({ processing: true });
    showLoading('生成中...');
    try {
      const created = await createApiToken(this.data.familyId, this.data.integrationId);
      hideLoading();
      this.setData({ processing: false });
      setCredentialResult({
        kind: 'api_token',
        systemName: this.data.integration.name,
        apiToken: created,
      });
      wx.navigateTo({ url: `/pages/integrations/credential?familyId=${this.data.familyId}&id=${this.data.integrationId}` });
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[IntegrationDetail] Create api token failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 吊销单条凭证 */
  async onRevokeCredential(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const credentialId = e.currentTarget.dataset.id as string;
    if (!credentialId || this.data.processing) return;
    const confirmed = await showConfirm(
      '吊销凭证',
      '吊销后使用该凭证的外部系统将立即无法访问本家庭。是否继续？',
    );
    if (!confirmed) return;

    this.setData({ processing: true });
    showLoading('吊销中...');
    try {
      await revokeCredential(this.data.familyId, this.data.integrationId, credentialId);
      hideLoading();
      showSuccess('已吊销');
      this.loadAll();
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[IntegrationDetail] Revoke failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /** 删除外部系统 */
  async onDelete(): Promise<void> {
    const integration = this.data.integration;
    if (!integration || this.data.processing) return;
    const confirmed = await showConfirm(
      '删除外部系统',
      `删除后，“${integration.name}”将立即无法访问本家庭。已由该系统创建的日程和待办不会被删除。是否继续？`,
    );
    if (!confirmed) return;

    this.setData({ processing: true });
    showLoading('删除中...');
    try {
      await deleteIntegration(this.data.familyId, this.data.integrationId);
      hideLoading();
      showSuccess('已删除');
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error: unknown) {
      hideLoading();
      this.setData({ processing: false });
      console.error('[IntegrationDetail] Delete failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },
});
