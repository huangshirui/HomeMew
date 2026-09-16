import { Check, Clipboard, LoaderCircle, LogIn, LogOut, Plus, ShieldCheck, Trash2, UserMinus, Users } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHousehold, type FamilyMember } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ApiError, apiRequest } from '../lib/api-client';

const roleLabel: Record<FamilyMember['role'], string> = {
  owner: '家庭所有者',
  admin: '管理员',
  editor: '成员',
  viewer: '只读成员',
};

type InvitePreview = {
  space: {
    id: string;
    name: string;
    kind: string;
    timezone: string;
    memberCount: number;
  };
  role: 'admin' | 'editor' | 'viewer';
  expiresAt: string;
  canJoin: boolean;
};

type SpaceDetail = {
  id: string;
  version: number;
};

function canManage(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function lifecycleError(cause: unknown, fallback: string) {
  if (!(cause instanceof ApiError)) return cause instanceof Error ? cause.message : fallback;
  if (cause.code === 'SPACE_OWNER_REQUIRED') return '只有当前家庭所有者可以注销家庭，请刷新页面后重试。';
  if (cause.code === 'SPACE_VERSION_CONFLICT') return '家庭信息已经发生变化，本次注销没有执行。请刷新后重新确认。';
  if (cause.code === 'LAST_SPACE_MANAGER') return '家庭必须保留至少一位所有者或管理员，请先安排其他管理员再退出。';
  if (cause.code === 'SPACE_NOT_FOUND') return '这个家庭已关闭或你已无法访问，请刷新家庭列表。';
  return cause.message || fallback;
}

export function FamilyPage() {
  const navigate = useNavigate();
  const { user, families, currentFamily, members, loading, error, setCurrentFamilyId, refresh, refreshMembers } = useHousehold();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [createFamilyBusy, setCreateFamilyBusy] = useState(false);
  const [joinFamilyBusy, setJoinFamilyBusy] = useState(false);
  const [familyActionBusy, setFamilyActionBusy] = useState<'leave' | 'close' | null>(null);

  const manager = canManage(currentFamily?.role);
  const owner = currentFamily?.role === 'owner';
  const sortedMembers = useMemo(() => [...members].sort((a, b) => {
    const rank = { owner: 0, admin: 1, editor: 2, viewer: 3 } as const;
    return rank[a.role] - rank[b.role];
  }), [members]);

  async function createFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = familyName.trim();
    const displayName = user?.displayName.trim() || '';
    if (!name) {
      setActionError('请输入家庭名称');
      return;
    }
    if (!displayName) {
      setActionError('当前账号缺少显示名称，请先完善个人资料');
      return;
    }

    setCreateFamilyBusy(true);
    setActionError(null);
    try {
      await apiRequest('/api/lifespace/core/v1/spaces', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'family',
          name,
          ownerDisplayName: displayName,
          timezone: 'Asia/Shanghai',
        }),
      });
      setFamilyName('');
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '创建家庭失败');
    } finally {
      setCreateFamilyBusy(false);
    }
  }

  async function joinFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = joinToken.trim();
    const displayName = user?.displayName.trim() || '';
    if (!token) {
      setActionError('请输入家庭邀请码');
      return;
    }
    if (!displayName) {
      setActionError('当前账号缺少显示名称，请先完善个人资料');
      return;
    }

    setJoinFamilyBusy(true);
    setActionError(null);
    try {
      const preview = await apiRequest<InvitePreview>('/api/lifespace/core/v1/space-invites/preview', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (preview.space.kind !== 'family') {
        setActionError('这个邀请码不是 HomeMew 家庭邀请');
        return;
      }
      if (!preview.canJoin) {
        setActionError('这个家庭邀请码当前不可加入');
        return;
      }
      await apiRequest('/api/lifespace/core/v1/space-invites/join', {
        method: 'POST',
        body: JSON.stringify({ token, displayName }),
      });
      setJoinToken('');
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '加入家庭失败');
    } finally {
      setJoinFamilyBusy(false);
    }
  }

  async function updateRole(member: FamilyMember, role: 'admin' | 'editor' | 'viewer') {
    if (!currentFamily || member.role === 'owner' || member.role === role) return;
    setBusyUserId(member.userId);
    setActionError(null);
    try {
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/members/${encodeURIComponent(member.userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, version: member.version }),
      });
      await refreshMembers();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '修改成员角色失败');
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(member: FamilyMember) {
    if (!currentFamily || member.role === 'owner' || member.userId === user?.id) return;
    if (!window.confirm(`确认将“${member.displayName || member.userId}”移出家庭吗？`)) return;
    setBusyUserId(member.userId);
    setActionError(null);
    try {
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/members/${encodeURIComponent(member.userId)}`, {
        method: 'DELETE',
      });
      await refreshMembers();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '移除成员失败');
    } finally {
      setBusyUserId(null);
    }
  }

  async function createInvite() {
    if (!currentFamily) return;
    setInviteBusy(true);
    setActionError(null);
    setInviteToken(null);
    setCopied(false);
    try {
      const result = await apiRequest<{ token: string }>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(currentFamily.id)}/invites`, {
        method: 'POST',
        body: JSON.stringify({ role: 'editor', expiresInMinutes: 1440, maxUses: 1 }),
      });
      setInviteToken(result.token);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '创建邀请失败');
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteToken);
      setCopied(true);
    } catch {
      setActionError('复制失败，请手工选择邀请码');
    }
  }

  async function leaveFamily() {
    const family = currentFamily;
    if (!family || family.role === 'owner' || familyActionBusy) return;
    if (!window.confirm(`确认退出“${family.name}”吗？退出后你将立即失去这个家庭的数据访问权限。`)) return;

    setFamilyActionBusy('leave');
    setActionError(null);
    try {
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(family.id)}/leave`, {
        method: 'POST',
      });
      await refresh();
      navigate('/', { replace: true });
    } catch (cause) {
      setActionError(lifecycleError(cause, '退出家庭失败'));
    } finally {
      setFamilyActionBusy(null);
    }
  }

  async function closeFamily() {
    const family = currentFamily;
    if (!family || family.role !== 'owner' || familyActionBusy) return;
    if (!window.confirm('注销家庭后，所有成员和外部系统会立即失去访问权限。家庭数据不会立即物理删除，当前版本也不能自行恢复。确认继续吗？')) return;
    if (!window.confirm(`再次确认：注销“${family.name}”？注销会立即生效。`)) return;

    setFamilyActionBusy('close');
    setActionError(null);
    try {
      const latest = await apiRequest<SpaceDetail>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(family.id)}`);
      await apiRequest(`/api/lifespace/core/v1/spaces/${encodeURIComponent(family.id)}/close`, {
        method: 'POST',
        body: JSON.stringify({ version: latest.version }),
      });
      await refresh();
      navigate('/', { replace: true });
    } catch (cause) {
      setActionError(lifecycleError(cause, '注销家庭失败'));
    } finally {
      setFamilyActionBusy(null);
    }
  }

  if (loading) {
    return <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-stone-500"><LoaderCircle className="size-5 animate-spin" /> 正在加载家庭…</div>;
  }

  if (!currentFamily) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><Users className="size-5" /></span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">开始使用家事喵</h1>
          <p className="mt-2 text-sm text-stone-500">创建一个新家庭，或使用家人发来的邀请码加入已有家庭。</p>
        </div>

        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {actionError && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div>
                <span className="grid size-10 place-items-center rounded-2xl bg-amber-100 text-amber-800"><Plus className="size-4" /></span>
                <h2 className="mt-4 text-lg font-semibold text-stone-900">创建家庭</h2>
                <p className="mt-1 text-sm leading-6 text-stone-500">你会自动成为家庭所有者。家庭时区默认使用 Asia/Shanghai。</p>
              </div>
              <form className="space-y-4" onSubmit={(event) => void createFamily(event)}>
                <label className="block text-sm font-medium text-stone-700">
                  家庭名称
                  <input
                    className="mt-2 h-11 w-full rounded-2xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
                    value={familyName}
                    onChange={(event) => setFamilyName(event.target.value)}
                    placeholder="例如：我们家"
                    maxLength={100}
                    autoComplete="off"
                  />
                </label>
                <Button className="w-full" variant="primary" type="submit" disabled={createFamilyBusy || joinFamilyBusy || !familyName.trim()}>
                  {createFamilyBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  创建家庭
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 pt-6">
              <div>
                <span className="grid size-10 place-items-center rounded-2xl bg-sky-100 text-sky-700"><LogIn className="size-4" /></span>
                <h2 className="mt-4 text-lg font-semibold text-stone-900">加入家庭</h2>
                <p className="mt-1 text-sm leading-6 text-stone-500">粘贴家庭管理员生成的一次性邀请码；加入前会先验证它确实指向家庭空间。</p>
              </div>
              <form className="space-y-4" onSubmit={(event) => void joinFamily(event)}>
                <label className="block text-sm font-medium text-stone-700">
                  家庭邀请码
                  <input
                    className="mt-2 h-11 w-full rounded-2xl border border-stone-200 bg-white px-3 font-mono text-sm text-stone-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
                    value={joinToken}
                    onChange={(event) => setJoinToken(event.target.value)}
                    placeholder="粘贴邀请码"
                    autoComplete="off"
                  />
                </label>
                <Button className="w-full" type="submit" disabled={joinFamilyBusy || createFamilyBusy || !joinToken.trim()}>
                  {joinFamilyBusy ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                  加入家庭
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="grid size-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><Users className="size-5" /></span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">家庭与成员</h1>
          <p className="mt-2 text-sm text-stone-500">真实数据来自 LifeSpace Space；页面上的角色控制只负责交互，最终权限仍由 LifeSpace 校验。</p>
        </div>
        {families.length > 1 && (
          <label className="text-sm text-stone-500">
            当前家庭
            <select
              className="ml-2 h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800"
              value={currentFamily.id}
              onChange={(event) => setCurrentFamilyId(event.target.value)}
            >
              {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {actionError && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-stone-400">当前家庭</p>
                <h2 className="mt-1 text-xl font-semibold text-stone-900">{currentFamily.name}</h2>
                <p className="mt-1 text-sm text-stone-500">{members.length} 位成员 · {currentFamily.timezone}</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{roleLabel[currentFamily.role]}</span>
            </div>

            <div className="mt-6 divide-y divide-stone-100">
              {sortedMembers.map((member) => {
                const busy = busyUserId === member.userId;
                const isSelf = member.userId === user?.id;
                return (
                  <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-stone-100 text-sm font-semibold text-stone-600">
                        {(member.displayName || '?').slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-stone-900">{member.displayName || member.userId}{isSelf ? '（我）' : ''}</p>
                        <p className="mt-0.5 text-xs text-stone-400">{roleLabel[member.role]}</p>
                      </div>
                    </div>

                    {manager && member.role !== 'owner' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="h-9 rounded-xl border border-stone-200 bg-white px-2 text-xs text-stone-700 disabled:opacity-50"
                          disabled={busy || familyActionBusy !== null}
                          value={member.role}
                          onChange={(event) => void updateRole(member, event.target.value as 'admin' | 'editor' | 'viewer')}
                        >
                          <option value="admin">管理员</option>
                          <option value="editor">成员</option>
                          <option value="viewer">只读成员</option>
                        </select>
                        {!isSelf && (
                          <Button size="icon" variant="ghost" disabled={busy || familyActionBusy !== null} aria-label="移除成员" onClick={() => void removeMember(member)}>
                            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <ShieldCheck className="size-4 text-stone-300" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="h-fit">
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="font-semibold text-stone-900">邀请家庭成员</h2>
                <p className="mt-1 text-sm leading-6 text-stone-500">生成一个 24 小时有效、仅可使用一次的成员邀请码。</p>
              </div>
              {manager ? (
                !inviteToken ? (
                  <Button variant="primary" disabled={inviteBusy || familyActionBusy !== null} onClick={() => void createInvite()}>
                    {inviteBusy && <LoaderCircle className="size-4 animate-spin" />}
                    生成邀请码
                  </Button>
                ) : (
                  <div className="space-y-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                    <code className="block select-all break-all text-sm text-emerald-950">{inviteToken}</code>
                    <Button disabled={familyActionBusy !== null} onClick={() => void copyInvite()}>
                      {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                      {copied ? '已复制' : '复制邀请码'}
                    </Button>
                    <p className="text-xs leading-5 text-stone-500">邀请码明文只在创建时返回，请只发给要加入这个家庭的人。</p>
                  </div>
                )
              ) : (
                <p className="text-sm text-stone-500">只有家庭管理员可以邀请和管理成员。</p>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardContent className="space-y-4 pt-6">
              {owner ? (
                <>
                  <div>
                    <h2 className="font-semibold text-stone-900">注销家庭</h2>
                    <p className="mt-1 text-sm leading-6 text-stone-500">关闭整个家庭空间。所有成员和外部系统会立即失去访问权限，现有家庭数据不会立即物理删除。</p>
                  </div>
                  <Button variant="destructive" disabled={familyActionBusy !== null} onClick={() => void closeFamily()}>
                    {familyActionBusy === 'close' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    注销家庭
                  </Button>
                  <p className="text-xs leading-5 text-stone-400">当前版本不提供自行恢复已注销家庭的能力。</p>
                </>
              ) : (
                <>
                  <div>
                    <h2 className="font-semibold text-stone-900">退出家庭</h2>
                    <p className="mt-1 text-sm leading-6 text-stone-500">只结束你自己的家庭成员关系，不会关闭家庭，也不会影响其他成员。</p>
                  </div>
                  <Button disabled={familyActionBusy !== null} onClick={() => void leaveFamily()}>
                    {familyActionBusy === 'leave' ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                    退出家庭
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
