import { ExternalLink, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/card';
import { IntegrationsPage } from './integrations-page';

const settings = [
  { icon: Users, title: '家庭与成员', description: '家庭资料、成员和角色权限。', to: '/family', enabled: true },
  { icon: ExternalLink, title: '外部系统', description: 'n8n、Agent、脚本的 API Token / OAuth 接入。', to: '/settings/integrations', enabled: true },
  { icon: ShieldCheck, title: '权限与安全', description: '由 LifeSpace Space/Data Grant 作为最终授权依据。', enabled: false },
];

export function SettingsPage({ section }: { section?: 'integrations' }) {
  if (section === 'integrations') {
    return <IntegrationsPage />;
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
