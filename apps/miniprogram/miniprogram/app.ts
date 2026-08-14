import { FamilyListItem } from './types/index';

App<IAppOption>({
  globalData: {
    userInfo: null,
    currentFamily: null,
    families: [] as FamilyListItem[],
  },

  onLaunch() {
    // HomeMew no longer depends on WeChat Cloud Development.
    // wx.login() codes are exchanged by the HomeMew Cloudflare application backend.
  },

  onShow() {
    // 应用从后台显示时检查 token 状态
  },
});
