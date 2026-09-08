/**
 * 首页启动缓存。
 *
 * 这里只保存可丢弃的 UI cache，LifeSpace 仍是唯一权威数据源。缓存必须绑定到
 * 已经由本次启动远端校验过的 userId + familyId；页面进入后仍立即并发刷新远端数据。
 */

import type { DayRecord, Event, Task } from '../types/index';

/** 与 config.ts 的 STORAGE_KEYS.homeCache 保持一致；这里避免引入运行时依赖，便于纯单测。 */
const HOME_CACHE_STORAGE_KEY = 'homeCacheV1';
const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CachedSection<T> = {
  savedAt: number;
  items: T[];
};

type CachedEventSection = CachedSection<Event> & {
  viewDate: string;
};

type CachedFamilyHome = {
  events?: CachedEventSection;
  tasks?: CachedSection<Task>;
  attentionDays?: CachedSection<DayRecord>;
};

type HomeCacheEnvelope = {
  version: typeof CACHE_VERSION;
  userId: string;
  families: Record<string, CachedFamilyHome>;
};

export type HomeStartupCache = {
  events?: Event[];
  tasks?: Task[];
  attentionDays?: DayRecord[];
};

function emptyEnvelope(userId: string): HomeCacheEnvelope {
  return { version: CACHE_VERSION, userId, families: {} };
}

function readEnvelope(userId: string): HomeCacheEnvelope {
  try {
    const raw = wx.getStorageSync(HOME_CACHE_STORAGE_KEY) as Partial<HomeCacheEnvelope> | null | undefined;
    if (
      !raw ||
      raw.version !== CACHE_VERSION ||
      raw.userId !== userId ||
      !raw.families ||
      typeof raw.families !== 'object'
    ) {
      return emptyEnvelope(userId);
    }
    return raw as HomeCacheEnvelope;
  } catch (error) {
    console.warn('[HomeCache] Read failed:', error);
    return emptyEnvelope(userId);
  }
}

function writeEnvelope(envelope: HomeCacheEnvelope): void {
  try {
    wx.setStorageSync(HOME_CACHE_STORAGE_KEY, envelope);
  } catch (error) {
    // 缓存写失败不应影响真实业务请求与页面可用性。
    console.warn('[HomeCache] Write failed:', error);
  }
}

function isFresh(savedAt: unknown, now: number): savedAt is number {
  return (
    typeof savedAt === 'number' &&
    savedAt > 0 &&
    savedAt <= now &&
    now - savedAt <= CACHE_MAX_AGE_MS
  );
}

function updateFamily(
  userId: string,
  familyId: string,
  updater: (current: CachedFamilyHome) => CachedFamilyHome,
): void {
  if (!userId || !familyId) return;
  const envelope = readEnvelope(userId);
  envelope.families[familyId] = updater(envelope.families[familyId] || {});
  writeEnvelope(envelope);
}

/**
 * 读取本次已验证用户/家庭对应的启动缓存。
 * Event 只有在查看日期仍是同一天时才恢复，避免隔天把“昨天日程”短暂显示成今天。
 */
export function readHomeStartupCache(
  userId: string,
  familyId: string,
  viewDate: string,
  now = Date.now(),
): HomeStartupCache | null {
  if (!userId || !familyId) return null;
  const family = readEnvelope(userId).families[familyId];
  if (!family) return null;

  const result: HomeStartupCache = {};
  if (
    family.events &&
    family.events.viewDate === viewDate &&
    Array.isArray(family.events.items) &&
    isFresh(family.events.savedAt, now)
  ) {
    result.events = family.events.items;
  }
  if (family.tasks && Array.isArray(family.tasks.items) && isFresh(family.tasks.savedAt, now)) {
    result.tasks = family.tasks.items;
  }
  if (
    family.attentionDays &&
    Array.isArray(family.attentionDays.items) &&
    isFresh(family.attentionDays.savedAt, now)
  ) {
    result.attentionDays = family.attentionDays.items;
  }

  return result.events || result.tasks || result.attentionDays ? result : null;
}

export function cacheHomeEvents(
  userId: string,
  familyId: string,
  viewDate: string,
  events: Event[],
  now = Date.now(),
): void {
  updateFamily(userId, familyId, current => ({
    ...current,
    events: { savedAt: now, viewDate, items: events },
  }));
}

export function cacheHomeTasks(
  userId: string,
  familyId: string,
  tasks: Task[],
  now = Date.now(),
): void {
  updateFamily(userId, familyId, current => ({
    ...current,
    tasks: { savedAt: now, items: tasks },
  }));
}

export function cacheHomeAttentionDays(
  userId: string,
  familyId: string,
  records: DayRecord[],
  now = Date.now(),
): void {
  updateFamily(userId, familyId, current => ({
    ...current,
    attentionDays: { savedAt: now, items: records },
  }));
}

export function clearHomeStartupCache(): void {
  try {
    wx.removeStorageSync(HOME_CACHE_STORAGE_KEY);
  } catch (error) {
    console.warn('[HomeCache] Clear failed:', error);
  }
}
