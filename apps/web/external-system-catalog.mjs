const SPACE_ID = /^spc_[A-Za-z0-9_-]+$/u;
const EXTERNAL_SYSTEM_ID = /^ext_[a-f0-9]{32}$/u;
const SERVICE_PRINCIPAL_ID = /^svc_[A-Za-z0-9_-]+$/u;
const AGENT_ID = /^agt_[A-Za-z0-9_-]+$/u;

export class ExternalSystemCatalogError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function parseExternalSystemId(value) {
  if (typeof value !== 'string' || !EXTERNAL_SYSTEM_ID.test(value)) {
    throw new ExternalSystemCatalogError(404, 'EXTERNAL_SYSTEM_NOT_FOUND', '找不到这个外部系统');
  }
  return value;
}

export function parseExternalSystemSpaceId(value) {
  if (typeof value !== 'string' || !SPACE_ID.test(value)) {
    throw new ExternalSystemCatalogError(422, 'VALIDATION_ERROR', 'spaceId is invalid');
  }
  return value;
}

function backend(env) {
  if (!env.HOMEMEW_BACKEND || typeof env.HOMEMEW_BACKEND.fetch !== 'function') {
    throw new ExternalSystemCatalogError(503, 'EXTERNAL_SYSTEM_CATALOG_NOT_CONFIGURED', 'HomeMew 应用配置服务暂时不可用');
  }
  return env.HOMEMEW_BACKEND;
}

async function requestCatalog(env, path, { method = 'GET', body, id } = {}) {
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (id) headers.set('x-request-id', id);
  const response = await backend(env).fetch(new Request(`https://homemew-backend.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ExternalSystemCatalogError(
      response.status,
      payload?.error?.code ?? 'EXTERNAL_SYSTEM_CATALOG_FAILED',
      payload?.error?.message ?? 'HomeMew 外部系统目录暂时不可用',
    );
  }
  return payload?.data;
}

export async function listExternalSystems(env, spaceId, id) {
  return requestCatalog(env, `/internal/v1/external-systems?spaceId=${encodeURIComponent(parseExternalSystemSpaceId(spaceId))}`, { id });
}

export async function getExternalSystem(env, spaceId, externalSystemId, id) {
  return requestCatalog(
    env,
    `/internal/v1/external-systems/${encodeURIComponent(parseExternalSystemId(externalSystemId))}?spaceId=${encodeURIComponent(parseExternalSystemSpaceId(spaceId))}`,
    { id },
  );
}

export async function createExternalSystem(env, input, id) {
  return requestCatalog(env, '/internal/v1/external-systems', {
    method: 'POST',
    id,
    body: input,
  });
}

export async function updateExternalSystem(env, spaceId, externalSystemId, patch, id) {
  return requestCatalog(env, `/internal/v1/external-systems/${encodeURIComponent(parseExternalSystemId(externalSystemId))}`, {
    method: 'PATCH',
    id,
    body: { spaceId: parseExternalSystemSpaceId(spaceId), ...patch },
  });
}

export async function bindExternalSystemService(env, spaceId, externalSystemId, servicePrincipalId, expectedServicePrincipalId, id) {
  if (servicePrincipalId !== null && (typeof servicePrincipalId !== 'string' || !SERVICE_PRINCIPAL_ID.test(servicePrincipalId))) {
    throw new ExternalSystemCatalogError(422, 'INVALID_SERVICE_PRINCIPAL_ID', 'servicePrincipalId is invalid');
  }
  if (expectedServicePrincipalId !== null && (typeof expectedServicePrincipalId !== 'string' || !SERVICE_PRINCIPAL_ID.test(expectedServicePrincipalId))) {
    throw new ExternalSystemCatalogError(422, 'INVALID_SERVICE_PRINCIPAL_ID', 'expectedServicePrincipalId is invalid');
  }
  return updateExternalSystem(env, spaceId, externalSystemId, { servicePrincipalId, expectedServicePrincipalId }, id);
}

export async function bindExternalSystemAgent(env, spaceId, externalSystemId, agentId, expectedAgentId, id) {
  if (agentId !== null && (typeof agentId !== 'string' || !AGENT_ID.test(agentId))) {
    throw new ExternalSystemCatalogError(422, 'INVALID_AGENT_ID', 'agentId is invalid');
  }
  if (expectedAgentId !== null && (typeof expectedAgentId !== 'string' || !AGENT_ID.test(expectedAgentId))) {
    throw new ExternalSystemCatalogError(422, 'INVALID_AGENT_ID', 'expectedAgentId is invalid');
  }
  return updateExternalSystem(env, spaceId, externalSystemId, { agentId, expectedAgentId }, id);
}
