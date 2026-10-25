import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eventLocationName, eventLocationToLifeSpace, adaptEventWritePayload,
} from './event-location.mjs';
test('stable Mini Event DTO always exposes a name whether LifeSpace has string or object', () => {
  assert.equal(eventLocationName(' 教室 '), '教室');
  assert.equal(eventLocationName({ name: ' 教室 ', coordinates: { latitude: 31, longitude: 121 } }), '教室');
  assert.equal(eventLocationName(null), null);
  assert.throws(() => eventLocationName({ coordinates: { latitude: 31, longitude: 121 } }));
});
test('Mini text always becomes canonical Location without deployment switches', () => {
  assert.deepEqual(eventLocationToLifeSpace(' 教室 '), { name: '教室' });
  assert.equal(eventLocationToLifeSpace(' '), null);
  assert.deepEqual(adaptEventWritePayload({ summary: 'Meeting', location: null }),
    { summary: 'Meeting', location: null });
  assert.deepEqual(adaptEventWritePayload({ summary: 'Meeting' }), { summary: 'Meeting' });
});
test('preserves explicit coordinates for the current canonical upstream without losing provider-neutral meaning', () => {
  const coordinates = { name: '场地', address: '上海', coordinates: { latitude: 31, longitude: 121 } };
  assert.deepEqual(eventLocationToLifeSpace(coordinates), coordinates);
  for (const invalid of [
    { name: '场地', foo: true },
    { name: '场地', coordinates: { latitude: 100, longitude: 121 } },
    { name: '场地', coordinates: { latitude: 31 } },
    { name: '场地', address: '' },
  ]) assert.throws(() => eventLocationToLifeSpace(invalid));
});

test('name-only labels obey the same size bound as selected locations', () => {
  assert.throws(() => eventLocationToLifeSpace('x'.repeat(501)));
  assert.deepEqual(eventLocationToLifeSpace('x'.repeat(500)), { name: 'x'.repeat(500) });
});
