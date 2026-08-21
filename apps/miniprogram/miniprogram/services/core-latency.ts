import { getCoreBaseUrl, generateRequestId } from './config';
import { LatencySample, LatencySummary, summarizeLatency } from './latency-metrics';

const SAMPLE_COUNT = 3;
const PROBE_TIMEOUT_MS = 10_000;

type RequestProfileSubset = {
  rtt?: number;
};

type ProbeResponse = WechatMiniprogram.RequestSuccessCallbackResult & {
  profile?: RequestProfileSubset;
};

export type CoreLatencyReport = LatencySummary & {
  coreBaseUrl: string;
  networkType: string;
  healthSamples: number[];
  statusSamples: number[];
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
        const response = result as ProbeResponse;
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

export async function runCoreLatencyTest(): Promise<CoreLatencyReport> {
  const networkType = await currentNetworkType();
  const healthSamples: LatencySample[] = [];
  const statusSamples: LatencySample[] = [];

  // 交替采样，避免把某一接口固定放在冷连接或热连接阶段。
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    if (index % 2 === 0) {
      healthSamples.push(await probe('/health'));
      statusSamples.push(await probe('/api/v1/status'));
    } else {
      statusSamples.push(await probe('/api/v1/status'));
      healthSamples.push(await probe('/health'));
    }
  }

  return {
    coreBaseUrl: getCoreBaseUrl(),
    networkType,
    healthSamples: healthSamples.map(sample => sample.elapsedMs),
    statusSamples: statusSamples.map(sample => sample.elapsedMs),
    testedAt: new Date().toISOString(),
    ...summarizeLatency(healthSamples, statusSamples),
  };
}
