import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function source(path) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

test('desktop family selector replaces duplicated branding and family card', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.doesNotMatch(shell, /function Brand\(/u);
  assert.doesNotMatch(shell, /<Brand\s*\/>/u);
  assert.match(shell, /aria-label=\{mobile \? '移动端切换家庭' : '切换家庭'\}/u);
  assert.match(shell, /group-hover:opacity-100/u);
  assert.match(shell, /focus-within:ring-2/u);
  assert.match(shell, /absolute inset-0 h-full w-full cursor-pointer opacity-0/u);
  assert.doesNotMatch(shell, /rounded-2xl bg-white px-3 py-3 shadow-sm ring-1 ring-stone-200/u);
  assert.match(shell, /members\.length/u);
});

test('only mobile has a persistent shell header; desktop keeps page-owned headers', () => {
  const shell = source('./src/components/app-shell.tsx');
  assert.match(shell, /<header className="[^"]*lg:hidden"/u);
  assert.doesNotMatch(shell, /家庭空间/u);
  assert.match(shell, /<Outlet key=\{currentFamily\?\.id \?\? 'no-family'\} \/>/u);
  const home = source('./src/pages/home-page.tsx');
  assert.match(home, /\{dateLabel\}/u);
  assert.doesNotMatch(home, /\{dateLabel\} · \{currentFamily\.name\}/u);
});

test('family administration uses the shared navigation selection, not a local selector', () => {
  const family = source('./src/pages/family-page.tsx');
  assert.doesNotMatch(family, /setCurrentFamilyId/u);
  assert.doesNotMatch(family, /当前家庭\s*<select/u);
});

test('rapid switching cannot overwrite new family members with a stale response', () => {
  const provider = source('./src/components/household-provider.tsx');
  assert.match(provider, /const membersRequestId = useRef\(0\)/u);
  assert.match(provider, /if \(requestId === membersRequestId\.current\) setMembers\(result\)/u);
  assert.match(provider, /setCurrentFamilyIdState\(familyId\);\s*setMembers\(\[\]\);/u);
});

test('mobile calendar offers spacious date selection and a per-day agenda', () => {
  const calendar = source('./src/pages/calendar-page.tsx');
  assert.match(calendar, /onClick=\{\(\) => setSelectedDay\(day\)\}/u);
  assert.match(calendar, /aria-pressed=\{isSelected\}/u);
  assert.match(calendar, /min-h-12 w-full flex-col/u);
  assert.match(calendar, /className="space-y-3 sm:hidden"/u);
  assert.match(calendar, /<CalendarAgenda events=\{activeEvents\}/u);
  assert.match(calendar, /onClick=\{\(\) => openCreate\(activeDay\)\}/u);
  assert.match(calendar, /gridDays\.includes\(selectedDay\)/u);
});

test('main family pages use compact mobile headings and retain larger desktop titles', () => {
  for (const name of ['calendar', 'tasks', 'days', 'wishes', 'family', 'integrations', 'settings']) {
    const page = source(`./src/pages/${name}-page.tsx`);
    assert.match(page, /flex items-center gap-3 sm:block/u, `${name} title should align with its icon on mobile`);
    assert.match(page, /text-2xl sm:mt-4 sm:text-3xl/u, `${name} desktop typography should remain`);
  }
});
