import { apiRequest, ApiError } from './api-client';

// LifeSpace's configuration-time Discovery is authoritative for the current
// HomeMew Application × Model Access. Labels below are presentation only.
const localModelLabels: Record<string, string> = {
  event: '日程',
  task: '待办',
  day_record: '日子',
  wish: '心愿',
  person_group: '人员分组',
  anniversary: '纪念日',
  activity: '活动',
  goal: '目标',
  person_profile: '个人档案',
  habit: '习惯',
  football_match: '足球比赛',
  football_performance: '球员表现',
};

export type Permission = 'read' | 'write' | null;
export type PermissionMap = Record<string, Permission>;
export type IntegrationModel = {
  key: string;
  label: string;
  description: string;
  access: ('read' | 'write')[];
};

type DiscoveredModel = {
  key: string;
  display?: { singular?: string };
  access?: string[];
};

export async function fetchIntegrationModels(): Promise<IntegrationModel[]> {
  const discovery = await apiRequest<{ models: DiscoveredModel[] }>('/api/lifespace/core/v1/me/_discovery/models');
  if (!Array.isArray(discovery?.models)) throw new Error('LifeSpace 未返回有效的模型权限清单');
  const models = discovery.models.flatMap((model): IntegrationModel[] => {
    if (typeof model?.key !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(model.key)) return [];
    const access = (Array.isArray(model.access) ? model.access : [])
      .filter((value): value is 'read' | 'write' => value === 'read' || value === 'write');
    if (!access.length) return [];
    return [{
      key: model.key,
      label: localModelLabels[model.key] ?? model.display?.singular ?? model.key,
      description: model.key,
      access,
    }];
  });
  return models;
}

// Keep old Grants visible if a model is later retired or the Application loses
// Model Access, but never allow edits/elevation on an undiscoverable model.
export function visibleIntegrationModels(models: IntegrationModel[], ...permissions: PermissionMap[]): IntegrationModel[] {
  const available = new Set(models.map((model) => model.key));
  const existing = new Set(permissions.flatMap((map) => Object.entries(map)
    .filter(([, permission]) => permission !== null && permission !== undefined)
    .map(([key]) => key)));
  return [
    ...models,
    ...[...existing].filter((key) => !available.has(key)).map((key) => ({
      key,
      label: localModelLabels[key] ?? key,
      description: '该模型当前不可配置，原有授权会保留；请在 LifeSpace Console 核查。',
      access: [] as ('read' | 'write')[],
    })),
  ];
}
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
