/**
 * 时区选择组件
 *
 * 统一的 IANA 时区选择器：带搜索、展示「城市名 + 时区值」，
 * 设备时区设置、家庭时区、事件时区等均复用本组件，保证交互一致。
 *
 * 用法：
 *   <timezone-picker
 *     value="{{timezoneValue}}"
 *     preferred="{{preferredTimeZones}}"
 *     bind:select="onTimezoneSelect"
 *   />
 *
 * - value：当前选中的 IANA 时区 id（可为空）
 * - preferred：优先展示在列表前方的时区 id 列表（可选）
 * - select 事件：{ value: string } 选中后的 IANA 时区 id
 */

import { buildTimeZoneOptions, searchTimeZoneOptions, timeZoneLabel, TimeZoneOption } from '../../utils/index';

Component({
  properties: {
    /** 当前选中的 IANA 时区 id，可为空 */
    value: {
      type: String,
      value: '',
    },
    /** 优先展示在列表前方的时区 id 列表 */
    preferred: {
      type: Array,
      value: [] as string[],
    },
  },

  data: {
    label: '',
    pickerVisible: false,
    searchKeyword: '',
    allOptions: [] as TimeZoneOption[],
    filteredOptions: [] as TimeZoneOption[],
  },

  observers: {
    value(v: string): void {
      this.setData({ label: v ? timeZoneLabel(v) : '' });
    },
  },


  methods: {
    onOpenPicker(): void {
      const preferred = (this.data.preferred as string[]) || [];
      const allOptions = buildTimeZoneOptions([...(preferred as Array<string | null | undefined>)]);
      this.setData({
        pickerVisible: true,
        searchKeyword: '',
        allOptions,
        filteredOptions: allOptions,
      });
    },

    onClosePicker(): void {
      this.setData({ pickerVisible: false });
    },

    // 仅用于 catchtap，阻止点击面板内容时冒泡到遮罩
    noop(): void {
      // no-op
    },

    onSearchInput(e: WechatMiniprogram.Input): void {
      const keyword = (e.detail.value as string) || '';
      this.setData({
        searchKeyword: keyword,
        filteredOptions: searchTimeZoneOptions(this.data.allOptions as TimeZoneOption[], keyword),
      });
    },

    onSelectTimeZone(e: WechatMiniprogram.TouchEvent): void {
      const id = e.currentTarget.dataset.id as string;
      if (!id) return;
      this.setData({ pickerVisible: false });
      this.triggerEvent('select', { value: id });
    },
  },
});
