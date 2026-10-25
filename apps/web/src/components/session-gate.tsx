import { Check, Clipboard, Link2, LoaderCircle, RefreshCw, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { householdErrorMessage } from '../lib/user-facing-error';

type SessionPayload = {
  data?: {
    authenticated?: boolean;
    expiresAt?: string;
    user?: { id?: string; displayName?: string } | null;
  };
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type Challenge = {
  challengeId: string;
  expiresAt?: string;
};

type GateState =
  | { kind: 'loading' }
  | { kind: 'authenticated' }
  | { kind: 'unlinked' }
  | { kind: 'error'; message: string; requestId?: string };

async function parsePayload(response: Response): Promise<SessionPayload> {
  return await response.json().catch(() => ({} as SessionPayload));
}

export function SessionGate({ children }: PropsWithChildren) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSession = useCallback(async () => {
    setState({ kind: 'loading' });
    setActionError(null);
    try {
      const response = await fetch('/api/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const payload = await parsePayload(response);
      if (response.ok && payload.data?.authenticated) {
        setState({ kind: 'authenticated' });
        return;
      }
      if (response.status === 409 && payload.error?.code === 'ACCESS_PRINCIPAL_UNLINKED') {
        setState({ kind: 'unlinked' });
        return;
      }
      setState({
        kind: 'error',
        message: payload.error?.message || '暂时无法建立 HomeMew 会话',
        requestId: payload.error?.requestId,
      });
    } catch {
      setState({ kind: 'error', message: '网络连接失败，请稍后重试' });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function createChallenge() {
    setChallengeBusy(true);
    setActionError(null);
    setCopied(false);
    try {
      const response = await fetch('/api/access/link-challenge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload?.data?.challengeId !== 'string') {
        throw new Error(payload?.error?.message || '无法创建关联码');
      }
      setChallenge({
        challengeId: payload.data.challengeId,
        expiresAt: typeof payload.data.expiresAt === 'string' ? payload.data.expiresAt : undefined,
      });
    } catch (error) {
      setActionError(householdErrorMessage(error, '无法创建关联码，请稍后重试。'));
    } finally {
      setChallengeBusy(false);
    }
  }

  async function copyChallenge() {
    if (!challenge) return;
    try {
      await navigator.clipboard.writeText(challenge.challengeId);
      setCopied(true);
    } catch {
      setActionError('复制失败，请手工选择关联码');
    }
  }

  if (state.kind === 'authenticated') return children;

  if (state.kind === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f8f4] px-6">
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <LoaderCircle className="size-5 animate-spin" />
          正在连接家事喵…
        </div>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f8f4] px-6 py-12">
        <Card className="w-full max-w-lg">
          <CardContent className="space-y-5 pt-6">
            <div>
              <h1 className="text-xl font-semibold text-stone-900">暂时无法进入家事喵</h1>
              <p className="mt-2 text-sm leading-6 text-stone-600">{state.message}</p>
              {state.requestId && <p className="mt-2 break-all text-xs text-stone-400">Request ID: {state.requestId}</p>}
            </div>
            <Button variant="primary" onClick={() => void loadSession()}>
              <RefreshCw className="size-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8f4] px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            <Link2 className="size-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-700">已登录</p>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900">关联你的家事喵小程序账号</h1>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">关联已有家事喵账号</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                在小程序「更多 → 设置 → 绑定邮箱」授权当前 Web 登录邮箱，然后重新检查即可进入。
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-500">
                也可使用下方的一次性关联码。已绑定邮箱的账号请在小程序设置中修改邮箱。首次使用家事喵，请先打开微信小程序。
              </p>
            </div>

            {!challenge ? (
              <Button variant="primary" disabled={challengeBusy} onClick={() => void createChallenge()}>
                {challengeBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                生成一次性关联码
              </Button>
            ) : (
              <div className="space-y-4 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">一次性关联码</p>
                  <code className="mt-2 block select-all break-all rounded-xl bg-white p-3 text-sm text-stone-800 ring-1 ring-emerald-100">
                    {challenge.challengeId}
                  </code>
                  <p className="mt-2 text-xs leading-5 text-stone-500">
                    {challenge.expiresAt ? `有效期至 ${new Date(challenge.expiresAt).toLocaleString()}` : '关联码有效期约 10 分钟'}。不要把关联码发给其他人。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void copyChallenge()}>
                    {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                    {copied ? '已复制' : '复制关联码'}
                  </Button>
                  <Button variant="ghost" onClick={() => void createChallenge()} disabled={challengeBusy}>
                    重新生成
                  </Button>
                </div>
                <ol className="space-y-2 text-sm leading-6 text-stone-700">
                  <li>1. 打开家事喵微信小程序。</li>
                  <li>2. 进入“我的 → 设置 → 关联 Web 登录”。</li>
                  <li>3. 粘贴上面的关联码并确认。</li>
                </ol>
                <Button variant="primary" onClick={() => void loadSession()}>
                  <RefreshCw className="size-4" />
                  我已在小程序确认
                </Button>
              </div>
            )}

            {actionError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
