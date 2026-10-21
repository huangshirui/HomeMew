import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EMOJI_GROUPS, EMOJI_TOTAL } from '../miniprogram/components/record-icon-picker/emoji-data.ts';

const read = (path: string) => readFileSync(new URL('../miniprogram/' + path, import.meta.url), 'utf8');

test('Emoji picker provides the complete Unicode 17 repertoire under classified tabs', () => {
  assert.equal(EMOJI_TOTAL, 3944);
  assert.equal(EMOJI_GROUPS.length, 9);
  assert.deepEqual(EMOJI_GROUPS.map(x => x.title),
    ['表情', '人物', '动物自然', '食物饮品', '旅行地点', '活动', '物品', '符号', '旗帜']);
  const values = EMOJI_GROUPS.flatMap(x => x.entries);
  assert.equal(values.length, EMOJI_TOTAL);
  assert.equal(new Set(values.map(x => x[0])).size, EMOJI_TOTAL);
  for (const [emoji, name] of values) {
    assert.ok(emoji.length > 0 && name.length > 0);
  }
  assert.ok(values.some(x => x[0] === '⚽'));
  assert.ok(values.some(x => x[0] === '🇨🇳'));
});

test('all four editors use one compact shared picker, not per-form emoji grids', () => {
  for (const model of ['events', 'tasks', 'wishes', 'days']) {
    const xml = read('pages/' + model + '/edit.wxml');
    const ts = read('pages/' + model + '/edit.ts');
    const json = JSON.parse(read('pages/' + model + '/edit.json')) as { usingComponents?: Record<string, string> };
    assert.equal((xml.match(/<record-icon-picker\b/g) || []).length, 1, model);
    assert.match(xml, /bind:change="onRecordIconChange"/, model);
    assert.match(ts, /onRecordIconChange\(/, model);
    assert.ok(!xml.includes('iconChoices') && !xml.includes('iconRows'), model);
    assert.equal(json.usingComponents?.['record-icon-picker'], '/components/record-icon-picker/index');
  }
});

test('the shared picker limits display work and has close, clear, image and grouped emoji operations', () => {
  const source = read('components/record-icon-picker/index.ts');
  const xml = read('components/record-icon-picker/index.wxml');
  assert.match(source, /const PAGE_SIZE = 72/);
  assert.match(source, /results\(\)/);
  assert.match(source, /onLoadMore\(\)/);
  assert.match(source, /onSelectEmoji\(/);
  assert.match(source, /onChooseImage\(/);
  assert.match(source, /onClear\(/);
  assert.match(xml, /group-tabs/);
  assert.match(xml, /onSearchInput/);
  assert.match(xml, /onChooseImage/);
  assert.match(xml, /onClear/);
});

test('image pre-upload applies both dimension and byte caps and inspects actual MIME bytes', () => {
  const source = read('services/record-icons.ts');
  assert.match(source, /MAX_DIMENSION = 512/);
  assert.match(source, /Math\.min\(1, MAX_DIMENSION \/ Math\.max\(original\.width, original\.height\)\)/);
  assert.match(source, /compressedWidth: width/);
  assert.match(source, /compressedHeight: height/);
  assert.match(source, /measured\.width > MAX_DIMENSION \|\| measured\.height > MAX_DIMENSION/);
  assert.match(source, /MAX_BYTES = 256 \* 1024/);
  assert.match(source, /mimeFromBytes\(bytes\)/);
});

test('slow image downloads cannot overwrite a newly selected Icon', () => {
  for (const model of ['days', 'events', 'tasks', 'wishes']) {
    const source = read('pages/' + model + '/edit.ts');
    assert.match(source, /!this\.data\.iconTouched && this\.data\.iconFileId === fileId/, model);
  }
});
