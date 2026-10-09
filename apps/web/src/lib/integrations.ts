import { ApiError } from './api-client';

export const integrationModels = [
  { key: 'event', label: '日程', description: '读取或创建、修改家庭日程' },
  { key: 'task', label: '待办', description: '读取或创建、修改家庭待办' },
  { key: 'day_record', label: '日子', description: '读取或维护纪念日、倒计时等时间状态' },
] as const;

export type ModelKey = (typeof integrationModels)[number]['key'];
export type Permission = 'read' | 'write' | null;
export type PermissionMap = Record<ModelKey, Permission>;
export type CredentialMode = 'api_token' | 'oauth_client_credentials';

export type ExternalSystem = {
  id: string;
  spaceId: string;
  displayName: string;
  description: string | null;
  servicePrincipalId: string | null;
  agentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationCredential = {
  id: string;
  type: CredentialMode;
  label: string;
  displayPrefix?: string;
  clientId?: string;
  suffix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

export type ServiceAccess = {
  id: string;
  displayName: string;
  description: string | null;
  status: 'active' | 'disabled';
  bindingStatus: 'bound' | 'legacy_unbound';
  maxScopes: string[];
  createdAt: string;
  updatedAt: string;
  permissions: PermissionMap;
  effectivePermissions: PermissionMap;
  hasWholeSpaceGrant: boolean;
  credentialMode: CredentialMode | null;
  rotationPending: boolean;
  rotationCandidateId: string | null;
  credentials: IntegrationCredential[];
};

// Legacy name retained for compatibility with older helper/tests while the UI uses ServiceAccess.
export type Integration = ServiceAccess;

export type RevealedCredential =
  | { integrationName: string; type: 'api_token'; token: string }
  | { integrationName: string; type: 'oauth_client_credentials'; clientId: string; clientSecret: string };

export type CredentialSecret =
  | { type: 'api_token'; credentialId: string | null; token: string | null }
  | { type: 'oauth_client_credentials'; credentialId: string | null; clientId: string; clientSecret: string | null };

export function formatIntegrationTime(value: string | null) {
  if (!value) return '从未';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function familyApiBaseUrl(spaceId: string) {
  const coreOrigin = window.location.hostname === 'homemew.aisr.online'
    ? 'https://core.aisr.online'
    : 'https://core-staging.aisr.online';
  return `${coreOrigin}/api/v1/spaces/${encodeURIComponent(spaceId)}`;
}

export function oauthTokenUrl() {
  return window.location.hostname === 'homemew.aisr.online'
    ? 'https://auth.aisr.online/oauth/token'
    : 'https://auth-staging.aisr.online/oauth/token';
}

export function credentialModeLabel(mode: CredentialMode | null) {
  return mode === 'oauth_client_credentials' ? 'OAuth Client Credentials' : mode === 'api_token' ? 'API Token' : '未配置';
}

export function permissionLabel(permission: Permission) {
  return permission === 'write' ? '读写' : permission === 'read' ? '只读' : '无权限';
}

export function displayIntegrationError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.code === 'INTEGRATIONS_NOT_CONFIGURED') {
    return '外部系统运行凭据尚未配置到 HomeMew Web。当前环境还不能创建 LifeSpace 接入身份。';
  }
  if (cause instanceof ApiError && cause.code === 'EXTERNAL_SYSTEM_CATALOG_NOT_CONFIGURED') {
    return 'HomeMew 外部系统目录尚未部署完成。';
  }
  if (cause instanceof ApiError && cause.code === 'FORBIDDEN') {
    return '当前账号没有这个家庭的外部系统管理权限。';
  }
  if (cause instanceof ApiError && cause.code === 'INTEGRATION_BINDING_REQUIRED') {
    return '这个迁移 Service Principal 还没有 HomeMew 家庭管理归属，当前只能查看，不能管理全局凭据。';
  }
  if (cause instanceof ApiError && cause.code === 'CREDENTIAL_ROTATION_PENDING') {
    return '已有一次凭据轮换尚未完成，请先完成或取消。';
  }
  if (cause instanceof ApiError && cause.code === 'SERVICE_NOT_CONFIGURED') {
    return '这个外部系统还没有配置 Service Access。';
  }
  return cause instanceof Error ? cause.message : fallback;
}
