import { FamilyListItem } from './types/index';
import { ensureProductionRuntimeStorage, getApplicationBaseUrl } from './services/config';
import { reportMiniProgramActivityOncePerDay } from './services/activity';
import { coordinateAppEntry, AppEntryOptions } from './services/entry-navigation';

App<IAppOption>({
  globalData: { userInfo: null, currentFamily: null, families: [] as FamilyListItem[] },

  onLaunch() {
    ensureProductionRuntimeStorage();
    console.info('[HomeMew Runtime]', { environment: 'production', applicationBaseUrl: getApplicationBaseUrl() });
  },

  onShow(options: AppEntryOptions) {
    // Normal startup never routes through an application-level splash page.
    // Prepare runtime/onboarding in parallel with the requested entry page.
    void coordinateAppEntry(options).catch((error) => {
      console.warn('[HomeMew Entry] coordination failed', error instanceof Error ? error.message : 'unknown');
    });

    void reportMiniProgramActivityOncePerDay().catch((error) => {
      console.warn('[HomeMew Activity] miniprogram report failed', error instanceof Error ? error.message : 'unknown');
    });
  },
});
