/**
 * 小程序运行时初始化。
 *
 * 企业微信菜单、扫码链接、分享卡片、通知跳转等场景可能直接进入业务页面，
 * 绕过 pages/launch/launch 的完整启动路径。业务页面在访问 LifeSpace 数据前
 * 调用 ensureRuntimeReady()，确保身份与家庭上下文已准备完成。
 *
 * 设计要点：
 * - 本进程已经过初始化（用户已加载）时直接复用，避免重复登录 / 拉取家庭；
 * - 并发调用共享同一个进行中的初始化，避免重复请求；
 * - 不缓存家庭业务数据、不绕过 LifeSpace 权限，用户 / 家庭仍以 LifeSpace 为事实来源。
 */

import { hasValidToken, loginAndSaveToken } from './auth';
import {
  currentFamilyStore,
  userStore,
  loadCurrentUser,
  loadFamilies,
  refreshFamilyState,
} from '../stores/index';

/** 进行中的初始化（用于并发去重）；成功后置空，后续调用走 userStore 快路径 */
let readyPromise: Promise<void> | null = null;

export async function ensureRuntimeReady(): Promise<void> {
  // 本进程已初始化过（用户已加载）：直接进入业务页面，无需重复 bootstrap
  if (userStore.value) return;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (!hasValidToken()) {
      await loginAndSaveToken();
    }

    await loadCurrentUser();
    const families = await loadFamilies({ force: true });
    refreshFamilyState(families);

    // 列表非空时 refreshFamilyState 必然已选中一个家庭；
    // 若仍为空，说明用户虽通过登录但无可访问的家庭空间，交由页面展示「创建 / 加入」。
    if (!currentFamilyStore.value && families.length > 0) {
      throw new Error('当前没有可访问的家庭空间');
    }
  })();

  try {
    await readyPromise;
  } catch (error) {
    // 初始化失败：清除进行中的 promise，允许下次重试
    readyPromise = null;
    throw error;
  }

  // 成功后丢弃进行中的 promise：后续调用由 userStore 快路径直接放行
  readyPromise = null;
}
