import { appendFileSync } from 'node:fs';
import process from 'node:process';

const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
const apiToken = (process.env.CLOUDFLARE_API_TOKEN ?? '').trim();
const targetDomain = (process.env.HOMEMEW_WEB_PRODUCTION_DOMAIN ?? 'homemew.aisr.online').trim();
const templateDomain = (process.env.HOMEMEW_WEB_ACCESS_TEMPLATE_DOMAIN ?? 'homemew-web-staging.aisr.online').trim();
const confirmation = (process.env.HOMEMEW_WEB_PRODUCTION_CONFIRMATION ?? '').trim();
const githubEnv = (process.env.GITHUB_ENV ?? '').trim();
const loginPath = '/api/v1/login/wechat';

if (!accountId || !apiToken) throw new Error('Cloudflare account credentials are required');
if (confirmation !== 'PREPARE_HOMEMEW_WEB_PRODUCTION') {
  throw new Error('HOMEMEW_WEB_PRODUCTION_CONFIRMATION must equal PREPARE_HOMEMEW_WEB_PRODUCTION');
}
if (!targetDomain || targetDomain.includes('/') || !templateDomain || templateDomain.includes('/')) {
  throw new Error('Access domains must be hostnames without paths');
}

async function cf(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const errors = Array.isArray(payload?.errors) ? payload.errors.map((item) => item?.message).filter(Boolean).join('; ') : '';
    throw new Error(`Cloudflare Access API failed: ${method} ${path} -> HTTP ${response.status}${errors ? ` (${errors})` : ''}`);
  }
  return payload;
}

async function listApps() {
  const payload = await cf('/access/apps?per_page=100');
  if (!Array.isArray(payload.result)) throw new Error('Cloudflare Access application listing returned an invalid shape');
  return payload.result;
}

async function appPolicies(appId) {
  const payload = await cf(`/access/apps/${encodeURIComponent(appId)}/policies?per_page=100`);
  return Array.isArray(payload.result) ? payload.result : [];
}

function copyPolicy(policy, precedence) {
  const copy = {
    name: policy.name || `HomeMew production allow ${precedence}`,
    decision: policy.decision,
    include: policy.include,
    exclude: Array.isArray(policy.exclude) ? policy.exclude : [],
    require: Array.isArray(policy.require) ? policy.require : [],
    precedence,
  };
  if (typeof policy.session_duration === 'string' && policy.session_duration) copy.session_duration = policy.session_duration;
  if (typeof policy.purpose_justification_required === 'boolean') copy.purpose_justification_required = policy.purpose_justification_required;
  if (typeof policy.purpose_justification_prompt === 'string' && policy.purpose_justification_prompt) copy.purpose_justification_prompt = policy.purpose_justification_prompt;
  return copy;
}

async function ensureRootApp() {
  let apps = await listApps();
  let target = apps.find((app) => app?.type === 'self_hosted' && app?.domain === targetDomain);
  if (!target) {
    const template = apps.find((app) => app?.type === 'self_hosted' && app?.domain === templateDomain);
    if (!template?.id) throw new Error(`Template Access application not found: ${templateDomain}`);
    const policies = (await appPolicies(template.id)).filter((policy) => policy?.decision === 'allow');
    if (!policies.length) throw new Error(`Template Access application has no Allow policy: ${templateDomain}`);
    const created = await cf('/access/apps', {
      method: 'POST',
      body: {
        name: 'HomeMew Web production',
        domain: targetDomain,
        type: 'self_hosted',
        session_duration: template.session_duration || '24h',
        policies: policies.map((policy, index) => copyPolicy(policy, index + 1)),
      },
    });
    target = created.result;
    if (!target?.id || target?.domain !== targetDomain) throw new Error('Production Access application creation returned an invalid result');
  }

  const policies = await appPolicies(target.id);
  if (!policies.some((policy) => policy?.decision === 'allow')) {
    throw new Error('Production Access application must retain at least one Allow policy');
  }
  if (typeof target.aud !== 'string' || !target.aud.trim()) throw new Error('Production Access application AUD is missing');
  return target;
}

async function ensureLoginBypassApp() {
  const bypassDomain = `${targetDomain}${loginPath}`;
  const apps = await listApps();
  let bypass = apps.find((app) => app?.type === 'self_hosted' && app?.domain === bypassDomain);
  if (!bypass) {
    const created = await cf('/access/apps', {
      method: 'POST',
      body: {
        name: 'HomeMew Mini Program login public',
        domain: bypassDomain,
        type: 'self_hosted',
        session_duration: '24h',
        policies: [{
          name: 'Bypass Mini Program login',
          decision: 'bypass',
          include: [{ everyone: {} }],
          exclude: [],
          require: [],
          precedence: 1,
        }],
      },
    });
    bypass = created.result;
  }
  if (!bypass?.id) throw new Error('Mini Program login bypass Access application is missing');
  const policies = await appPolicies(bypass.id);
  if (!policies.some((policy) => policy?.decision === 'bypass' && Array.isArray(policy.include) && policy.include.some((rule) => rule?.everyone))) {
    throw new Error('Mini Program login Access application must contain an Everyone bypass policy');
  }
  return bypass;
}

const bypass = await ensureLoginBypassApp();
const root = await ensureRootApp();

if (githubEnv) {
  appendFileSync(githubEnv, `HOMEMEW_WEB_PRODUCTION_ACCESS_AUD=${root.aud}\n`, 'utf8');
  appendFileSync(githubEnv, `HOMEMEW_WEB_PRODUCTION_ACCESS_APP_ID=${root.id}\n`, 'utf8');
  appendFileSync(githubEnv, `HOMEMEW_WEB_PRODUCTION_BYPASS_APP_ID=${bypass.id}\n`, 'utf8');
}

console.log(JSON.stringify({
  ok: true,
  domain: targetDomain,
  rootApplication: { id: root.id, aud: root.aud, sessionDuration: root.session_duration ?? null },
  publicLoginApplication: { id: bypass.id, domain: `${targetDomain}${loginPath}` },
  templateDomain,
}, null, 2));
