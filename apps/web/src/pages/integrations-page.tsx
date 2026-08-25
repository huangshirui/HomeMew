import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';
import { bufferIntegrationCredential } from '../lib/integration-secret-buffer';
import {
  credentialModeLabel,
  displayIntegrationError,
  integrationModels,
  permissionLabel,
  type CredentialMode,
  type CredentialSecret,
  type Integration,
  type PermissionMap,
  type RevealedCredential,
} from '../lib/integrations';

function PermissionEditor({ value, onChange }: {
  value: PermissionMap;
  onChange: (value: PermissionMap) => void;
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
            className="h-9 shrink-0 rounded-xl border border-stone-200 bg-white px-2 text-sm text-stone-700"
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

function IntegrationListItem({ integration }: { integration: Integration }) {
  const permissionSummary = integrationModels
    .filter((model) => integration.effectivePermissions[model.key])
    .map((model) => `${model.label}·${permissionLabel(integration.effectivePermissions[model.key])}`)
    .join('  ·  ');

  return (
    <Link to={`/settings/integrations/${encodeURIComponent(integration.id)}`} className="block">
      <Card className="transition hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="flex items-center gap-4 py-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-800">
            <ExternalLink className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold text-stone-900">{integration.displayName}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${integration.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                {integration.status === 'active' ? '启用中' : '已禁用'}
              </span>
              {integration.bindingStatus === 'legacy_unbound' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">迁移旧系统 · 只读</span>
              )}
              {integration.rotationPending && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">凭据轮换中</span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-stone-500">{integration.description || '没有说明'}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
              <span>{credentialModeLabel(integration.credentialMode)}</span>
              <span>{integration.hasWholeSpaceGrant ? '含旧 Space 级授权' : permissionSummary || '无模型授权'}</span>
            </div>
          </div>
          <ChevronRight className="size-5 shrink-0 text-stone-300" />
        </CardContent>
      </Card>
    </Link>
  );
}

export function IntegrationsPage() {
  const { currentFamily } = useHousehold();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionMap>({ event: 'write', task: 'write', day_record: 'read' });
  const [credentialMode, setCredentialMode] = useState<CredentialMode>('api_token');

  const manager = currentFamily?.role === 'owner' || currentFamily?.role === 'admin';

  async function load() {
    if (!currentFamily || !manager) {
      setIntegrations([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setIntegrations(await apiRequest<Integration[]>(`/api/integrations?spaceId=${encodeURIComponent(currentFamily.id)}`));
    } catch (cause) {
      setError(displayIntegrationError(cause, '加载外部系统失败'));
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

      let revealedCredential: RevealedCredential | null = null;
      if (result.credential.type === 'api_token' && result.credential.token) {
        revealedCredential = {
          integrationName: result.integration.displayName,
          type: 'api_token',
          token: result.credential.token,
        };
      }
      if (result.credential.type === 'oauth_client_credentials' && result.credential.clientSecret) {
        revealedCredential = {
          integrationName: result.integration.displayName,
          type: 'oauth_client_credentials',
          clientId: result.credential.clientId,
          clientSecret: result.credential.clientSecret,
        };
      }
      if (revealedCredential) bufferIntegrationCredential(result.integration.id, revealedCredential);

      setName('');
      setDescription('');
      setPermissions({ event: 'write', task: 'write', day_record: 'read' });
      setCredentialMode('api_token');
      setShowCreate(false);
      navigate(`/settings/integrations/${encodeURIComponent(result.integration.id)}`);
    } catch (cause) {
      setError(displayIntegrationError(cause, '创建外部系统失败'));
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
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            管理“{currentFamily.name}”连接的 n8n、Agent、脚本等服务。这里保留系统级摘要；认证、事件订阅和后续对接能力都进入具体系统后配置。
          </p>
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
            <p>只有家庭所有者或管理员可以管理外部系统、Data Grant、服务凭据和事件订阅。</p>
          </div>
        </Card>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {manager && showCreate && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">新建外部系统</h2>
              <p className="mt-1 text-sm leading-6 text-stone-500">
                创建后会进入该系统的详情页。每个系统拥有独立 Service Principal、家庭数据授权和事件订阅。
              </p>
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
                <p className="mb-3 text-sm font-medium text-stone-700">数据访问</p>
                <PermissionEditor value={permissions} onChange={setPermissions} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
              <div className="flex max-w-xl gap-2 text-xs leading-5 text-stone-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>首次凭据明文只展示一次。创建成功后会直接进入详情页，请在那里复制并保存。</p>
              </div>
              <div className="flex gap-2">
                <Button disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
                <Button
                  variant="primary"
                  disabled={creating || !name.trim() || !Object.values(permissions).some(Boolean)}
                  onClick={() => void createIntegration()}
                >
                  {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  创建外部系统
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {manager && loading && (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-stone-500">
          <LoaderCircle className="size-5 animate-spin" /> 正在加载外部系统…
        </div>
      )}

      {manager && !loading && integrations.length === 0 && !error && (
        <Card className="p-8 text-center">
          <KeyRound className="mx-auto size-8 text-stone-300" />
          <p className="mt-4 font-medium text-stone-800">还没有外部系统</p>
          <p className="mt-1 text-sm text-stone-500">为 n8n、Agent 或私有脚本创建一个独立访问身份。</p>
        </Card>
      )}

      {manager && !loading && integrations.length > 0 && (
        <div className="space-y-3">
          {integrations.map((integration) => <IntegrationListItem key={integration.id} integration={integration} />)}
        </div>
      )}
    </div>
  );
}
