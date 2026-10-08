import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyLifeSpaceReleaseBaseline } from './lifespace-release-baseline.mjs';

function required(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function baseUrl(value, name) {
  return required(value, name).replace(/\/+$/u, '');
}

async function requestEnvelope(fetcher, url, bearer) {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${bearer}`,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    throw new Error(`${url} failed: ${code}`);
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error(`${url} did not return a HomeMew { data } envelope`);
  }
  const requestId = response.headers?.get?.('x-request-id');
  if (!requestId) throw new Error(`${url} did not return x-request-id`);
  return payload.data;
}

function familyPath(base, familyId, suffix = '') {
  return `${base}/api/v1/miniprogram/families/${encodeURIComponent(familyId)}${suffix}`;
}

function assertItems(value, label) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
    throw new Error(`${label} did not return { items: [] }`);
  }
  return value.items.length;
}

export async function runReadOnlyConsumerSmoke({
  homeMewBaseUrl,
  bearer,
  familyId,
  identityBaseUrl,
  coreBaseUrl,
  environment = 'production',
  fetcher = fetch,
}) {
  const homeMew = baseUrl(homeMewBaseUrl, 'homeMewBaseUrl');
  const token = required(bearer, 'bearer');

  const baseline = await verifyLifeSpaceReleaseBaseline({
    environment,
    identityBaseUrl: baseUrl(identityBaseUrl, 'identityBaseUrl'),
    coreBaseUrl: baseUrl(coreBaseUrl, 'coreBaseUrl'),
  });

  const familiesData = await requestEnvelope(fetcher, `${homeMew}/api/v1/miniprogram/families`, token);
  const families = Array.isArray(familiesData?.items) ? familiesData.items : null;
  if (!families) throw new Error('family list did not return { items: [] }');

  const selectedFamilyId = familyId || families[0]?.id;
  if (!selectedFamilyId) {
    return {
      baseline: {
        identity: baseline.identity.contractVersion,
        core: baseline.core.contractVersion,
      },
      families: 0,
      familyId: null,
      resources: null,
    };
  }

  await requestEnvelope(fetcher, familyPath(homeMew, selectedFamilyId), token);
  const members = await requestEnvelope(fetcher, familyPath(homeMew, selectedFamilyId, '/members'), token);
  const events = await requestEnvelope(fetcher, familyPath(homeMew, selectedFamilyId, '/events'), token);
  const tasks = await requestEnvelope(fetcher, familyPath(homeMew, selectedFamilyId, '/tasks'), token);
  const days = await requestEnvelope(fetcher, familyPath(homeMew, selectedFamilyId, '/day-records'), token);
  const wishes = await requestEnvelope(fetcher, familyPath(homeMew, selectedFamilyId, '/wishes'), token);

  return {
    baseline: {
      identity: baseline.identity.contractVersion,
      core: baseline.core.contractVersion,
    },
    families: families.length,
    familyId: selectedFamilyId,
    resources: {
      members: assertItems(members, 'members'),
      events: assertItems(events, 'events'),
      tasks: assertItems(tasks, 'tasks'),
      dayRecords: assertItems(days, 'day records'),
      wishes: assertItems(wishes, 'wishes'),
    },
  };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const result = await runReadOnlyConsumerSmoke({
    homeMewBaseUrl: process.env.HOMEMEW_SMOKE_BASE_URL,
    bearer: process.env.HOMEMEW_SMOKE_BEARER,
    familyId: process.env.HOMEMEW_SMOKE_FAMILY_ID,
    identityBaseUrl: process.env.LIFESPACE_IDENTITY_URL,
    coreBaseUrl: process.env.LIFESPACE_CORE_URL,
    environment: process.env.LIFESPACE_ENVIRONMENT || 'production',
  });
  console.log(JSON.stringify(result, null, 2));
}
