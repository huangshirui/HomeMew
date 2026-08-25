import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const plan = readFileSync(fileURLToPath(new URL('../../docs/web-plan.md', import.meta.url)), 'utf8');

test('W6 browser acceptance remains closed in the delivery plan', () => {
  assert.match(plan, /W6 — staging acceptance and product convergence — acceptance complete, polish ongoing/u);
  assert.match(plan, /real Cloudflare Access household CRUD\/action acceptance completed on 2026-08-25/u);
  assert.doesNotMatch(plan, /run\/finish real household CRUD\/action acceptance/u);
  assert.doesNotMatch(plan, /only after household browser acceptance/u);
});
