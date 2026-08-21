export class AsyncKeyedTtlCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      return Promise.resolve(cached.value);
    }
    if (cached) this.values.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = loader()
      .then(value => {
        this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
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
      return;
    }
    this.values.delete(key);
  }
}
