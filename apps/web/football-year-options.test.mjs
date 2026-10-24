import test from 'node:test';
import assert from 'node:assert/strict';
import { footballYearOptions } from './src/pages/football-year-options.ts';

test('football year dropdown has only latest five years by default', () => {
  assert.deepEqual(footballYearOptions(2026), ['2026','2025','2024','2023','2022']);
  assert.equal(footballYearOptions(2026).includes('1992'),false);
});
test('dropdown rolls forward automatically after New Year, without code updates', () => {
  assert.deepEqual(footballYearOptions(2027), ['2027','2026','2025','2024','2023']);
});
test('selected older or future custom years remain visible and do not grow into a huge range', () => {
  assert.deepEqual(footballYearOptions(2026,'1992'),['2026','2025','2024','2023','2022','1992']);
  assert.deepEqual(footballYearOptions(2026,'2030'),['2030','2026','2025','2024','2023','2022']);
  assert.deepEqual(footballYearOptions(2026,'2026'),footballYearOptions(2026));
  assert.deepEqual(footballYearOptions(2026,'not-a-year'),footballYearOptions(2026));
});
