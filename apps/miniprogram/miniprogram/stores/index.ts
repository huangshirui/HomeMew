/**
 * 全局状态管理
 *
 * 管理小程序的核心状态：
 * - 用户信息
 * - 当前家庭
 * - 家庭列表
 * - 认证状态
 *
 * 状态变更通知机制：
 * 通过回调模式通知页面更新，避免引入复杂的状态管理库。
 */

import { UserProfile, FamilyListItem } from '../types/index';
import { STORAGE_KEYS } from '../services/config';
import { clearAuth } from '../services/auth';
import { resolveCurrentFamily } from './family-state';

/** 状态变化监听器类型 */
type StateListener<T> = (value: T) => void;

class Store<T> {
  private _value: T;
  private listeners: Set<StateListener<T>> = new Set();

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  get value(): T {
    return this._value;
  }

  set value(newValue: T) {
    this._value = newValue;
    this.notify();
  }

  /** 订阅状态变化 */
  subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 通知所有订阅者 */
  private notify(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this._value);
      } catch (e) {
        console.error('[Store] Listener error:', e);
      }
    });
  }
}

// ==================== 用户状态 ====================

export const userStore = new Store<UserProfile | null>(null);

/**
 * 从远程加载当前用户并更新 store。
 * 失败时抛出原始错误（不吞掉网络 / 401 / 403 / 500）。
 */
export async function loadCurrentUser(): Promise<UserProfile> {
  const { getCurrentUser } = require('../services/users');
  const user = await getCurrentUser();
  userStore.value = user;
  // 同步到 globalData
  const app = getApp<IAppOption>();
  if (app) {
    app.globalData.userInfo = user;
  }
  return user;
}

// ==================== 家庭状态 ====================

export const familiesStore = new Store<FamilyListItem[]>([]);
export const currentFamilyStore = new Store<FamilyListItem | null>(null);

/**
 * Launch 刚完成家庭权限刷新后，首页会立刻进入并再次调用 loadFamilies()。
 * 5 秒复用窗口只复用本次小程序进程里刚刚成功从远端拿到的结果，用来消除这次重复网络请求；
 * 它不是持久化权限缓存，也不会替代下一次启动的远端权限校验。
 */
const FAMILY_LIST_REUSE_WINDOW_MS = 5 * 1000;
let familiesLoadedAt = 0;
let familiesLoadInFlight: Promise<FamilyListItem[]> | null = null;

export type LoadFamiliesOptions = {
  /** 明确要求重新访问 LifeSpace；用于启动权限校验或用户主动刷新。 */
  force?: boolean;
};

/**
 * 从远程加载家庭列表并更新 store。
 *
 * - 并发调用 single-flight，避免同时发出重复请求；
 * - 刚刚成功加载后的短窗口内允许复用内存结果，消除 Launch -> Home 的重复 Families 请求；
 * - force=true 始终要求新的远端结果（如果已有同一轮 in-flight，则共享该请求）。
 *
 * 失败时抛出原始错误（不吞掉网络 / 401 / 403 / 500）。
 */
export async function loadFamilies(options: LoadFamiliesOptions = {}): Promise<FamilyListItem[]> {
  if (
    !options.force &&
    familiesLoadedAt > 0 &&
    Date.now() - familiesLoadedAt <= FAMILY_LIST_REUSE_WINDOW_MS
  ) {
    return familiesStore.value;
  }

  if (familiesLoadInFlight) return familiesLoadInFlight;

  const request = (async () => {
    const { listMyFamilies } = require('../services/families');
    const families = await listMyFamilies();
    familiesStore.value = families;
    familiesLoadedAt = Date.now();
    // 同步到 globalData
    const app = getApp<IAppOption>();
    if (app) {
      app.globalData.families = families;
    }
    return families;
  })();

  familiesLoadInFlight = request;
  try {
    return await request;
  } finally {
    if (familiesLoadInFlight === request) familiesLoadInFlight = null;
  }
}

/** 设置当前家庭 */
export function setCurrentFamily(family: FamilyListItem | null): void {
  currentFamilyStore.value = family;
  if (family) {
    wx.setStorageSync(STORAGE_KEYS.currentFamilyId, family.id);
  } else {
    wx.removeStorageSync(STORAGE_KEYS.currentFamilyId);
  }
  // 同步到 globalData
  const app = getApp<IAppOption>();
  if (app) {
    app.globalData.currentFamily = family;
  }
}

/**
 * 根据当前家庭列表恢复或选择当前家庭。
 * 规则：
 * - 列表为空：当前家庭设为 null，清除缓存。
 * - 缓存的 currentFamilyId 仍有效：恢复该家庭。
 * - 无缓存或缓存失效：清除缓存并选择第一个家庭。
 */
export function refreshFamilyState(families: FamilyListItem[]): FamilyListItem | null {
  const savedId = wx.getStorageSync(STORAGE_KEYS.currentFamilyId) as string | undefined;
  const { family, clearSaved } = resolveCurrentFamily(families, savedId);
  if (clearSaved) {
    wx.removeStorageSync(STORAGE_KEYS.currentFamilyId);
  }
  setCurrentFamily(family);
  return family;
}

/**
 * 更新当前家庭与家庭列表中某个家庭的头像，保持两处 store 同步。
 */
export function updateFamilyAvatar(familyId: string, avatarUrl: string | null): void {
  const current = currentFamilyStore.value;
  if (current && current.id === familyId) {
    setCurrentFamily({ ...current, avatarUrl });
  }
  const list = familiesStore.value;
  const idx = list.findIndex(f => f.id === familyId);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = { ...next[idx], avatarUrl };
    familiesStore.value = next;
  }
}

/** 恢复上次选择的家庭（验证是否仍在家庭列表中） */
export function restoreCurrentFamily(families: FamilyListItem[]): FamilyListItem | null {
  const savedId = wx.getStorageSync(STORAGE_KEYS.currentFamilyId) as string | undefined;

  if (!savedId || !families.length) {
    return null;
  }

  // 查找缓存的家庭是否仍然有效
  const found = families.find(f => f.id === savedId);
  if (found) {
    setCurrentFamily(found);
    return found;
  }

  // 缓存的家庭已无效，清除
  wx.removeStorageSync(STORAGE_KEYS.currentFamilyId);
  return null;
}

/**
 * 清空登录与全部本地状态（用户、家庭、当前家庭、globalData、Storage）。
 * 登录清除时调用，保证三处状态同步。
 */
export function clearUserState(): void {
  userStore.value = null;
  familiesStore.value = [];
  currentFamilyStore.value = null;
  familiesLoadedAt = 0;

  const app = getApp<IAppOption>();
  if (app) {
    app.globalData.userInfo = null;
    app.globalData.families = [];
    app.globalData.currentFamily = null;
  }

  clearAuth();
}

// ==================== 加载状态 ====================

export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

export const loginStatusStore = new Store<LoadingStatus>('idle');
export const initStatusStore = new Store<LoadingStatus>('idle');
