import { runCoreLatencyTest } from '../../services/core-latency';

type LatencyView = {
  networkRttText: string;
  healthText: string;
  statusText: string;
  extraText: string;
  healthSamplesText: string;
  statusSamplesText: string;
  networkTypeText: string;
  coreBaseUrl: string;
  testedAtText: string;
};

function formatSamples(values: number[]): string {
  return values.map(value => `${value}ms`).join(' / ');
}

function networkTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    wifi: 'Wi-Fi',
    '2g': '2G',
    '3g': '3G',
    '4g': '4G',
    '5g': '5G',
    ethernet: '有线网络',
    none: '无网络',
    unknown: '未知',
  };
  return labels[value] || value;
}

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

Page({
  data: {
    version: '1.4.7',
    testing: false,
    errorText: '',
    latency: null as LatencyView | null,
  },

  onLoad(): void {
    this.runLatencyTest();
  },

  async runLatencyTest(): Promise<void> {
    if (this.data.testing) return;
    this.setData({ testing: true, errorText: '' });
    try {
      const report = await runCoreLatencyTest();
      this.setData({
        testing: false,
        latency: {
          networkRttText: report.networkRttMedianMs === null ? '—' : `${report.networkRttMedianMs} ms`,
          healthText: `${report.healthMedianMs} ms`,
          statusText: `${report.statusMedianMs} ms`,
          extraText: `≈ ${report.workerD1ExtraMs} ms`,
          healthSamplesText: formatSamples(report.healthSamples),
          statusSamplesText: formatSamples(report.statusSamples),
          networkTypeText: networkTypeLabel(report.networkType),
          coreBaseUrl: report.coreBaseUrl,
          testedAtText: formatLocalTime(report.testedAt),
        } as LatencyView,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '响应时间测试失败';
      console.error('[About] Core latency test failed:', error);
      this.setData({ testing: false, errorText: message });
    }
  },

  onRetryLatency(): void {
    this.runLatencyTest();
  },
});
