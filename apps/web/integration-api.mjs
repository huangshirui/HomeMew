import {
  handleIntegrationRequest as handleCoreIntegrationRequest,
  integrationsReady as coreIntegrationsReady,
} from './integration-api-core.mjs';
import { handleExternalSystemAgentRequest } from './external-system-agent-api.mjs';
import {
  bindExternalSystemService,
  createExternalSystem,
  ExternalSystemCatalogError,
  getExternalSystem,
  listExternalSystems,
  parseExternalSystemId,
  parseExternalSystemSpaceId,
  updateExternalSystem,
} from './external-system-catalog.mjs';

const MANAGER_SCOPES = ['profile:read', 'grants:manage'];
const EVENTING_MANAGER_SCOPES = ['spaces:manage'];

class ExternalSystemError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function integrationsReady(env) {
  return coreIntegrationsReady(env)
    && Boolean(env.HOMEMEW_BACKEND && typeof env.HOMEMEW_BACKEND.fetch === 'function');
}

function json(data, status = 200, id) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(id ? { 'x-request-id': id } : {}),
    },
  });
}

function errorJson(error, id) {
  if (error instanceof ExternalSystemError || error instanceof ExternalSystemCatalogError) {
    return json({ error: { code: error.code, message: error.message, requestId: id } }, error.status, id);
  }
  console.error('[HomeMew external systems] unhandled error', error instanceof Error ? error.message : 'unknown');
  return json({ error: { code: 'INTERNAL_ERROR', message: '外部系统服务暂时不可用', requestId: id } }, 500, id);
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new ExternalSystemError(500, 'WEB_NOT_CONFIGURED', `${name} is not configured`);
  return value.trim();
}

function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}

function applicationCredential(env) {
  const credential = requiredString(env.LIFESPACE_APPLICATION_CREDENTIAL, 'LIFESPACE_APPLICATION_CREDENTIAL');
  if (!credential.startsWith('lsa_')) throw new ExternalSystemError(500, 'WEB_NOT_CONFIGURED', 'LIFESPACE_APPLICATION_CREDENTIAL is invalid');
  return credential;
}

function requireSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ExternalSystemError(403, 'INVALID_ORIGIN', 'Cross-origin state-changing requests are not allowed');
}

async function readJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ExternalSystemError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  return body;
}

