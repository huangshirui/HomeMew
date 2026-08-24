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

type ServiceToken = {
  id: string;
  displayPrefix: string;
  lastFour: string;
  label: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
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
  tokens: ServiceToken[];
};

type RevealedToken = {
  integrationName: string;
  token: string;
};

function formatTime(value: string | null) {
  if (!value) return '从未';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
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
  return cause instanceof Error ? cause.message : fallback;
}

function PermissionEditor({
  value,
  onChange,
  disabled = false,
}: {
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

function TokenReveal({ value, onClose }: { value: RevealedToken; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/70 ring-emerald-200">
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-emerald-700 ring-1 ring-emerald-200">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-emerald-950">{value.integrationName} 的新 API Token</p>
            <p className="mt-1 text-sm leading-6 text-emerald-900/70">明文只会出现这一次。复制到 n8n、脚本或密钥管理器后关闭此卡片。</p>
            <code className="mt-4 block select-all break-all rounded-2xl bg-white p-4 text-sm text-emerald-950 ring-1 ring-emerald-200">{value.token}</code>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied ? '已复制' : '复制 Token'}
              </Button>
              <Button onClick={onClose}>我已保存，关闭</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationCard({
  integration,
  spaceId,
  onChanged,
  onReveal,
}: {
  integration: Integration;
  spaceId: string;
  onChanged: () => Promise<void>;
  onReveal: (value: RevealedToken) => void;
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

  const activeTokens = useMemo(() => integration.tokens.filter((token) => !token.revokedAt), [integration.tokens]);
  const bound = integration.bindingStatus === 'bound';
  const editable = bound && integration.status === 'active';

  async function save() {
    setBusy('save');
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ spaceId, displayName: name, description, permissions }),
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '保存外部系统失败'));
    } finally {
      setBusy(null);
    }
  }

  async function rotateToken() {
    setBusy('token');
    setError(null);
    try {
      const result = await apiRequest<{ token: string | null }>(`/api/integrations/${encodeURIComponent(integration.id)}/tokens`, {
        method: 'POST',
        body: JSON.stringify({ spaceId, label: `${integration.displayName} API Token` }),
      });
      if (result.token) onReveal({ integrationName: integration.displayName, token: result.token });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '创建 Token 失败'));
    } finally {
      setBusy(null);
    }
  }

  async function revokeToken(token: ServiceToken) {
    if (!window.confirm(`确认撤销“${token.label}”吗？撤销后使用它的自动化会立即失效。`)) return;
    setBusy(token.id);
    setError(null);
    try {
      await apiRequest(`/api/integrations/${encodeURIComponent(integration.id)}/tokens/${encodeURIComponent(token.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ spaceId }),
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '撤销 Token 失败'));
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!window.confirm(`确认禁用“${integration.displayName}”吗？系统会先禁用 Service Principal，并尝试撤销当前家庭授权和有效 Token。`)) return;
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
              {integration.hasWholeSpaceGrant && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">含旧 Space 级授权</span>
              )}
            </div>
            <p className="mt-1 text-sm text-stone-500">{integration.description || '没有说明'}</p>
          </div>
          {editable && (
            <Button disabled={busy !== null} onClick={() => void rotateToken()}>
              {busy === 'token' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              新建 Token
            </Button>
          )}
        </div>

        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {!bound && (
          <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>这是授权迁移前创建的 Service Principal，目前只有“它曾被当前家庭授权”的证据，没有“当前家庭拥有其全局凭据管理权”的明确绑定。为了避免跨家庭误操作，本页只显示当前家庭的 Grant，不读取或修改 Token，也不能编辑、禁用。后续需要通过受控迁移补上家庭归属。</p>
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
            <p>这个系统仍包含迁移前的 Space 级宽泛读取授权。该授权会成为模型读取的兜底权限，因此页面不会假装它已经是精细授权；本版先保持原权限不变，精细调整需要先完成一次明确的旧授权收敛。</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-stone-800">API Token</p>
            {bound && <span className="text-xs text-stone-400">{activeTokens.length} 个有效</span>}
          </div>
          {!bound ? (
            <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">为避免把其他 Space 的全局凭据暴露给当前家庭，迁移旧系统在建立明确归属前不展示 Token 元数据。</p>
          ) : (
            <div className="mt-3 grid gap-2">
              {integration.tokens.length === 0 && <p className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">还没有 Token。</p>}
              {integration.tokens.map((token) => (
                <div key={token.id} className="flex flex-col gap-3 rounded-2xl bg-stone-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800">{token.label}</p>
                    <p className="mt-1 text-xs text-stone-400">
                      {token.displayPrefix}…{token.lastFour} · 创建 {formatTime(token.createdAt)} · 最近使用 {formatTime(token.lastUsedAt)}
                      {token.revokedAt ? ` · 已撤销 ${formatTime(token.revokedAt)}` : ''}
                    </p>
                  </div>
                  {!token.revokedAt && editable && (
                    <Button size="icon" variant="ghost" disabled={busy !== null} aria-label="撤销 Token" onClick={() => void revokeToken(token)}>
                      {busy === token.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-400">有效权限 = Token scope ∩ Application × Model Access ∩ 当前家庭 Data Grant。</p>
            <div className="flex gap-2">
              <Button disabled={busy !== null || integration.hasWholeSpaceGrant} onClick={() => void save()}>
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
  const [revealedToken, setRevealedToken] = useState<RevealedToken | null>(null);

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
      const result = await apiRequest<{ integration: Integration; token: string | null }>('/api/integrations', {
        method: 'POST',
        body: JSON.stringify({
          spaceId: currentFamily.id,
          displayName: name,
          description,
          permissions,
        }),
      });
      if (result.token) setRevealedToken({ integrationName: result.integration.displayName, token: result.token });
      setName('');
      setDescription('');
      setPermissions({ event: 'write', task: 'write', day_record: 'read' });
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
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">为“{currentFamily.name}”管理 n8n、Agent、脚本等服务访问。凭据和权限都由 LifeSpace 权威管理，HomeMew 不保存密钥副本。</p>
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
            <p>只有家庭所有者或管理员可以管理外部系统、Data Grant 和 API Token。</p>
          </div>
        </Card>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {revealedToken && <TokenReveal value={revealedToken} onClose={() => setRevealedToken(null)} />}

      {manager && showCreate && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">新建外部系统</h2>
              <p className="mt-1 text-sm text-stone-500">每个系统拥有独立 Service Principal、独立 Token、明确的家庭管理归属和独立模型授权。</p>
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
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-stone-700">模型权限</p>
                <PermissionEditor value={permissions} onChange={setPermissions} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
              <p className="text-xs leading-5 text-stone-400">创建后默认签发一个长期、可随时撤销的 `lsp_pat_*` Token；明文只展示一次。</p>
              <div className="flex gap-2">
                <Button disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
                <Button variant="primary" disabled={creating || !name.trim() || !Object.values(permissions).some(Boolean)} onClick={() => void createIntegration()}>
                  {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  创建并签发 Token
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
          onReveal={setRevealedToken}
        />
      ))}
    </div>
  );
}
