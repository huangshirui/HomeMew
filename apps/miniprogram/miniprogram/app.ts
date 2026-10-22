import { FamilyListItem } from './types/index';
import { ensureRuntimeEnvironmentStorage, getApplicationBaseUrl, selectLaunchEnvironment } from './services/config';
import { reportMiniProgramActivityOncePerDay } from './services/activity';
import { coordinateAppEntry, AppEntryOptions } from './services/entry-navigation';
import { resetRuntimeReady } from './services/runtime-bootstrap';
import { invalidatePendingAuth } from './services/auth';
import { clearUserState } from './stores/index';

App<IAppOption>({
  globalData: { userInfo: null, currentFamily: null, families: [] as FamilyListItem[] },

  onLaunch() {
    const environment = ensureRuntimeEnvironmentStorage();
    console.info('[HomeMew Runtime]', { environment, applicationBaseUrl: getApplicationBaseUrl() });
  },

  onShow(options: AppEntryOptions) {
    const changed = selectLaunchEnvironment(options?.query?.env);
    if (changed) {
      invalidatePendingAuth();
      // A different backend has different principals, tokens, families and caches.
      ensureRuntimeEnvironmentStorage();
      resetRuntimeReady();
      clearUserState();
    }
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
