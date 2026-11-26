import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ActivityAwarePoll, setMiniAppForeground, pollIntervalForIdle } from '../miniprogram/services/refresh-policy.ts';

function harness() {
  let now = 0, next = 0, polls = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const clock = {
    now: () => now,
    schedule(fn: () => void, delay: number) {
      const id = ++next;
      queue.set(id, { at: now + delay, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel(id: ReturnType<typeof setTimeout>) { queue.delete(id as unknown as number); },
  };
  const controller = new ActivityAwarePoll(() => { polls++; }, clock);
  function advance(ms: number) {
    const end = now + ms;
    while (true) {
      const entry = [...queue].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      queue.delete(entry[0]);
      now = entry[1].at;
      entry[1].fn();
    }
    now = end;
  }
  return { controller, advance, count: () => polls, timers: () => queue.size };
}

test('active, slowed and paused cadence boundaries', () => {
  assert.equal(pollIntervalForIdle(299_999), 60_000);
  assert.equal(pollIntervalForIdle(300_000), 300_000);
  assert.equal(pollIntervalForIdle(900_000), null);
});

test('an open unattended desktop tab stops network polling after 15 minutes', () => {
  setMiniAppForeground(true);
  const h = harness();
  try {
    h.controller.show();
    h.controller.show();
    assert.equal(h.timers(), 1);
    h.advance(300_000);
    assert.equal(h.count(), 5);
    h.advance(600_000);
    assert.equal(h.count(), 7);
    assert.equal(h.timers(), 0);
    h.advance(8 * 3600_000);
    assert.equal(h.count(), 7);
    h.controller.activity();
    h.advance(1000);
    assert.equal(h.count(), 8);
  } finally { h.controller.hide(); setMiniAppForeground(false); }
});

test('App hide independently cancels polling even if page onHide is missing', () => {
  setMiniAppForeground(true);
  const h = harness();
  try {
    h.controller.show();
    h.advance(1000);
    assert.equal(h.count(), 1);
    setMiniAppForeground(false);
    assert.equal(h.timers(), 0);
    h.controller.activity();
    h.advance(8 * 3600_000);
    assert.equal(h.count(), 1);
    setMiniAppForeground(true);
    h.advance(1000);
    assert.equal(h.count(), 2);
    h.controller.hide();
    assert.equal(h.timers(), 0);
    setMiniAppForeground(false);
    setMiniAppForeground(true);
    h.advance(120_000);
    assert.equal(h.count(), 2);
  } finally { h.controller.hide(); setMiniAppForeground(false); }
});

test('page shown before App foreground cannot poll until App resumes', () => {
  setMiniAppForeground(false);
  const h = harness();
  try {
    h.controller.show();
    h.advance(120_000);
    assert.equal(h.count(), 0);
    setMiniAppForeground(true);
    h.advance(1000);
    assert.equal(h.count(), 1);
    h.controller.hide();
    h.advance(120_000);
    assert.equal(h.count(), 1);
  } finally { h.controller.hide(); setMiniAppForeground(false); }
});

test('all three polling tabs use the shared lifecycle and input policy', () => {
  const source = (path: string) => readFileSync(new URL('../miniprogram/' + path, import.meta.url), 'utf8');
  const app = source('app.ts');
  assert.match(app, /onShow\([\s\S]*?setMiniAppForeground\(true\)/);
  assert.match(app, /onHide\([\s\S]*?setMiniAppForeground\(false\)/);
  for (const tab of ['home', 'events', 'tasks']) {
    const page = source('pages/' + tab + '/' + tab + '.ts');
    assert.match(page, /new ActivityAwarePoll/);
    assert.match(page, /_pollController\?\.hide\(\)/);
    assert.match(page, /_pollController\?\.activity\(\)/);
    assert.doesNotMatch(page, /setInterval\(\(\) => this\._poll\(/);
    const wxml = source('pages/' + tab + '/' + tab + '.wxml');
    assert.match(wxml, /capture-bind:touchstart="onPollActivity"/);
    assert.match(wxml, /capture-bind:tap="onPollActivity"/);
  }
});
