import {
  AlertTriangle,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ApiError, apiRequest } from '../lib/api-client';

const models = [
  { key: 'event', label: '日程', description: '读取或创建、修改家庭日程' },
  { key: 'task', label: '待办', description: '读取或创建、修改家庭待办' },
  { key: 'day_record', label: '日子', description: '读取或维护纪念日、倒计时等时间状态' },
] as const;

type ModelKey = (typeof models)[number]['key'];
type Permission = 'read' | 'write' | null;
type PermissionMap = Record<ModelKey, Permission>;
type CredentialMode = 'api_token' | 'oauth_client_credentials';

type IntegrationCredential = {
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

type Integration = {
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

type RevealedCredential =
  | { integrationName: string; type: 'api_token'; token: string }
  | { integrationName: string; type: 'oauth_client_credentials'; clientId: string; clientSecret: string };

type CredentialSecret =
  | { type: 'api_token'; credentialId: string | null; token: string | null }
  | { type: 'oauth_client_credentials'; credentialId: string | null; clientId: string; clientSecret: string | null };

function formatTime(value: string | null) {
  if (!value) return '从未';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function familyApiBaseUrl(spaceId: string) {
  const coreOrigin = window.location.hostname === 'homemew.aisr.online'
    ? 'https://core.aisr.online'
    : 'https://core-staging.aisr.online';
  return `${coreOrigin}/api/v1/spaces/${encodeURIComponent(spaceId)}`;
}

function oauthTokenUrl() {
  return window.location.hostname === 'homemew.aisr.online'
    ? 'https://auth.aisr.online/oauth/token'
    : 'https://auth-staging.aisr.online/oauth/token';
}

function credentialModeLabel(mode: CredentialMode | null) {
  return mode === 'oauth_client_credentials' ? 'OAuth Client Credentials' : mode === 'api_token' ? 'API Token' : '未配置';
}

function displayError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.code === 'INTEGRATIONS_NOT_CONFIGURED') {
    return '外部系统运行凭据尚未配置到 HomeMew Web staging。代码能力已就绪，但当前环境还不能签发服务凭据。';
  }
  if (cause instanceof ApiError && cause.code === 'FORBIDDEN') {
    return '当前账号没有这个家庭的外部系统管理权限。';
  }
  if (cause instanceof ApiError && cause.code === 'INTEGRATION_BINDING_REQUIRED') {
    return '这个迁移外部系统还没有 HomeMew 家庭管理归属，当前只能查看，不能管理全局凭据。';
  }
  if (cause instanceof ApiError && cause.code === 'CREDENTIAL_ROTATION_PENDING') {
    return '已有一次凭据轮换尚未完成，请先完成或取消。';
  }
  return cause instanceof Error ? cause.message : fallback;
}

function PermissionEditor({ value, onChange, disabled = false }: {
  value: PermissionMap;
  onChange: (value: PermissionMap) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      {models.map((model) => (
        <label key={model.key} className="flex items-center justify-between gap-4 rounded-2xl bg-stone-50 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-stone-800">{model.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-stone-400">{model.description}</span>
          </span>
          <select
            className="h-9 shrink-0 rounded-xl border border-stone-200 bg-white px-2 text-sm text-stone-700 disabled:bg-stone-100 disabled:text-stone-400"
            disabled={disabled}
            value={value[model.key] ?? 'none'}
            onChange={(event) => onChange({
              ...value,
              [model.key]: event.target.value === 'none' ? null : event.target.value as 'read' | 'write',
            })}
          >
            <option value="none">无权限</option>
            <option value="read">只读</option>
            <option value="write">读写</option>
          </select>
        </label>
      ))}
    </div>
  );
}

function PermissionSummary({ value }: { value: PermissionMap }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {models.map((model) => (
        <div key={model.key} className="rounded-2xl bg-stone-50 px-4 py-3">
          <p className="text-sm font-medium text-stone-800">{model.label}</p>
          <p className="mt-1 text-xs text-stone-500">
            {value[model.key] === 'write' ? '读写' : value[model.key] === 'read' ? '只读' : '无模型授权'}
          </p>
        </div>
      ))}
    </div>
  );
}

function ApiAccessGuide({ spaceId }: { spaceId: string }) {
  const [copied, setCopied] = useState(false);
  const baseUrl = familyApiBaseUrl(spaceId);

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(baseUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-sky-100 bg-sky-50/40">
      <CardContent className="space-y-4 pt-6">
        <div>
          <p className="text-sm font-semibold text-stone-900">外部系统接入信息</p>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            n8n、Agent 和脚本直接调用 LifeSpace Core。HomeMew Web 只负责高级配置，不代理外部系统的日常业务请求。
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-stone-500">家庭 API Base URL</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 select-all break-all rounded-xl bg-white px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-200">{baseUrl}</code>
            <Button onClick={() => void copyBaseUrl()}>
              {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
              {copied ? '已复制' : '复制 Base URL'}
            </Button>
          </div>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-stone-100"><span className="text-stone-400">日程</span><code className="ml-2 text-stone-700">/events</code></div>
          <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-stone-100"><span className="text-stone-400">待办</span><code className="ml-2 text-stone-700">/tasks</code></div>
          <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-stone-100"><span className="text-stone-400">日子</span><code className="ml-2 text-stone-700">/day-records</code></div>
        </div>
        <p className="text-xs leading-5 text-stone-500">具体可访问模型仍以当前家庭为这个外部系统配置的 LifeSpace Data Grant 为准。</p>
      </CardContent>
    </Card>
  );
}

function CredentialReveal({ value, onClose }: { value: RevealedCredential; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/70 ring-emerald-200">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-emerald-700 ring-1 ring-emerald-200">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-emerald-950">{value.integrationName} 的新凭据</p>
            <p className="mt-1 text-sm leading-6 text-emerald-900/70">明文只会出现这一次。更新外部系统并验证成功后，再回到下方完成轮换。</p>
          </div>
        </div>

        {value.type === 'api_token' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-emerald-900/70">API Token</p>
            <code className="block select-all break-all rounded-2xl bg-white p-4 text-sm text-emerald-950 ring-1 ring-emerald-200">{value.token}</code>
            <Button variant="primary" onClick={() => void copy('token', value.token)}>
              {copied === 'token' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
              {copied === 'token' ? '已复制' : '复制 Token'}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Token URL</p>
              <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{oauthTokenUrl()}</code>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Client ID</p>
              <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{value.clientId}</code>
              <Button className="mt-2" onClick={() => void copy('clientId', value.clientId)}>
                {copied === 'clientId' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied === 'clientId' ? '已复制' : '复制 Client ID'}
              </Button>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Client Secret</p>
              <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{value.clientSecret}</code>
              <Button className="mt-2" variant="primary" onClick={() => void copy('secret', value.clientSecret)}>
                {copied === 'secret' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied === 'secret' ? '已复制' : '复制 Client Secret'}
              </Button>
            </div>
            <p className="text-xs leading-5 text-emerald-900/70">使用 <code>client_credentials</code> 获取短期 Bearer Token；scope 只能请求当前 Service Principal 允许的稳定平台 scope。</p>
          </div>
        )}

        <Button onClick={onClose}>我已保存，关闭</Button>
      </CardContent>
    </Card>
  );
}

function IntegrationCard({ integration, spaceId, onChanged, onReveal }: {
  integration: Integration;
  spaceId: string;
  onChanged: () => Promise<void>;
  onReveal: (value: RevealedCredential) => void;
}) {
  const [name, setName] = useState(integration.displayName);
  const [description, setDescription] = useState(integration.description ?? '');
  const [permissions, setPermissions] = useState<PermissionMap>(integration.permissions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(integration.displayName);
    setDescription(integration.description ?? '');
    setPermissions(integration.permissions);
  }, [integration]);

  const activeCredentials = useMemo(() => integration.credentials.filter((credential) => credential.active), [integration.credentials]);
  const currentCredential = activeCredentials[0] ?? null;
  const rotationCandidate = integration.rotationCandidateId
    ? activeCredentials.find((credential) => credential.id === integration.rotationCandidateId) ?? null
    : null;
  const bound = integration.bindingStatus === 'bound';
  const editable = bound && integration.status === 'active';
  const hasPermissions = Object.values(permissions).some(Boolean);
  const canSave = Boolean(name.trim()) && hasPermissions && !integration.hasWholeSpaceGrant;

  async function save() {
    if (!name.trim()) {
      setError('请输入外部系统名称。');
      return;
    }
    if (!hasPermissions) {
      setError('至少保留一个模型权限；如需全部撤权，请直接禁用这个外部系统。');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ spaceId, displayName: name.trim(), description, permissions }),
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '保存外部系统失败'));
    } finally {
      setBusy(null);
    }
  }

  async function startRotation(mode: CredentialMode) {
    const switching = integration.credentialMode && integration.credentialMode !== mode;
    const action = switching ? `切换到 ${credentialModeLabel(mode)}` : '轮换当前凭据';
    if (activeCredentials.length && !window.confirm(`确认${action}吗？新旧凭据会暂时同时有效，直到你完成或取消本次轮换。`)) return;
    setBusy('credential');
    setError(null);
    try {
      const result = await apiRequest<{ integration: Integration; credential: CredentialSecret }>(
        `/api/integrations/${encodeURIComponent(integration.id)}/credential-rotation`,
        { method: 'POST', body: JSON.stringify({ spaceId, credentialMode: mode }) },
      );
      if (result.credential.type === 'api_token' && result.credential.token) {
        onReveal({ integrationName: integration.displayName, type: 'api_token', token: result.credential.token });
      }
      if (result.credential.type === 'oauth_client_credentials' && result.credential.clientSecret) {
        onReveal({
          integrationName: integration.displayName,
          type: 'oauth_client_credentials',
          clientId: result.credential.clientId,
          clientSecret: result.credential.clientSecret,
        });
      }
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '创建新凭据失败'));
    } finally {
      setBusy(null);
    }
  }

  async function completeRotation() {
    if (!rotationCandidate) return;
    if (!window.confirm('确认外部系统已经使用新凭据并验证成功？完成后旧凭据会立即撤销。')) return;
    setBusy('complete-rotation');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/credential-rotation/complete`, {
        method: 'POST',
        body: JSON.stringify({ spaceId, keepCredentialId: rotationCandidate.id }),
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '完成凭据轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelRotation() {
    if (!rotationCandidate) return;
    if (!window.confirm('取消本次轮换？新凭据会被撤销，旧凭据继续有效。')) return;
    setBusy('cancel-rotation');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/credential-rotation/cancel`, {
        method: 'POST',
        body: JSON.stringify({ spaceId, candidateCredentialId: rotationCandidate.id }),
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '取消凭据轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!window.confirm(`确认禁用“${integration.displayName}”吗？系统会先禁用 Service Principal，并尝试撤销当前家庭授权和全部有效凭据。`)) return;
    setBusy('disable');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/disable`, {
        method: 'POST',
        body: JSON.stringify({ spaceId }),
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '禁用外部系统失败'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={integration.status === 'disabled' ? 'opacity-70' : undefined}>
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-stone-900">{integration.displayName}</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${integration.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                {integration.status === 'active' ? '启用中' : '已禁用'}
              </span>
              {!bound && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">迁移旧系统 · 只读</span>}
              {integration.hasWholeSpaceGrant && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">含旧 Space 级授权</span>}
              {integration.rotationPending && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">凭据轮换中</span>}
            </div>
            <p className="mt-1 text-sm text-stone-500">{integration.description || '没有说明'}</p>
          </div>
        </div>

        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {!bound && (
          <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>这是授权迁移前创建的 Service Principal，目前只有“它曾被当前家庭授权”的证据，没有“当前家庭拥有其全局凭据管理权”的明确绑定。为了避免跨家庭误操作，本页只显示当前家庭的 Grant，不读取或修改凭据，也不能编辑、禁用。</p>
          </div>
        )}

        {editable ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-stone-800">基本信息</p>
              <input
                className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <textarea
                className="min-h-24 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                maxLength={400}
                placeholder="例如：家庭自动化 n8n"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-stone-800">模型权限</p>
                <span className="text-xs text-stone-400">LifeSpace Data Grant</span>
              </div>
              <PermissionEditor value={permissions} onChange={setPermissions} disabled={integration.hasWholeSpaceGrant} />
              {!hasPermissions && !integration.hasWholeSpaceGrant ? (
                <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">至少保留一个模型权限；如需撤销全部访问，请使用“禁用”。</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-stone-800">当前家庭模型授权</p>
              <span className="text-xs text-stone-400">LifeSpace Data Grant</span>
            </div>
            <PermissionSummary value={integration.permissions} />
          </div>
        )}

        {integration.hasWholeSpaceGrant && (
          <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>这个系统仍包含迁移前的 Space 级宽泛读取授权。本版先保持原权限不变，精细调整需要先完成一次明确的旧授权收敛。</p>
          </div>
        )}

        {bound && (
          <div className="rounded-2xl border border-stone-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-800">认证方式</p>
                <p className="mt-1 text-sm text-stone-600">{credentialModeLabel(integration.credentialMode)}</p>
                {currentCredential && (
                  <p className="mt-1 text-xs text-stone-400">
                    {currentCredential.type === 'api_token'
                      ? `${currentCredential.displayPrefix ?? 'lsp_pat'}…${currentCredential.suffix}`
                      : `${currentCredential.clientId ?? integration.id} · secret …${currentCredential.suffix}`}
                    {' · '}创建 {formatTime(currentCredential.createdAt)} · 最近使用 {formatTime(currentCredential.lastUsedAt)}
                  </p>
                )}
              </div>
              {editable && !integration.rotationPending && (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy !== null} onClick={() => void startRotation(integration.credentialMode ?? 'api_token')}>
                    {busy === 'credential' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    {currentCredential ? '轮换凭据' : '创建凭据'}
                  </Button>
                  {currentCredential && (
                    <Button
                      disabled={busy !== null}
                      onClick={() => void startRotation(integration.credentialMode === 'api_token' ? 'oauth_client_credentials' : 'api_token')}
                    >
                      切换到 {integration.credentialMode === 'api_token' ? 'OAuth' : 'API Token'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {integration.rotationPending && rotationCandidate && (
              <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">
                <p className="font-medium">新旧凭据暂时同时有效</p>
                <p className="mt-1 leading-6">请先在 n8n、Agent 或脚本中替换为刚生成的新凭据并完成真实请求验证。确认成功后再完成轮换；如果验证失败可取消并继续使用旧凭据。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy !== null} onClick={() => void completeRotation()}>
                    {busy === 'complete-rotation' ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                    已验证，完成轮换
                  </Button>
                  <Button disabled={busy !== null} onClick={() => void cancelRotation()}>
                    {busy === 'cancel-rotation' ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    取消轮换
                  </Button>
                </div>
              </div>
            )}

            <p className="mt-3 text-xs leading-5 text-stone-400">稳态只保留一种认证方式和一个有效凭据。底层允许短暂双凭据仅用于零停机轮换。</p>
          </div>
        )}

        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-400">有效权限 = 凭据 scope ∩ Application × Model Access ∩ 当前家庭 Data Grant。</p>
            <div className="flex gap-2">
              <Button disabled={busy !== null || !canSave} onClick={() => void save()}>
                {busy === 'save' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => void disable()}>
                {busy === 'disable' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                禁用
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IntegrationsPage() {
  const { currentFamily } = useHousehold();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionMap>({ event: 'write', task: 'write', day_record: 'read' });
  const [credentialMode, setCredentialMode] = useState<CredentialMode>('api_token');
  const [revealedCredential, setRevealedCredential] = useState<RevealedCredential | null>(null);

  const manager = currentFamily?.role === 'owner' || currentFamily?.role === 'admin';

  async function load() {
    if (!currentFamily || !manager) {
      setIntegrations([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<Integration[]>(`/api/integrations?spaceId=${encodeURIComponent(currentFamily.id)}`);
      setIntegrations(result);
    } catch (cause) {
      setError(displayError(cause, '加载外部系统失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [currentFamily?.id, manager]);

  async function createIntegration() {
    if (!currentFamily) return;
    setCreating(true);
    setError(null);
    try {
      const result = await apiRequest<{ integration: Integration; credential: CredentialSecret }>('/api/integrations', {
        method: 'POST',
        body: JSON.stringify({
          spaceId: currentFamily.id,
          displayName: name.trim(),
          description,
          permissions,
          credentialMode,
        }),
      });
      if (result.credential.type === 'api_token' && result.credential.token) {
        setRevealedCredential({ integrationName: result.integration.displayName, type: 'api_token', token: result.credential.token });
      }
      if (result.credential.type === 'oauth_client_credentials' && result.credential.clientSecret) {
        setRevealedCredential({
          integrationName: result.integration.displayName,
          type: 'oauth_client_credentials',
          clientId: result.credential.clientId,
          clientSecret: result.credential.clientSecret,
        });
      }
      setName('');
      setDescription('');
      setPermissions({ event: 'write', task: 'write', day_record: 'read' });
      setCredentialMode('api_token');
      setShowCreate(false);
      await load();
    } catch (cause) {
      setError(displayError(cause, '创建外部系统失败'));
      await load();
    } finally {
      setCreating(false);
    }
  }

  if (!currentFamily) {
    return <Card className="p-8 text-center text-sm text-stone-500">请先创建或加入一个家庭。</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-800"><KeyRound className="size-5" /></span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">外部系统</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">为“{currentFamily.name}”管理 n8n、Agent、脚本等高级服务接入。该能力只在 Web 提供，小程序保持轻量。</p>
        </div>
        {manager && (
          <Button variant="primary" onClick={() => setShowCreate((value) => !value)}>
            <Plus className="size-4" />
            新建外部系统
          </Button>
        )}
      </div>

      {!manager && (
        <Card className="p-6">
          <div className="flex gap-3 text-sm leading-6 text-stone-600">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-stone-400" />
            <p>只有家庭所有者或管理员可以管理外部系统、Data Grant 和服务凭据。</p>
          </div>
        </Card>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {manager && <ApiAccessGuide spaceId={currentFamily.id} />}
      {revealedCredential && <CredentialReveal value={revealedCredential} onClose={() => setRevealedCredential(null)} />}

      {manager && showCreate && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">新建外部系统</h2>
              <p className="mt-1 text-sm text-stone-500">每个系统拥有独立 Service Principal、明确的家庭归属和独立模型授权；稳态只使用一种认证方式和一个有效凭据。</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-sm font-medium text-stone-700">
                  名称
                  <input
                    className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    maxLength={100}
                    placeholder="例如：家庭 n8n"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-stone-700">
                  说明
                  <textarea
                    className="mt-2 min-h-28 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    maxLength={400}
                    placeholder="这个系统做什么、部署在哪里……"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-stone-700">
                  认证方式
                  <select
                    className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700"
                    value={credentialMode}
                    onChange={(event) => setCredentialMode(event.target.value as CredentialMode)}
                  >
                    <option value="api_token">API Token · 简单长期凭据</option>
                    <option value="oauth_client_credentials">OAuth Client Credentials · 短期 Bearer Token</option>
                  </select>
                </label>
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-stone-700">模型权限</p>
                <PermissionEditor value={permissions} onChange={setPermissions} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
              <p className="text-xs leading-5 text-stone-400">凭据明文只展示一次。后续轮换采用“先创建新凭据 → 验证 → 撤销旧凭据”，避免停机。</p>
              <div className="flex gap-2">
                <Button disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
                <Button variant="primary" disabled={creating || !name.trim() || !Object.values(permissions).some(Boolean)} onClick={() => void createIntegration()}>
                  {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  创建并签发凭据
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {manager && loading && (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-stone-500"><LoaderCircle className="size-5 animate-spin" /> 正在加载外部系统…</div>
      )}

      {manager && !loading && integrations.length === 0 && !error && (
        <Card className="p-8 text-center">
          <KeyRound className="mx-auto size-8 text-stone-300" />
          <p className="mt-4 font-medium text-stone-800">还没有外部系统</p>
          <p className="mt-1 text-sm text-stone-500">为 n8n、Agent 或私有脚本创建一个独立访问身份。</p>
        </Card>
      )}

      {manager && !loading && integrations.map((integration) => (
        <IntegrationCard
          key={integration.id}
          integration={integration}
          spaceId={currentFamily.id}
          onChanged={load}
          onReveal={setRevealedCredential}
        />
      ))}
    </div>
  );
}
