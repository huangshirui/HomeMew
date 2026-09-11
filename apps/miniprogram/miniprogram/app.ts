import { FamilyListItem } from './types/index';
import {
  ensureRuntimeEnvironmentStorage,
  getRuntimeServiceUrls,
} from './services/config';
import { reportMiniProgramActivityOncePerDay } from './services/activity';

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
    // 任意可直达页面都会经过 App.onShow。Activity 在进程内按本地自然日去重，
    // 上报失败不记成功，后续 onShow 仍可重试；跨日后下一次 onShow 会再次上报。
    void reportMiniProgramActivityOncePerDay().catch((error) => {
      console.warn('[HomeMew Activity] miniprogram report failed', error instanceof Error ? error.message : 'unknown');
    });
  },
});
