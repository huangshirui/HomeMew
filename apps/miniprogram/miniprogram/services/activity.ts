import { getStoredToken, hasValidToken, loginAndSaveToken } from './auth';
import { getLoginBackendUrl, REQUEST_TIMEOUT } from './config';
import { ensureRuntimeReady } from './runtime-bootstrap';

let reportedLocalDay: string | null = null;
let reportPromise: Promise<void> | null = null;
let reportPromiseDay: string | null = null;

function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function ensureActivityToken(): Promise<string> {
  if (!hasValidToken()) await loginAndSaveToken();
  const token = getStoredToken();
  if (!token) throw new Error('Activity 上报缺少有效登录令牌');
  return token;
}

async function sendMiniProgramActivity(): Promise<void> {
  const token = await ensureActivityToken();
  await new Promise<void>((resolve, reject) => {
    wx.request({
      url: `${getLoginBackendUrl()}/api/v1/activity/me`,
      method: 'POST',
      data: { channel: 'miniprogram' },
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: REQUEST_TIMEOUT,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        const payload = response.data as { error?: { message?: string } } | undefined;
        reject(new Error(payload?.error?.message || `Activity 上报失败 (${response.statusCode})`));
      },
      fail(error) {
        reject(new Error(`Activity 上报失败: ${error.errMsg}`));
      },
    });
  });
}

export async function reportMiniProgramActivityOncePerDay(): Promise<void> {
  const day = localDayKey();
  if (reportedLocalDay === day) return;

  if (reportPromise) {
    await reportPromise;
    if (reportedLocalDay === day) return;
  }

  reportPromiseDay = day;
  reportPromise = (async () => {
    await ensureRuntimeReady();
    await sendMiniProgramActivity();
    reportedLocalDay = day;
  })();

  try {
    await reportPromise;
  } finally {
    if (reportPromiseDay === day) {
      reportPromise = null;
      reportPromiseDay = null;
    }
  }
}
