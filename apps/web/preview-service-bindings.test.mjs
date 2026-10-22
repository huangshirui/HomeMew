import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPreviewServiceBindings } from './preview-service-bindings.mjs';

const services = [
  { binding: 'HOMEMEW_BACKEND', service: 'homemew-backend-staging' },
  { binding: 'LIFESPACE_CORE', service: 'lifespace-core-staging' },
  { binding: 'LIFESPACE_IDENTITY', service: 'lifespace-identity-staging' },
];

test('Preview validation accepts the Wrangler binding order and any permutation', () => {
  assert.doesNotThrow(() => assertPreviewServiceBindings(services));
  assert.doesNotThrow(() => assertPreviewServiceBindings([services[0], services[2], services[1]]));
  assert.doesNotThrow(() => assertPreviewServiceBindings([...services].reverse()));
});

test('Preview validation rejects production targets and missing or extra bindings', () => {
  assert.throws(() => assertPreviewServiceBindings([
    { ...services[0], service: 'homemew-backend-production' }, ...services.slice(1),
  ]), /wrong target/);
  assert.throws(() => assertPreviewServiceBindings(services.slice(1)), /exactly three/);
  assert.throws(() => assertPreviewServiceBindings([...services, { binding: 'OTHER', service: 'other' }]), /exactly three/);
  assert.throws(() => assertPreviewServiceBindings([services[0], services[0], services[2]]), /Duplicate/);
  assert.throws(() => assertPreviewServiceBindings([services[0], services[1], { binding: 'LIFESPACE_IDENTITY', service: 'lifespace-identity' }]), /wrong target/);
});
