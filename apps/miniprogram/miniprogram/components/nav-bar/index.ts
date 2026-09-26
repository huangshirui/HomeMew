/**
 * 统一自定义导航栏组件。
 *
 * 负责：
 * - 计算状态栏高度与胶囊避让距离（复用 utils/nav-metrics，按设备只算一次）；
 * - 渲染白色全宽导航条，左侧可放返回按钮或自定义内容（slot=left），
 *   中部为标题（title 属性或 slot=center），右侧可放自定义内容（slot=right）；
 * - 进入页面时将系统状态栏前景色设为深色（frontColor #000000），
 *   避免白色导航条上浅色的时间/电量/信号看不清（见需求反馈第 2 点）。
 *
 * 全宽实现：用 width:100vw + margin 左右 calc(50% - 50vw) 抵消任意父容器
 * 左右内边距；顶部用 topInset（默认 24rpx，对应 .container 内边距）抵消父容器
 * 顶部内边距，使导航条贴住屏幕顶端。
 */

import { getNavMetrics } from '../../utils/nav-metrics';

Component({
  options: {
    multipleSlots: true,
    addGlobalClass: true,
  },

  properties: {
    /** 中部标题（与 slot=center 二选一；同时存在时 slot 优先） */
    title: {
      type: String,
      value: '',
    },
    /** 是否显示左侧返回按钮（非 tab 页一般为 true） */
    showBack: {
      type: Boolean,
      value: false,
    },
    /** 导航条背景色 */
    background: {
      type: String,
      value: '#FFFFFF',
    },
    /** 抵消父容器顶部内边距的 rpx 值（.container 为 24，无内边距的页面传 0） */
    topInset: {
      type: Number,
      value: 24,
    },
  },

  data: {
    statusBarHeight: 44,
    navBarHeight: 44,
    capsuleRight: 0,
  },

  lifetimes: {
    attached(): void {
      this.applyMetrics();
      this.applyStatusBarColor();
    },
    ready(): void {
      this.applyMetrics();
    },
  },

  pageLifetimes: {
    show(): void {
      this.applyStatusBarColor();
    },
  },

  methods: {
    applyMetrics(): void {
      const m = getNavMetrics();
      this.setData({
        statusBarHeight: m.statusBarHeight,
        navBarHeight: m.navBarHeight,
        capsuleRight: m.capsuleRight,
      });
    },

    /** 将系统状态栏前景色设为深色，确保白底导航上时间/电量可见 */
    applyStatusBarColor(): void {
      try {
        wx.setNavigationBarColor({
          frontColor: '#000000',
          backgroundColor: this.data.background || '#FFFFFF',
        });
      } catch (e) {
        /* 忽略：部分基础库版本在自定义导航下不允许设置 */
      }
    },

    onBack(): void {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/home/home' });
      }
    },
  },
});
