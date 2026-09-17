import { request } from './api';
import { getApplicationBaseUrl, STORAGE_KEYS } from './config';
import { LatencySummary, median, summarizeLatency } from './latency-metrics';

type DiagnosticResponse = {
  target: string;
  sampleCount: number;
  healthSamples: number[];
  statusSamples: number[];
  businessSamples: number[];
  testedAt: string;
};

export type CoreLatencyReport = LatencySummary & {
  applicationBaseUrl: string;
  clientDiagnosticElapsedMs: number;
  networkType: string;
  healthSamples: number[];
  statusSamples: number[];
  businessSamples: number[];
  businessMedianMs: number | null;
  testedAt: string;
};

function currentNetworkType(): Promise<string> {
  return new Promise(resolve => wx.getNetworkType({
    success: result => resolve(result.networkType || 'unknown'),
    fail: () => resolve('unknown'),
  }));
}

function currentFamilyId(): string | null {
  const value = wx.getStorageSync(STORAGE_KEYS.currentFamilyId) as unknown;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function runCoreLatencyTest(): Promise<CoreLatencyReport> {
  const familyId = currentFamilyId();
  if (!familyId) throw new Error('请先选择家庭后再测试');
  const diagnostic = async (): Promise<{ result: DiagnosticResponse; elapsedMs: number }> => {
    const startedAt = Date.now();
    const result = await request<DiagnosticResponse>('/api/v1/miniprogram/diagnostics/lifespace-core', {
      method: 'POST',
      data: { familyId },
      skipRetry: true,
      timeout: 40_000,
    });
    return { result, elapsedMs: Date.now() - startedAt };
  };
  const [networkType, { result, elapsedMs }] = await Promise.all([
    currentNetworkType(),
    diagnostic(),
  ]);
  return {
    applicationBaseUrl: getApplicationBaseUrl(),
    clientDiagnosticElapsedMs: elapsedMs,
    networkType,
    healthSamples: result.healthSamples,
    statusSamples: result.statusSamples,
    businessSamples: result.businessSamples,
    businessMedianMs: result.businessSamples.length ? median(result.businessSamples) : null,
    testedAt: result.testedAt,
    ...summarizeLatency(result.healthSamples, result.statusSamples),
  };
}
