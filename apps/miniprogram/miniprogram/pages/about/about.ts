import { runCoreLatencyTest } from '../../services/core-latency';

type LatencyView = {
  clientDiagnosticText: string;
  healthText: string;
  statusText: string;
  extraText: string;
  businessText: string;
  healthSamplesText: string;
  statusSamplesText: string;
  businessSamplesText: string;
  networkTypeText: string;
  applicationBaseUrl: string;
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
    version: '1.6.3',
    testing: false,
    errorText: '',
    latency: null as LatencyView | null,
  },

  onLoad(): void {
    // 响应时间测试改为手动点击开始，不再在页面加载时自动触发。
  },

  onStartLatency(): void {
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
          clientDiagnosticText: `${report.clientDiagnosticElapsedMs} ms`,
          healthText: `${report.healthMedianMs} ms`,
          statusText: `${report.statusMedianMs} ms`,
          extraText: `≈ ${report.workerD1ExtraMs} ms`,
          businessText: report.businessMedianMs === null ? '未测试' : `${report.businessMedianMs} ms`,
          healthSamplesText: formatSamples(report.healthSamples),
          statusSamplesText: formatSamples(report.statusSamples),
          businessSamplesText: report.businessSamples.length ? formatSamples(report.businessSamples) : '无当前家庭',
          networkTypeText: networkTypeLabel(report.networkType),
          applicationBaseUrl: report.applicationBaseUrl,
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
