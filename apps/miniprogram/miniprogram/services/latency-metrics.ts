export type LatencySample = {
  elapsedMs: number;
  rttMs: number | null;
};

export type LatencySummary = {
  healthMedianMs: number;
  statusMedianMs: number;
  networkRttMedianMs: number | null;
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
  healthSamples: LatencySample[],
  statusSamples: LatencySample[],
): LatencySummary {
  const healthMedianMs = median(healthSamples.map(sample => sample.elapsedMs));
  const statusMedianMs = median(statusSamples.map(sample => sample.elapsedMs));
  const rtts = healthSamples
    .map(sample => sample.rttMs)
    .filter((value): value is number => typeof value === 'number' && value > 0);

  return {
    healthMedianMs,
    statusMedianMs,
    networkRttMedianMs: rtts.length ? median(rtts) : null,
    // 这个差值包含 Core route、D1 往返与瞬时网络抖动，只作为附加耗时估算。
    workerD1ExtraMs: Math.max(0, statusMedianMs - healthMedianMs),
  };
}
