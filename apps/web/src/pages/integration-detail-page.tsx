import {
  ArrowLeft,
  Bot,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Save,
  Server,
  Webhook,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';
import { displayIntegrationError, type ExternalSystem } from '../lib/integrations';
import { AgentAccessSection } from './agent-access-section';
import { EventSubscriptionsSection } from './event-subscriptions-page';
import { ServiceAccessSection } from './service-access-section';

function CapabilitySummary({ system }: { system: ExternalSystem }) {
  const capabilities = [
    { label: 'Service Access', active: Boolean(system.servicePrincipalId), icon: Server },
    { label: 'Agent Access', active: Boolean(system.agentId), icon: Bot },
    { label: 'Event Push', active: Boolean(system.servicePrincipalId), icon: Webhook, dependent: true },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {capabilities.map(({ label, active, icon: Icon, dependent }) => (
        <div key={label} className={`rounded-2xl border p-4 ${active ? 'border-emerald-100 bg-emerald-50/50' : 'border-stone-100 bg-stone-50'}`}>
          <div className="flex items-center gap-2">
            <Icon className={`size-4 ${active ? 'text-emerald-700' : 'text-stone-400'}`} />
            <p className="text-sm font-semibold text-stone-900">{label}</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-stone-500">
            {active ? (dependent ? '可配置' : '已配置') : (dependent ? '需要先配置 Service Access' : '未配置')}
          </p>
        </div>
      ))}
    </div>
  );
}

export function IntegrationDetailPage() {
  const { integrationId = '' } = useParams();
  const { currentFamily } = useHousehold();
  const [system, setSystem] = useState<ExternalSystem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const manager = currentFamily?.role === 'owner' || currentFamily?.role === 'admin';

  async function load({ preserveContent = false }: { preserveContent?: boolean } = {}) {
    if (!currentFamily || !manager || !integrationId) {
      setSystem(null);
      setLoading(false);
      return;
    }
    if (!preserveContent) setLoading(true);
    setError(null);
    try {
      const value = await apiRequest<ExternalSystem>(
        `/api/integrations/${encodeURIComponent(integrationId)}?spaceId=${encodeURIComponent(currentFamily.id)}`,
      );
      setSystem(value);
      setName(value.displayName);
      setDescription(value.description ?? '');
    } catch (cause) {
      setError(displayIntegrationError(cause, '加载外部系统失败'));
      if (!preserveContent) setSystem(null);
    } finally {
      if (!preserveContent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [currentFamily?.id, manager, integrationId]);

  async function saveMetadata() {
    if (!currentFamily || !system || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const value = await apiRequest<ExternalSystem>(`/api/integrations/${encodeURIComponent(system.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          spaceId: currentFamily.id,
          displayName: name.trim(),
          description,
        }),
      });
      setSystem(value);
      setName(value.displayName);
      setDescription(value.description ?? '');
      setEditing(false);
    } catch (cause) {
      setError(displayIntegrationError(cause, '保存外部系统信息失败'));
    } finally {
      setBusy(false);
    }
  }

  if (!currentFamily) return <Card className="p-8 text-center text-sm text-stone-500">请先创建或加入一个家庭。</Card>;
  if (!manager) return <Card className="p-8 text-center text-sm text-stone-500">只有家庭所有者或管理员可以管理外部系统。</Card>;

  return (
    <div className="space-y-7">
      <Link to="/settings/integrations" className="inline-flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-800">
        <ArrowLeft className="size-4" />返回外部系统
      </Link>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-stone-500"><LoaderCircle className="size-4 animate-spin" />正在加载外部系统…</div>
      ) : !system ? (
        <Card className="p-8 text-center text-sm text-stone-500">找不到这个外部系统，或者它已经不属于当前家庭。</Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <span className="grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-800"><ExternalLink className="size-5" /></span>
                  <h1 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">{system.displayName}</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{system.description || '没有说明'}</p>
                  <code className="mt-2 block text-xs text-stone-400">{system.id}</code>
                </div>
                {!editing && <Button onClick={() => setEditing(true)}><Pencil className="size-4" />编辑基本信息</Button>}
              </div>

              {editing && (
                <div className="grid gap-4 rounded-2xl bg-stone-50 p-4 lg:grid-cols-2">
                  <label className="text-sm font-medium text-stone-700">名称
                    <input
                      className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      maxLength={100}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="text-sm font-medium text-stone-700">说明
                    <textarea
                      className="mt-2 min-h-24 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      maxLength={400}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                  <div className="flex justify-end gap-2 lg:col-span-2">
                    <Button disabled={busy} onClick={() => {
                      setName(system.displayName);
                      setDescription(system.description ?? '');
                      setEditing(false);
                    }}>取消</Button>
                    <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void saveMetadata()}>
                      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存
                    </Button>
                  </div>
                </div>
              )}

              <div className="border-t border-stone-100 pt-5">
                <p className="mb-3 text-sm font-semibold text-stone-800">接入能力</p>
                <CapabilitySummary system={system} />
              </div>
            </CardContent>
          </Card>

          <ServiceAccessSection
            spaceId={currentFamily.id}
            externalSystemId={system.id}
            systemName={system.displayName}
            readOnly={!manager}
            onBindingChanged={() => load({ preserveContent: true })}
          />

          <AgentAccessSection
            spaceId={currentFamily.id}
            integrationId={system.id}
            integrationName={system.displayName}
            readOnly={!manager}
          />

          {system.servicePrincipalId ? (
            <EventSubscriptionsSection
              spaceId={currentFamily.id}
              familyName={currentFamily.name}
              subscriberServicePrincipalId={system.servicePrincipalId}
              integrationName={system.displayName}
              readOnly={!manager}
            />
          ) : (
            <section className="space-y-4" id="event-subscriptions">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl bg-sky-100 text-sky-800"><Webhook className="size-4" /></span>
                <div>
                  <h2 className="text-xl font-semibold text-stone-900">Event Push</h2>
                  <p className="mt-0.5 text-sm text-stone-500">LifeSpace 主动把业务变化推送到这个外部系统。</p>
                </div>
              </div>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm font-semibold text-stone-900">需要先配置 Service Access</p>
                  <p className="mt-2 text-sm leading-6 text-stone-500">
                    当前 LifeSpace Webhook Endpoint 必须绑定一个 subscriber Service Principal，用它在投递前重新检查模型读取权限。因此 HomeMew 不会为了 Webhook 偷偷创建 Service Principal；请先显式创建上面的 Service Access。
                  </p>
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
