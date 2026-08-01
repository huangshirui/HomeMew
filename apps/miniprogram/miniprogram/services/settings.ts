/**
 * 本地偏好设置（设备时区）
 *
 * 仅保存 UI/展示用的本地偏好，不持久化任何业务数据或密钥。
 * 允许的值：
 * - mode === 'system'：跟随系统时区（默认）；
 * - mode === 'custom'：使用用户指定的 IANA 时区 customTimeZone。
 */

import { STORAGE_KEYS } from './config';
import { getSystemTimeZone } from '../utils/datetime';

export type TimeZoneMode = 'system' | 'custom';

export type TimeZonePreference = {
  mode: TimeZoneMode;
  /** 仅在 mode === 'custom' 时有意义 */
  customTimeZone: string;
};

const DEFAULT_PREFERENCE: TimeZonePreference = {
  mode: 'system',
  customTimeZone: '',
};

export function loadTimeZonePreference(): TimeZonePreference {
  try {
    const mode = wx.getStorageSync(STORAGE_KEYS.timeZoneMode) as TimeZoneMode | undefined;
    const customTimeZone = (wx.getStorageSync(STORAGE_KEYS.timeZoneCustom) as string) || '';
    if (mode !== 'system' && mode !== 'custom') {
      return { ...DEFAULT_PREFERENCE };
    }
    return { mode, customTimeZone };
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

export function saveTimeZonePreference(pref: TimeZonePreference): void {
  wx.setStorageSync(STORAGE_KEYS.timeZoneMode, pref.mode);
  if (pref.mode === 'custom' && pref.customTimeZone) {
    wx.setStorageSync(STORAGE_KEYS.timeZoneCustom, pref.customTimeZone);
  } else {
    // 跟随系统时区时，不保留任何指定时区，避免回退误用
    wx.removeStorageSync(STORAGE_KEYS.timeZoneCustom);
  }
}

/**
 * 解析当前生效的展示时区：
 * - system：使用设备/家庭默认时区；
 * - custom：使用用户指定时区。
 */
export function resolveDisplayTimeZone(pref: TimeZonePreference): string {
  if (pref.mode === 'custom' && pref.customTimeZone) {
    return pref.customTimeZone;
  }
  return getSystemTimeZone();
}

/**
 * 统一的「查看时区」入口：所有页面展示日程 / 待办时区都经此获取，
 * 保证「跟随系统时区 / 指定时区」偏好只在一处生效。
 *
 * - custom：返回用户指定的 IANA 时区；
 * - system：返回设备时区，并回退到家庭时区（与原有行为一致）。
 *
 * familyTimeZone 为可选的家庭时区（Core 下发的 family.timezone），
 * 仅在 system 模式下作为回退使用。
 */
export function getViewingTimeZone(familyTimeZone?: string): string {
  const pref = loadTimeZonePreference();
  if (pref.mode === 'custom' && pref.customTimeZone) {
    return pref.customTimeZone;
  }
  return getSystemTimeZone(familyTimeZone);
}
