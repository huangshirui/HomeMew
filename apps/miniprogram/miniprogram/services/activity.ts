import { ensureAccessToken } from './auth';
import { getApplicationBaseUrl, getRuntimeEnvironment, REQUEST_TIMEOUT } from './config';

let reportedLocalDay: string | null = null;
let reportPromise: Promise<void> | null = null;
let reportPromiseDay: string | null = null;

function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function sendMiniProgramActivity(): Promise<void> {
  const token = await ensureAccessToken();
  await new Promise<void>((resolve, reject) => wx.request({
    url: `${getApplicationBaseUrl()}/api/v1/activity/me`,
    method: 'POST',
    data: { channel: 'miniprogram' },
    header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    timeout: REQUEST_TIMEOUT,
    success(response) {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve();
      else {
        const payload = response.data as { error?: { message?: string } } | undefined;
        reject(new Error(payload?.error?.message || `Activity 上报失败 (${response.statusCode})`));
      }
    },
    fail: error => reject(new Error(`Activity 上报失败: ${error.errMsg}`)),
  }));
}

export async function reportMiniProgramActivityOncePerDay(): Promise<void> {
  const day = getRuntimeEnvironment() + ':' + localDayKey();
  if (reportedLocalDay === day) return;
  if (reportPromise) {
    await reportPromise;
    if (reportedLocalDay === day) return;
  }
  reportPromiseDay = day;
  reportPromise = (async () => {
    // Activity reporting needs only a valid user bearer. It must not trigger
    // profile/family bootstrap or compete with the requested entry page.
    await sendMiniProgramActivity();
    reportedLocalDay = day;
  })();
  try { await reportPromise; } finally {
    if (reportPromiseDay === day) {
      reportPromise = null;
      reportPromiseDay = null;
    }
  }
}
