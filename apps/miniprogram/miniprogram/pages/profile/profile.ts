/** Historical personal-page route now opens the unified family manager. */
Page({
  onLoad(): void { wx.redirectTo({url:'/pages/family/detail'}); },
});
