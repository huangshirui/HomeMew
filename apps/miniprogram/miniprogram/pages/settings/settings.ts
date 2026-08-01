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
import { buildTimeZoneOptions, searchTimeZoneOptions, TimeZoneOption } from '../../utils/index';

Page({
  data: {
    mode: 'system' as 'system' | 'custom',
    customTimeZone: '',
    systemTimeZone: '',
    displayTimeZone: '',

    // 时区选择面板
    pickerVisible: false,
    searchKeyword: '',
    allOptions: [] as TimeZoneOption[],
    filteredOptions: [] as TimeZoneOption[],
  },

  onLoad(): void {
    const pref = loadTimeZonePreference();
    const systemTz = resolveDisplayTimeZone({ mode: 'system', customTimeZone: '' });
    this.setData({
      mode: pref.mode,
      customTimeZone: pref.customTimeZone,
      systemTimeZone: systemTz,
      displayTimeZone: resolveDisplayTimeZone(pref),
      allOptions: buildTimeZoneOptions([pref.customTimeZone, systemTz]),
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

  /** 打开时区选择面板 */
  onOpenPicker(): void {
    if (this.data.mode !== 'custom') return;
    this.setData({
      pickerVisible: true,
      searchKeyword: '',
      filteredOptions: this.data.allOptions,
    });
  },

  onClosePicker(): void {
    this.setData({ pickerVisible: false });
  },

  /** 阻止面板内点击冒泡到遮罩 */
  noop(): void {
    // 仅用于 catchtap，阻止事件冒泡
  },

  onSearchInput(e: WechatMiniprogram.Input): void {
    const keyword = (e.detail.value as string) || '';
    this.setData({
      searchKeyword: keyword,
      filteredOptions: searchTimeZoneOptions(this.data.allOptions, keyword),
    });
  },

  /** 选择一个特定时区 */
  onSelectTimeZone(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    this.setData({
      customTimeZone: id,
      pickerVisible: false,
      displayTimeZone: id,
    });
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
