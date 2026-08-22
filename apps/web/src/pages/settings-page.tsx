import { ExternalLink, KeyRound, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/card';

const settings = [
  { icon: Users, title: '家庭与成员', description: '家庭资料、成员和角色权限。', to: '/family', enabled: true },
  { icon: ExternalLink, title: '外部系统', description: 'n8n、Agent、Webhook 与服务凭据。', to: '/settings/integrations', enabled: true },
  { icon: ShieldCheck, title: '权限与安全', description: '由 LifeSpace Space/Grant 作为最终授权依据。', enabled: false },
];

export function SettingsPage({ section }: { section?: 'integrations' }) {
  if (section === 'integrations') {
    return <IntegrationsPlaceholder />;
  }

  return (
    <div className="space-y-6">
      <div>
        <span className="grid size-11 place-items-center rounded-2xl bg-stone-200 text-stone-700"><Settings2 className="size-5" /></span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">设置</h1>
        <p className="mt-2 text-sm text-stone-500">家庭管理和 HomeMew 应用设置放在同一个产品里，不另建管理员站点。</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {settings.map(({ icon: Icon, title, description, to, enabled }) => {
          const content = (
            <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-md">
              <span className="grid size-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Icon className="size-5" /></span>
              <p className="mt-4 font-semibold text-stone-900">{title}</p>
              <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
              {!enabled ? <span className="mt-4 inline-block text-xs font-medium text-stone-400">后续阶段</span> : null}
            </Card>
          );
          return enabled && to ? <Link key={title} to={to}>{content}</Link> : <div key={title}>{content}</div>;
        })}
      </div>
    </div>
  );
}

function IntegrationsPlaceholder() {
  return (
    <div className="space-y-6">
      <div>
        <span className="grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-800"><KeyRound className="size-5" /></span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">外部系统</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">这里未来管理 n8n、Agent、Webhook 等家庭级集成。</p>
      </div>
      <Card className="border-amber-200 bg-amber-50/60 p-6 ring-amber-200">
        <p className="font-semibold text-amber-950">等待 LifeSpace 平台能力</p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-900/70">当前 LifeSpace 已有 Data Grant / service-principal 基础能力，但 HomeMew 所需的“家庭管理员为自己家庭创建服务主体并一次性领取凭据”的最终用户流程尚未批准。HomeMew 不会在这里另造一套凭据系统。</p>
      </Card>
    </div>
  );
}
