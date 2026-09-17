import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function service(relative: string): string {
  return readFileSync(new URL(`../miniprogram/services/${relative}`, import.meta.url), 'utf8');
}

function page(relative: string): string {
  return readFileSync(new URL(`../miniprogram/pages/${relative}`, import.meta.url), 'utf8');
}

test('family close uses the fixed HomeMew route', () => {
  const families = service('families.ts');
  assert.match(families, /export function closeFamily/);
  assert.match(families, /\$\{base\(familyId\)\}\/close/);
  assert.doesNotMatch(families, /\/api\/v1\/spaces/);
  assert.match(families, /skipRetry:\s*true/);
});

test('family detail separates owner close from ordinary member leave', () => {
  const detail = page('family/detail.ts');
  const template = page('family/detail.wxml');
  assert.match(detail, /isFamilyOwner/);
  assert.match(detail, /async onClose/);
  assert.match(detail, /SPACE_OWNER_REQUIRED/);
  assert.match(detail, /SPACE_VERSION_CONFLICT/);
  assert.match(template, /wx:if="\{\{!isOwner\}\}"[^>]*bindtap="onLeave"/);
  assert.match(template, /wx:if="\{\{isOwner\}\}"[^>]*bindtap="onClose"/);
  assert.match(template, /注销家庭/);
});
