import {
  Activity,
  BellRing,
  Check,
  Clipboard,
  FlaskConical,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ApiError, apiRequest } from '../lib/api-client';

type EventType = 'record.created' | 'record.updated' | 'record.deleted';
type SubscriptionModelKey = 'event' | 'task';

type EventSubscription = {
  id: string;
  spaceId: string;
  subscriberServicePrincipalId: string;
  name: string;
  modelKey: string;
  eventTypes: EventType[];
  destination: { type: 'webhook'; url: string };
  enabled: boolean;
  signingConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

type EventDelivery = {
  id: string;
  eventId: string;
  eventType: EventType;
  recordId: string;
  recordVersion: number;
  occurredAt: string;
  status: 'pending' | 'queued' | 'succeeded' | 'failed' | 'cancelled';
  attemptCount: number;
  deliveredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
};

type SecretReveal = {
  subscriptionName: string;
  signingSecret: string;
};

const eventOptions: { key: EventType; label: string }[] = [
  { key: 'record.created', label: '创建' },
  { key: 'record.updated', label: '修改' },
  { key: 'record.deleted', label: '删除' },
];

const modelOptions: {
  key: SubscriptionModelKey;
  label: string;
  description: string;
  defaultName: string;
  webhookPlaceholder: string;
}[] = [
  {
    key: 'event',
    label: '日程',
    description: '家庭日程的创建、修改和删除变化',
    defaultName: '日程变化通知',
    webhookPlaceholder: 'https://n8n.example.com/webhook/calendar',
  },
  {
    key: 'task',
    label: '待办',
    description: '家庭待办的创建、修改和删除变化',
    defaultName: '待办变化通知',
    webhookPlaceholder: 'https://n8n.example.com/webhook/tasks',
  },
];

const supportedModelKeys = new Set<SubscriptionModelKey>(modelOptions.map((item) => item.key));

function getModelOption(modelKey: string) {
  return modelOptions.find((item) => item.key === modelKey);
}

function modelLabel(modelKey: string) {
  return getModelOption(modelKey)?.label ?? modelKey;
}

function formatTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function eventLabel(type: EventType) {
  return eventOptions.find((item) => item.key === type)?.label ?? type;
}

function displayError(cause: unknown, fallback: string, modelKey?: string) {
  const target = modelKey ? modelLabel(modelKey) : '所选模型';
  if (cause instanceof ApiError && cause.code === 'FORBIDDEN') return '当前账号没有这个家庭的事件订阅管理权限。';
  if (cause instanceof ApiError && cause.code === 'INVALID_WEBHOOK_URL') return 'Webhook 必须是可公开访问的 HTTPS 地址。';
  if (cause instanceof ApiError && cause.code === 'MODEL_ACCESS_DENIED') return `HomeMew 当前没有${target}模型的读取权限，暂时不能创建订阅。`;
  if (cause instanceof ApiError && cause.code === 'EVENT_SUBSCRIBER_ACCESS_DENIED') return `这个外部系统当前没有${target}读取权限。请先在“认证与数据访问”中授予${target}只读或读写权限。`;
  return cause instanceof Error ? cause.message : fallback;
}

function EventTypePicker({ value, onChange, disabled = false }: {
  value: EventType[];
  onChange: (value: EventType[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {eventOptions.map((option) => {
        const checked = value.includes(option.key);
        return (
          <label key={option.key} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'} ${checked ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-500'}`}>
            <input
              className="size-4 accent-emerald-600"
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(checked ? value.filter((item) => item !== option.key) : [...value, option.key])}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

function ModelPicker({ value, onChange }: {
  value: SubscriptionModelKey;
  onChange: (value: SubscriptionModelKey) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {modelOptions.map((option) => {
        const checked = value === option.key;
        return (
          <label key={option.key} className={`cursor-pointer rounded-2xl border p-4 transition ${checked ? 'border-sky-200 bg-sky-50 ring-2 ring-sky-100' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
            <span className="flex items-start gap-3">
              <input
                className="mt-1 size-4 accent-sky-600"
                type="radio"
                name="subscription-model"
                value={option.key}
                checked={checked}
                onChange={() => onChange(option.key)}
              />
              <span>
                <span className="block text-sm font-semibold text-stone-900">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-stone-500">{option.description}</span>
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SecretRevealCard({ value, onClose }: { value: SecretReveal; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value.signingSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/70 ring-emerald-200">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-emerald-700 ring-1 ring-emerald-200">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-emerald-950">{value.subscriptionName} 的签名密钥</p>
            <p className="mt-1 text-sm leading-6 text-emerald-900/70">明文只会在创建或重新生成时返回。请保存到 n8n 或接收服务的 Secret 中。</p>
          </div>
        </div>
        <code className="block select-all break-all rounded-2xl bg-white p-4 text-sm text-emerald-950 ring-1 ring-emerald-200">{value.signingSecret}</code>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
            {copied ? '已复制' : '复制签名密钥'}
          </Button>
          <Button onClick={onClose}>我已保存</Button>
        </div>
        <p className="text-xs leading-5 text-emerald-900/70">验证方式：HMAC-SHA256(timestamp + "." + rawBody)，请求头为 X-LifeSpace-Timestamp 与 X-LifeSpace-Signature。</p>
      </CardContent>
    </Card>
  );
}

function DeliveryList({ subscriptionId }: { subscriptionId: string }) {
  const [items, setItems] = useState<EventDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiRequest<{ items: EventDelivery[] }>(`/api/lifespace/core/v1/event-subscriptions/${encodeURIComponent(subscriptionId)}/deliveries`)
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((cause) => {
        if (active) setError(displayError(cause, '加载投递记录失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [subscriptionId]);

  if (loading) return <p className="py-3 text-sm text-stone-400">正在加载最近投递…</p>;
  if (error) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!items.length) return <p className="py-3 text-sm text-stone-400">还没有真实事件投递记录。</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-100">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-400">
          <tr>
            <th className="px-3 py-2 font-medium">时间</th>
            <th className="px-3 py-2 font-medium">变化</th>
            <th className="px-3 py-2 font-medium">记录</th>
            <th className="px-3 py-2 font-medium">结果</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="whitespace-nowrap px-3 py-2 text-stone-500">{formatTime(item.occurredAt)}</td>
              <td className="px-3 py-2 text-stone-700">{eventLabel(item.eventType)}</td>
              <td className="px-3 py-2"><code className="text-xs text-stone-500">{item.recordId}</code></td>
              <td className="px-3 py-2">
                <span className={item.status === 'succeeded' ? 'text-emerald-700' : item.status === 'failed' ? 'text-red-700' : 'text-stone-500'}>
                  {item.status === 'succeeded'
                    ? `成功 · ${item.lastStatusCode ?? 200}`
                    : item.status === 'failed'
                      ? `失败 · ${item.lastStatusCode ?? '网络'}`
                      : item.status === 'cancelled'
                        ? '已取消'
                        : item.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionCard({ value, readOnly, onChanged, onReveal }: {
  value: EventSubscription;
  readOnly: boolean;
  onChanged: () => Promise<void>;
  onReveal: (value: SecretReveal) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(value.name);
  const [webhookUrl, setWebhookUrl] = useState(value.destination.url);
  const [eventTypes, setEventTypes] = useState<EventType[]>(value.eventTypes);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const model = modelLabel(value.modelKey);

  useEffect(() => {
    setName(value.name);
    setWebhookUrl(value.destination.url);
    setEventTypes(value.eventTypes);
  }, [value]);

  async function patch(body: Record<string, unknown>, action: string) {
    setBusy(action);
    setError(null);
    try {
      const updated = await apiRequest<EventSubscription & { signingSecret?: string }>(`/api/lifespace/core/v1/event-subscriptions/${encodeURIComponent(value.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (updated.signingSecret) onReveal({ subscriptionName: updated.name, signingSecret: updated.signingSecret });
      await onChanged();
      return true;
    } catch (cause) {
      setError(displayError(cause, '更新订阅失败', value.modelKey));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!name.trim() || !webhookUrl.trim() || !eventTypes.length) {
      setError('名称、Webhook URL 和至少一种变化类型都是必填项。');
      return;
    }
    if (await patch({ name: name.trim(), webhookUrl: webhookUrl.trim(), eventTypes }, 'save')) setEditing(false);
  }

  async function test() {
    setBusy('test');
    setError(null);
    try {
      const result = await apiRequest<{ ok: boolean; statusCode: number }>(`/api/lifespace/core/v1/event-subscriptions/${encodeURIComponent(value.id)}/test`, {
        method: 'POST',
        body: '{}',
      });
      if (!result.ok) setError(`Webhook 已连接，但接收端返回 HTTP ${result.statusCode}。`);
      else window.alert(`测试事件发送成功，接收端返回 HTTP ${result.statusCode}。`);
    } catch (cause) {
      setError(displayError(cause, '测试发送失败', value.modelKey));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`确认删除“${value.name}”吗？删除后不会再发送新的事件。`)) return;
    setBusy('delete');
    setError(null);
    try {
      await fetch(`/api/lifespace/core/v1/event-subscriptions/${encodeURIComponent(value.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new ApiError(payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.message ?? '删除订阅失败', payload?.error?.requestId, response.status);
        }
      });
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '删除订阅失败', value.modelKey));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-stone-900">{value.name}</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${value.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{value.enabled ? '启用' : '已停用'}</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{model}</span>
            </div>
            <p className="mt-1 break-all text-sm text-stone-500">{value.destination.url}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button disabled={busy !== null} onClick={() => void test()}>
                {busy === 'test' ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                测试
              </Button>
            )}
            {!readOnly && <Button disabled={busy !== null} onClick={() => setEditing((current) => !current)}><Pencil className="size-4" />编辑</Button>}
          </div>
        </div>

        <p className="text-sm leading-6 text-stone-600">{model}被 {value.eventTypes.map(eventLabel).join('、')} 时，将引用型事件发送到这个外部系统的 Webhook。</p>

        {editing && !readOnly && (
          <div className="grid gap-4 rounded-2xl bg-stone-50 p-4">
            <label className="text-sm font-medium text-stone-700">订阅名称
              <input className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="text-sm font-medium text-stone-700">Webhook URL
              <input className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
            </label>
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700">什么变化需要通知</p>
              <EventTypePicker value={eventTypes} onChange={setEventTypes} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy !== null || !eventTypes.length} onClick={() => void save()}>
                {busy === 'save' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存
              </Button>
              <Button disabled={busy !== null} onClick={() => setEditing(false)}>取消</Button>
            </div>
          </div>
        )}

        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button disabled={busy !== null} onClick={() => void patch({ enabled: !value.enabled }, 'toggle')}>
                {busy === 'toggle' ? <LoaderCircle className="size-4 animate-spin" /> : null}{value.enabled ? '停用' : '启用'}
              </Button>
            )}
            {!readOnly && (
              <Button disabled={busy !== null} onClick={() => void patch({ rotateSigningSecret: true }, 'rotate')}>
                {busy === 'rotate' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}重新生成签名密钥
              </Button>
            )}
            <Button disabled={busy !== null} onClick={() => setShowDeliveries((current) => !current)}>
              <Activity className="size-4" />{showDeliveries ? '收起投递记录' : '最近投递'}
            </Button>
          </div>
          {!readOnly && (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void remove()}>
              {busy === 'delete' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}删除
            </Button>
          )}
        </div>

        {showDeliveries && <DeliveryList subscriptionId={value.id} />}
      </CardContent>
    </Card>
  );
}

export function EventSubscriptionsSection({
  spaceId,
  familyName,
  subscriberServicePrincipalId,
  integrationName,
  readOnly = false,
}: {
  spaceId: string;
  familyName: string;
  subscriberServicePrincipalId: string;
  integrationName: string;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<EventSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedModel, setSelectedModel] = useState<SubscriptionModelKey>('event');
  const [name, setName] = useState(modelOptions[0].defaultName);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<EventType[]>(eventOptions.map((item) => item.key));
  const [revealedSecret, setRevealedSecret] = useState<SecretReveal | null>(null);
  const selectedModelOption = getModelOption(selectedModel) ?? modelOptions[0];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<{ items: EventSubscription[] }>(
        `/api/lifespace/core/v1/event-subscriptions?spaceId=${encodeURIComponent(spaceId)}&subscriberServicePrincipalId=${encodeURIComponent(subscriberServicePrincipalId)}`,
      );
      setItems(result.items.filter((item) => supportedModelKeys.has(item.modelKey as SubscriptionModelKey) && item.subscriberServicePrincipalId === subscriberServicePrincipalId));
    } catch (cause) {
      setError(displayError(cause, '加载事件订阅失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [spaceId, subscriberServicePrincipalId]);

  function selectModel(modelKey: SubscriptionModelKey) {
    const currentDefaultNames = new Set(modelOptions.map((item) => item.defaultName));
    const next = getModelOption(modelKey) ?? modelOptions[0];
    setSelectedModel(modelKey);
    if (!name.trim() || currentDefaultNames.has(name)) setName(next.defaultName);
  }

  async function create() {
    if (!name.trim() || !webhookUrl.trim() || !eventTypes.length) {
      setError('名称、Webhook URL 和至少一种变化类型都是必填项。');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await apiRequest<EventSubscription & { signingSecret: string }>('/api/lifespace/core/v1/event-subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          spaceId,
          subscriberServicePrincipalId,
          name: name.trim(),
          modelKey: selectedModel,
          eventTypes,
          webhookUrl: webhookUrl.trim(),
        }),
      });
      setRevealedSecret({ subscriptionName: result.name, signingSecret: result.signingSecret });
      setName(selectedModelOption.defaultName);
      setWebhookUrl('');
      setEventTypes(eventOptions.map((item) => item.key));
      setShowCreate(false);
      await load();
    } catch (cause) {
      setError(displayError(cause, '创建事件订阅失败', selectedModel));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-4" id="event-subscriptions">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-sky-100 text-sky-800"><BellRing className="size-4" /></span>
            <div>
              <h2 className="text-xl font-semibold text-stone-900">事件订阅</h2>
              <p className="mt-0.5 text-sm text-stone-500">由 {integrationName} 接收“{familyName}”的业务变化通知。</p>
            </div>
          </div>
        </div>
        {!readOnly && <Button variant="primary" onClick={() => setShowCreate((current) => !current)}><Plus className="size-4" />新建订阅</Button>}
      </div>

      <Card className="border-sky-100 bg-sky-50/40">
        <CardContent className="flex gap-3 pt-6">
          <Webhook className="mt-0.5 size-5 shrink-0 text-sky-700" />
          <div>
            <p className="text-sm font-semibold text-stone-900">当前开放“日程”和“待办”</p>
            <p className="mt-1 text-sm leading-6 text-stone-500">
              Webhook 只收到 Space、模型、recordId/version 等引用信息，不包含完整业务记录。每个订阅都绑定到当前外部系统的 Service Principal；对应模型的 Data Grant 被撤销后，LifeSpace 会停止新的投递。
            </p>
          </div>
        </CardContent>
      </Card>

      {readOnly && (
        <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm leading-6 text-stone-600">
          当前外部系统处于只读或禁用状态，已有订阅可查看，但不能新建、测试或修改。
        </p>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {revealedSecret && <SecretRevealCard value={revealedSecret} onClose={() => setRevealedSecret(null)} />}

      {!readOnly && showCreate && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h3 className="text-lg font-semibold text-stone-900">新建事件订阅</h3>
              <p className="mt-1 text-sm text-stone-500">选择要监听的业务模型；发生选中的变化时，把事件发送到 {integrationName} 的指定 Webhook。</p>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-stone-700">订阅什么</p>
              <ModelPicker value={selectedModel} onChange={selectModel} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <label className="block text-sm font-medium text-stone-700">订阅名称
                  <input className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="block text-sm font-medium text-stone-700">Webhook URL
                  <input className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" type="url" placeholder={selectedModelOption.webhookPlaceholder} value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
                </label>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-700">什么变化需要通知</p>
                <div className="mt-2"><EventTypePicker value={eventTypes} onChange={setEventTypes} /></div>
                <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
                  {selectedModelOption.label}被 {eventTypes.length ? eventTypes.map(eventLabel).join('、') : '（请选择变化）'} 时发送通知。
                </div>
              </div>
            </div>
            <p className="text-xs leading-5 text-stone-400">外部系统需要先拥有“{selectedModelOption.label}”的只读或读写 Data Grant；订阅本身不会新增数据权限。</p>
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-4">
              <Button disabled={creating} onClick={() => setShowCreate(false)}>取消</Button>
              <Button variant="primary" disabled={creating || !name.trim() || !webhookUrl.trim() || !eventTypes.length} onClick={() => void create()}>
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}保存订阅
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && <div className="flex min-h-28 items-center justify-center gap-3 text-sm text-stone-500"><LoaderCircle className="size-5 animate-spin" />正在加载事件订阅…</div>}

      {!loading && !items.length && !error && (
        <Card className="p-7 text-center">
          <BellRing className="mx-auto size-7 text-stone-300" />
          <p className="mt-3 font-medium text-stone-800">还没有事件订阅</p>
          <p className="mt-1 text-sm text-stone-500">需要自动触发 n8n 或其它服务时，再为日程或待办添加即可。</p>
        </Card>
      )}

      {!loading && items.map((item) => (
        <SubscriptionCard key={item.id} value={item} readOnly={readOnly} onChanged={load} onReveal={setRevealedSecret} />
      ))}
    </section>
  );
}
