/**
 * 首页
 *
 * 展示当前家庭的近期核心信息：
 * - 当前家庭名称和切换入口
 * - 今日日程和近期日程（待实现）
 * - 待完成任务（待实现）
 * - 快速操作按钮
 * - 无家庭时的引导
 *
 * 当前为占位页面，后续阶段完善。
 */

import { currentFamilyStore, familiesStore, loadFamilies } from '../../stores/index';
import { createFamily } from '../../services/families';
import { showConfirm, showSuccess, showError, showLoading, hideLoading } from '../../utils/index';

Page({
  data: {
    currentFamily: null as unknown as { id: string; name: string; avatarUrl: string | null; role: string; memberCount: number } | null,
    families: [] as unknown as { id: string; name: string; avatarUrl: string | null; role: string; memberCount: number }[],
    loaded: false,
  },

  /** 监听页面显示 */
  onShow(): void {
    this.loadData();
    // 订阅当前家庭变化
    this._familyUnsubscribe = currentFamilyStore.subscribe((family) => {
      this.setData({ currentFamily: family });
    });
    this._familiesUnsubscribe = familiesStore.subscribe((families) => {
      this.setData({ families, loaded: true });
    });
  },

  /** 取消订阅 */
  onHide(): void {
    if (this._familyUnsubscribe) this._familyUnsubscribe();
    if (this._familiesUnsubscribe) this._familiesUnsubscribe();
  },

  _familyUnsubscribe: null as (() => void) | null,
  _familiesUnsubscribe: null as (() => void) | null,

  async loadData(): Promise<void> {
    try {
      const families = await loadFamilies();
      const currentFamily = currentFamilyStore.value;

      this.setData({
        families,
        currentFamily,
        loaded: true,
      });

      // 同步 globalData
      const app = getApp<IAppOption>();
      if (app) {
        app.globalData.families = families;
        app.globalData.currentFamily = currentFamily;
      }
    } catch (e) {
      console.error('[Home] Load data failed:', e);
      this.setData({ loaded: true });
    }
  },

  /** 切换家庭 */
  onSwitchFamily(): void {
    const { families, currentFamily } = this.data;
    if (!families || families.length <= 1) return;

    wx.showActionSheet({
      itemList: families.map(f => f.name),
      success: (res) => {
        const selected = families[res.tapIndex];
        if (selected.id !== currentFamily?.id) {
          const { setCurrentFamily } = require('../../stores/index');
          setCurrentFamily(selected);
          showSuccess(`已切换到 ${selected.name}`);
        }
      },
    });
  },

  /** 创建家庭 */
  async onCreateFamily(): Promise<void> {
    const confirmed = await showConfirm('创建家庭', '请输入家庭名称');
    if (!confirmed) return;

    // 简化版：使用默认名称，后续可改为自定义输入页
    showLoading('正在创建...');

    try {
      const result = await createFamily({ name: '我的家庭' });
      hideLoading();
      showSuccess('创建成功');

      // 刷新家庭列表并设置当前家庭
      const { loadFamilies, setCurrentFamily } = require('../../stores/index');
      const families = await loadFamilies();
      const newFamily = families.find(f => f.id === result.id) || result;
      setCurrentFamily(newFamily);

    } catch (error: unknown) {
      hideLoading();
      console.error('[Home] Create family failed:', error);
      showError('创建失败，请重试');
    }
  },

  /** 加入家庭 */
  onJoinFamily(): void {
    wx.navigateTo({
      url: '/pages/family/join',
    });
  },

  /** 新建日程 */
  onCreateEvent(): void {
    wx.navigateTo({
      url: '/pages/events/edit',
    });
  },

  /** 新建待办 */
  onCreateTask(): void {
    wx.navigateTo({
      url: '/pages/tasks/edit',
    });
  },
});
