import { useEffect } from 'react';

const STORAGE_KEY = 'homemew.activity.web.reportedLocalDay';
let reportedInMemoryDay: string | null = null;
let reportPromise: Promise<void> | null = null;
let reportPromiseDay: string | null = null;

function localDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function storedDay(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberDay(day: string): void {
  reportedInMemoryDay = day;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, day);
  } catch {
    // sessionStorage is only a duplicate-suppression optimization.
  }
}

async function reportWebActivityOncePerDay(): Promise<void> {
  const day = localDayKey();
  if (reportedInMemoryDay === day || storedDay() === day) {
    reportedInMemoryDay = day;
    return;
  }

  if (reportPromise) {
    await reportPromise;
    if (reportedInMemoryDay === day || storedDay() === day) return;
  }

  reportPromiseDay = day;
  reportPromise = (async () => {
    const response = await fetch('/api/activity/me', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Activity report failed (${response.status})`);
    rememberDay(day);
  })();

  try {
    await reportPromise;
  } finally {
    if (reportPromiseDay === day) {
      reportPromise = null;
      reportPromiseDay = null;
    }
  }
}

export function ActivityReporter() {
  useEffect(() => {
    const reportWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void reportWebActivityOncePerDay().catch((error) => {
        console.warn('[HomeMew Activity] web report failed', error instanceof Error ? error.message : 'unknown');
      });
    };

    reportWhenVisible();
    document.addEventListener('visibilitychange', reportWhenVisible);
    return () => document.removeEventListener('visibilitychange', reportWhenVisible);
  }, []);

  return null;
}
