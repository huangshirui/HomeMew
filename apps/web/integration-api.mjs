import {
  handleIntegrationRequest as handleCoreIntegrationRequest,
  integrationsReady,
} from './integration-api-core.mjs';

export { integrationsReady };

const EVENTING_MANAGER_SCOPES = ['spaces:manage'];

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is not configured`);
  return value.trim();
}

function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}

function applicationCredential(env) {
  const credential = requiredString(env.LIFESPACE_APPLICATION_CREDENTIAL, 'LIFESPACE_APPLICATION_CREDENTIAL');
  if (!credential.startsWith('lsa_')) throw new Error('LIFESPACE_APPLICATION_CREDENTIAL is invalid');
  return credential;
}

async function exchangeEventingManager(env, fetcher, assertion, id) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${applicationCredential(env)}`,
    ...(id ? { 'x-request-id': id } : {}),
  };
  const response = await fetcher(`${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}/internal/v1/access/tokens`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accessAssertion: assertion, requestedScopes: EVENTING_MANAGER_SCOPES }),
  });
  const payload = await response.json().catch(() => ({}));
  const token = payload?.data?.accessToken;
  if (!response.ok || typeof token !== 'string' || !token) throw new Error('eventing manager exchange failed');
  return token;
}

async function listEventingEndpoints(env, fetcher, managerToken, spaceId, principalId, id) {
  const path = `/api/v1/webhook-endpoints?spaceId=${encodeURIComponent(spaceId)}&subscriberServicePrincipalId=${encodeURIComponent(principalId)}`;
  const response = await fetcher(`${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}${path}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${managerToken}`,
      ...(id ? { 'x-request-id': id } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.data?.items)) throw new Error('eventing endpoint list failed');
  return payload.data.items;
}

async function deleteEventingEndpoint(env, fetcher, managerToken, endpointId, id) {
  const response = await fetcher(
    `${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}/api/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: 'DELETE',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${managerToken}`,
        ...(id ? { 'x-request-id': id } : {}),
      },
    },
  );
  if (response.status !== 204 && response.status !== 404) throw new Error('eventing endpoint delete failed');
}

async function cleanupIntegrationEventing(env, fetcher, assertion, spaceId, principalId, id) {
  let managerToken;
  try {
    managerToken = await exchangeEventingManager(env, fetcher, assertion, id);
  } catch {
    return ['eventing:manager'];
  }

  let endpoints;
  try {
    endpoints = await listEventingEndpoints(env, fetcher, managerToken, spaceId, principalId, id);
  } catch {
    return ['eventing:endpoints:list'];
  }

  const warnings = [];
  for (const endpoint of endpoints) {
    const endpointId = typeof endpoint?.id === 'string' ? endpoint.id : '';
    if (!endpointId) {
      warnings.push('eventing:endpoint:invalid');
      continue;
    }
    try {
      await deleteEventingEndpoint(env, fetcher, managerToken, endpointId, id);
    } catch {
      warnings.push(`eventing:endpoint:${endpointId}`);
    }
  }
  return warnings;
}

function disableTarget(request) {
  if (request.method !== 'POST') return null;
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'integrations' || parts[3] !== 'disable') return null;
  let principalId;
  try {
    principalId = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  return /^svc_[A-Za-z0-9_-]+$/u.test(principalId) ? principalId : null;
}

async function withCleanupWarnings(response, warnings) {
  if (!warnings.length) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload?.data || payload.data.disabled !== true) return response;
  const existing = Array.isArray(payload.data.cleanupWarnings) ? payload.data.cleanupWarnings : [];
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Response(JSON.stringify({
    ...payload,
    data: {
      ...payload.data,
      cleanupWarnings: [...existing, ...warnings],
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleIntegrationRequest(request, env, { fetcher = fetch, assertion, id } = {}) {
  const principalId = disableTarget(request);
  if (!principalId) {
    return handleCoreIntegrationRequest(request, env, { fetcher, assertion, id });
  }

  const cleanupRequest = request.clone();
  const response = await handleCoreIntegrationRequest(request, env, { fetcher, assertion, id });
  if (!response.ok) return response;

  const body = await cleanupRequest.json().catch(() => null);
  const spaceId = typeof body?.spaceId === 'string' ? body.spaceId.trim() : '';
  if (!/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) return response;

  const warnings = await cleanupIntegrationEventing(env, fetcher, assertion, spaceId, principalId, id)
    .catch(() => ['eventing:cleanup']);
  return withCleanupWarnings(response, warnings);
}
