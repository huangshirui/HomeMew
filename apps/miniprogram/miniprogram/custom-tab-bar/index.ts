import { currentFamilyStore } from '../stores/index';

type TabItem = {
  pagePath: string;
  text: string;
  /** Lucide 图标名（见 components/lucide-icon） */
  icon: string;
};

type SheetAction = {
  key: string;
  text: string;
  icon: string;
  path: string;
  disabled: boolean;
};

Component({
  data: {
    selected: 0,
    sheetOpen: false,
    /** 记录手势起点 Y，用于下滑关闭面板 */
    _sheetStartY: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: 'home' },
      { pagePath: '/pages/events/events', text: '日程', icon: 'calendar' },
      { pagePath: '/pages/tasks/tasks', text: '待办', icon: 'list-checks' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'user' },
    ] as TabItem[],
    actions: [
      { key: 'event', text: '新建日程', icon: '📅', path: '/pages/events/edit', disabled: false },
      { key: 'task', text: '新建待办', icon: '✓', path: '/pages/tasks/edit', disabled: false },
      { key: 'day', text: '添加日子', icon: '⏱', path: '/pages/days/edit', disabled: false },
      { key: 'wish', text: '添加愿望', icon: '⭐', path: '/pages/wishes/edit', disabled: false },
    ] as SheetAction[],
  },

  methods: {
    /** 4 个真 tab：切换页面，不改变中央面板 */
    switchTab(e: WechatMiniprogram.TouchEvent): void {
      const url = e.currentTarget.dataset.path as string;
      wx.switchTab({ url });
    },

    /** 中央凸起「＋」：切换底部面板，无选中态、不切页 */
    onPlusTap(): void {
      this.setData({ sheetOpen: !this.data.sheetOpen });
    },

    onSheetClose(): void {
      this.setData({ sheetOpen: false });
    },

    /** 阻止点击面板内部冒泡到遮罩 */
    noop(): void {},

    onSheetTouchStart(e: WechatMiniprogram.TouchEvent): void {
      this.setData({ _sheetStartY: e.touches[0].clientY });
    },

    onSheetTouchEnd(e: WechatMiniprogram.TouchEvent): void {
      const endY = e.changedTouches[0].clientY;
      if (endY - this.data._sheetStartY > 60) {
        this.setData({ sheetOpen: false });
      }
    },

    onActionTap(e: WechatMiniprogram.TouchEvent): void {
      const { path, disabled } = e.currentTarget.dataset as { path: string; disabled: boolean };
      if (disabled) {
        wx.showToast({ title: '敬请期待', icon: 'none' });
        return;
      }
      const familyId = currentFamilyStore.value?.id || '';
      if (!familyId) {
        wx.showToast({ title: '请先创建或加入家庭', icon: 'none' });
        return;
      }
      this.setData({ sheetOpen: false });
      wx.navigateTo({ url: `${path}?familyId=${familyId}` });
    },
  },
});
