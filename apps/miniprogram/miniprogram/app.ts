import { FamilyListItem } from './types/index';
import { ensureRuntimeEnvironmentStorage, getApplicationBaseUrl } from './services/config';
import { reportMiniProgramActivityOncePerDay } from './services/activity';

App<IAppOption>({
  globalData: { userInfo: null, currentFamily: null, families: [] as FamilyListItem[] },

  onLaunch() {
    const environment = ensureRuntimeEnvironmentStorage();
    console.info('[HomeMew Runtime]', { environment, applicationBaseUrl: getApplicationBaseUrl() });
  },

  onShow() {
    void reportMiniProgramActivityOncePerDay().catch((error) => {
      console.warn('[HomeMew Activity] miniprogram report failed', error instanceof Error ? error.message : 'unknown');
    });
  },
});
