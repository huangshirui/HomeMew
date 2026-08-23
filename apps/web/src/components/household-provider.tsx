import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { apiRequest } from '../lib/api-client';

const CURRENT_FAMILY_KEY = 'homemew.currentFamilyId';

export type SessionUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type FamilySpace = {
  id: string;
  kind: 'family';
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
type SpaceResponse = FamilySpace | { id: string; kind: string; name: string; timezone: string; avatarUrl: string | null; role: FamilySpace['role']; version: number };

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
    return window.localStorage.getItem(CURRENT_FAMILY_KEY);
  } catch {
    return null;
  }
}

function rememberFamilyId(familyId: string | null) {
  try {
    if (familyId) window.localStorage.setItem(CURRENT_FAMILY_KEY, familyId);
    else window.localStorage.removeItem(CURRENT_FAMILY_KEY);
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

  const currentFamily = useMemo(
    () => families.find((family) => family.id === currentFamilyId) ?? families[0] ?? null,
    [families, currentFamilyId],
  );

  const loadMembers = useCallback(async (familyId: string | null) => {
    if (!familyId) {
      setMembers([]);
      return;
    }
    const result = await apiRequest<FamilyMember[]>(`/api/lifespace/core/v1/spaces/${encodeURIComponent(familyId)}/members`);
    setMembers(result);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [session, spaces] = await Promise.all([
        apiRequest<SessionResponse>('/api/session'),
        apiRequest<SpaceResponse[]>('/api/lifespace/core/v1/me/spaces'),
      ]);
      const nextFamilies = spaces.filter((space): space is FamilySpace => space.kind === 'family');
      const remembered = rememberedFamilyId();
      const selected = nextFamilies.find((space) => space.id === remembered)?.id ?? nextFamilies[0]?.id ?? null;
      setUser(session.user);
      setFamilies(nextFamilies);
      setCurrentFamilyIdState(selected);
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
    if (!families.some((family) => family.id === familyId)) return;
    setCurrentFamilyIdState(familyId);
    rememberFamilyId(familyId);
    setError(null);
    void loadMembers(familyId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : '无法切换家庭');
    });
  }, [families, loadMembers]);

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
