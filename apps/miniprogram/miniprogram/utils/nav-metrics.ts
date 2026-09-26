/**
 * 自定义导航栏所需的设备尺寸。
 *
 * 不同机型状态栏高度、胶囊按钮位置不同，且与 CSS 的 rpx 单位无关，
 * 因此用系统接口（px）计算一次后缓存复用，避免每个页面重复计算。
 *
 * - statusBarHeight：系统状态栏高度（px）
 * - navBarHeight：状态栏之下、与胶囊按钮等高的导航内容区高度（px）
 * - capsuleRight：屏幕右边缘到胶囊按钮左边缘的距离（px），用于右侧避让
 */
let cached:
  | { statusBarHeight: number; navBarHeight: number; capsuleRight: number }
  | null = null;

export function getNavMetrics(): {
  statusBarHeight: number;
  navBarHeight: number;
  capsuleRight: number;
} {
  if (cached && cached.navBarHeight > 0) return cached;

  let statusBarHeight = 44;
  let navBarHeight = 44;
  let capsuleRight = 0;

  try {
    const info = wx.getSystemInfoSync();
    statusBarHeight = info.statusBarHeight || 44;
    const menuButton = wx.getMenuButtonBoundingClientRect();
    if (menuButton && menuButton.top) {
      navBarHeight = (menuButton.top - statusBarHeight) * 2 + menuButton.height;
      capsuleRight = info.screenWidth - menuButton.left;
    }
  } catch (e) {
    /* 使用默认值 */
  }

  cached = { statusBarHeight, navBarHeight, capsuleRight };
  return cached;
}
