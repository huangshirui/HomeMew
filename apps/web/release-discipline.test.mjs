import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
test('all HomeMew deployment workflows pin checkout and enforce provenance before deployment',()=>{
 for(const name of ['web-preview-deploy.yml','web-production-deploy.yml','backend-staging-deploy.yml','backend-production-deploy.yml']){
  const source=fs.readFileSync(new URL('../../.github/workflows/'+name,import.meta.url),'utf8');
  assert.match(source,/ref: \$\{\{ github.sha \}\}/,name);
  assert.match(source,/GH_TOKEN: \$\{\{ github.token \}\}/,name);
  assert.ok(source.indexOf('verify-release-candidate.mjs')<source.indexOf(' wrangler@'),name);
  assert.match(source,/actions: read/,name);assert.match(source,/pull-requests: read/,name);
  assert.doesNotMatch(source,/^  push:/m,name);
 }
});

test('every PR supplies the CI evidence required to release its merge candidate',()=>{
 for(const name of ['web-check.yml','backend-check.yml']){
  const source=fs.readFileSync(new URL('../../.github/workflows/'+name,import.meta.url),'utf8');
  assert.match(source,/^  pull_request:\s*$/m,name);
  assert.doesNotMatch(source,/  pull_request:\n    paths:/,name);
 }
});
