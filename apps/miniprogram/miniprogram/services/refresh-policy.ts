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
