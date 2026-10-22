/**
 * Compare Preview Worker bindings by name instead of JSON.stringify key order.
 * Fail closed on missing, duplicate, unknown or production-target bindings.
 */
const expectedPreviewServiceTargets = new Map([
  ['HOMEMEW_BACKEND', 'homemew-backend-staging'],
  ['LIFESPACE_CORE', 'lifespace-core-staging'],
  ['LIFESPACE_IDENTITY', 'lifespace-identity-staging'],
]);

export function assertPreviewServiceBindings(services) {
  if (!Array.isArray(services) || services.length !== expectedPreviewServiceTargets.size) {
    throw new Error('Preview must contain exactly three staging Service Bindings');
  }
  const found = new Set();
  for (const item of services) {
    const name = item?.binding;
    if (found.has(name)) throw new Error(`Duplicate Preview Service Binding: ${name}`);
    found.add(name);
    if (expectedPreviewServiceTargets.get(name) !== item?.service) {
      throw new Error(`Preview Service Binding ${name || '<unknown>'} has the wrong target`);
    }
  }
}
