import process from 'node:process';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
const confirmation = process.env.HOMEMEW_WEB_PRODUCTION_CONFIRMATION ?? '';

const HOSTNAME = 'homemew.aisr.online';
const ZONE_NAME = 'aisr.online';
const LOGIN_PATH = '/api/v1/login/wechat';
const OLD_SERVICE = 'homemew-backend-production';
const TARGET_SERVICE = 'homemew-web-production';
const REQUIRED_WORKER_SECRETS = [
  'LIFESPACE_APPLICATION_CREDENTIAL',
  'WEB_SESSION_SECRET',
  'LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL',
];
const REQUIRED_IDENTITY_CONTRACT = '0.5.0';
const REQUIRED_CORE_CONTRACT = '0.15.0';

if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required');
if (confirmation !== 'CUTOVER_HOMEMEW_WEB_PRODUCTION') {
  throw new Error('HOMEMEW_WEB_PRODUCTION_CONFIRMATION must equal CUTOVER_HOMEMEW_WEB_PRODUCTION');
}

async function parseResponse(response) {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { return raw; }
}

async function cloudflare(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await parseResponse(response);
  if (!response.ok || payload?.success !== true) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message).filter(Boolean).join('; ')
      : '';
    throw new Error(`Cloudflare request failed: ${method} ${path} -> HTTP ${response.status}${errors ? ` (${errors})` : ''}`);
  }
  return payload.result;
}

async function requireLifeSpaceProduction() {
  const [identityResponse, coreResponse] = await Promise.all([
    fetch('https://auth.aisr.online/api/v1/status'),
    fetch('https://core.aisr.online/api/v1/status'),
  ]);
  const [identity, core] = await Promise.all([parseResponse(identityResponse), parseResponse(coreResponse)]);
  if (identityResponse.status !== 200
      || identity?.data?.environment !== 'production'
      || identity?.data?.contractVersion !== REQUIRED_IDENTITY_CONTRACT) {
    throw new Error(`LifeSpace Identity production must be contract ${REQUIRED_IDENTITY_CONTRACT}`);
  }
  if (coreResponse.status !== 200
      || core?.data?.environment !== 'production'
      || core?.data?.contractVersion !== REQUIRED_CORE_CONTRACT) {
    throw new Error(`LifeSpace Core production must be contract ${REQUIRED_CORE_CONTRACT}`);
  }
}

async function requireAccessBoundary() {
  const apps = await cloudflare('/access/apps?per_page=100');
  const root = (apps ?? []).find((app) => app?.type === 'self_hosted' && app?.domain === HOSTNAME);
  if (!root?.id) throw new Error(`Cloudflare Access root application is missing for ${HOSTNAME}`);
  const rootPolicies = await cloudflare(`/access/apps/${encodeURIComponent(root.id)}/policies?per_page=100`);
  if (!(rootPolicies ?? []).some((policy) => policy?.decision === 'allow')) {
    throw new Error('Cloudflare Access root application has no Allow policy');
  }

  const publicDomain = `${HOSTNAME}${LOGIN_PATH}`;
  const publicApp = (apps ?? []).find((app) => app?.type === 'self_hosted' && app?.domain === publicDomain);
  if (!publicApp?.id) throw new Error(`Cloudflare Access bypass application is missing for ${publicDomain}`);
  const publicPolicies = await cloudflare(`/access/apps/${encodeURIComponent(publicApp.id)}/policies?per_page=100`);
  const hasBypass = (publicPolicies ?? []).some((policy) => policy?.decision === 'bypass'
    && Array.isArray(policy.include)
    && policy.include.some((entry) => entry?.everyone));
  if (!hasBypass) throw new Error('Mini Program login Access application has no Everyone bypass policy');
}

async function requireWorkerSecrets() {
  const secrets = await cloudflare(`/workers/scripts/${encodeURIComponent(TARGET_SERVICE)}/secrets`);
  const names = new Set((secrets ?? []).map((entry) => entry?.name).filter(Boolean));
  const missing = REQUIRED_WORKER_SECRETS.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Production Web Worker is missing required secret bindings: ${missing.join(', ')}`);
}

async function listDomains() {
  return cloudflare('/workers/domains');
}

async function currentDomain() {
  return (await listDomains()).find((entry) => entry?.hostname === HOSTNAME) ?? null;
}

async function attachDomain(service) {
  await cloudflare('/workers/domains', {
    method: 'PUT',
    body: {
      hostname: HOSTNAME,
      service,
      zone_name: ZONE_NAME,
      override_existing_origin: true,
    },
  });
}

async function waitForDomain(service) {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const current = await currentDomain();
    if (current?.service === service) return current;
    if (attempt === 15) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Custom Domain did not converge to ${service}`);
}

async function verifyMiniProgramLogin() {
  const response = await fetch(`https://${HOSTNAME}${LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    redirect: 'manual',
  });
  const payload = await parseResponse(response);
  if (response.status !== 400 || payload?.error?.code !== 'INVALID_REQUEST') {
    throw new Error(`Mini Program login probe failed after routing change: HTTP ${response.status}`);
  }
}

async function verifyAccessRoot() {
  const response = await fetch(`https://${HOSTNAME}/`, { method: 'HEAD', redirect: 'manual' });
  if (![301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
    throw new Error(`Production root is not protected by Cloudflare Access: HTTP ${response.status}`);
  }
}

let movedByThisRun = false;
try {
  await requireLifeSpaceProduction();
  await requireAccessBoundary();
  await requireWorkerSecrets();

  const before = await currentDomain();
  if (!before?.service) throw new Error(`Production Custom Domain is missing for ${HOSTNAME}`);
  if (![OLD_SERVICE, TARGET_SERVICE].includes(before.service)) {
    throw new Error(`Refusing cutover because ${HOSTNAME} is attached to unexpected service ${before.service}`);
  }

  await verifyMiniProgramLogin();
  await verifyAccessRoot();

  if (before.service === OLD_SERVICE) {
    await attachDomain(TARGET_SERVICE);
    movedByThisRun = true;
  }

  await waitForDomain(TARGET_SERVICE);
  await verifyMiniProgramLogin();
  await verifyAccessRoot();

  console.log(JSON.stringify({
    ok: true,
    hostname: HOSTNAME,
    service: TARGET_SERVICE,
    miniProgramLogin: 'passed',
    accessRoot: 'passed',
  }, null, 2));
} catch (error) {
  if (movedByThisRun) {
    try {
      console.error('Cutover verification failed; restoring the production Custom Domain to the previous backend.');
      await attachDomain(OLD_SERVICE);
      await waitForDomain(OLD_SERVICE);
      await verifyMiniProgramLogin();
      console.error('Production Custom Domain rollback completed and Mini Program login probe passed.');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Cutover failed and automatic Custom Domain rollback also failed');
    }
  }
  throw error;
}
