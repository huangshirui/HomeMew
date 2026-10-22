import { getRuntimeEnvironment } from '../lib/runtime-environment';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { apiRequest } from '../lib/api-client';

const CURRENT_FAMILY_KEY = 'homemew.currentFamilyId';

export type SessionUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type FamilySpace = {
  id: string;
  name: string;
  timezone: string;
  avatarUrl: string | null;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  version: number;
};

export type FamilyMember = {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  version: number;
  personId?: string;
  displayName?: string;
  createdAt?: string;
};

type SessionResponse = { authenticated: boolean; user: SessionUser };

type HouseholdContextValue = {
  user: SessionUser | null;
  families: FamilySpace[];
  currentFamily: FamilySpace | null;
  members: FamilyMember[];
  loading: boolean;
  error: string | null;
  setCurrentFamilyId: (familyId: string) => void;
  refresh: () => Promise<void>;
  refreshMembers: () => Promise<void>;
};

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

function rememberedFamilyId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_FAMILY_KEY + '.' + getRuntimeEnvironment());
  } catch {
    return null;
  }
}

function rememberFamilyId(familyId: string | null) {
  try {
    if (familyId) window.localStorage.setItem(CURRENT_FAMILY_KEY + '.' + getRuntimeEnvironment(), familyId);
    else window.localStorage.removeItem(CURRENT_FAMILY_KEY + '.' + getRuntimeEnvironment());
  } catch {
    // Browser storage is only a UI preference; ignore unavailable storage.
  }
}

export function HouseholdProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [families, setFamilies] = useState<FamilySpace[]>([]);
  const [currentFamilyId, setCurrentFamilyIdState] = useState<string | null>(() => rememberedFamilyId());
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const membersRequestId = useRef(0);

  const currentFamily = useMemo(
    () => families.find((family) => family.id === currentFamilyId) ?? families[0] ?? null,
    [families, currentFamilyId],
  );

  const loadMembers = useCallback(async (familyId: string | null) => {
    // A response from a previous family must not replace the current family's members.
    const requestId = ++membersRequestId.current;
    if (!familyId) {
      setMembers([]);
      return;
    }
    try {
      const result = await apiRequest<FamilyMember[]>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(familyId)}/members`);
      if (requestId === membersRequestId.current) setMembers(result);
    } catch (cause) {
      if (requestId === membersRequestId.current) throw cause;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [session, nextFamilies] = await Promise.all([
        apiRequest<SessionResponse>('/api/session'),
        apiRequest<FamilySpace[]>('/api/families'),
      ]);
      const remembered = rememberedFamilyId();
      const selected = nextFamilies.find((space) => space.id === remembered)?.id ?? nextFamilies[0]?.id ?? null;
      setUser(session.user);
      setFamilies(nextFamilies);
      setCurrentFamilyIdState(selected);
      setMembers([]);
      rememberFamilyId(selected);
      await loadMembers(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载家庭信息');
    } finally {
      setLoading(false);
    }
  }, [loadMembers]);

  const refreshMembers = useCallback(async () => {
    setError(null);
    try {
      await loadMembers(currentFamily?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法加载成员信息');
    }
  }, [currentFamily?.id, loadMembers]);

  const setCurrentFamilyId = useCallback((familyId: string) => {
    if (!families.some((family) => family.id === familyId) || currentFamilyId === familyId) return;
    setCurrentFamilyIdState(familyId);
    setMembers([]);
    rememberFamilyId(familyId);
    setError(null);
    void loadMembers(familyId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : '无法切换家庭');
    });
  }, [families, currentFamilyId, loadMembers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <HouseholdContext.Provider value={{
      user,
      families,
      currentFamily,
      members,
      loading,
      error,
      setCurrentFamilyId,
      refresh,
      refreshMembers,
    }}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const value = useContext(HouseholdContext);
  if (!value) throw new Error('useHousehold must be used inside HouseholdProvider');
  return value;
}
