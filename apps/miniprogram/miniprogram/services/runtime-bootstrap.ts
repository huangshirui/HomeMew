/**
 * 小程序运行时初始化。
 *
 * 企业微信菜单、扫码链接等场景可能直接进入业务页面，绕过完整的启动路径。
 * 页面在访问 LifeSpace 数据前调用此方法，确保身份和家庭上下文已准备完成。
 */

import { hasValidToken, loginAndSaveToken } from './auth';
import { currentFamilyStore, loadCurrentUser, loadFamilies, refreshFamilyState } from '../stores/index';

let readyPromise: Promise<void> | null = null;

export async function ensureRuntimeReady(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (!hasValidToken()) {
      await loginAndSaveToken();
    }

    await loadCurrentUser();
    const families = await loadFamilies({ force: true });
    refreshFamilyState(families);

    if (!currentFamilyStore.value && families.length > 0) {
      throw new Error('当前没有可访问的家庭空间');
    }
  })();

  try {
    await readyPromise;
  } catch (error) {
    readyPromise = null;
    throw error;
  }
}
