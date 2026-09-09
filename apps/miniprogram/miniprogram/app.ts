import { FamilyListItem } from './types/index';
import {
  ensureRuntimeEnvironmentStorage,
  getRuntimeServiceUrls,
} from './services/config';

App<IAppOption>({
  globalData: {
    userInfo: null,
    currentFamily: null,
    families: [] as FamilyListItem[],
  },

  onLaunch() {
    // HomeMew no longer depends on WeChat Cloud Development.
    // wx.login() codes are exchanged by the HomeMew Cloudflare application backend.
    const environment = ensureRuntimeEnvironmentStorage();
    const urls = getRuntimeServiceUrls();
    console.info('[HomeMew Runtime]', { environment, ...urls });
  },

  onShow() {
    // 应用从后台显示时检查 token 状态。
    // 业务页面通过 ensureRuntimeReady() 确保身份和家庭上下文可用。
  },
});
