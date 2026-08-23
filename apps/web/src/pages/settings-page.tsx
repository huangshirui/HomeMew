import { ExternalLink, KeyRound, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHousehold } from '../components/household-provider';
import { Card } from '../components/ui/card';

const settings = [
  { icon: Users, title: '家庭与成员', description: '家庭资料、成员和角色权限。', to: '/family', enabled: true },
  { icon: ExternalLink, title: '外部系统', description: '优先建设：n8n、Agent 与长期 API Token。', to: '/settings/integrations', enabled: true },
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

function IntegrationsPage() {
  const { currentFamily } = useHousehold();
  return (
    <div className="space-y-6">
      <div>
        <span className="grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-800"><KeyRound className="size-5" /></span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">外部系统</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{currentFamily ? `为“${currentFamily.name}”管理 n8n、Agent、脚本等服务访问。` : '请选择一个家庭后管理外部系统。'}</p>
      </div>

      <Card className="p-6">
        <p className="font-semibold text-stone-900">第一版目标</p>
        <div className="mt-4 grid gap-3 text-sm text-stone-600 sm:grid-cols-2">
          <div className="rounded-2xl bg-stone-50 p-4"><strong className="text-stone-800">固定 API Token</strong><p className="mt-1 leading-6">默认签发可撤销的 `lsp_pat_*`，n8n 直接使用 Header Auth，不增加每次请求前的 OAuth 换票。</p></div>
          <div className="rounded-2xl bg-stone-50 p-4"><strong className="text-stone-800">最小权限</strong><p className="mt-1 leading-6">每个外部系统独立 Service Principal、独立凭据，并只获得当前家庭和明确选择的模型权限。</p></div>
          <div className="rounded-2xl bg-stone-50 p-4"><strong className="text-stone-800">安全轮换</strong><p className="mt-1 leading-6">新 Token 明文只展示一次；允许新旧凭据短暂并存后撤销旧 Token。</p></div>
          <div className="rounded-2xl bg-stone-50 p-4"><strong className="text-stone-800">LifeSpace 授权</strong><p className="mt-1 leading-6">HomeMew 不保存权限副本，Service Principal、Token 与 Data Grant 都由 LifeSpace 作为权威。</p></div>
        </div>
      </Card>

      <Card className="border-amber-200 bg-amber-50/60 p-6 ring-amber-200">
        <p className="font-semibold text-amber-950">只差一个平台契约点即可开工</p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-900/75">LifeSpace 已经支持 Service Principal、长期 API Token，以及家庭管理员创建/修改/撤销 Data Grant。当前缺口是 Data Grant 的产品 API 只能授予整个 Space 的 `read/write`，还不能表达“仅 event 写、task 读、day_record 不允许”这种按模型 collection 的授权。为避免给外部系统过宽权限，这里暂不签发 Token。</p>
      </Card>
    </div>
  );
}
