/**
 * HomeMew Mini: process-local SWR foreground refresh policy.
 * Stores timestamps and UI domain revisions only; never household data.
 */
export const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
export const INITIAL_RETRY_INTERVAL_MS = 10 * 1000;

const revisions = new Map<string, number>();

export function markRefreshDirty(domain: string): void {
  revisions.set(domain, (revisions.get(domain) || 0) + 1);
}

export function getRefreshRevision(domain: string): number {
  return revisions.get(domain) || 0;
}

export class AutoRefreshGate {
  private context = '';
  private lastAttemptAt = 0;
  private seenRevision = -1;

  shouldRefresh(context: string, domain: string, loaded: boolean, now = Date.now()): boolean {
    if (!context || this.context !== context || this.seenRevision !== getRefreshRevision(domain)) return true;
    return now - this.lastAttemptAt >= (loaded ? AUTO_REFRESH_INTERVAL_MS : INITIAL_RETRY_INTERVAL_MS);
  }

  noteRequest(context: string, domain: string, now = Date.now()): void {
    this.context = context;
    this.seenRevision = getRefreshRevision(domain);
    this.lastAttemptAt = now;
  }
}

// Activity-aware network polling. Local display ticks are independent.
export const POLL_SLOW_AFTER_MS = 5 * 60 * 1000;
export const POLL_PAUSE_AFTER_MS = 15 * 60 * 1000;
export const IDLE_POLL_INTERVAL_MS = 5 * 60 * 1000;
const RESUME_DELAY_MS = 1000;

let appForeground = false;
const foregroundListeners = new Set<(foreground: boolean) => void>();

export function setMiniAppForeground(foreground: boolean): void {
  if (appForeground === foreground) return;
  appForeground = foreground;
  foregroundListeners.forEach(listener => listener(foreground));
}

export function pollIntervalForIdle(idleMs: number): number | null {
  if (idleMs >= POLL_PAUSE_AFTER_MS) return null;
  return idleMs >= POLL_SLOW_AFTER_MS ? IDLE_POLL_INTERVAL_MS : AUTO_REFRESH_INTERVAL_MS;
}

type PollClock = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

const systemPollClock: PollClock = {
  now: () => Date.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: timer => clearTimeout(timer),
};

/** One visible page owns one scheduler. No network timer survives app/page hide or idle pause. */
export class ActivityAwarePoll {
  private visible = false;
  private lastActivityAt = 0;
  private lastAttemptAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly poll: () => void;
  private readonly clock: PollClock;

  constructor(poll: () => void, clock: PollClock = systemPollClock) {
    this.poll = poll;
    this.clock = clock;
  }

  private readonly onForeground = (foreground: boolean): void => {
    this.clear();
    if (foreground && this.visible) this.resume();
  };

  show(): void {
    if (this.visible) return;
    this.visible = true;
    foregroundListeners.add(this.onForeground);
    if (appForeground) this.resume();
  }

  hide(): void {
    this.visible = false;
    foregroundListeners.delete(this.onForeground);
    this.clear();
  }

  /** Call from actual user input only, never from renders or automatic scroll changes. */
  activity(): void {
    if (!this.visible || !appForeground) return;
    const now = this.clock.now();
    const wasIdle = now - this.lastActivityAt >= POLL_SLOW_AFTER_MS;
    this.lastActivityAt = now;
    if (wasIdle || this.timer === null) {
      this.clear();
      this.schedule(RESUME_DELAY_MS);
    }
  }

  private resume(): void {
    this.lastActivityAt = this.clock.now();
    this.lastAttemptAt = null;
    // Existing page throttles avoid duplicating initial/explicit refreshes.
    this.schedule(RESUME_DELAY_MS);
  }

  private clear(): void {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    if (!this.visible || !appForeground) return;
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private tick(): void {
    if (!this.visible || !appForeground) return;
    const now = this.clock.now();
    const idle = Math.max(0, now - this.lastActivityAt);
    const interval = pollIntervalForIdle(idle);
    if (interval === null) return;
    try {
      if (this.lastAttemptAt === null || now - this.lastAttemptAt >= interval) {
        this.lastAttemptAt = now;
        this.poll();
      }
    } finally {
      if (this.visible && appForeground) {
        const nextInterval = pollIntervalForIdle(Math.max(0, this.clock.now() - this.lastActivityAt));
        if (nextInterval !== null) {
          const current = this.clock.now();
          const untilDue = Math.max(1, (this.lastAttemptAt ?? current) + nextInterval - current);
          const untilTransition = this.lastActivityAt + (current - this.lastActivityAt < POLL_SLOW_AFTER_MS
            ? POLL_SLOW_AFTER_MS : POLL_PAUSE_AFTER_MS) - current;
          this.clear();
          this.schedule(Math.max(1, Math.min(untilDue, untilTransition)));
        }
      }
    }
  }
}
