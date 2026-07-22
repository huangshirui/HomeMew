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

/** 从远程加载当前用户并更新 store */
export async function loadCurrentUser(): Promise<UserProfile | null> {
  try {
    const { getCurrentUser } = require('../services/users');
    const user = await getCurrentUser();
    userStore.value = user;
    // 同步到 globalData
    const app = getApp<IAppOption>();
    if (app) {
      app.globalData.userInfo = user;
    }
    return user;
  } catch (e) {
    console.error('[Store] Failed to load current user:', e);
    return null;
  }
}

// ==================== 家庭状态 ====================

export const familiesStore = new Store<FamilyListItem[]>([]);
export const currentFamilyStore = new Store<FamilyListItem | null>(null);

/** 从远程加载家庭列表并更新 store */
export async function loadFamilies(): Promise<FamilyListItem[]> {
  try {
    const { listMyFamilies } = require('../services/families');
    const families = await listMyFamilies();
    familiesStore.value = families;
    // 同步到 globalData
    const app = getApp<IAppOption>();
    if (app) {
      app.globalData.families = families;
    }
    return families;
  } catch (e) {
    console.error('[Store] Failed to load families:', e);
    return [];
  }
}

/** 设置当前家庭 */
export function setCurrentFamily(family: FamilyListItem | null): void {
  currentFamilyStore.value = family;
  if (family) {
    wx.setStorageSync('currentFamilyId', family.id);
  } else {
    wx.removeStorageSync('currentFamilyId');
  }
  // 同步到 globalData
  const app = getApp<IAppOption>();
  if (app) {
    app.globalData.currentFamily = family;
  }
}

/** 恢复上次选择的家庭（验证是否仍在家庭列表中） */
export function restoreCurrentFamily(families: FamilyListItem[]): FamilyListItem | null {
  const savedId = wx.getStorageSync('currentFamilyId') as string | undefined;

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
  wx.removeStorageSync('currentFamilyId');
  return null;
}

// ==================== 加载状态 ====================

export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

export const loginStatusStore = new Store<LoadingStatus>('idle');
export const initStatusStore = new Store<LoadingStatus>('idle');
