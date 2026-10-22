import { ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '../components/ui/page-header';
import { Link } from '../components/environment-navigation';
import { Card } from '../components/ui/card';
import { IntegrationsPage } from './integrations-page';

const settings = [
  { icon: Users, title: '家庭与成员', description: '家庭资料、成员和角色权限。', to: '/family', enabled: true },
  { icon: ExternalLink, title: '外部系统', description: '管理自动化平台、Agent、脚本、后端服务等系统的认证、事件订阅和后续对接能力。', to: '/settings/integrations', enabled: true },
  { icon: ShieldCheck, title: '权限与安全', description: '由 LifeSpace Space/Data Grant 作为最终授权依据。', enabled: false },
];

export function SettingsPage({ section }: { section?: 'integrations' }) {
  if (section === 'integrations') {
    return <IntegrationsPage />;
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="设置" />

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
