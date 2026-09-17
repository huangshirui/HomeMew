export type LatencySummary = {
  healthMedianMs: number;
  statusMedianMs: number;
  workerD1ExtraMs: number;
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function summarizeLatency(
  healthSamples: number[],
  statusSamples: number[],
): LatencySummary {
  const healthMedianMs = median(healthSamples);
  const statusMedianMs = median(statusSamples);

  return {
    healthMedianMs,
    statusMedianMs,
    // 两组 BFF -> Core Service Binding 耗时的差值仅作附加耗时估算。
    workerD1ExtraMs: Math.max(0, statusMedianMs - healthMedianMs),
  };
}
