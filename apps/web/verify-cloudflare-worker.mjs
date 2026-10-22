/**
 * Prevent Wrangler from accidentally creating a *second* Worker when deploying
 * HomeMew Web Production or a named Preview after the Worker rename.
 * No credentials are logged or stored in source control.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const EXPECTED_WORKER_ID = '260f99bcf41b4290925ac5e35ce41d31';
const EXPECTED_WORKER_NAME = 'homemew-web';
const EXPECTED_DOMAIN = 'homemew.aisr.online';

if (!accountId || !token) {
  throw new Error('Cloudflare account credentials are required for Worker identity verification');
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/workers/${EXPECTED_WORKER_NAME}`,
  { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
);

if (!response.ok) {
  throw new Error(`HomeMew Web Worker identity lookup failed (HTTP ${response.status}). Refusing deployment.`);
}

const payload = await response.json();
const worker = payload?.result;
if (payload?.success !== true || worker?.id !== EXPECTED_WORKER_ID || worker?.name !== EXPECTED_WORKER_NAME) {
  throw new Error('Unexpected HomeMew Worker ID/name; refusing to create or deploy a duplicate Worker');
}
if (!worker.references?.domains?.some(domain => domain.hostname === EXPECTED_DOMAIN)) {
  throw new Error('Production HomeMew custom domain is not owned by the expected Worker');
}

console.log('Verified existing HomeMew Web Worker identity and custom domain ownership.');
