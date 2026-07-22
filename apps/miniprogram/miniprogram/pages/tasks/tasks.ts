/**
 * 待办页（占位）
 *
 * 后续阶段实现：
 * - 待完成/已完成切换
 * - 任务列表
 * - 筛选功能
 */

Page({
  data: {
    currentFamilyId: '',
  },

  onShow(): void {
    const familyId = wx.getStorageSync('currentFamilyId') as string | undefined;
    this.setData({ currentFamilyId: familyId || '' });
  },
});
