export class AsyncKeyedTtlCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly keyGenerations = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private epoch = 0;

  constructor(ttlMs: number, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    if (cached) this.values.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const requestEpoch = this.epoch;
    const requestGeneration = this.keyGenerations.get(key) ?? 0;
    const request = loader()
      .then(value => {
        if (
          this.epoch === requestEpoch
          && (this.keyGenerations.get(key) ?? 0) === requestGeneration
        ) {
          this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });

    this.inFlight.set(key, request);
    return request;
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      this.values.clear();
      this.inFlight.clear();
      this.epoch += 1;
      return;
    }
    this.values.delete(key);
    this.inFlight.delete(key);
    this.keyGenerations.set(key, (this.keyGenerations.get(key) ?? 0) + 1);
  }
}
