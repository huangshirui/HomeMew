/**
 * 设置页
 *
 * 目前提供「设备时区」选项：
 * - 跟随系统时区（默认）
 * - 指定某个特定时区（从常用 IANA 时区列表中选择）
 *
 * 该偏好仅保存在本地，用于页面展示时区换算，不影响任何家庭业务数据。
 */

import {
  loadTimeZonePreference,
  saveTimeZonePreference,
  resolveDisplayTimeZone,
  TimeZonePreference,
} from '../../services/settings';

Page({
  data: {
    mode: 'system' as 'system' | 'custom',
    customTimeZone: '',
    systemTimeZone: '',
    displayTimeZone: '',
    /** 优先展示家庭/系统时区，交给 timezone-picker 组件处理 */
    preferredTimeZones: [] as string[],
  },

  onLoad(): void {
    const pref = loadTimeZonePreference();
    const systemTz = resolveDisplayTimeZone({ mode: 'system', customTimeZone: '' });
    this.setData({
      mode: pref.mode,
      customTimeZone: pref.customTimeZone,
      systemTimeZone: systemTz,
      displayTimeZone: resolveDisplayTimeZone(pref),
      preferredTimeZones: [pref.customTimeZone, systemTz].filter(Boolean) as string[],
    });
  },

  /** 切换「跟随系统时区 / 指定时区」 */
  onModeChange(e: WechatMiniprogram.TouchEvent): void {
    const mode = e.currentTarget.dataset.mode as 'system' | 'custom';
    if (mode === this.data.mode) return;

    if (mode === 'custom') {
      // 切到「指定时区」：若尚未选过时区，默认填入当前系统时区
      const customTimeZone = this.data.customTimeZone || this.data.systemTimeZone;
      this.setData({ mode, customTimeZone });
    } else {
      // 切回「跟随系统时区」：清空已指定的时区存储
      this.setData({ mode, customTimeZone: '' });
    }
    this.persistAndRefresh();
  },

  /** 时区选择组件回调：更新指定的时区 */
  onTimezoneSelect(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    const id = e.detail.value;
    if (!id) return;
    this.setData({ customTimeZone: id, displayTimeZone: id });
    this.persistAndRefresh();
  },

  persistAndRefresh(): void {
    const pref: TimeZonePreference = {
      mode: this.data.mode,
      customTimeZone: this.data.customTimeZone,
    };
    saveTimeZonePreference(pref);
    let displayTimeZone = resolveDisplayTimeZone(pref);
    if (pref.mode === 'custom' && !pref.customTimeZone) {
      displayTimeZone = '';
    }
    this.setData({ displayTimeZone });
  },
});
