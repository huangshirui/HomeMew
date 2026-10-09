import {
  AlertTriangle,
  Bot,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';
import {
  displayIntegrationError,
  familyApiBaseUrl,
  formatIntegrationTime,
  integrationModels,
  permissionLabel,
  type PermissionMap,
} from '../lib/integrations';

type CredentialAccess = 'read' | 'write';

type AgentCredential = {
  id: string;
  displayPrefix: string;
  suffix: string;
  label: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

type AgentAccess = {
  id: string;
  displayName: string;
  status: 'active' | 'disabled';
  credentialAccess: CredentialAccess | null;
  permissions: PermissionMap;
  effectivePermissions: PermissionMap;
  hasWholeSpaceGrant: boolean;
  rotationPending: boolean;
  rotationCandidateId: string | null;
  credentials: AgentCredential[];
};

type AgentSecret = {
  credentialId: string;
  token: string;
};

const emptyPermissions = (): PermissionMap => ({ event: null, task: null, day_record: null });

function accessLabel(value: CredentialAccess | null) {
  return value === 'write' ? '读取 + 写入' : value === 'read' ? '只读' : '未配置';
}

function DirectPermissionEditor({ value, onChange, credentialAccess, disabled = false }: {
  value: PermissionMap;
  onChange: (value: PermissionMap) => void;
  credentialAccess: CredentialAccess;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      {integrationModels.map((model) => (
        <label key={model.key} className="flex items-center justify-between gap-4 rounded-2xl bg-stone-50 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-stone-800">{model.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-stone-400">Principal=Agent / Actor=Agent 时无需临时用户授权的权限</span>
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
            <option value="write" disabled={credentialAccess === 'read'}>读写</option>
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

function AgentCredentialReveal({ token, spaceId, onClose }: {
  token: string;
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
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
      <p className="font-semibold text-emerald-950">新的 Agent API Token</p>
      <p className="mt-1 text-sm leading-6 text-emerald-900/70">明文只保留在当前页面运行期。请先保存到 Agent Runtime，再关闭。</p>
      <div className="mt-4 grid gap-4">
        <div>
          <p className="text-xs font-medium text-emerald-900/70">Connection Base URL</p>
          <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{connectionBaseUrl}</code>
          <Button className="mt-2" onClick={() => void copy('base', connectionBaseUrl)}>
            {copied === 'base' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            {copied === 'base' ? '已复制' : '复制 Connection Base URL'}
          </Button>
        </div>
        <div>
          <p className="text-xs font-medium text-emerald-900/70">Agent API Token</p>
          <code className="mt-1 block select-all break-all rounded-xl bg-white p-3 text-sm text-emerald-950 ring-1 ring-emerald-200">{token}</code>
          <Button className="mt-2" variant="primary" onClick={() => void copy('token', token)}>
            {copied === 'token' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            {copied === 'token' ? '已复制' : '复制 Agent API Token'}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-emerald-900/60">Agent API Token 是通用 LifeSpace Agent 凭据。Agent Runtime 使用 Connection Base URL + Agent API Token 调用授权范围内的能力；关闭后 Token 明文无法恢复，遗失时请重新签发。</p>
      <Button className="mt-3" onClick={onClose}>我已保存，关闭</Button>
    </div>
  );
}

export function AgentAccessSection({ spaceId, integrationId, integrationName, readOnly }: {
  spaceId: string;
  integrationId: string;
  integrationName: string;
  readOnly: boolean;
}) {
  const [agent, setAgent] = useState<AgentAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [credentialAccess, setCredentialAccess] = useState<CredentialAccess>('write');
  const [permissions, setPermissions] = useState<PermissionMap>(emptyPermissions);
  const [editingPermissions, setEditingPermissions] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [rotationAccess, setRotationAccess] = useState<CredentialAccess>('write');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const value = await apiRequest<AgentAccess | null>(
        `/api/integrations/${encodeURIComponent(integrationId)}/agent?spaceId=${encodeURIComponent(spaceId)}`,
      );
      setAgent(value);
      if (value) {
        setPermissions(value.permissions);
        setCredentialAccess(value.credentialAccess ?? 'write');
        setRotationAccess(value.credentialAccess ?? 'write');
      } else {
        setPermissions(emptyPermissions());
        setCredentialAccess('write');
        setRotationAccess('write');
      }
    } catch (cause) {
      setError(displayIntegrationError(cause, '加载 Agent 接入失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [spaceId, integrationId]);

  const activeCredentials = useMemo(() => agent?.credentials.filter((credential) => credential.active) ?? [], [agent]);
  const currentCredential = activeCredentials[0] ?? null;
  const rotationCandidate = agent?.rotationCandidateId
    ? activeCredentials.find((credential) => credential.id === agent.rotationCandidateId) ?? null
    : null;

  async function createAgent() {
    setBusy('create');
    setError(null);
    try {
      const result = await apiRequest<{ agent: AgentAccess; credential: AgentSecret }>(
        `/api/integrations/${encodeURIComponent(integrationId)}/agent`,
        {
          method: 'POST',
          body: JSON.stringify({ spaceId, credentialAccess, permissions }),
        },
      );
      setAgent(result.agent);
      setPermissions(result.agent.permissions);
      setRotationAccess(result.agent.credentialAccess ?? credentialAccess);
      setRevealedToken(result.credential.token);
    } catch (cause) {
      setError(displayIntegrationError(cause, '创建 Agent 接入失败'));
    } finally {
      setBusy(null);
    }
  }

  async function savePermissions() {
    if (!agent) return;
    setBusy('save');
    setError(null);
    try {
      const value = await apiRequest<AgentAccess>(`/api/integrations/${encodeURIComponent(integrationId)}/agent`, {
        method: 'PATCH',
        body: JSON.stringify({ spaceId, permissions }),
      });
      setAgent(value);
      setPermissions(value.permissions);
      setEditingPermissions(false);
    } catch (cause) {
      setError(displayIntegrationError(cause, '保存 Agent 直接权限失败'));
    } finally {
      setBusy(null);
    }
  }

  async function startRotation() {
    if (!agent) return;
    if (activeCredentials.length && !window.confirm('确认重新签发 Agent API Token 吗？新旧 Token 会暂时同时有效，直到完成或取消轮换。')) return;
    setBusy('rotate');
    setError(null);
    try {
      const result = await apiRequest<{ agent: AgentAccess; credential: AgentSecret }>(
        `/api/integrations/${encodeURIComponent(integrationId)}/agent/credential-rotation`,
        { method: 'POST', body: JSON.stringify({ spaceId, credentialAccess: rotationAccess }) },
      );
      setAgent(result.agent);
      setRevealedToken(result.credential.token);
    } catch (cause) {
      setError(displayIntegrationError(cause, '签发 Agent API Token 失败'));
    } finally {
      setBusy(null);
    }
  }

  async function completeRotation() {
    if (!rotationCandidate) return;
    if (!window.confirm('确认 Agent Runtime 已经使用新 Token 并验证成功？完成后旧 Token 会立即撤销。')) return;
    setBusy('complete');
    setError(null);
    try {
      const value = await apiRequest<AgentAccess>(
        `/api/integrations/${encodeURIComponent(integrationId)}/agent/credential-rotation/complete`,
        { method: 'POST', body: JSON.stringify({ spaceId, keepCredentialId: rotationCandidate.id }) },
      );
      setAgent(value);
      setRotationAccess(value.credentialAccess ?? 'write');
      setRevealedToken(null);
    } catch (cause) {
      setError(displayIntegrationError(cause, '完成 Agent Token 轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelRotation() {
    if (!rotationCandidate) return;
    if (!window.confirm('取消本次 Agent Token 轮换？新 Token 会被撤销，旧 Token 继续有效。')) return;
    setBusy('cancel');
    setError(null);
    try {
      const value = await apiRequest<AgentAccess>(
        `/api/integrations/${encodeURIComponent(integrationId)}/agent/credential-rotation/cancel`,
        { method: 'POST', body: JSON.stringify({ spaceId, candidateCredentialId: rotationCandidate.id }) },
      );
      setAgent(value);
      setRotationAccess(value.credentialAccess ?? 'write');
      setRevealedToken(null);
    } catch (cause) {
      setError(displayIntegrationError(cause, '取消 Agent Token 轮换失败'));
    } finally {
      setBusy(null);
    }
  }

  async function removeAgent() {
    if (!agent) return;
    if (!window.confirm(`确认移除“${integrationName}”的 Agent 接入吗？当前家庭给这个 Agent 的直接权限和全部 Agent API Token 都会撤销。`)) return;
    setBusy('remove');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integrationId)}/agent/remove`, {
        method: 'POST',
        body: JSON.stringify({ spaceId }),
      });
      setAgent(null);
      setPermissions(emptyPermissions());
      setCredentialAccess('write');
      setRotationAccess('write');
      setRevealedToken(null);
      setEditingPermissions(false);
    } catch (cause) {
      setError(displayIntegrationError(cause, '移除 Agent 接入失败'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4" id="agent-access">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-violet-100 text-violet-800"><Bot className="size-4" /></span>
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Agent 接入</h2>
          <p className="mt-0.5 text-sm text-stone-500">给 AI Agent 签发独立身份，并配置它在当前家庭可以直接做什么。</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5 pt-6">
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {revealedToken && <AgentCredentialReveal token={revealedToken} spaceId={spaceId} onClose={() => setRevealedToken(null)} />}

          {loading ? (
            <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-stone-500"><LoaderCircle className="size-4 animate-spin" />正在加载 Agent 接入…</div>
          ) : !agent ? (
            <div className="space-y-5">
              <div className="rounded-2xl bg-violet-50/60 p-4 text-sm leading-6 text-violet-950/80">
                Agent API Token 用于证明 <strong>Agent 身份</strong>并限定它最多能调用读取还是读写能力；下面的“当前家庭直接权限”才决定它以 <strong>Principal=Agent / Actor=Agent</strong> 执行时实际能访问哪些模型。需要代表家庭成员执行额外操作时，仍可在运行时使用 User Delegation。
              </div>
              <div>
                <p className="text-sm font-semibold text-stone-800">Agent API 能力上限</p>
                <p className="mt-1 text-xs leading-5 text-stone-400">这是 Agent Token 的技术 Scope 上限，也适用于之后通过 User Delegation 执行的请求。</p>
                <select
                  className="mt-2 h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-700"
                  disabled={readOnly || busy !== null}
                  value={credentialAccess}
                  onChange={(event) => {
                    const next = event.target.value as CredentialAccess;
                    setCredentialAccess(next);
                    if (next === 'read') {
                      setPermissions((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value === 'write' ? 'read' : value])) as PermissionMap);
                    }
                  }}
                >
                  <option value="read">只读</option>
                  <option value="write">读取 + 写入</option>
                </select>
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">当前家庭直接权限</p>
                    <p className="mt-1 text-xs leading-5 text-stone-400">可以全部选“无权限”，此时 Agent 仅能通过用户运行时授权访问家庭数据。</p>
                  </div>
                  <span className="text-xs text-stone-400">LifeSpace Agent Data Grant</span>
                </div>
                <DirectPermissionEditor value={permissions} onChange={setPermissions} credentialAccess={credentialAccess} disabled={readOnly || busy !== null} />
              </div>
              {!readOnly && (
                <div className="flex justify-end border-t border-stone-100 pt-4">
                  <Button variant="primary" disabled={busy !== null} onClick={() => void createAgent()}>
                    {busy === 'create' ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />}创建 Agent 接入
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Agent Identity</p>
                  <p className="mt-1 font-medium text-stone-900">{agent.displayName}</p>
                  <code className="mt-1 block text-xs text-stone-400">{agent.id}</code>
                  <p className="mt-2 text-sm text-stone-600">Agent API 能力上限：<strong>{accessLabel(agent.credentialAccess)}</strong></p>
                  {currentCredential && (
                    <p className="mt-1 text-xs leading-5 text-stone-400">
                      {currentCredential.displayPrefix}…{currentCredential.suffix}
                      {' · '}创建 {formatIntegrationTime(currentCredential.createdAt)} · 最近使用 {formatIntegrationTime(currentCredential.lastUsedAt)}
                    </p>
                  )}
                </div>
                {!readOnly && !agent.rotationPending && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-stone-500">新 Token 能力上限
                      <select
                        className="mt-1 block h-9 rounded-xl border border-stone-200 bg-white px-2 text-sm text-stone-700"
                        disabled={busy !== null}
                        value={rotationAccess}
                        onChange={(event) => setRotationAccess(event.target.value as CredentialAccess)}
                      >
                        <option value="read">只读</option>
                        <option value="write">读取 + 写入</option>
                      </select>
                    </label>
                    <Button disabled={busy !== null} onClick={() => void startRotation()}>
                      {busy === 'rotate' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      {currentCredential ? '重新签发 Token' : '签发 Token'}
                    </Button>
                  </div>
                )}
              </div>

              {agent.rotationPending && rotationCandidate && (
                <div className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">
                  <p className="font-medium">新旧 Agent Token 暂时同时有效</p>
                  <p className="mt-1 leading-6">先在 Agent Runtime 中切换并完成真实请求验证。验证成功后完成轮换；失败则取消。</p>
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

              {agent.hasWholeSpaceGrant && (
                <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p>这个 Agent 存在当前家庭的 Space 级宽泛授权。HomeMew 只管理当前家庭的模型级 Agent Grant，因此这里保持只读；请先在 LifeSpace Console 中收敛宽泛授权。</p>
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">当前家庭直接权限</p>
                    <p className="mt-1 text-xs leading-5 text-stone-400">这些权限无需逐次用户授权；超出它们时可再走 User Delegation。</p>
                  </div>
                  {!readOnly && !agent.hasWholeSpaceGrant && !editingPermissions && (
                    <Button disabled={busy !== null || agent.rotationPending || !agent.credentialAccess} onClick={() => setEditingPermissions(true)}>编辑</Button>
                  )}
                </div>
                {editingPermissions && agent.credentialAccess ? (
                  <div className="space-y-3">
                    <DirectPermissionEditor value={permissions} onChange={setPermissions} credentialAccess={agent.credentialAccess} disabled={busy !== null} />
                    <div className="flex justify-end gap-2">
                      <Button disabled={busy !== null} onClick={() => {
                        setEditingPermissions(false);
                        setPermissions(agent.permissions);
                      }}>取消</Button>
                      <Button variant="primary" disabled={busy !== null} onClick={() => void savePermissions()}>
                        {busy === 'save' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存直接权限
                      </Button>
                    </div>
                  </div>
                ) : (
                  <PermissionSummary value={agent.effectivePermissions} />
                )}
              </div>

              <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-sky-700" />
                  <p className="text-sm leading-6 text-stone-600"><strong>Agent Connection</strong> 使用当前家庭的 Connection Base URL + <code>lsp_agt_*</code>。Agent API Token 是通用 Agent 凭据，不绑定单个 Space；HomeMew 这里只配置当前家庭的直接权限。</p>
                </div>
              </div>

              {!readOnly && (
                <div className="flex flex-col gap-3 border-t border-red-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">移除 Agent 接入</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">撤销这个 Agent 的全部 API Token 与当前家庭直接 Grant。稳定 Agent Identity 会作为无权限历史身份保留在 LifeSpace。</p>
                  </div>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => void removeAgent()}>
                    {busy === 'remove' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}移除 Agent 接入
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
