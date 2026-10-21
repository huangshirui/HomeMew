import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const picker = read('./src/components/record-icon.tsx');

test('Web uses one shared Notion-style Icon dialog rather than inline Emoji fields', () => {
  assert.match(picker, /export function RecordIconField\(/u);
  assert.match(picker, /createPortal\(/u);
  assert.match(picker, /role="dialog" aria-modal="true"/u);
  assert.match(picker, /aria-label=\{selectedEmoji \|\| icon\.iconFile/u);
  assert.match(picker, /role="tablist"/u);
  assert.match(picker, /onClick=\{\(\) => selectCategory\(item\.key\)\}/u);
  assert.match(picker, /type="search"/u);
  assert.match(picker, /const PAGE_SIZE = 72/u);
  assert.match(picker, /results\.slice\(0, shown\)/u);
  assert.match(picker, /onScroll=\{event =>/u);
  assert.match(picker, /type="file" accept="image\/png,image\/jpeg,image\/webp"/u);
  assert.match(picker, /onClick=\{\(\) => pick\(emptyIconDraft\(\)\)\}/u);
  assert.doesNotMatch(picker, /CHOICES\.map\(/u);
});

test('Web and Mini use exactly one Unicode 17.0 grouped Emoji dataset', () => {
  assert.match(picker, /from '\.\.\/\.\.\/\.\.\/miniprogram\/miniprogram\/components\/record-icon-picker\/emoji-data'/u);
  const emojiSource = read('../miniprogram/miniprogram/components/record-icon-picker/emoji-data.ts');
  assert.match(emojiSource, /export const EMOJI_TOTAL = 3944/u);
  assert.match(picker, /EMOJI_GROUPS\.flatMap/u);
});

test('all four Web record editors mount the same Icon picker next to title', () => {
  const editors = [
    ['./src/pages/days-page.tsx', 'day_record', '名称'],
    ['./src/pages/calendar-page.tsx', 'event', '日程名称'],
    ['./src/pages/tasks-page.tsx', 'task', '待办名称'],
    ['./src/pages/wishes-page.tsx', 'wish', '愿望'],
  ];
  for (const [path, model, label] of editors) {
    const source = read(path);
    const index = source.indexOf('<RecordIconField icon={draft.icon}');
    assert.ok(index > 0, `missing shared Icon picker in ${model}`);
    const preceding = source.slice(Math.max(0, index - 130), index);
    assert.match(preceding, /<div className="flex items-end gap-3">/u, model);
    const near = source.slice(index, index + 1000);
    assert.match(near, new RegExp(`modelKey="${model}"`), model);
    assert.ok(near.includes(label), `picker must precede ${model} title`);
    assert.equal((source.match(/<RecordIconField icon=\{draft\.icon\}/gu) ?? []).length, 1, model);
  }
});

test('record metadata is optional and saved alongside business fields once', () => {
  assert.match(picker, /return unchanged \? \{\} : \{ presentation: \{ icon \} \}/u);
  for (const path of ['./src/pages/days-page.tsx','./src/pages/calendar-page.tsx','./src/pages/tasks-page.tsx','./src/pages/wishes-page.tsx']) {
    assert.match(read(path), /presentationToSave\(/u, path);
  }
});

test('Web image picker resizes on the longest side and enforces File limits before POST', () => {
  assert.match(picker, /const MAX_ICON_BYTES = 256 \* 1024/u);
  assert.match(picker, /const MAX_ICON_DIMENSION = 512/u);
  assert.match(picker, /createImageBitmap\(file\)/u);
  assert.match(picker, /Math\.min\(1, MAX_ICON_DIMENSION \/ longest\)/u);
  assert.match(picker, /canvas\.width = Math\.max\(1/u);
  assert.match(picker, /canvas\.height = Math\.max\(1/u);
  assert.match(picker, /canvas\.toBlob\(resolve, 'image\/webp', quality\)/u);
  assert.match(picker, /blob\.size <= MAX_ICON_BYTES/u);
  assert.match(picker, /body: image/u);
});

test('shared picker supports keyboard close, focus restoration and disables during save', () => {
  assert.match(picker, /event\.key === 'Escape'/u);
  assert.match(picker, /triggerRef\.current\?\.focus\(\)/u);
  assert.match(picker, /aria-modal="true"/u);
  for (const model of ['calendar-page', 'tasks-page', 'wishes-page', 'days-page']) {
    const source = read(`./src/pages/${model}.tsx`);
    assert.match(source, /disabled=\{(?:readOnly|!editable) \|\| saving\}/u, model);
  }
});
