import {
  Activity,
  BellRing,
  Check,
  Clipboard,
  FlaskConical,
  LoaderCircle,
  Pencil,
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

type WebhookEndpoint = {
  id: string;
  spaceId: string;
  subscriberServicePrincipalId: string;
  name: string;
  destination: { type: 'webhook'; url: string };
  enabled: boolean;
  signingConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

type EventSubscription = {
  id: string;
  endpointId: string;
  modelKey: string;
  eventTypes: EventType[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type EventDelivery = {
  id: string;
  eventId: string;
  eventType: EventType;
  modelKey: string;
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
  endpointName: string;
  signingSecret: string;
};

const eventOptions: { key: EventType; label: string }[] = [
  { key: 'record.created', label: '创建' },
  { key: 'record.updated', label: '修改' },
  { key: 'record.deleted', label: '删除' },
];

const modelOptions: { key: SubscriptionModelKey; label: string; description: string }[] = [
  { key: 'event', label: '日程', description: '家庭日程的创建、修改和删除变化' },
  { key: 'task', label: '待办', description: '家庭待办的创建、修改和删除变化' },
];

function modelLabel(modelKey: string) {
  return modelOptions.find((item) => item.key === modelKey)?.label ?? modelKey;
}

function eventLabel(type: EventType) {
  return eventOptions.find((item) => item.key === type)?.label ?? type;
}

function formatTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function displayError(cause: unknown, fallback: string, modelKey?: string) {
  const target = modelKey ? modelLabel(modelKey) : '所选模型';
  if (cause instanceof ApiError && cause.code === 'FORBIDDEN') return '当前账号没有这个家庭的事件推送管理权限。';
  if (cause instanceof ApiError && cause.code === 'INVALID_WEBHOOK_URL') return 'Webhook 必须是可公开访问的 HTTPS 地址。';
  if (cause instanceof ApiError && cause.code === 'MODEL_ACCESS_DENIED') return `HomeMew 当前没有${target}模型的读取权限，暂时不能订阅。`;
  if (cause instanceof ApiError && cause.code === 'EVENT_SUBSCRIBER_ACCESS_DENIED') return `这个外部系统当前没有${target}读取权限。请先在“认证与数据访问”中授予${target}只读或读写权限。`;
  return cause instanceof Error ? cause.message : fallback;
}

async function deleteResource(path: string, fallback: string) {
  const response = await fetch(path, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => ({}));
  throw new ApiError(
    payload?.error?.code ?? `HTTP_${response.status}`,
    payload?.error?.message ?? fallback,
    payload?.error?.requestId,
    response.status,
  );
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
          <label
            key={option.key}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'} ${checked ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-500'}`}
          >
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
            <p className="font-semibold text-emerald-950">{value.endpointName} 的签名密钥</p>
            <p className="mt-1 text-sm leading-6 text-emerald-900/70">这一个密钥用于验证通过该 Webhook 收到的日程、待办等所有已选事件。明文只会在创建或重新生成时返回。</p>
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

function DeliveryList({ endpointId }: { endpointId: string }) {
  const [items, setItems] = useState<EventDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiRequest<{ items: EventDelivery[] }>(`/api/lifespace/core/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries`)
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
  }, [endpointId]);

  if (loading) return <p className="py-3 text-sm text-stone-400">正在加载最近投递…</p>;
  if (error) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!items.length) return <p className="py-3 text-sm text-stone-400">还没有真实事件投递记录。</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-100">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-50 text-xs text-stone-400">
          <tr>
            <th className="px-3 py-2 font-medium">时间</th>
            <th className="px-3 py-2 font-medium">内容</th>
            <th className="px-3 py-2 font-medium">变化</th>
            <th className="px-3 py-2 font-medium">记录</th>
            <th className="px-3 py-2 font-medium">结果</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="whitespace-nowrap px-3 py-2 text-stone-500">{formatTime(item.occurredAt)}</td>
              <td className="px-3 py-2 text-stone-700">{modelLabel(item.modelKey)}</td>
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

function ModelSubscriptionRow({ endpointId, option, subscription, readOnly, onChanged }: {
  endpointId: string;
  option: (typeof modelOptions)[number];
  subscription?: EventSubscription;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const [eventTypes, setEventTypes] = useState<EventType[]>(subscription?.eventTypes ?? eventOptions.map((item) => item.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = Boolean(subscription?.enabled);

  useEffect(() => {
    setEventTypes(subscription?.eventTypes ?? eventOptions.map((item) => item.key));
  }, [subscription]);

  async function toggle() {
    if (readOnly || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!subscription) {
        await apiRequest<EventSubscription>('/api/lifespace/core/v1/event-subscriptions', {
          method: 'POST',
          body: JSON.stringify({ endpointId, modelKey: option.key, eventTypes }),
        });
      } else {
        await apiRequest<EventSubscription>(`/api/lifespace/core/v1/event-subscriptions/${encodeURIComponent(subscription.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !subscription.enabled }),
        });
      }
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, `更新${option.label}订阅失败`, option.key));
    } finally {
      setBusy(false);
    }
  }

  async function changeEventTypes(next: EventType[]) {
    if (!next.length || !subscription || readOnly || busy) return;
    setEventTypes(next);
    setBusy(true);
    setError(null);
    try {
      await apiRequest<EventSubscription>(`/api/lifespace/core/v1/event-subscriptions/${encodeURIComponent(subscription.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ eventTypes: next }),
      });
      await onChanged();
    } catch (cause) {
      setEventTypes(subscription.eventTypes);
      setError(displayError(cause, `更新${option.label}变化类型失败`, option.key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border p-4 transition ${selected ? 'border-emerald-200 bg-emerald-50/40' : 'border-stone-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className={`flex min-w-0 items-start gap-3 ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
          <input
            className="mt-1 size-5 accent-emerald-600"
            type="checkbox"
            checked={selected}
            disabled={readOnly || busy}
            onChange={() => void toggle()}
          />
          <span>
            <span className="block font-semibold text-stone-900">{option.label}</span>
            <span className="mt-1 block text-sm leading-6 text-stone-500">{option.description}</span>
          </span>
        </label>
        {busy && <LoaderCircle className="size-4 animate-spin text-stone-400" />}
      </div>

      <div className="mt-4 border-t border-stone-100 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">通知这些变化</p>
        <EventTypePicker value={eventTypes} onChange={(next) => void changeEventTypes(next)} disabled={!selected || readOnly || busy} />
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function EndpointCard({ endpoint, subscriptions, readOnly, onChanged, onReveal }: {
  endpoint: WebhookEndpoint;
  subscriptions: EventSubscription[];
  readOnly: boolean;
  onChanged: () => Promise<void>;
  onReveal: (value: SecretReveal) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(endpoint.destination.url);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeliveries, setShowDeliveries] = useState(false);

  useEffect(() => {
    setWebhookUrl(endpoint.destination.url);
  }, [endpoint]);

  async function patch(body: Record<string, unknown>, action: string) {
    setBusy(action);
    setError(null);
    try {
      const updated = await apiRequest<WebhookEndpoint & { signingSecret?: string }>(`/api/lifespace/core/v1/webhook-endpoints/${encodeURIComponent(endpoint.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (updated.signingSecret) onReveal({ endpointName: updated.name, signingSecret: updated.signingSecret });
      await onChanged();
      return true;
    } catch (cause) {
      setError(displayError(cause, '更新事件推送失败'));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!webhookUrl.trim()) {
      setError('Webhook URL 不能为空。');
      return;
    }
    if (await patch({ webhookUrl: webhookUrl.trim() }, 'save')) setEditing(false);
  }

  async function test() {
    setBusy('test');
    setError(null);
    try {
      const result = await apiRequest<{ ok: boolean; statusCode: number }>(`/api/lifespace/core/v1/webhook-endpoints/${encodeURIComponent(endpoint.id)}/test`, {
        method: 'POST',
        body: '{}',
      });
      if (!result.ok) setError(`Webhook 已连接，但接收端返回 HTTP ${result.statusCode}。`);
      else window.alert(`Webhook 测试发送成功，接收端返回 HTTP ${result.statusCode}。`);
    } catch (cause) {
      setError(displayError(cause, '测试发送失败'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm('确认移除这个事件推送 Webhook 吗？日程和待办订阅会一起停止。')) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteResource(`/api/lifespace/core/v1/webhook-endpoints/${encodeURIComponent(endpoint.id)}`, '删除事件推送失败');
      await onChanged();
    } catch (cause) {
      setError(displayError(cause, '删除事件推送失败'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-stone-900">Webhook</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${endpoint.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{endpoint.enabled ? '启用' : '已停用'}</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">一套 URL / 一套密钥</span>
            </div>
            <p className="mt-2 break-all text-sm text-stone-500">{endpoint.destination.url}</p>
          </div>
          {!readOnly && <Button disabled={busy !== null} onClick={() => setEditing((current) => !current)}><Pencil className="size-4" />修改地址</Button>}
        </div>

        {editing && !readOnly && (
          <div className="rounded-2xl bg-stone-50 p-4">
            <label className="block text-sm font-medium text-stone-700">Webhook URL
              <input
                className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                type="url"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy !== null || !webhookUrl.trim()} onClick={() => void save()}>
                {busy === 'save' ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存
              </Button>
              <Button disabled={busy !== null} onClick={() => { setWebhookUrl(endpoint.destination.url); setEditing(false); }}>取消</Button>
            </div>
          </div>
        )}

        <div>
          <div className="mb-3">
            <h4 className="font-semibold text-stone-900">订阅内容</h4>
            <p className="mt-1 text-sm leading-6 text-stone-500">只需要选择哪些业务变化发送到上面的同一个 Webhook；不会再为每个模型创建新的 URL 或签名密钥。</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {modelOptions.map((option) => (
              <ModelSubscriptionRow
                key={option.key}
                endpointId={endpoint.id}
                option={option}
                subscription={subscriptions.find((item) => item.modelKey === option.key)}
                readOnly={readOnly}
                onChanged={onChanged}
              />
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-400">勾选某项前，这个外部系统需要先拥有对应模型的只读或读写 Data Grant。事件订阅本身不会新增数据权限。</p>
        </div>

        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button disabled={busy !== null} onClick={() => void test()}>
                {busy === 'test' ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}测试 Webhook
              </Button>
            )}
            {!readOnly && (
              <Button disabled={busy !== null} onClick={() => void patch({ enabled: !endpoint.enabled }, 'toggle')}>
                {busy === 'toggle' ? <LoaderCircle className="size-4 animate-spin" /> : null}{endpoint.enabled ? '停用推送' : '启用推送'}
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
              {busy === 'delete' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}移除 Webhook
            </Button>
          )}
        </div>

        {showDeliveries && <DeliveryList endpointId={endpoint.id} />}
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
  const [endpoint, setEndpoint] = useState<WebhookEndpoint | null>(null);
  const [subscriptions, setSubscriptions] = useState<EventSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<SecretReveal | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const endpointResult = await apiRequest<{ items: WebhookEndpoint[] }>(
        `/api/lifespace/core/v1/webhook-endpoints?spaceId=${encodeURIComponent(spaceId)}&subscriberServicePrincipalId=${encodeURIComponent(subscriberServicePrincipalId)}`,
      );
      const selectedEndpoint = endpointResult.items[0] ?? null;
      setEndpoint(selectedEndpoint);
      if (!selectedEndpoint) {
        setSubscriptions([]);
        return;
      }
      const subscriptionResult = await apiRequest<{ items: EventSubscription[] }>(
        `/api/lifespace/core/v1/event-subscriptions?endpointId=${encodeURIComponent(selectedEndpoint.id)}`,
      );
      setSubscriptions(subscriptionResult.items.filter((item) => modelOptions.some((option) => option.key === item.modelKey)));
    } catch (cause) {
      setError(displayError(cause, '加载事件推送配置失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [spaceId, subscriberServicePrincipalId]);

  async function createEndpoint() {
    if (!webhookUrl.trim()) {
      setError('Webhook URL 不能为空。');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await apiRequest<WebhookEndpoint & { signingSecret: string }>('/api/lifespace/core/v1/webhook-endpoints', {
        method: 'POST',
        body: JSON.stringify({
          spaceId,
          subscriberServicePrincipalId,
          name: `${integrationName} 事件推送`,
          webhookUrl: webhookUrl.trim(),
        }),
      });
      setRevealedSecret({ endpointName: result.name, signingSecret: result.signingSecret });
      setWebhookUrl('');
      await load();
    } catch (cause) {
      setError(displayError(cause, '配置事件推送失败'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-4" id="event-subscriptions">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-sky-100 text-sky-800"><BellRing className="size-4" /></span>
        <div>
          <h2 className="text-xl font-semibold text-stone-900">事件推送</h2>
          <p className="mt-0.5 text-sm text-stone-500">由 {integrationName} 接收“{familyName}”的业务变化通知。</p>
        </div>
      </div>

      <Card className="border-sky-100 bg-sky-50/40">
        <CardContent className="flex gap-3 pt-6">
          <Webhook className="mt-0.5 size-5 shrink-0 text-sky-700" />
          <div>
            <p className="text-sm font-semibold text-stone-900">一个 Webhook，选择要订阅的内容</p>
            <p className="mt-1 text-sm leading-6 text-stone-500">日程和待办共享同一个 Webhook URL 和同一套签名密钥。Webhook 只收到 Space、模型、recordId/version 等引用信息；需要完整数据时，外部系统仍按自己的 LifeSpace 权限读取。</p>
          </div>
        </CardContent>
      </Card>

      {readOnly && (
        <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm leading-6 text-stone-600">当前外部系统处于只读或禁用状态，事件推送配置可查看，但不能测试或修改。</p>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {revealedSecret && <SecretRevealCard value={revealedSecret} onClose={() => setRevealedSecret(null)} />}

      {loading && <div className="flex min-h-28 items-center justify-center gap-3 text-sm text-stone-500"><LoaderCircle className="size-5 animate-spin" />正在加载事件推送配置…</div>}

      {!loading && endpoint && (
        <EndpointCard endpoint={endpoint} subscriptions={subscriptions} readOnly={readOnly} onChanged={load} onReveal={setRevealedSecret} />
      )}

      {!loading && !endpoint && !readOnly && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div>
              <h3 className="text-lg font-semibold text-stone-900">配置事件推送 Webhook</h3>
              <p className="mt-1 text-sm leading-6 text-stone-500">只需配置一次接收地址。保存后再勾选日程、待办等需要推送的内容。</p>
            </div>
            <label className="block text-sm font-medium text-stone-700">Webhook URL
              <input
                className="mt-2 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                type="url"
                placeholder="https://example.com/webhooks/homemew"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
              />
            </label>
            <p className="text-xs leading-5 text-stone-400">保存后 LifeSpace 会生成一套签名密钥，只显示一次。以后新增订阅内容不需要生成新的密钥。</p>
            <div className="flex justify-end border-t border-stone-100 pt-4">
              <Button variant="primary" disabled={creating || !webhookUrl.trim()} onClick={() => void createEndpoint()}>
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Webhook className="size-4" />}保存 Webhook
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !endpoint && readOnly && (
        <Card className="p-7 text-center">
          <BellRing className="mx-auto size-7 text-stone-300" />
          <p className="mt-3 font-medium text-stone-800">还没有配置事件推送</p>
        </Card>
      )}
    </section>
  );
}
