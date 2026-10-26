/**
 * Lucide 图标组件。
 *
 * 以 data URI 形式内联 SVG（stroke 矢量），不依赖任何二进制资源，
 * 通过 `color` 属性即可同时支持正常态 / 选中态两种颜色。
 *
 * 路径与 Web 的 Lucide 图标保持一致；只内置当前小程序使用的图标。
 */

type IconPaths = Record<string, string>;

/** Lucide 官方 24x24 矢量路径（stroke 风格，统一描边宽度 2） */
const ICONS: IconPaths = {
  // Lucide v1.33.0 (ISC), copied from the same package used by Web.
  "plus": "<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>",
  "bar-chart-3": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"M18 17V9\"/><path d=\"M13 17V5\"/><path d=\"M8 17v-3\"/>",
  "shield": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/>",
  "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/>",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
  "x": "<path d=\"M18 6 6 18\"/><path d=\"m6 6 12 12\"/>",
  "check": "<path d=\"M20 6 9 17l-5-5\"/>",
  "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>",
  "trash-2": "<path d=\"M10 11v6\"/><path d=\"M14 11v6\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M3 6h18\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
  "trophy": "<path d=\"M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2\"/><path d=\"M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2\"/><path d=\"M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3\"/><path d=\"M4 22h16\"/><path d=\"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z\"/><path d=\"M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3\"/>",
  "handshake": "<path d=\"m11 17 2 2a1 1 0 1 0 3-3\"/><path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\"/><path d=\"m21 3 1 11h-2\"/><path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\"/><path d=\"M3 4h8\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 6v6l4 2\"/>",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>",
  "calendar-days": "<path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M8 13h.01\"/><path d=\"M12 13h.01\"/><path d=\"M16 13h.01\"/><path d=\"M8 17h.01\"/><path d=\"M12 17h.01\"/><path d=\"M16 17h.01\"/>",
  // 首页：标准房屋
  home:
    '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
    '<path d="M9 22V12h6v10"/>',
  // 日程：日历
  calendar:
    '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/>' +
    '<rect x="3" y="4" width="18" height="18" rx="2"/>',
  // 待办：带勾选的清单
  'list-checks':
    '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>' +
    '<path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  // 更多：三列网格
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  // 个人资料：用户
  'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  // Lucide v1.33.0 (ISC), identical to the Web package's SlidersHorizontal.
  'sliders-horizontal':
    '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/>' +
    '<path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/>' +
    '<path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  user:
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>' +
    '<circle cx="12" cy="7" r="4"/>',
};

Component({
  properties: {
    name: { type: String, value: '' },
    color: { type: String, value: '#999999' },
    size: { type: Number, value: 24 },
    strokeWidth: { type: Number, value: 2 },
  },

  data: {
    bg: '',
    sizePx: 24,
  },

  observers: {
    'name,color,size,strokeWidth': function (name: string, color: string, size: number, strokeWidth: number): void {
      const paths = ICONS[name];
      if (!paths) {
        this.setData({ bg: '', sizePx: size });
        return;
      }
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="' + color +
        '" stroke-width="' + (Number.isFinite(strokeWidth) ? Math.min(3, Math.max(1, strokeWidth)) : 2) + '" stroke-linecap="round" stroke-linejoin="round">' +
        paths + '</svg>';
      const uri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27');
      this.setData({ bg: "url('" + uri + "')", sizePx: size });
    },
  },
});
