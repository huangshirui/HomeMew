/**
 * Lucide 图标组件。
 *
 * 以 data URI 形式内联 SVG（stroke 矢量），不依赖任何二进制资源，
 * 通过 `color` 属性即可同时支持正常态 / 选中态两种颜色。
 *
 * 仅内置 TabBar 需要的少量图标；如需更多，按相同格式在 ICONS 中补充即可。
 */

type IconPaths = Record<string, string>;

/** Lucide 官方 24x24 矢量路径（stroke 风格，统一描边宽度 2） */
const ICONS: IconPaths = {
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
  // 我的：用户
  user:
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>' +
    '<circle cx="12" cy="7" r="4"/>',
};

Component({
  properties: {
    name: { type: String, value: '' },
    color: { type: String, value: '#999999' },
    size: { type: Number, value: 24 },
  },

  data: {
    bg: '',
    sizePx: 24,
  },

  observers: {
    'name,color,size': function (name: string, color: string, size: number): void {
      const paths = ICONS[name];
      if (!paths) {
        this.setData({ bg: '', sizePx: size });
        return;
      }
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="' + color +
        '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        paths + '</svg>';
      const uri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27');
      this.setData({ bg: "url('" + uri + "')", sizePx: size });
    },
  },
});
