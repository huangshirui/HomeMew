import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eventLocationName, eventLocationToLifeSpace, adaptEventWritePayload, eventLocationWireFormat,
} from './event-location-compat.mjs';
const legacy = { LIFESPACE_EVENT_LOCATION_FORMAT: 'string' };
const modern = { LIFESPACE_EVENT_LOCATION_FORMAT: 'location' };

test('legacy deployed LifeSpace and structured deployed LifeSpace have explicit cutover modes', () => {
  assert.equal(eventLocationWireFormat({}), 'string');
  assert.equal(eventLocationWireFormat(legacy), 'string');
  assert.equal(eventLocationWireFormat(modern), 'location');
  assert.throws(() => eventLocationWireFormat({ LIFESPACE_EVENT_LOCATION_FORMAT: 'auto' }));
});
test('stable Mini Event DTO always exposes a name whether LifeSpace has string or object', () => {
  assert.equal(eventLocationName(' 教室 '), '教室');
  assert.equal(eventLocationName({ name: ' 教室 ', coordinates: { latitude: 31, longitude: 121 } }), '教室');
  assert.equal(eventLocationName(null), null);
  assert.equal(eventLocationName({ coordinates: { latitude: 31, longitude: 121 } }), null);
});
test('only configured Location upstream gets name-only canonical objects', () => {
  assert.equal(eventLocationToLifeSpace(' 教室 ', legacy), '教室');
  assert.deepEqual(eventLocationToLifeSpace(' 教室 ', modern), { name: '教室' });
  assert.equal(eventLocationToLifeSpace(' ', modern), null);
  assert.deepEqual(adaptEventWritePayload({ summary: 'Meeting', location: null }, modern),
    { summary: 'Meeting', location: null });
  assert.deepEqual(adaptEventWritePayload({ summary: 'Meeting' }, modern), { summary: 'Meeting' });
});
test('preserves explicit coordinates only for canonical upstream without losing provider-neutral meaning', () => {
  const coordinates = { name: '场地', address: '上海', coordinates: { latitude: 31, longitude: 121 } };
  assert.deepEqual(eventLocationToLifeSpace(coordinates, modern), coordinates);
  assert.throws(() => eventLocationToLifeSpace(coordinates, legacy), /Rich Location requires/);
  for (const invalid of [
    { name: '场地', foo: true },
    { name: '场地', coordinates: { latitude: 100, longitude: 121 } },
    { name: '场地', coordinates: { latitude: 31 } },
    { name: '场地', address: '' },
  ]) assert.throws(() => eventLocationToLifeSpace(invalid, modern));
});