async function fetchJson(fetcher, url, { method = 'GET', credential, body, id, fallbackCode }) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${credential}`,
    ...(id ? { 'x-request-id': id } : {}),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ExternalSystemError(502, fallbackCode, '连接 LifeSpace 失败，请稍后重试');
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const upstream = payload?.error;
    if (response.status >= 400 && response.status < 500 && upstream?.code) {
      throw new ExternalSystemError(response.status, upstream.code, upstream.message ?? 'LifeSpace rejected the request');
    }
    throw new ExternalSystemError(502, fallbackCode, upstream?.message ?? 'LifeSpace 服务暂时不可用');
  }
  return payload?.data;
}

async function managerContext(env, fetcher, assertion, spaceId, id) {
  const exchange = await fetchJson(fetcher, `${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}/internal/v1/access/tokens`, {
    method: 'POST',
    credential: applicationCredential(env),
    body: { accessAssertion: assertion, requestedScopes: MANAGER_SCOPES },
    id,
    fallbackCode: 'INTEGRATION_MANAGER_EXCHANGE_FAILED',
  });
  if (!exchange?.accessToken) throw new ExternalSystemError(502, 'INTEGRATION_MANAGER_EXCHANGE_FAILED', 'LifeSpace 未返回有效的管理会话');
  const profile = await fetchJson(fetcher, `${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}/api/v1/me`, {
    credential: exchange.accessToken,
    id,
    fallbackCode: 'INTEGRATION_MANAGER_PROFILE_FAILED',
  });
  await fetchJson(fetcher, `${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}/api/v1/spaces/${encodeURIComponent(spaceId)}/grants?includeRevoked=true`, {
    credential: exchange.accessToken,
    id,
    fallbackCode: 'INTEGRATION_GRANTS_FAILED',
  });
  return { accessToken: exchange.accessToken, userId: typeof profile?.id === 'string' ? profile.id : null };
}

function cloneRequest(request, pathname, { method = request.method, search = '', body } = {}) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = search;
  const headers = new Headers(request.headers);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(url, {
    method,
    headers,
    body: body === undefined || ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body),
  });
}

async function coreCall(request, env, options, pathname, config = {}) {
  return handleCoreIntegrationRequest(cloneRequest(request, pathname, config), env, options);
}

async function parseResponse(response) {
  const payload = await response.clone().json().catch(() => null);
  return { response, payload };
}

async function readServiceAccess(request, env, options, spaceId, servicePrincipalId) {
  const result = await parseResponse(await coreCall(
    request,
    env,
    options,
    '/api/integrations',
    { method: 'GET', search: `?spaceId=${encodeURIComponent(spaceId)}` },
  ));
  if (!result.response.ok) return result;
  const items = Array.isArray(result.payload?.data) ? result.payload.data : [];
  const service = items.find((item) => item?.id === servicePrincipalId) ?? null;
  if (!service) {
    return {
      response: errorJson(new ExternalSystemError(409, 'SERVICE_BINDING_BROKEN', '外部系统绑定的 Service Principal 已不存在或不再属于当前应用'), options.id),
      payload: null,
    };
  }
  return { response: json({ data: service }, 200, options.id), payload: { data: service } };
}

function serviceDisplayName(name) {
  return `${String(name).slice(0, 90)} Service`;
}

async function handleList(request, env, fetcher, assertion, id) {
  const spaceId = parseExternalSystemSpaceId(new URL(request.url).searchParams.get('spaceId'));
  await managerContext(env, fetcher, assertion, spaceId, id);
  const items = await listExternalSystems(env, spaceId, id);
  return json({ data: Array.isArray(items) ? items : [] }, 200, id);
}

async function handleCreate(request, env, fetcher, assertion, id) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  if (Object.keys(body).some((key) => !['spaceId', 'displayName', 'description'].includes(key))) {
    throw new ExternalSystemError(400, 'INVALID_REQUEST', '创建外部系统时只需要名称和说明');
  }
  const manager = await managerContext(env, fetcher, assertion, spaceId, id);
  const external = await createExternalSystem(env, {
    spaceId,
    displayName: body.displayName,
    description: body.description,
    createdByUserId: manager.userId,
  }, id);
  return json({ data: external }, 201, id);
}

async function handleGet(request, env, fetcher, assertion, id, externalSystemId) {
  const spaceId = parseExternalSystemSpaceId(new URL(request.url).searchParams.get('spaceId'));
  await managerContext(env, fetcher, assertion, spaceId, id);
  return json({ data: await getExternalSystem(env, spaceId, externalSystemId, id) }, 200, id);
}

async function handleUpdate(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  if (Object.keys(body).some((key) => !['spaceId', 'displayName', 'description'].includes(key))) {
    throw new ExternalSystemError(400, 'INVALID_REQUEST', '外部系统基本信息只能修改名称和说明');
  }
  await managerContext(env, fetcher, assertion, spaceId, id);
  const patch = {};
  if (Object.hasOwn(body, 'displayName')) patch.displayName = body.displayName;
  if (Object.hasOwn(body, 'description')) patch.description = body.description;
  return json({ data: await updateExternalSystem(env, spaceId, externalSystemId, patch, id) }, 200, id);
}

async function handleServiceGet(request, env, fetcher, assertion, id, externalSystemId) {
  const spaceId = parseExternalSystemSpaceId(new URL(request.url).searchParams.get('spaceId'));
  await managerContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.servicePrincipalId) return json({ data: null }, 200, id);
  return (await readServiceAccess(request, env, { fetcher, assertion, id }, spaceId, external.servicePrincipalId)).response;
}

async function handleServiceCreate(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  await managerContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (external.servicePrincipalId) throw new ExternalSystemError(409, 'SERVICE_ALREADY_CONFIGURED', '这个外部系统已经配置 Service Access');

  const coreResponse = await coreCall(request, env, { fetcher, assertion, id }, '/api/integrations', {
    method: 'POST',
    body: {
      spaceId,
      displayName: serviceDisplayName(external.displayName),
      description: `HomeMew External System ${external.id}`,
      permissions: body.permissions,
      credentialMode: body.credentialMode,
    },
  });
  if (!coreResponse.ok) return coreResponse;
  const payload = await coreResponse.clone().json().catch(() => null);
  const service = payload?.data?.integration;
  const credential = payload?.data?.credential;
  if (!service?.id) throw new ExternalSystemError(502, 'SERVICE_CREATE_FAILED', 'LifeSpace 未返回新 Service Principal');

  try {
    await bindExternalSystemService(env, spaceId, externalSystemId, service.id, null, id);
  } catch (error) {
    await coreCall(request, env, { fetcher, assertion, id }, `/api/integrations/${encodeURIComponent(service.id)}/disable`, {
      method: 'POST', body: { spaceId },
    }).catch(() => undefined);
    throw error;
  }
  return json({ data: { service, credential } }, 201, id);
}

async function resolveService(request, env, fetcher, assertion, id, externalSystemId, spaceId) {
  await managerContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.servicePrincipalId) throw new ExternalSystemError(404, 'SERVICE_NOT_CONFIGURED', '这个外部系统还没有配置 Service Access');
  return external;
}

async function handleServiceMutation(request, env, fetcher, assertion, id, externalSystemId, tail) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const external = await resolveService(request, env, fetcher, assertion, id, externalSystemId, spaceId);
  const serviceId = external.servicePrincipalId;
  const path = tail === 'update'
    ? `/api/integrations/${encodeURIComponent(serviceId)}`
    : tail === 'rotate'
      ? `/api/integrations/${encodeURIComponent(serviceId)}/credential-rotation`
      : tail === 'complete'
        ? `/api/integrations/${encodeURIComponent(serviceId)}/credential-rotation/complete`
        : `/api/integrations/${encodeURIComponent(serviceId)}/credential-rotation/cancel`;
  const method = tail === 'update' ? 'PATCH' : 'POST';
  const coreResponse = await coreCall(request, env, { fetcher, assertion, id }, path, { method, body });
  if (!coreResponse.ok) return coreResponse;
  const payload = await coreResponse.clone().json().catch(() => null);
  if (tail === 'rotate') {
    return json({ data: { service: payload?.data?.integration, credential: payload?.data?.credential } }, coreResponse.status, id);
  }
  return json({ data: payload?.data }, coreResponse.status, id);
}

async function exchangeEventingManager(env, fetcher, assertion, id) {
  const data = await fetchJson(fetcher, `${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}/internal/v1/access/tokens`, {
    method: 'POST',
    credential: applicationCredential(env),
    body: { accessAssertion: assertion, requestedScopes: EVENTING_MANAGER_SCOPES },
    id,
    fallbackCode: 'EVENTING_MANAGER_EXCHANGE_FAILED',
  });
  if (!data?.accessToken) throw new ExternalSystemError(502, 'EVENTING_MANAGER_EXCHANGE_FAILED', 'LifeSpace 未返回事件推送管理会话');
  return data.accessToken;
}

async function listEventingEndpoints(env, fetcher, managerToken, spaceId, principalId, id) {
  const data = await fetchJson(fetcher, `${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}/api/v1/webhook-endpoints?spaceId=${encodeURIComponent(spaceId)}&subscriberServicePrincipalId=${encodeURIComponent(principalId)}`, {
    credential: managerToken,
    id,
    fallbackCode: 'EVENTING_ENDPOINT_LIST_FAILED',
  });
  if (!Array.isArray(data?.items)) throw new ExternalSystemError(502, 'EVENTING_ENDPOINT_LIST_FAILED', 'LifeSpace 未返回有效 Webhook Endpoint 列表');
  return data.items;
}

async function deleteEventingEndpoint(env, fetcher, managerToken, endpointId, id) {
  const response = await fetcher(`${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}/api/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`, {
    method: 'DELETE',
    headers: { accept: 'application/json', authorization: `Bearer ${managerToken}`, ...(id ? { 'x-request-id': id } : {}) },
  });
  if (response.status !== 204 && response.status !== 404) throw new ExternalSystemError(502, 'EVENTING_ENDPOINT_DELETE_FAILED', '删除事件推送失败');
}

async function cleanupIntegrationEventing(env, fetcher, assertion, spaceId, principalId, id) {
  let managerToken;
  try { managerToken = await exchangeEventingManager(env, fetcher, assertion, id); }
  catch { return ['eventing:manager']; }
  let endpoints;
  try { endpoints = await listEventingEndpoints(env, fetcher, managerToken, spaceId, principalId, id); }
  catch { return ['eventing:endpoints:list']; }
  const warnings = [];
  for (const endpoint of endpoints) {
    if (!endpoint?.id) { warnings.push('eventing:endpoint:invalid'); continue; }
    try { await deleteEventingEndpoint(env, fetcher, managerToken, endpoint.id, id); }
    catch { warnings.push(`eventing:endpoint:${endpoint.id}`); }
  }
  return warnings;
}

async function handleServiceRemove(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const external = await resolveService(request, env, fetcher, assertion, id, externalSystemId, spaceId);
  const serviceId = external.servicePrincipalId;
  const coreResponse = await coreCall(request, env, { fetcher, assertion, id }, `/api/integrations/${encodeURIComponent(serviceId)}/disable`, {
    method: 'POST', body: { spaceId },
  });
  if (!coreResponse.ok) return coreResponse;
  const payload = await coreResponse.clone().json().catch(() => null);
  const warnings = [
    ...(Array.isArray(payload?.data?.cleanupWarnings) ? payload.data.cleanupWarnings : []),
    ...await cleanupIntegrationEventing(env, fetcher, assertion, spaceId, serviceId, id).catch(() => ['eventing:cleanup']),
  ];
  if (!warnings.length) await bindExternalSystemService(env, spaceId, externalSystemId, null, serviceId, id);
  return json({ data: { removed: warnings.length === 0, cleanupWarnings: warnings } }, 200, id);
}

function legacyDisableTarget(request) {
  if (request.method !== 'POST') return null;
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'integrations' || parts[3] !== 'disable') return null;
  const principalId = decodeURIComponent(parts[2]);
  return /^svc_[A-Za-z0-9_-]+$/u.test(principalId) ? principalId : null;
}

async function handleLegacyRequest(request, env, fetcher, assertion, id) {
  const principalId = legacyDisableTarget(request);
  if (!principalId) return handleCoreIntegrationRequest(request, env, { fetcher, assertion, id });
  const copy = request.clone();
  const response = await handleCoreIntegrationRequest(request, env, { fetcher, assertion, id });
  if (!response.ok) return response;
  const body = await copy.json().catch(() => null);
  const spaceId = typeof body?.spaceId === 'string' ? body.spaceId.trim() : '';
  if (!/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) return response;
  const warnings = await cleanupIntegrationEventing(env, fetcher, assertion, spaceId, principalId, id).catch(() => ['eventing:cleanup']);
  if (!warnings.length) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload?.data) return response;
  return json({ data: { ...payload.data, cleanupWarnings: [...(payload.data.cleanupWarnings ?? []), ...warnings] } }, response.status, id);
}

export async function handleIntegrationRequest(request, env, { fetcher = fetch, assertion, id } = {}) {
  try {
    // Unit/legacy harnesses intentionally omit the HomeMew application backend. Keep the
    // pre-container Service-Principal orchestration reachable there without weakening
    // production readiness: integrationsReady() still requires HOMEMEW_BACKEND.
    if (!env.HOMEMEW_BACKEND || typeof env.HOMEMEW_BACKEND.fetch !== 'function') {
      return handleLegacyRequest(request, env, fetcher, assertion, id);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (url.pathname === '/api/integrations') {
      if (request.method === 'GET') return await handleList(request, env, fetcher, assertion, id);
      if (request.method === 'POST') return await handleCreate(request, env, fetcher, assertion, id);
      throw new ExternalSystemError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    if (parts[0] !== 'api' || parts[1] !== 'integrations' || !parts[2]) {
      return handleLegacyRequest(request, env, fetcher, assertion, id);
    }

    const rawId = decodeURIComponent(parts[2]);
    if (/^svc_[A-Za-z0-9_-]+$/u.test(rawId)) return handleLegacyRequest(request, env, fetcher, assertion, id);
    const externalSystemId = parseExternalSystemId(rawId);

    if (parts[3] === 'agent') {
      return handleExternalSystemAgentRequest(request, env, { fetcher, assertion, id, externalSystemId });
    }

    if (parts.length === 3 && request.method === 'GET') return await handleGet(request, env, fetcher, assertion, id, externalSystemId);
    if (parts.length === 3 && request.method === 'PATCH') return await handleUpdate(request, env, fetcher, assertion, id, externalSystemId);

    if (parts[3] === 'service') {
      if (parts.length === 4 && request.method === 'GET') return await handleServiceGet(request, env, fetcher, assertion, id, externalSystemId);
      if (parts.length === 4 && request.method === 'POST') return await handleServiceCreate(request, env, fetcher, assertion, id, externalSystemId);
      if (parts.length === 4 && request.method === 'PATCH') return await handleServiceMutation(request, env, fetcher, assertion, id, externalSystemId, 'update');
      if (parts.length === 5 && parts[4] === 'credential-rotation' && request.method === 'POST') return await handleServiceMutation(request, env, fetcher, assertion, id, externalSystemId, 'rotate');
      if (parts.length === 6 && parts[4] === 'credential-rotation' && parts[5] === 'complete' && request.method === 'POST') return await handleServiceMutation(request, env, fetcher, assertion, id, externalSystemId, 'complete');
      if (parts.length === 6 && parts[4] === 'credential-rotation' && parts[5] === 'cancel' && request.method === 'POST') return await handleServiceMutation(request, env, fetcher, assertion, id, externalSystemId, 'cancel');
      if (parts.length === 5 && parts[4] === 'remove' && request.method === 'POST') return await handleServiceRemove(request, env, fetcher, assertion, id, externalSystemId);
    }

    throw new ExternalSystemError(404, 'NOT_FOUND', 'Not found');
  } catch (error) {
    return errorJson(error, id);
  }
}
