import { Check, Clipboard, LoaderCircle, ShieldCheck, UserMinus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useHousehold, type FamilyMember } from '../components/household-provider';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { apiRequest } from '../lib/api-client';

const roleLabel: Record<FamilyMember['role'], string> = {
  owner: '家庭所有者',
  admin: '管理员',
  editor: '成员',
  viewer: '只读成员',
};

function canManage(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

export function FamilyPage() {
  const { user, families, currentFamily, members, loading, error, setCurrentFamilyId, refreshMembers } = useHousehold();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const manager = canManage(currentFamily?.role);
  const sortedMembers = useMemo(() => [...members].sort((a, b) => {
    const rank = { owner: 0, admin: 1, editor: 2, viewer: 3 } as const;
    return rank[a.role] - rank[b.role];
  }), [members]);

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

  if (loading) {
    return <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-stone-500"><LoaderCircle className="size-5 animate-spin" /> 正在加载家庭…</div>;
  }

  if (!currentFamily) {
    return (
      <Card className="p-8 text-center">
        <Users className="mx-auto size-8 text-stone-400" />
        <h1 className="mt-4 text-xl font-semibold">还没有家庭</h1>
        <p className="mt-2 text-sm text-stone-500">当前 Web 先完成已有家庭的管理；创建/加入家庭会继续接入同一套 LifeSpace Space 能力。</p>
      </Card>
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
                          disabled={busy}
                          value={member.role}
                          onChange={(event) => void updateRole(member, event.target.value as 'admin' | 'editor' | 'viewer')}
                        >
                          <option value="admin">管理员</option>
                          <option value="editor">成员</option>
                          <option value="viewer">只读成员</option>
                        </select>
                        {!isSelf && (
                          <Button size="icon" variant="ghost" disabled={busy} aria-label="移除成员" onClick={() => void removeMember(member)}>
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

        <Card className="h-fit">
          <CardContent className="space-y-4 pt-6">
            <div>
              <h2 className="font-semibold text-stone-900">邀请家庭成员</h2>
              <p className="mt-1 text-sm leading-6 text-stone-500">生成一个 24 小时有效、仅可使用一次的成员邀请码。</p>
            </div>
            {manager ? (
              !inviteToken ? (
                <Button variant="primary" disabled={inviteBusy} onClick={() => void createInvite()}>
                  {inviteBusy && <LoaderCircle className="size-4 animate-spin" />}
                  生成邀请码
                </Button>
              ) : (
                <div className="space-y-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                  <code className="block select-all break-all text-sm text-emerald-950">{inviteToken}</code>
                  <Button onClick={() => void copyInvite()}>
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
      </div>
    </div>
  );
}
