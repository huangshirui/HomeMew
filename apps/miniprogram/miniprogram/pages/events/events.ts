/**
 * 日程页（占位）
 *
 * 后续阶段实现：
 * - 日历或日期列表
 * - 日程列表
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
