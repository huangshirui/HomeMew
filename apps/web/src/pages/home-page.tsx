import type { ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, Plus, Sparkles } from 'lucide-react';
import { browserAuthCapability } from '../lib/platform';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';

const events = [
  { time: '16:00', title: 'KK 足球训练', meta: '银都路 · KK', tone: 'bg-emerald-500' },
  { time: '18:30', title: '家庭晚餐', meta: '在家 · 全家', tone: 'bg-amber-400' },
  { time: '20:00', title: '准备明天比赛装备', meta: '爸爸、KK', tone: 'bg-sky-400' },
];

const tasks = [
  { title: '买牛奶和酸奶', meta: '今天 · 妈妈', done: false },
  { title: '缴电费', meta: '今天', done: false },
  { title: '给猫咪补驱虫药', meta: '本周', done: true },
];

function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

export function HomePage() {
  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">界面预览</span>
            <span className="text-xs text-stone-400">{browserAuthCapability.message}</span>
          </div>
          <p className="text-sm font-medium text-stone-400">{todayLabel()}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">下午好，今天家里有这些事。</h1>
        </div>
        <div className="flex gap-2">
          <Button><Plus className="size-4" /> 新建</Button>
          <Button variant="primary"><Sparkles className="size-4" /> 喵一下</Button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-stone-900">今天的日程</p>
              <p className="mt-1 text-xs text-stone-400">按家庭时区展示</p>
            </div>
            <Button variant="ghost" className="h-9 px-3">全部日程 <ArrowRight className="size-4" /></Button>
          </CardHeader>
          <CardContent className="space-y-1 pt-3">
            {events.map((event) => (
              <div key={event.time + event.title} className="group grid grid-cols-[54px_12px_1fr] items-start gap-3 rounded-2xl px-2 py-3 hover:bg-stone-50">
                <span className="pt-0.5 text-sm font-semibold tabular-nums text-stone-500">{event.time}</span>
                <span className={`mt-1.5 size-2.5 rounded-full ${event.tone}`} />
                <div>
                  <p className="text-sm font-semibold text-stone-900">{event.title}</p>
                  <p className="mt-1 text-xs text-stone-400">{event.meta}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-stone-900">待办</p>
              <p className="mt-1 text-xs text-stone-400">2 件今天需要完成</p>
            </div>
            <CheckSquareSummary />
          </CardHeader>
          <CardContent className="space-y-2 pt-3">
            {tasks.map((task) => (
              <div key={task.title} className="flex items-start gap-3 rounded-2xl p-2 hover:bg-stone-50">
                <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${task.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 bg-white'}`}>
                  {task.done ? <Check className="size-3" /> : null}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${task.done ? 'text-stone-400 line-through' : 'text-stone-800'}`}>{task.title}</p>
                  <p className="mt-1 text-xs text-stone-400">{task.meta}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MiniCard icon={<Clock3 className="size-5" />} label="最近的日子" value="妈妈生日" detail="还有 12 天" />
        <MiniCard icon={<CalendarDays className="size-5" />} label="本周" value="7 个家庭日程" detail="周日最忙" />
        <MiniCard icon={<Sparkles className="size-5" />} label="家庭动态" value="3 件新变化" detail="查看最近更新" />
      </section>
    </div>
  );
}

function CheckSquareSummary() {
  return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">1 / 3</span>;
}

function MiniCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-2xl bg-stone-100 text-stone-600">{icon}</span>
        <ArrowRight className="size-4 text-stone-300" />
      </div>
      <p className="mt-5 text-xs font-medium text-stone-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-900">{value}</p>
      <p className="mt-1 text-sm text-stone-500">{detail}</p>
    </Card>
  );
}
