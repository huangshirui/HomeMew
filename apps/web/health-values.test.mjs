import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, dateRange, measurementPayload, eventPayload } from './src/pages/health-values.ts';

const metric = { id: 'rec_synthetic', version: 1, valueType: 'number', name: 'Synthetic' };
test('strict date-only validation and leap-day half-open ranges', () => {
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-11-16'), true);
  assert.deepEqual(dateRange('2024-02-29'), { kind: 'date', start: '2024-02-29', endExclusive: '2024-03-01' });
  assert.throws(() => dateRange('2026-02-30'));
});
test('measurement keeps zero/false distinct from absent and prevents wrong Person IDs', () => {
  const payload = measurementPayload('per_synthetic', metric, '2026-01-01', '0', 'unit', '');
  assert.equal(payload.valueNumber, 0); assert.equal(payload.valueText, null); assert.equal(payload.valueBoolean, null);
  const flag = measurementPayload('per_synthetic', { ...metric, valueType: 'boolean' }, '2026-01-01', 'false', '', '');
  assert.equal(flag.valueBoolean, false); assert.equal(flag.valueNumber, null);
  assert.throws(() => measurementPayload('usr_synthetic', metric, '2026-01-01', '1', '', ''));
  assert.throws(() => measurementPayload('per_synthetic', metric, '2026-02-30', '1', '', ''));
  assert.throws(() => measurementPayload('per_synthetic', metric, '2026-01-01', 'Infinity', '', ''));
});
test('event editing preserves existing instants and rich location; prevents subject switch', () => {
  const record = { id: 'rec_synthetic', version: 1, subjectPersonId: 'per_synthetic', summary: 'Example', eventType: 'visit',
    when: { kind: 'instant', start: '2026-01-01T12:00:00Z', endExclusive: '2026-01-01T13:00:00Z' },
    location: { name: 'Example', address: 'Synthetic address' } };
  const payload = eventPayload('per_synthetic', 'Example', 'visit', '2026-02-01', 'Example', '', record);
  assert.deepEqual(payload.when, record.when); assert.deepEqual(payload.location, record.location);
  assert.throws(() => eventPayload('per_other','Example','visit','2026-02-01','','',record));
  const shifted = eventPayload('per_synthetic','Example','visit','2026-02-01','Other','',{...record,when:{kind:'date',start:'2026-01-01',endExclusive:'2026-01-04'}});
  assert.deepEqual(shifted.when,{kind:'date',start:'2026-02-01',endExclusive:'2026-02-04'});
  assert.deepEqual(shifted.location,{name:'Other'});
});
