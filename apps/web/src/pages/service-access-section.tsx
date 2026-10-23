import {
  AlertTriangle,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
  type PermissionMap,
  type ServiceAccess,
} from '../lib/integrations';

const defaultPermissions = (): PermissionMap => ({ event: 'write', task: 'write', day_record: 'read' });

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

function SecretReveal({ credential, systemName, spaceId, onClose }: {
  credential: CredentialSecret;
  systemName: string;
  spaceId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const baseUrl = familyApiBaseUrl(spaceId);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
      <p className="font-semibold text-emerald-950">{systemName} 的新 Service 凭据</p>
      <p className="mt-1 text-sm leading-6 text-emerald-900/70">明文只保留在当前页面运行期。请先保存到外部系统，再关闭。</p>
      <div className="mt-4 grid gap-4">
        <div>
          <p className="text-xs font-medium text-emerald-900/70">Connection Base URL</p>
          <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{baseUrl}</code>
          <Button className="mt-2" onClick={() => void copy('base', baseUrl)}>
            {copied === 'base' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            {copied === 'base' ? '已复制' : '复制 Connection Base URL'}
          </Button>
        </div>
        {credential.type === 'api_token' ? (
          <div>
            <p className="text-xs font-medium text-emerald-900/70">Service API Token</p>
            <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{credential.token ?? '未返回 Token'}</code>
            {credential.token && (
              <Button className="mt-2" variant="primary" onClick={() => void copy('token', credential.token!)}>
                {copied === 'token' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied === 'token' ? '已复制' : '复制 Service API Token'}
              </Button>
            )}
            <p className="mt-2 text-xs leading-5 text-emerald-900/60">请将这份凭据妥善保存在需要连接的外部服务中，不要分享给其他人。</p>
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Token URL</p>
              <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{oauthTokenUrl()}</code>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Client ID</p>
              <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{credential.clientId}</code>
              <Button className="mt-2" onClick={() => void copy('client', credential.clientId)}>
                {copied === 'client' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied === 'client' ? '已复制' : '复制 Client ID'}
              </Button>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900/70">Client Secret</p>
              <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{credential.clientSecret ?? '未返回 Secret'}</code>
              {credential.clientSecret && (
                <Button className="mt-2" variant="primary" onClick={() => void copy('secret', credential.clientSecret!)}>
                  {copied === 'secret' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                  {copied === 'secret' ? '已复制' : '复制 Client Secret'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-emerald-900/60">关闭后无法恢复凭据明文；遗失时请使用受控轮换重新签发。</p>
      <Button className="mt-3" onClick={onClose}>我已保存，关闭</Button>
    </div>
  );
}

export function ServiceAccessSection({
  spaceId,
  externalSystemId,
  systemName,
  readOnly,
  onBindingChanged,
}: {
  spaceId: string;
  externalSystemId: string;
  systemName: string;
  readOnly: boolean;
  onBindingChanged: () => Promise<void>;
}) {
  const [service, setService] = useState<ServiceAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>(defaultPermissions);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>('api_token');
  const [editingPermissions, setEditingPermissions] = useState(false);
  const [rotationMode, setRotationMode] = useState<CredentialMode>('api_token');
  const [revealedCredential, setRevealedCredential] = useState<CredentialSecret | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const value = await apiRequest<ServiceAccess | null>(
        `/api/integrations/${encodeURIComponent(externalSystemId)}/service?spaceId=${encodeURIComponent(spaceId)}`,
      );
      setService(value);
      if (value) {
        setPermissions(value.permissions);
        setCredentialMode(value.credentialMode ?? 'api_token');
        setRotationMode(value.credentialMode ?? 'api_token');
      } else {
        setPermissions(defaultPermissions());
        setCredentialMode('api_token');
        setRotationMode('api_token');
      }
    } catch (cause) {
      setError(displayIntegrationError(cause, '加载 Service Access 失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [spaceId, externalSystemId]);

  const activeCredentials = useMemo(() => service?.credentials.filter((item) => item.active) ?? [], [service]);
  const currentCredential = activeCredentials[0] ?? null;
  const rotationCandidate = service?.rotationCandidateId
    ? activeCredentials.find((item) => item.id === service.rotationCandidateId) ?? null
    : null;

  async function createService() {
    setBusy('create');
    setError(null);
    try {
      const result = await apiRequest<{ service: ServiceAccess; credential: CredentialSecret }>(
        `/api/integrations/${encodeURIComponent(externalSystemId)}/service`,
        { method: 'POST', body: JSON.stringify({ spaceId, permissions, credentialMode }) },
      );
      setService(result.service);
      setPermissions(result.service.permissions);
      setRotationMode(result.service.credentialMode ?? credentialMode);
      setRevealedCredential(result.credential);
      await onBindingChanged();
    } catch (cause) {
      setError(displayIntegrationError(cause, '创建 Service Access 失败'));
    } finally {
      setBusy(null);
    }
  }

  async function savePermissions() {
    if (!service) return;
    setBusy('save');
    setError(null);
    try {
      const value = await apiRequest<ServiceAccess>(`/api/integrations/${encodeURIComponent(externalSystemId)}/service`, {
        method: 'PATCH',
        body: JSON.stringify({ spaceId, permissions }),
      });
      setService(value);
      setPermissions(value.permissions);
      setEditingPermissions(false);
    } catch (cause) {
      setError(displayIntegrationError(cause, '保存 Service 数据访问失败'));
    } finally {
      setBusy(null);
    }
  }

  async function startRotation() {
    if (!service) return;
    if (currentCredential && !window.confirm('确认签发新的 Service 凭据吗？新旧凭据会暂时同时有效，直到完成或取消轮换。')) return;
    setBusy('rotate');
    setError(null);
    try {
      const result = await apiRequest<{ service: ServiceAccess; credential: CredentialSecret }>(
        `/api/integrations/${encodeURIComponent(externalSystemId)}/service/credential-rotation`,
        { method: 'POST', body: JSON.stringify({ spaceId, credentialMode: rotationMode }) },
      );
      setService(result.service);
      setRevealedCredential(result.credential);
    } catch (cause) {
      setError(displayIntegrationError(cause, '签发 Service 凭据失败'));
    } finally {
      setBusy(null);
    }
  }

  async function completeRotation() {
    if (!rotationCandidate) return;
    if (!window.confirm('确认外部系统已经使用新凭据并验证成功？完成后旧凭据会立即撤销。')) return;
    setBusy('complete');
    setError(null);
    try {
      const value = await apiRequest<ServiceAccess>(
        `/api/integrations/${encodeURIComponent(externalSystemId)}/service/credential-rotation/complete`,
        { method: 'POST', body: JSON.stringify({ spaceId, keepCredentialId: rotationCandidate.id }) },
      );
      setService(value);
      setRotationMode(value.credentialMode ?? 'api_token');
      setRevealedCredential(null);
    } catch (cause) {
      setError(displayIntegrationError(cause, '完成 Service 凭据轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelRotation() {
    if (!rotationCandidate) return;
    if (!window.confirm('取消本次 Service 凭据轮换？新凭据会被撤销，旧凭据继续有效。')) return;
    setBusy('cancel');
    setError(null);
    try {
      const value = await apiRequest<ServiceAccess>(
        `/api/integrations/${encodeURIComponent(externalSystemId)}/service/credential-rotation/cancel`,
        { method: 'POST', body: JSON.stringify({ spaceId, candidateCredentialId: rotationCandidate.id }) },
      );
      setService(value);
      setRotationMode(value.credentialMode ?? 'api_token');
      setRevealedCredential(null);
    } catch (cause) {
      setError(displayIntegrationError(cause, '取消 Service 凭据轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function removeService() {
    if (!service) return;
    if (!window.confirm(`确认移除“${systemName}”的服务接入吗？相关凭据和事件推送会停止，AI 助手接入不受影响。`)) return;
    setBusy('remove');
    setError(null);
    try {
      const result = await apiRequest<{ removed: boolean; cleanupWarnings: string[] }>(
        `/api/integrations/${encodeURIComponent(externalSystemId)}/service/remove`,
        { method: 'POST', body: JSON.stringify({ spaceId }) },
      );
      if (!result.removed) {
        setError(`Service 已进入停用清理，但仍有未完成项：${result.cleanupWarnings.join('、')}`);
        await load();
        return;
      }
      setService(null);
      setPermissions(defaultPermissions());
      setCredentialMode('api_token');
      setRotationMode('api_token');
      setRevealedCredential(null);
      setEditingPermissions(false);
      await onBindingChanged();
    } catch (cause) {
      setError(displayIntegrationError(cause, '移除 Service Access 失败'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4" id="service-access">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-emerald-100 text-emerald-800"><Server className="size-4" /></span>
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Service Access</h2>
          <p className="mt-0.5 text-sm text-stone-500">允许外部服务在你设置的权限范围内访问家庭数据。</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5 pt-6">
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {revealedCredential && <SecretReveal credential={revealedCredential} systemName={systemName} spaceId={spaceId} onClose={() => setRevealedCredential(null)} />}

          {loading ? (
            <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-stone-500"><LoaderCircle className="size-4 animate-spin" />正在加载 Service Access…</div>
          ) : !service ? (
            <div className="space-y-5">
              <div className="rounded-2xl bg-emerald-50/50 p-4 text-sm leading-6 text-emerald-950/80">
                只有开启后，外部服务才能使用你授予的家庭数据权限。
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-stone-800">数据访问</p>
                <PermissionEditor value={permissions} onChange={setPermissions} disabled={readOnly || busy !== null} />
              </div>
              <label className="block max-w-md text-sm font-medium text-stone-700">认证方式
                <select
                  className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700"
                  disabled={readOnly || busy !== null}
                  value={credentialMode}
                  onChange={(event) => setCredentialMode(event.target.value as CredentialMode)}
                >
                  <option value="api_token">Service API Token · Bearer 认证</option>
                  <option value="oauth_client_credentials">OAuth Client Credentials · OAuth 2.0</option>
                </select>
                <span className="mt-2 block text-xs leading-5 text-stone-400">请根据外部服务支持的登录方式选择。密钥方式适合能妥善保存密钥的服务。</span>
              </label>
              {!readOnly && (
                <div className="flex justify-end border-t border-stone-100 pt-4">
                  <Button variant="primary" disabled={busy !== null || !Object.values(permissions).some(Boolean)} onClick={() => void createService()}>
                    {busy === 'create' ? <LoaderCircle className="size-4 animate-spin" /> : <Server className="size-4" />}创建 Service Access
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Service Principal</p>
                  <p className="mt-1 font-medium text-stone-900">{service.displayName}</p>
                  <code className="mt-1 block text-xs text-stone-400">{service.id}</code>
                  <p className="mt-2 text-sm text-stone-600">认证：<strong>{credentialModeLabel(service.credentialMode)}</strong></p>
                  {currentCredential && (
                    <p className="mt-1 text-xs leading-5 text-stone-400">
                      {(currentCredential.displayPrefix ?? currentCredential.clientId ?? currentCredential.label)}…{currentCredential.suffix}
                      {' · '}创建 {formatIntegrationTime(currentCredential.createdAt)} · 最近使用 {formatIntegrationTime(currentCredential.lastUsedAt)}
                    </p>
                  )}
                </div>
                {!readOnly && !service.rotationPending && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-stone-500">新凭据方式
                      <select
                        className="mt-1 block h-9 rounded-xl border border-stone-200 bg-white px-2 text-sm text-stone-700"
                        disabled={busy !== null}
                        value={rotationMode}
                        onChange={(event) => setRotationMode(event.target.value as CredentialMode)}
                      >
                        <option value="api_token">Service API Token</option>
                        <option value="oauth_client_credentials">OAuth Client Credentials</option>
                      </select>
                    </label>
                    <Button disabled={busy !== null} onClick={() => void startRotation()}>
                      {busy === 'rotate' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}重新签发凭据
                    </Button>
                  </div>
                )}
              </div>

              {service.rotationPending && rotationCandidate && (
                <div className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">
                  <p className="font-medium">新旧 Service 凭据暂时同时有效</p>
                  <p className="mt-1 leading-6">先切换外部系统并完成一次真实请求。验证成功后完成轮换；失败则取消。</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy !== null} onClick={() => void completeRotation()}>
                      {busy === 'complete' ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}已验证，完成轮换
                    </Button>
                    <Button disabled={busy !== null} onClick={() => void cancelRotation()}>
                      {busy === 'cancel' ? <LoaderCircle className="size-4 animate-spin" /> : null}取消轮换
                    </Button>
                  </div>
                </div>
              )}

              {service.hasWholeSpaceGrant && (
                <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p>当前服务使用旧的权限设置，为避免误操作，暂时不能在这里修改。请先前往管理控制台调整。</p>
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">当前家庭数据访问</p>
                    <p className="mt-1 text-xs leading-5 text-stone-400">选择这个服务可以查看或修改哪些家庭内容。</p>
                  </div>
                  {!readOnly && !service.hasWholeSpaceGrant && !editingPermissions && (
                    <Button disabled={busy !== null || service.rotationPending} onClick={() => setEditingPermissions(true)}>编辑</Button>
                  )}
                </div>
                {editingPermissions ? (
                  <div className="space-y-3">
                    <PermissionEditor value={permissions} onChange={setPermissions} disabled={busy !== null} />
                    <div className="flex justify-end gap-2">
                      <Button disabled={busy !== null} onClick={() => { setEditingPermissions(false); setPermissions(service.permissions); }}>取消</Button>
                      <Button variant="primary" disabled={busy !== null || !Object.values(permissions).some(Boolean)} onClick={() => void savePermissions()}>
                        {busy === 'save' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存数据访问
                      </Button>
                    </div>
                  </div>
                ) : <PermissionSummary value={service.effectivePermissions} />}
              </div>

              <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-sky-700" />
                  <div className="text-sm leading-6 text-stone-600">
                    <p className="font-semibold text-stone-900">LifeSpace Connection</p>
                    <code className="mt-2 block break-all text-xs">{familyApiBaseUrl(spaceId)}</code>
                    <p className="mt-2 text-xs leading-5 text-stone-500">这是外部服务连接当前家庭时使用的地址，请妥善保管凭据。</p>
                  </div>
                </div>
              </div>

              {!readOnly && (
                <div className="flex justify-end border-t border-stone-100 pt-4">
                  <Button variant="ghost" disabled={busy !== null} onClick={() => void removeService()}>
                    {busy === 'remove' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}移除 Service Access
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
