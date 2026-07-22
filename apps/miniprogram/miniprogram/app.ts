App<IAppOption>({
  globalData: {
    userInfo: null,
    currentFamily: null,
    families: [] as FamilyListItem[],
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发');
      return;
    }
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true,
    });
  },

  onShow() {
    // 应用从后台显示时检查 token 状态
  },
});
