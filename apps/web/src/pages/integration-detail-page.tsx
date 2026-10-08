import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';
import {
  credentialModeLabel,
  displayIntegrationError,
  familyApiBaseUrl,
  formatIntegrationTime,
  integrationModels,
  oauthTokenUrl,
  permissionLabel,
  type CredentialMode,
  type CredentialSecret,
  type Integration,
  type PermissionMap,
  type RevealedCredential,
} from '../lib/integrations';
import {
  clearBufferedIntegrationCredential,
  getBufferedIntegrationCredential,
} from '../lib/integration-secret-buffer';
import { AgentAccessSection } from './agent-access-section';
import { EventSubscriptionsSection } from './event-subscriptions-page';

function PermissionEditor({ value, onChange, disabled = false }: {
  value: PermissionMap;
  onChange: (value: PermissionMap) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      {integrationModels.map((model) => (
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
      {integrationModels.map((model) => (
        <div key={model.key} className="rounded-2xl bg-stone-50 px-4 py-3">
          <p className="text-sm font-medium text-stone-800">{model.label}</p>
          <p className="mt-1 text-xs text-stone-500">{permissionLabel(value[model.key])}</p>
        </div>
      ))}
    </div>
  );
}

function CredentialReveal({ value, spaceId, onClose }: {
  value: RevealedCredential;
  spaceId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const connectionBaseUrl = familyApiBaseUrl(spaceId);

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
        <div>
          <p className="font-semibold text-emerald-950">{value.integrationName} 的新凭据</p>
          <p className="mt-1 text-sm leading-6 text-emerald-900/70">明文只保留在当前页面运行期。请先保存到外部系统，再关闭这张卡片。</p>
        </div>
        {value.type === 'api_token' ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-emerald-200">
              <p className="text-sm font-semibold text-emerald-950">用于 LifeSpace n8n Community Node</p>
              <p className="mt-1 text-sm leading-6 text-emerald-900/70">在 n8n 的 <strong>LifeSpace Connection API</strong> Credential 中只填写下面两项，不需要再填写 Space ID。</p>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Connection Base URL</p>
              <code className="mt-1 block select-all break-all rounded-2xl bg-white p-4 text-sm text-emerald-950 ring-1 ring-emerald-200">{connectionBaseUrl}</code>
              <Button className="mt-2" onClick={() => void copy('baseUrl', connectionBaseUrl)}>
                {copied === 'baseUrl' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied === 'baseUrl' ? '已复制' : '复制 Connection Base URL'}
              </Button>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Service API Token</p>
              <code className="mt-1 block select-all break-all rounded-2xl bg-white p-4 text-sm text-emerald-950 ring-1 ring-emerald-200">{value.token}</code>
              <Button className="mt-2" variant="primary" onClick={() => void copy('token', value.token)}>
                {copied === 'token' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied === 'token' ? '已复制' : '复制 Service API Token'}
              </Button>
            </div>
            <p className="text-xs leading-5 text-emerald-900/60">关闭后无法再次查看这个 Token 明文；如果遗失，请通过凭据轮换生成新的 Token。</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900 ring-1 ring-amber-100">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>OAuth Client Credentials 可用于支持 OAuth 的外部系统，但当前官方 LifeSpace n8n Community Node 首版 Credential 使用 Service API Token，不能把下面的 Client ID / Secret 直接填到该 Credential。</p>
            </div>
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
          </div>
        )}
        <Button onClick={onClose}>我已保存，关闭</Button>
      </CardContent>
    </Card>
  );
}

function LifeSpaceConnectionGuide({ spaceId, credentialMode, hasCredential }: {
  spaceId: string;
  credentialMode: CredentialMode | null;
  hasCredential: boolean;
}) {
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
    <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-stone-900">LifeSpace Connection</p>
        <p className="text-sm leading-6 text-stone-500">这个连接已经绑定当前家庭 Space。外部系统直接调用 LifeSpace Core，不需要再输入 Space ID。</p>
      </div>
      <div className="mt-3">
        <p className="text-xs font-medium text-stone-500">Connection Base URL</p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 select-all break-all rounded-xl bg-white px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-200">{baseUrl}</code>
          <Button onClick={() => void copyBaseUrl()}>
            {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            {copied ? '已复制' : '复制 Connection Base URL'}
          </Button>
        </div>
      </div>
      {credentialMode === 'api_token' ? (
        <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-stone-500 ring-1 ring-sky-100">
          官方 LifeSpace n8n Community Node 使用 <strong>Connection Base URL + Service API Token</strong>。模型和 Action 会通过 <code>/_discovery</code> 按当前授权动态加载。{hasCredential ? '已有 Token 的明文不可恢复；需要重新配置时请轮换凭据。' : '请先创建 API Token。'}
        </div>
      ) : credentialMode === 'oauth_client_credentials' ? (
        <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>当前官方 LifeSpace n8n Community Node 首版使用 Service API Token Credential；OAuth Client Credentials 仍可供其它支持 OAuth 的集成使用。</span>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-stone-500 ring-1 ring-sky-100">创建 Service API Token 后，即可把 Connection Base URL 和一次性 Token 直接填入官方 LifeSpace n8n Community Node Credential。</div>
      )}
    </div>
  );
}

export function IntegrationDetailPage() {
  const { integrationId = '' } = useParams();
  const { currentFamily } = useHousehold();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionMap>({ event: null, task: null, day_record: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [revealedCredential, setRevealedCredential] = useState<RevealedCredential | null>(() => (
    integrationId ? getBufferedIntegrationCredential(integrationId) : null
  ));

  const manager = currentFamily?.role === 'owner' || currentFamily?.role === 'admin';

  async function load() {
    if (!currentFamily || !manager || !integrationId) {
      setIntegration(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const values = await apiRequest<Integration[]>(`/api/integrations?spaceId=${encodeURIComponent(currentFamily.id)}`);
      const value = values.find((item) => item.id === integrationId) ?? null;
      setIntegration(value);
      if (!value) setError('找不到这个外部系统，或者它已经不属于当前家庭。');
    } catch (cause) {
      setError(displayIntegrationError(cause, '加载外部系统失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [currentFamily?.id, manager, integrationId]);

  useEffect(() => {
    if (!integration) return;
    setName(integration.displayName);
    setDescription(integration.description ?? '');
    setPermissions(integration.permissions);
  }, [integration]);

  const activeCredentials = useMemo(() => integration?.credentials.filter((credential) => credential.active) ?? [], [integration]);
  const currentCredential = activeCredentials[0] ?? null;
  const rotationCandidate = integration?.rotationCandidateId
    ? activeCredentials.find((credential) => credential.id === integration.rotationCandidateId) ?? null
    : null;
  const bound = integration?.bindingStatus === 'bound';
  const editable = Boolean(integration && bound && integration.status === 'active');
  const hasPermissions = Object.values(permissions).some(Boolean);
  const canSave = Boolean(name.trim()) && hasPermissions && !integration?.hasWholeSpaceGrant;

  function closeCredentialReveal() {
    if (integrationId) clearBufferedIntegrationCredential(integrationId);
    setRevealedCredential(null);
  }

  async function save() {
    if (!integration || !currentFamily) return;
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
        body: JSON.stringify({ spaceId: currentFamily.id, displayName: name.trim(), description, permissions }),
      });
      setEditing(false);
      await load();
    } catch (cause) {
      setError(displayIntegrationError(cause, '保存外部系统失败'));
    } finally {
      setBusy(null);
    }
  }

  async function startRotation(mode: CredentialMode) {
    if (!integration || !currentFamily) return;
    const switching = integration.credentialMode && integration.credentialMode !== mode;
    const action = switching ? `切换到 ${credentialModeLabel(mode)}` : '轮换当前凭据';
    if (activeCredentials.length && !window.confirm(`确认${action}吗？新旧凭据会暂时同时有效，直到你完成或取消本次轮换。`)) return;
    setBusy('credential');
    setError(null);
    try {
      const result = await apiRequest<{ integration: Integration; credential: CredentialSecret }>(
        `/api/integrations/${encodeURIComponent(integration.id)}/credential-rotation`,
        { method: 'POST', body: JSON.stringify({ spaceId: currentFamily.id, credentialMode: mode }) },
      );
      if (result.credential.type === 'api_token' && result.credential.token) {
        setRevealedCredential({ integrationName: integration.displayName, type: 'api_token', token: result.credential.token });
      }
      if (result.credential.type === 'oauth_client_credentials' && result.credential.clientSecret) {
        setRevealedCredential({
          integrationName: integration.displayName,
          type: 'oauth_client_credentials',
          clientId: result.credential.clientId,
          clientSecret: result.credential.clientSecret,
        });
      }
      await load();
    } catch (cause) {
      setError(displayIntegrationError(cause, '创建新凭据失败'));
    } finally {
      setBusy(null);
    }
  }

  async function completeRotation() {
    if (!integration || !currentFamily || !rotationCandidate) return;
    if (!window.confirm('确认外部系统已经使用新凭据并验证成功？完成后旧凭据会立即撤销。')) return;
    setBusy('complete-rotation');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/credential-rotation/complete`, {
        method: 'POST',
        body: JSON.stringify({ spaceId: currentFamily.id, keepCredentialId: rotationCandidate.id }),
      });
      closeCredentialReveal();
      await load();
    } catch (cause) {
      setError(displayIntegrationError(cause, '完成凭据轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelRotation() {
    if (!integration || !currentFamily || !rotationCandidate) return;
    if (!window.confirm('取消本次轮换？新凭据会被撤销，旧凭据继续有效。')) return;
    setBusy('cancel-rotation');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/credential-rotation/cancel`, {
        method: 'POST',
        body: JSON.stringify({ spaceId: currentFamily.id, candidateCredentialId: rotationCandidate.id }),
      });
      closeCredentialReveal();
      await load();
    } catch (cause) {
      setError(displayIntegrationError(cause, '取消凭据轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!integration || !currentFamily) return;
    if (!window.confirm(`确认禁用“${integration.displayName}”吗？系统会禁用 Service Principal，并尝试撤销服务凭据、Agent API Token 和当前家庭授权。相关事件订阅也会因 Data Grant 撤销而停止投递。`)) return;
    setBusy('disable');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/disable`, {
        method: 'POST',
        body: JSON.stringify({ spaceId: currentFamily.id }),
      });
      closeCredentialReveal();
      await load();
    } catch (cause) {
      setError(displayIntegrationError(cause, '禁用外部系统失败'));
    } finally {
      setBusy(null);
    }
  }

  if (!currentFamily) return <Card className="p-8 text-center text-sm text-stone-500">请先创建或加入一个家庭。</Card>;
  if (!manager) return <Card className="p-8 text-center text-sm text-stone-500">只有家庭所有者或管理员可以查看外部系统详情。</Card>;

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-stone-500"><LoaderCircle className="size-5 animate-spin" />正在加载外部系统…</div>;
  }

  if (!integration) {
    return (
      <div className="space-y-4">
        <Link className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800" to="/settings/integrations"><ArrowLeft className="size-4" />返回外部系统</Link>
        <Card className="p-8 text-center text-sm text-stone-500">{error || '找不到这个外部系统。'}</Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800" to="/settings/integrations"><ArrowLeft className="size-4" />外部系统</Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">{integration.displayName}</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${integration.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                {integration.status === 'active' ? '启用中' : '已禁用'}
              </span>
              {!bound && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">迁移旧系统 · 只读</span>}
              {integration.rotationPending && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">凭据轮换中</span>}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{integration.description || '没有说明'}</p>
          </div>
          {editable && !editing && <Button onClick={() => setEditing(true)}><Pencil className="size-4" />编辑设置</Button>}
        </div>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {revealedCredential && <CredentialReveal value={revealedCredential} spaceId={currentFamily.id} onClose={closeCredentialReveal} />}

      {!bound && (
        <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>这是授权迁移前创建的 Service Principal，目前没有“当前家庭拥有其全局凭据管理权”的明确绑定。为了避免跨家庭误操作，认证与订阅配置均保持只读。</p>
        </div>
      )}

      <section className="space-y-4" id="authentication">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-amber-100 text-amber-800"><KeyRound className="size-4" /></span>
          <div>
            <h2 className="text-xl font-semibold text-stone-900">认证</h2>
            <p className="mt-0.5 text-sm text-stone-500">服务身份、凭据和可以读取的家庭数据。</p>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-5 pt-6">
            {editing && editable ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-stone-800">基本信息</p>
                  <label className="block text-sm text-stone-600">名称
                    <input className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  <label className="block text-sm text-stone-600">说明
                    <textarea className="mt-2 min-h-24 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" maxLength={400} value={description} onChange={(event) => setDescription(event.target.value)} />
                  </label>
                </div>
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-stone-800">数据访问</p>
                    <span className="text-xs text-stone-400">LifeSpace Data Grant</span>
                  </div>
                  <PermissionEditor value={permissions} onChange={setPermissions} disabled={integration.hasWholeSpaceGrant} />
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">认证方式</p>
                      <p className="mt-1 font-medium text-stone-900">{credentialModeLabel(integration.credentialMode)}</p>
                      {currentCredential && (
                        <p className="mt-1 text-xs leading-5 text-stone-400">
                          {currentCredential.type === 'api_token'
                            ? `${currentCredential.displayPrefix ?? 'lsp_pat'}…${currentCredential.suffix}`
                            : `${currentCredential.clientId ?? integration.id} · secret …${currentCredential.suffix}`}
                          {' · '}创建 {formatIntegrationTime(currentCredential.createdAt)} · 最近使用 {formatIntegrationTime(currentCredential.lastUsedAt)}
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
                          <Button disabled={busy !== null} onClick={() => void startRotation(integration.credentialMode === 'api_token' ? 'oauth_client_credentials' : 'api_token')}>
                            切换到 {integration.credentialMode === 'api_token' ? 'OAuth' : 'API Token'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-stone-800">数据访问</p>
                    <span className="text-xs text-stone-400">LifeSpace Data Grant</span>
                  </div>
                  <PermissionSummary value={integration.effectivePermissions} />
                </div>
              </div>
            )}

            {integration.hasWholeSpaceGrant && (
              <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>这个系统仍包含迁移前的 Space 级宽泛授权。本版先保持原权限不变，精细调整需要先完成旧授权收敛。</p>
              </div>
            )}

            {integration.rotationPending && rotationCandidate && (
              <div className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">
                <p className="font-medium">新旧凭据暂时同时有效</p>
                <p className="mt-1 leading-6">先在外部系统中换成新凭据并完成真实请求验证。成功后完成轮换；失败则取消并继续使用旧凭据。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy !== null} onClick={() => void completeRotation()}>
                    {busy === 'complete-rotation' ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}已验证，完成轮换
                  </Button>
                  <Button disabled={busy !== null} onClick={() => void cancelRotation()}>
                    {busy === 'cancel-rotation' ? <LoaderCircle className="size-4 animate-spin" /> : null}取消轮换
                  </Button>
                </div>
              </div>
            )}

            <LifeSpaceConnectionGuide
              spaceId={currentFamily.id}
              credentialMode={integration.credentialMode}
              hasCredential={Boolean(currentCredential)}
            />

            {editing && editable && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-4">
                <Button disabled={busy !== null} onClick={() => {
                  setEditing(false);
                  setName(integration.displayName);
                  setDescription(integration.description ?? '');
                  setPermissions(integration.permissions);
                }}>取消</Button>
                <Button variant="primary" disabled={busy !== null || !canSave} onClick={() => void save()}>
                  {busy === 'save' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <AgentAccessSection
        spaceId={currentFamily.id}
        integrationId={integration.id}
        integrationName={integration.displayName}
        readOnly={!editable}
      />

      <EventSubscriptionsSection
        spaceId={currentFamily.id}
        familyName={currentFamily.name}
        subscriberServicePrincipalId={integration.id}
        integrationName={integration.displayName}
        readOnly={!editable}
      />

      {editable && (
        <Card className="border-red-100 bg-red-50/30">
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-stone-900">禁用外部系统</p>
              <p className="mt-1 text-sm leading-6 text-stone-500">禁用会撤销服务凭据、Agent API Token 和当前家庭 Data Grant；绑定到该服务的事件订阅也会停止投递。</p>
            </div>
            <Button variant="ghost" disabled={busy !== null} onClick={() => void disable()}>
              {busy === 'disable' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}禁用
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
