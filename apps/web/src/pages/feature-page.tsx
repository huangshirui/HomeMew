import { CalendarDays, CheckSquare2, Clock3, Heart, Plus, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

const pageCopy = {
  calendar: {
    title: '家庭日程',
    description: '把每个人的安排放到一张清楚的家庭日历里。',
    icon: CalendarDays,
    hint: '下一步接入 Schedule-X 与 LifeSpace Calendar/event capability。',
  },
  tasks: {
    title: '家庭待办',
    description: '今天、逾期和接下来要做的事情，一眼看清。',
    icon: CheckSquare2,
    hint: '下一步接入 LifeSpace task Actions，并保留乐观并发版本控制。',
  },
  days: {
    title: '日子',
    description: '纪念日、倒数日和周期性的家庭时间提醒。',
    icon: Clock3,
    hint: '下一步映射 LifeSpace day_record / Temporal capability。',
  },
  wishes: {
    title: '许愿池',
    description: '一家人的小愿望，放在这里慢慢实现。',
    icon: Heart,
    hint: '下一步接入 LifeSpace wish 模型及其生命周期 Actions。',
  },
  family: {
    title: '我们的家',
    description: '成员、家庭资料和角色权限的统一入口。',
    icon: Users,
    hint: '下一步接入 LifeSpace Space(kind=family) 与成员/Person 映射。',
  },
} as const;

type FeatureKind = keyof typeof pageCopy;

export function FeaturePage({ kind }: { kind: FeatureKind }) {
  const page = pageCopy[kind];
  const Icon = page.icon;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><Icon className="size-5" /></span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-stone-950">{page.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{page.description}</p>
        </div>
        <Button variant="primary"><Plus className="size-4" /> 新建</Button>
      </div>
      <Card className="grid min-h-[360px] place-items-center p-8 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid size-14 place-items-center rounded-3xl bg-stone-100 text-stone-500"><Icon className="size-6" /></div>
          <p className="mt-5 font-semibold text-stone-800">产品壳已经就位</p>
          <p className="mt-2 text-sm leading-6 text-stone-500">{page.hint}</p>
          <p className="mt-3 text-xs text-stone-400">当前不创建本地业务数据，也不伪造 LifeSpace 登录。</p>
        </div>
      </Card>
    </div>
  );
}
