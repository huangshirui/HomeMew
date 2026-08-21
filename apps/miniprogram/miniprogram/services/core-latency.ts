import { request } from './api';
import { getCoreBaseUrl, generateRequestId, STORAGE_KEYS } from './config';
import { LatencySample, LatencySummary, median, summarizeLatency } from './latency-metrics';

const SAMPLE_COUNT = 3;
const PROBE_TIMEOUT_MS = 10_000;

type ProbeResponse = {
  statusCode: number;
  profile?: {
    rtt?: number;
  };
};

export type CoreLatencyReport = LatencySummary & {
  coreBaseUrl: string;
  networkType: string;
  healthSamples: number[];
  statusSamples: number[];
  businessSamples: number[];
  businessMedianMs: number | null;
  testedAt: string;
};

function probe(path: '/health' | '/api/v1/status'): Promise<LatencySample> {
  const baseUrl = getCoreBaseUrl();
  const requestId = generateRequestId();
  const separator = path.includes('?') ? '&' : '?';
  const url = `${baseUrl}${path}${separator}latencyProbe=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      timeout: PROBE_TIMEOUT_MS,
      header: {
        'Cache-Control': 'no-cache',
        'x-request-id': requestId,
      },
      success(result) {
        const response = result as unknown as ProbeResponse;
        const elapsedMs = Date.now() - startedAt;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Core probe failed: HTTP ${response.statusCode}`));
          return;
        }
        const rtt = response.profile?.rtt;
        resolve({
          elapsedMs,
          rttMs: typeof rtt === 'number' && rtt > 0 ? Math.round(rtt) : null,
        });
      },
      fail(error) {
        reject(new Error(error.errMsg || 'Core latency probe failed'));
      },
    });
  });
}

async function businessProbe(familyId: string): Promise<number> {
  const startedAt = Date.now();
  await request<unknown>(
    `/api/v1/spaces/${encodeURIComponent(familyId)}/tasks?status=pending&sort=dueDate%3Aasc&limit=1`,
    { timeout: PROBE_TIMEOUT_MS },
  );
  return Date.now() - startedAt;
}

function currentNetworkType(): Promise<string> {
  return new Promise(resolve => {
    wx.getNetworkType({
      success(result) {
        resolve(result.networkType || 'unknown');
      },
      fail() {
        resolve('unknown');
      },
    });
  });
}

function currentFamilyId(): string | null {
  const value = wx.getStorageSync(STORAGE_KEYS.currentFamilyId) as unknown;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function runCoreLatencyTest(): Promise<CoreLatencyReport> {
  const networkType = await currentNetworkType();
  const familyId = currentFamilyId();
  const healthSamples: LatencySample[] = [];
  const statusSamples: LatencySample[] = [];
  const businessSamples: number[] = [];

  // 三种探针轮换顺序，避免某一接口总是固定落在冷连接或热连接阶段。
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    if (index === 0) {
      healthSamples.push(await probe('/health'));
      statusSamples.push(await probe('/api/v1/status'));
      if (familyId) businessSamples.push(await businessProbe(familyId));
    } else if (index === 1) {
      statusSamples.push(await probe('/api/v1/status'));
      if (familyId) businessSamples.push(await businessProbe(familyId));
      healthSamples.push(await probe('/health'));
    } else {
      if (familyId) businessSamples.push(await businessProbe(familyId));
      healthSamples.push(await probe('/health'));
      statusSamples.push(await probe('/api/v1/status'));
    }
  }

  return {
    coreBaseUrl: getCoreBaseUrl(),
    networkType,
    healthSamples: healthSamples.map(sample => sample.elapsedMs),
    statusSamples: statusSamples.map(sample => sample.elapsedMs),
    businessSamples,
    businessMedianMs: businessSamples.length ? median(businessSamples) : null,
    testedAt: new Date().toISOString(),
    ...summarizeLatency(healthSamples, statusSamples),
  };
}
