import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const LIFESPACE_RELEASE_BASELINE = Object.freeze({
  identity: Object.freeze({
    contractVersion: '0.6.0',
    minimumSchemaVersion: 8,
  }),
  core: Object.freeze({
    contractVersion: '0.35.0',
    minimumSchemaVersion: 41,
  }),
});

function statusData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

export function assertLifeSpaceStatus(payload, service, environment) {
  const expected = LIFESPACE_RELEASE_BASELINE[service];
  if (!expected) throw new Error(`Unsupported LifeSpace service: ${service}`);
  const data = statusData(payload);
  if (!data || typeof data !== 'object') throw new Error(`${service} status payload is invalid`);
  if (data.status !== 'ok') throw new Error(`${service} status is not ok`);
  if (data.service !== service) throw new Error(`Expected ${service} status, got ${String(data.service ?? 'unknown')}`);
  if (data.environment !== environment) {
    throw new Error(`Expected ${service} environment ${environment}, got ${String(data.environment ?? 'unknown')}`);
  }
  if (data.contractVersion !== expected.contractVersion) {
    throw new Error(
      `${service} contract mismatch: HomeMew requires ${expected.contractVersion}, got ${String(data.contractVersion ?? 'unknown')}`,
    );
  }
  const schemaVersion = Number(data.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < expected.minimumSchemaVersion) {
    throw new Error(
      `${service} schema is behind the HomeMew release baseline: requires >=${expected.minimumSchemaVersion}, got ${String(data.schemaVersion ?? 'unknown')}`,
    );
  }
  return data;
}

async function fetchStatus(baseUrl, service, environment) {
  const url = `${String(baseUrl).replace(/\/+$/u, '')}/api/v1/status`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`${service} status returned HTTP ${response.status}`);
      return assertLifeSpaceStatus(payload, service, environment);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${service} status verification failed`);
}

export async function verifyLifeSpaceReleaseBaseline({ environment, identityBaseUrl, coreBaseUrl }) {
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('environment must be staging or production');
  }
  const [identity, core] = await Promise.all([
    fetchStatus(identityBaseUrl, 'identity', environment),
    fetchStatus(coreBaseUrl, 'core', environment),
  ]);
  return { identity, core };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const [environment, identityBaseUrl, coreBaseUrl] = process.argv.slice(2);
  if (!environment || !identityBaseUrl || !coreBaseUrl) {
    throw new Error('Usage: node apps/web/lifespace-release-baseline.mjs <staging|production> <identityBaseUrl> <coreBaseUrl>');
  }
  const verified = await verifyLifeSpaceReleaseBaseline({ environment, identityBaseUrl, coreBaseUrl });
  console.log(JSON.stringify({
    environment,
    baseline: LIFESPACE_RELEASE_BASELINE,
    deployed: {
      identity: { contractVersion: verified.identity.contractVersion, schemaVersion: verified.identity.schemaVersion },
      core: { contractVersion: verified.core.contractVersion, schemaVersion: verified.core.schemaVersion },
    },
  }, null, 2));
}
