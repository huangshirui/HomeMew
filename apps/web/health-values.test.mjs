import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, dateRange, measurementPayload, eventPayload, growthMetrics, derivedBmi, healthSince, healthMonth } from './src/pages/health-values.ts';

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

test('BMI uses unique same-date subject measurements, explicit units, no inferred pairing',()=>{
  const h={...metric,id:'rec_height',name:'身高',defaultUnit:'cm'},w={...metric,id:'rec_weight',name:'体重',defaultUnit:'kg'};
  assert.equal(growthMetrics([h,w],true).height.id,h.id);
  assert.equal(growthMetrics([h,w,{...h,id:'rec_duplicate'}],true).height,undefined);
  assert.equal(growthMetrics([h,w],false).weight,undefined);
  const row=(id,metricId,valueNumber,unit,observedDate='2026-01-01',subjectPersonId='per_synthetic')=>({id,metricId,valueNumber,unit,observedDate,subjectPersonId,version:1});
  const height=row('h',h.id,150,'cm'),weight=row('w',w.id,45,'kg');
  assert.deepEqual(derivedBmi([height,weight],h.id,w.id,'per_synthetic'),{date:'2026-01-01',value:20});
  assert.equal(derivedBmi([height,{...weight,observedDate:'2026-01-02'}],h.id,w.id,'per_synthetic'),null);
  assert.equal(derivedBmi([height,weight,{...weight,id:'w2'}],h.id,w.id,'per_synthetic'),null);
  assert.equal(derivedBmi([height,{...weight,unit:'lb'}],h.id,w.id,'per_synthetic'),null);
  assert.equal(derivedBmi([height,{...weight,subjectPersonId:'per_other'}],h.id,w.id,'per_synthetic'),null);
});

test('BMI excludes a date split across pagination without suppressing complete newer dates',()=>{
  const h={id:'h',metricId:'rec_height',valueNumber:150,unit:'cm',observedDate:'2026-01-01',subjectPersonId:'per_synthetic',version:1};
  const w={...h,id:'w',metricId:'rec_weight',valueNumber:45,unit:'kg'};
  assert.equal(derivedBmi([h,w],'rec_height','rec_weight','per_synthetic','2026-01-01'),null);
  assert.deepEqual(derivedBmi([h,w],'rec_height','rec_weight','per_synthetic','2025-12-31'),{date:'2026-01-01',value:20});
});

 test('family date presets include the current day and keep calendar boundaries',()=>{
 assert.equal(healthSince('2024-03-01',2),'2024-02-29');assert.equal(healthSince('2026-01-01',1),'2026-01-01');assert.equal(healthMonth('2026-11-18'),'2026年11月');assert.throws(()=>healthSince('invalid',90));
 });
