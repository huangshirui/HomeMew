import {
  Bot,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  Plus,
  Server,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useHousehold } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { Card, CardContent } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';
import { displayIntegrationError, type ExternalSystem } from '../lib/integrations';

function CapabilityBadge({ active, icon: Icon, children }: {
  active: boolean;
  icon: typeof Server;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-400'}`}>
      <Icon className="size-3" />
      {children}
    </span>
  );
}

function ExternalSystemListItem({ system }: { system: ExternalSystem }) {
  return (
    <Link to={`/settings/integrations/${encodeURIComponent(system.id)}`} className="block">
      <Card className="transition hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="flex items-center gap-4 py-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-800">
            <ExternalLink className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-stone-900">{system.displayName}</h2>
            <p className="mt-1 truncate text-sm text-stone-500">{system.description || '没有说明'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CapabilityBadge active={Boolean(system.servicePrincipalId)} icon={Server}>Service Access</CapabilityBadge>
              <CapabilityBadge active={Boolean(system.agentId)} icon={Bot}>Agent Access</CapabilityBadge>
              <CapabilityBadge active={Boolean(system.servicePrincipalId)} icon={Webhook}>Event Push 可配置</CapabilityBadge>
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
  const [systems, setSystems] = useState<ExternalSystem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const manager = currentFamily?.role === 'owner' || currentFamily?.role === 'admin';

  async function load() {
    if (!currentFamily || !manager) {
      setSystems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSystems(await apiRequest<ExternalSystem[]>(`/api/integrations?spaceId=${encodeURIComponent(currentFamily.id)}`));
    } catch (cause) {
      setError(displayIntegrationError(cause, '加载外部系统失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [currentFamily?.id, manager]);

  async function createSystem() {
    if (!currentFamily || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const system = await apiRequest<ExternalSystem>('/api/integrations', {
        method: 'POST',
        body: JSON.stringify({
          spaceId: currentFamily.id,
          displayName: name.trim(),
          description,
        }),
      });
      setName('');
      setDescription('');
      setShowCreate(false);
      navigate(`/settings/integrations/${encodeURIComponent(system.id)}`);
    } catch (cause) {
      setError(displayIntegrationError(cause, '创建外部系统失败'));
    } finally {
      setCreating(false);
    }
  }

  if (!currentFamily) {
    return <Card className="p-8 text-center text-sm text-stone-500">请先创建或加入一个家庭。</Card>;
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="外部系统">{manager ? <Button variant="primary" onClick={() => setShowCreate((value) => !value)}><Plus className="size-4" /> 新建外部系统</Button> : null}</PageHeader>

      {!manager && (
        <Card className="p-6">
          <div className="flex gap-3 text-sm leading-6 text-stone-600">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-stone-400" />
            <p>只有家庭所有者或管理员可以管理外部系统和它的接入能力。</p>
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
                这里只创建 HomeMew 的系统容器，不会自动创建 Service Principal、Agent、凭据、Data Grant 或 Webhook。
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block text-sm font-medium text-stone-700">
                名称
                <input
                  className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  maxLength={100}
                  placeholder="例如：家庭自动化平台"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block text-sm font-medium text-stone-700">
                说明
                <textarea
                  className="mt-2 min-h-24 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  maxLength={400}
                  placeholder="这个系统做什么、部署在哪里……"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
              <Button disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
              <Button variant="primary" disabled={creating || !name.trim()} onClick={() => void createSystem()}>
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                创建外部系统
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-stone-500">
          <LoaderCircle className="size-4 animate-spin" />正在加载外部系统…
        </div>
      ) : systems.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {systems.map((system) => <ExternalSystemListItem key={system.id} system={system} />)}
        </div>
      ) : manager ? (
        <Card className="p-8 text-center">
          <p className="font-medium text-stone-800">还没有外部系统</p>
          <p className="mt-2 text-sm text-stone-500">可以先创建自动化平台、后端服务、Agent Runtime 等系统，再逐项开启需要的接入能力。</p>
        </Card>
      ) : null}
    </div>
  );
}
