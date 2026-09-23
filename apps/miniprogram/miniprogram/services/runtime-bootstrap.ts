/**
 * 小程序运行时初始化。
 *
 * 任意入口（首页、Tab、扫码、分享卡片、通知、企业微信菜单）都可能成为首个页面。
 * 页面不依赖应用级 Launch 中转页；需要用户/家庭上下文的页面调用
 * ensureRuntimeReady()，与 App 入口协调共享同一轮初始化。
 *
 * 设计要点：
 * - Access Token 通过 auth.ensureAccessToken() 静默恢复；
 * - 用户与家庭权限并行加载；
 * - 并发调用共享同一个进行中的初始化；
 * - 成功后本进程直接复用；显式 reset 后才重新初始化；
 * - 不缓存家庭业务事实、不绕过 LifeSpace 权限。
 */

import { ensureAccessToken } from './auth';
import {
  currentFamilyStore,
  userStore,
  loadCurrentUser,
  loadFamilies,
  refreshFamilyState,
} from '../stores/index';

let runtimeReady = false;
let readyPromise: Promise<void> | null = null;

function runtimeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export async function ensureRuntimeReady(options: { force?: boolean } = {}): Promise<void> {
  const { force = false } = options;

  if (!force && runtimeReady && userStore.value) return;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    await ensureAccessToken();

    const [user, families] = await Promise.all([
      loadCurrentUser(),
      loadFamilies({ force: true }),
    ]);

    if (user.status === 'disabled') {
      throw runtimeError('USER_DISABLED', '账号已被禁用');
    }

    refreshFamilyState(families);

    // 列表非空时 refreshFamilyState 必然选中一个可访问家庭。
    if (!currentFamilyStore.value && families.length > 0) {
      throw runtimeError('RUNTIME_CONTEXT_INVALID', '当前家庭上下文初始化失败');
    }

    runtimeReady = true;
  })();

  try {
    await readyPromise;
  } catch (error) {
    runtimeReady = false;
    throw error;
  } finally {
    readyPromise = null;
  }
}

export function resetRuntimeReady(): void {
  runtimeReady = false;
}
