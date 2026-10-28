import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const LIFESPACE_RELEASE_BASELINE = Object.freeze({
  identity: Object.freeze({
    contractVersion: '0.17.0',
    // 0.15/schema 14 introduced globally unique login mailboxes; 0.16 added
    // self-only Application inspection; 0.17 moved Bootstrap operations to
    // the separate Platform Admin OpenAPI without removing ordinary routes.
    // Explicitly reviewed only: never accept unknown future versions by number.
    compatibleContractVersions: Object.freeze(['0.15.0', '0.16.0', '0.17.0']),
    minimumSchemaVersion: 14,
    minimumSchemaByContract: Object.freeze({ '0.15.0': 14, '0.16.0': 14, '0.17.0': 14 }),
  }),
  core: Object.freeze({
    contractVersion: '0.53.0',
    // Explicitly reviewed production #42 contracts; never accept an unknown
    // future Kernel version as compatible merely because its number is higher.
    compatibleContractVersions: Object.freeze(['0.48.0', '0.49.0', '0.53.0']),
    minimumSchemaVersion: 53,
    minimumSchemaByContract: Object.freeze({ '0.48.0': 53, '0.49.0': 53, '0.53.0': 74 }),
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

  const schemaVersion = Number(data.schemaVersion);
  if (!Number.isInteger(schemaVersion)) {
    throw new Error(`${service} schemaVersion must be an integer, got ${String(data.schemaVersion ?? 'unknown')}`);
  }

  const compatibleContractVersions = expected.compatibleContractVersions ?? [expected.contractVersion];
  if (!compatibleContractVersions.includes(data.contractVersion)) {
    throw new Error(
      `${service} contract mismatch: HomeMew accepts ${compatibleContractVersions.join(', ')}, got ${String(data.contractVersion ?? 'unknown')}`,
    );
  }
  const minimumSchemaVersion = expected.minimumSchemaByContract?.[data.contractVersion] ?? expected.minimumSchemaVersion;
  if (schemaVersion < minimumSchemaVersion) {
    throw new Error(
      `${service} schema is behind the HomeMew release baseline: requires >=${minimumSchemaVersion}, got ${String(data.schemaVersion ?? 'unknown')}`,
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
