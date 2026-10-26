/**
 * 首页「数据范围」设置（只看我的 / 看全家）。
 *
 * 按 (familyId, userId) 维度记住用户在设置页选择的首页展示范围：
 * - 'me'：只看我的（默认）—— 首页各模块只展示与当前用户相关的内容；
 * - 'all'：看全家 —— 首页展示全家的日程、待办与动态。
 *
 * 该值只是界面偏好，不是权限凭据；成员是否可查由 Core 校验。
 * 首页的「日程 / 待办」原先各自跟随 events-scope / tasks-scope 页面级偏好，
 * 现统一改由本设置控制，与日程页 / 待办页顶栏的范围选择器脱钩。
 */

import { STORAGE_KEYS } from '../services/config';

export type HomeScope = 'me' | 'all';

function scopeKey(familyId: string, userId: string): string {
  return `${STORAGE_KEYS.homeScope}:${familyId}:${userId || 'anon'}`;
}

/** 读取首页数据范围；无记录或非法值时默认 'me'（只看我的） */
export function loadHomeScope(familyId: string, userId: string): HomeScope {
  try {
    const v = wx.getStorageSync(scopeKey(familyId, userId)) as string | undefined;
    return v === 'all' ? 'all' : 'me';
  } catch {
    return 'me';
  }
}

/** 保存首页数据范围 */
export function saveHomeScope(familyId: string, userId: string, scope: HomeScope): void {
  try {
    wx.setStorageSync(scopeKey(familyId, userId), scope);
  } catch {
    // 存储失败不影响功能，下次进入回落默认值
  }
}
