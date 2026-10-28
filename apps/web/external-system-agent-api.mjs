import {
  bindExternalSystemAgent,
  ExternalSystemCatalogError,
  getExternalSystem,
  parseExternalSystemId,
  parseExternalSystemSpaceId,
} from './external-system-catalog.mjs';

const MANAGER_SCOPES = ['profile:read', 'grants:manage'];
const PERSON_DIRECTORY_KEY = 'person_directory';
const LEGACY_MODEL_KEYS = ['event', 'task', 'day_record', PERSON_DIRECTORY_KEY];
const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const PERMISSION_RANK = { read: 1, write: 2, manage: 3 };

class AgentAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
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
  if (error instanceof AgentAccessError || error instanceof ExternalSystemCatalogError) {
    return json({ error: { code: error.code, message: error.message, requestId: id } }, error.status, id);
  }
  console.error('[HomeMew external system Agent Access] unhandled error', error instanceof Error ? error.message : 'unknown');
  return json({ error: { code: 'INTERNAL_ERROR', message: 'Agent 接入服务暂时不可用', requestId: id } }, 500, id);
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentAccessError(500, 'WEB_NOT_CONFIGURED', `${name} is not configured`);
  return value.trim();
}

function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}

function applicationCredential(env) {
  const value = requiredString(env.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL, 'LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL');
  if (!value.startsWith('lsa_')) throw new AgentAccessError(503, 'INTEGRATIONS_NOT_CONFIGURED', 'LifeSpace Application Credential is invalid');
  return value;
}

function webApplicationCredential(env) {
  const value = requiredString(env.LIFESPACE_APPLICATION_CREDENTIAL, 'LIFESPACE_APPLICATION_CREDENTIAL');
  if (!value.startsWith('lsa_')) throw new AgentAccessError(500, 'WEB_NOT_CONFIGURED', 'LIFESPACE_APPLICATION_CREDENTIAL is invalid');
  return value;
}

function identityUrl(env, path) {
  return `${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}${path}`;
}

function coreUrl(env, path) {
  return `${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}${path}`;
}

function requireSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new AgentAccessError(403, 'INVALID_ORIGIN', 'Cross-origin state-changing requests are not allowed');
}

async function readJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AgentAccessError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  return body;
}

function upstreamError(response, payload, fallbackCode) {
  const upstream = payload?.error;
  if (response.status >= 400 && response.status < 500 && upstream && typeof upstream.code === 'string') {
    return new AgentAccessError(response.status, upstream.code, typeof upstream.message === 'string' ? upstream.message : 'LifeSpace rejected the request');
  }
  if (upstream && typeof upstream.code === 'string' && typeof upstream.message === 'string') {
    return new AgentAccessError(502, fallbackCode, `${upstream.message} (${upstream.code})`);
  }
  return new AgentAccessError(502, fallbackCode, 'LifeSpace 服务暂时不可用');
}

async function requestJson(fetcher, url, { method = 'GET', credential, body, id, fallbackCode }) {
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
  } catch (error) {
    console.error(`[HomeMew external system Agent Access] ${fallbackCode} fetch failed`, error instanceof Error ? error.message : 'unknown');
    throw new AgentAccessError(502, fallbackCode, '连接 LifeSpace 失败，请稍后重试');
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw upstreamError(response, payload, fallbackCode);
  return payload?.data;
}

async function identityApplicationRequest(env, fetcher, path, options) {
  return requestJson(fetcher, identityUrl(env, path), {
    ...options,
    credential: applicationCredential(env),
  });
}

async function coreManagerRequest(env, fetcher, token, path, options) {
  return requestJson(fetcher, coreUrl(env, path), {
    ...options,
    credential: token,
  });
}

async function managementContext(env, fetcher, assertion, spaceId, id) {
  const exchange = await requestJson(fetcher, identityUrl(env, '/internal/v1/access/tokens'), {
    method: 'POST',
    credential: webApplicationCredential(env),
    body: { accessAssertion: assertion, requestedScopes: MANAGER_SCOPES },
    id,
    fallbackCode: 'INTEGRATION_MANAGER_EXCHANGE_FAILED',
  });
  if (!exchange?.accessToken) throw new AgentAccessError(502, 'INTEGRATION_MANAGER_EXCHANGE_FAILED', 'LifeSpace 未返回有效的管理会话');
  await coreManagerRequest(env, fetcher, exchange.accessToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants?includeRevoked=true`, {
    id,
    fallbackCode: 'INTEGRATION_GRANTS_FAILED',
  });
  return exchange.accessToken;
}

function parsePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentAccessError(422, 'VALIDATION_ERROR', 'permissions is required');
  const keys = Object.keys(value);
  if (keys.length > 200 || keys.some((key) => !MODEL_KEY_PATTERN.test(key))) throw new AgentAccessError(422, 'VALIDATION_ERROR', 'permissions contains an invalid model key');
  const result = Object.create(null);
  for (const modelKey of keys) {
    const permission = value[modelKey];
    if (permission === undefined || permission === null || permission === 'none') result[modelKey] = null;
    else if (permission === 'read' || permission === 'write') result[modelKey] = permission;
    else throw new AgentAccessError(422, 'VALIDATION_ERROR', `${modelKey} permission must be read, write or none`);
  }
  return result;
}

function parseCredentialAccess(value) {
  if (value !== 'read' && value !== 'write') throw new AgentAccessError(422, 'VALIDATION_ERROR', 'credentialAccess must be read or write');
  return value;
}

function parseCredentialId(value) {
  if (typeof value !== 'string' || !/^agc_[A-Za-z0-9_-]+$/u.test(value)) throw new AgentAccessError(404, 'AGENT_CREDENTIAL_NOT_FOUND', 'Agent credential not found');
  return value;
}

function scopesForCredentialAccess(access) {
  return access === 'write' ? ['resources:read', 'resources:write'] : ['resources:read'];
}

function credentialAccessForScopes(scopes) {
  if (Array.isArray(scopes) && scopes.includes('resources:write')) return 'write';
  if (Array.isArray(scopes) && scopes.includes('resources:read')) return 'read';
  return null;
}

function assertPermissionsWithinAccess(permissions, access) {
  if (access === 'read' && Object.values(permissions).includes('write')) {
    throw new AgentAccessError(422, 'AGENT_SCOPE_TOO_NARROW', 'Agent API 凭证为只读能力上限，当前家庭直接权限不能包含读写');
  }
}

function activeGrant(grant) {
  if (grant.revokedAt) return false;
  return !grant.expiresAt || Date.parse(grant.expiresAt) > Date.now();
}

function activeCredential(credential) {
  if (credential.status !== 'active' || credential.revokedAt) return false;
  return !credential.expiresAt || Date.parse(credential.expiresAt) > Date.now();
}

function modelPermission(grants, modelKey) {
  let best = null;
  let rank = 0;
  for (const grant of grants) {
    if (!activeGrant(grant)) continue;
    const matchesModel = modelKey === PERSON_DIRECTORY_KEY
      ? grant.resourceType === 'person_directory' && grant.resourceId === null
      : grant.resourceType === 'model' && grant.resourceId === modelKey;
    const matchesSpace = grant.resourceType === 'space' && grant.resourceId === null;
    if (!matchesModel && !matchesSpace) continue;
    const nextRank = PERMISSION_RANK[grant.permission] ?? 0;
    if (nextRank > rank) {
      best = grant.permission === 'manage' ? 'write' : grant.permission;
      rank = nextRank;
    }
  }
  return best === 'read' || best === 'write' ? best : null;
}

async function listAgents(env, fetcher, id) {
  const result = await identityApplicationRequest(env, fetcher, '/internal/v1/agents', { id, fallbackCode: 'AGENT_LIST_FAILED' });
  if (!Array.isArray(result?.items)) throw new AgentAccessError(502, 'AGENT_LIST_FAILED', 'LifeSpace 未返回有效 Agent 列表');
  return result.items;
}

async function resolveAgent(env, fetcher, agentId, id) {
  const agent = (await listAgents(env, fetcher, id)).find((item) => item.id === agentId);
  if (!agent) throw new AgentAccessError(409, 'AGENT_BINDING_BROKEN', '外部系统绑定的 Agent 已不存在或不再属于当前应用');
  return agent;
}

async function createAgentIdentity(env, fetcher, displayName, id) {
  const baseline = new Set((await listAgents(env, fetcher, id)).map((item) => item.id));
  const create = () => identityApplicationRequest(env, fetcher, '/internal/v1/agents', {
    method: 'POST',
    body: { displayName: `${displayName.slice(0, 92)} Agent` },
    id,
    fallbackCode: 'AGENT_CREATE_FAILED',
  });
  try {
    return await create();
  } catch (error) {
    if (!(error instanceof AgentAccessError) || error.status < 500) throw error;
    const unexpected = (await listAgents(env, fetcher, id)).filter((item) => !baseline.has(item.id));
    if (unexpected.length === 1) return unexpected[0];
    if (unexpected.length > 1) throw new AgentAccessError(502, 'AGENT_CREATE_RECONCILIATION_FAILED', '创建 Agent 时出现多个无法判断归属的新身份');
  }
  return create();
}

function credentialDto(value) {
  return {
    id: value.id,
    displayPrefix: value.displayPrefix,
    suffix: value.lastFour,
    label: value.label,
    scopes: Array.isArray(value.scopes) ? value.scopes : [],
    expiresAt: value.expiresAt ?? null,
    createdAt: value.createdAt,
    lastUsedAt: value.lastUsedAt ?? null,
    revokedAt: value.revokedAt ?? null,
    active: activeCredential(value),
  };
}

async function listCredentials(env, fetcher, agentId, id) {
  const result = await identityApplicationRequest(env, fetcher, `/internal/v1/agents/${encodeURIComponent(agentId)}/api-credentials`, {
    id,
    fallbackCode: 'AGENT_CREDENTIALS_FAILED',
  });
  return Array.isArray(result) ? result.map(credentialDto).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
}

async function revokeCredential(env, fetcher, agentId, credentialId, id) {
  await identityApplicationRequest(env, fetcher, `/internal/v1/agents/${encodeURIComponent(agentId)}/api-credentials/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
    id,
    fallbackCode: 'AGENT_CREDENTIAL_REVOKE_FAILED',
  });
}

async function createCredential(env, fetcher, agentId, displayName, access, id) {
  const value = await identityApplicationRequest(env, fetcher, `/internal/v1/agents/${encodeURIComponent(agentId)}/api-credentials`, {
    method: 'POST',
    body: { label: `${displayName.slice(0, 78)} Agent API Token`, scopes: scopesForCredentialAccess(access), expiresAt: null },
    id,
    fallbackCode: 'AGENT_CREDENTIAL_CREATE_FAILED',
  });
  if (!value?.id || !value?.token) throw new AgentAccessError(502, 'AGENT_CREDENTIAL_CREATE_FAILED', 'LifeSpace 未返回有效 Agent API Token');
  return { credentialId: value.id, token: value.token };
}

async function createCredentialSafely(env, fetcher, agentId, displayName, access, id, baseline = []) {
  const baselineIds = new Set(baseline.filter((item) => item.active).map((item) => item.id));
  try {
    return await createCredential(env, fetcher, agentId, displayName, access, id);
  } catch (error) {
    if (!(error instanceof AgentAccessError) || error.status < 500) throw error;
    const after = await listCredentials(env, fetcher, agentId, id);
    for (const credential of after.filter((item) => item.active && !baselineIds.has(item.id))) {
      await revokeCredential(env, fetcher, agentId, credential.id, id);
    }
  }
  return createCredential(env, fetcher, agentId, displayName, access, id);
}

async function listSpaceGrants(env, fetcher, managerToken, spaceId, id) {
  const result = await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants?includeRevoked=true`, {
    id,
    fallbackCode: 'AGENT_GRANTS_FAILED',
  });
  if (!Array.isArray(result)) throw new AgentAccessError(502, 'AGENT_GRANTS_FAILED', 'LifeSpace 未返回有效授权列表');
  return result;
}

function grantsForAgent(grants, agentId) {
  return grants.filter((grant) => grant.granteeType === 'agent' && grant.granteeId === agentId);
}

async function createGrant(env, fetcher, managerToken, spaceId, agentId, modelKey, permission, id) {
  return coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants`, {
    method: 'POST',
    body: { granteeType: 'agent', granteeId: agentId, resourceType: modelKey === PERSON_DIRECTORY_KEY ? 'person_directory' : 'model', resourceId: modelKey === PERSON_DIRECTORY_KEY ? null : modelKey, permission, expiresAt: null },
    id,
    fallbackCode: 'AGENT_GRANT_CREATE_FAILED',
  });
}

async function revokeGrant(env, fetcher, managerToken, spaceId, grantId, id) {
  await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants/${encodeURIComponent(grantId)}`, {
    method: 'DELETE', id, fallbackCode: 'AGENT_GRANT_REVOKE_FAILED',
  });
}

async function reconcileGrants(env, fetcher, managerToken, spaceId, agentId, permissions, id) {
  const all = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
  const current = grantsForAgent(all, agentId);
  for (const modelKey of Object.keys(permissions)) {
    const desired = permissions[modelKey];
    const active = current.filter((grant) => activeGrant(grant) && ((modelKey === PERSON_DIRECTORY_KEY && grant.resourceType === 'person_directory' && grant.resourceId === null)
      || (modelKey !== PERSON_DIRECTORY_KEY && grant.resourceType === 'model' && grant.resourceId === modelKey)));
    if (!desired) {
      for (const grant of active) await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id);
      continue;
    }
    if (!active.length) {
      await createGrant(env, fetcher, managerToken, spaceId, agentId, modelKey, desired, id);
      continue;
    }
    const [keep, ...duplicates] = active;
    if (keep.permission !== desired) {
      await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants/${encodeURIComponent(keep.id)}`, {
        method: 'PATCH', body: { permission: desired }, id, fallbackCode: 'AGENT_GRANT_UPDATE_FAILED',
      });
    }
    for (const duplicate of duplicates) await revokeGrant(env, fetcher, managerToken, spaceId, duplicate.id, id);
  }
}

function agentDto(agent, grants, credentials) {
  const activeCredentials = credentials.filter((item) => item.active);
  const wholeSpace = grants.some((grant) => activeGrant(grant) && grant.resourceType === 'space' && grant.resourceId === null);
  const modelKeys = new Set([...LEGACY_MODEL_KEYS, ...grants
    .filter((grant) => grant.resourceType === 'model' && typeof grant.resourceId === 'string')
    .map((grant) => grant.resourceId)]);
  return {
    id: agent.id,
    displayName: agent.displayName,
    status: agent.status,
    credentialAccess: credentialAccessForScopes(activeCredentials[0]?.scopes ?? []),
    permissions: Object.fromEntries([...modelKeys].map((modelKey) => [modelKey, modelPermission(grants.filter((grant) => grant.resourceType !== 'space'), modelKey)])),
    effectivePermissions: Object.fromEntries([...modelKeys].map((modelKey) => [modelKey, modelPermission(grants, modelKey)])),
    hasWholeSpaceGrant: wholeSpace,
    rotationPending: activeCredentials.length > 1,
    rotationCandidateId: activeCredentials.length > 1 ? activeCredentials[0].id : null,
    credentials,
  };
}

async function readAgentAccess(env, fetcher, managerToken, external, spaceId, id) {
  if (!external.agentId) return null;
  const [agent, allGrants, credentials] = await Promise.all([
    resolveAgent(env, fetcher, external.agentId, id),
    listSpaceGrants(env, fetcher, managerToken, spaceId, id),
    listCredentials(env, fetcher, external.agentId, id),
  ]);
  return agentDto(agent, grantsForAgent(allGrants, external.agentId), credentials);
}

async function cleanupAgent(env, fetcher, managerToken, spaceId, agentId, id) {
  const warnings = [];
  try {
    const grants = grantsForAgent(await listSpaceGrants(env, fetcher, managerToken, spaceId, id), agentId).filter(activeGrant);
    for (const grant of grants) {
      try { await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id); }
      catch { warnings.push(`agent-grant:${grant.id}`); }
    }
  } catch { warnings.push('agent-grants:list'); }
  try {
    const credentials = await listCredentials(env, fetcher, agentId, id);
    for (const credential of credentials.filter((item) => item.active)) {
      try { await revokeCredential(env, fetcher, agentId, credential.id, id); }
      catch { warnings.push(`agent-credential:${credential.id}`); }
    }
  } catch { warnings.push('agent-credentials:list'); }
  return warnings;
}

async function handleGet(request, env, fetcher, assertion, id, externalSystemId) {
  const spaceId = parseExternalSystemSpaceId(new URL(request.url).searchParams.get('spaceId'));
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  return json({ data: await readAgentAccess(env, fetcher, managerToken, external, spaceId, id) }, 200, id);
}

async function handleCreate(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const access = parseCredentialAccess(body.credentialAccess);
  const permissions = parsePermissions(body.permissions);
  assertPermissionsWithinAccess(permissions, access);
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (external.agentId) throw new AgentAccessError(409, 'AGENT_ALREADY_CONFIGURED', '这个外部系统已经配置 Agent Access');

  const agent = await createAgentIdentity(env, fetcher, external.displayName, id);
  if (!agent?.id) throw new AgentAccessError(502, 'AGENT_CREATE_FAILED', 'LifeSpace 未返回新 Agent');
  try {
    await reconcileGrants(env, fetcher, managerToken, spaceId, agent.id, permissions, id);
    const credential = await createCredentialSafely(env, fetcher, agent.id, external.displayName, access, id, []);
    await bindExternalSystemAgent(env, spaceId, externalSystemId, agent.id, null, id);
    const value = await readAgentAccess(env, fetcher, managerToken, { ...external, agentId: agent.id }, spaceId, id);
    return json({ data: { agent: value, credential } }, 201, id);
  } catch (error) {
    await cleanupAgent(env, fetcher, managerToken, spaceId, agent.id, id).catch(() => undefined);
    throw error;
  }
}

async function handleUpdate(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const permissions = parsePermissions(body.permissions);
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.agentId) throw new AgentAccessError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent Access');
  const credentials = await listCredentials(env, fetcher, external.agentId, id);
  const access = credentialAccessForScopes(credentials.find((item) => item.active)?.scopes ?? []);
  if (access) assertPermissionsWithinAccess(permissions, access);
  await reconcileGrants(env, fetcher, managerToken, spaceId, external.agentId, permissions, id);
  return json({ data: await readAgentAccess(env, fetcher, managerToken, external, spaceId, id) }, 200, id);
}

async function handleStartRotation(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const access = parseCredentialAccess(body.credentialAccess);
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.agentId) throw new AgentAccessError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent Access');
  const current = await listCredentials(env, fetcher, external.agentId, id);
  const active = current.filter((item) => item.active);
  if (active.length > 1) throw new AgentAccessError(409, 'AGENT_CREDENTIAL_ROTATION_PENDING', '已有一次 Agent 凭据轮换尚未完成');
  const grants = grantsForAgent(await listSpaceGrants(env, fetcher, managerToken, spaceId, id), external.agentId);
  const permissions = Object.fromEntries([...new Set([...LEGACY_MODEL_KEYS, ...grants.filter((grant) => grant.resourceType === 'model' && typeof grant.resourceId === 'string').map((grant) => grant.resourceId)])].map((key) => [key, modelPermission(grants, key)]));
  assertPermissionsWithinAccess(permissions, access);
  const credential = await createCredentialSafely(env, fetcher, external.agentId, external.displayName, access, id, active);
  return json({ data: { agent: await readAgentAccess(env, fetcher, managerToken, external, spaceId, id), credential } }, 201, id);
}

async function handleCompleteRotation(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const keepId = parseCredentialId(body.keepCredentialId);
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.agentId) throw new AgentAccessError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent Access');
  const active = (await listCredentials(env, fetcher, external.agentId, id)).filter((item) => item.active);
  if (!active.some((item) => item.id === keepId)) throw new AgentAccessError(404, 'AGENT_CREDENTIAL_NOT_FOUND', '要保留的新 Agent 凭据不存在或已失效');
  for (const credential of active) if (credential.id !== keepId) await revokeCredential(env, fetcher, external.agentId, credential.id, id);
  return json({ data: await readAgentAccess(env, fetcher, managerToken, external, spaceId, id) }, 200, id);
}

async function handleCancelRotation(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const candidateId = parseCredentialId(body.candidateCredentialId);
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.agentId) throw new AgentAccessError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent Access');
  const active = (await listCredentials(env, fetcher, external.agentId, id)).filter((item) => item.active);
  if (active.length < 2 || active[0].id !== candidateId) throw new AgentAccessError(409, 'INVALID_AGENT_ROTATION_CANDIDATE', '当前没有匹配的 Agent 凭据轮换');
  await revokeCredential(env, fetcher, external.agentId, candidateId, id);
  return json({ data: await readAgentAccess(env, fetcher, managerToken, external, spaceId, id) }, 200, id);
}

async function handleRemove(request, env, fetcher, assertion, id, externalSystemId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseExternalSystemSpaceId(body.spaceId);
  const managerToken = await managementContext(env, fetcher, assertion, spaceId, id);
  const external = await getExternalSystem(env, spaceId, externalSystemId, id);
  if (!external.agentId) throw new AgentAccessError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent Access');
  const warnings = await cleanupAgent(env, fetcher, managerToken, spaceId, external.agentId, id);
  if (warnings.length) throw new AgentAccessError(502, 'AGENT_REMOVE_INCOMPLETE', 'Agent 凭据或当前家庭授权未能全部撤销，已保留绑定以便继续清理');
  await bindExternalSystemAgent(env, spaceId, externalSystemId, null, external.agentId, id);
  return json({ data: { removed: true } }, 200, id);
}

export async function handleExternalSystemAgentRequest(request, env, { fetcher = fetch, assertion, id, externalSystemId }) {
  try {
    const externalId = parseExternalSystemId(externalSystemId);
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'integrations' || parts[2] !== externalId || parts[3] !== 'agent') {
      throw new AgentAccessError(404, 'NOT_FOUND', 'Not found');
    }
    if (parts.length === 4 && request.method === 'GET') return handleGet(request, env, fetcher, assertion, id, externalId);
    if (parts.length === 4 && request.method === 'POST') return handleCreate(request, env, fetcher, assertion, id, externalId);
    if (parts.length === 4 && request.method === 'PATCH') return handleUpdate(request, env, fetcher, assertion, id, externalId);
    if (parts.length === 5 && parts[4] === 'credential-rotation' && request.method === 'POST') return handleStartRotation(request, env, fetcher, assertion, id, externalId);
    if (parts.length === 6 && parts[4] === 'credential-rotation' && parts[5] === 'complete' && request.method === 'POST') return handleCompleteRotation(request, env, fetcher, assertion, id, externalId);
    if (parts.length === 6 && parts[4] === 'credential-rotation' && parts[5] === 'cancel' && request.method === 'POST') return handleCancelRotation(request, env, fetcher, assertion, id, externalId);
    if (parts.length === 5 && parts[4] === 'remove' && request.method === 'POST') return handleRemove(request, env, fetcher, assertion, id, externalId);
    throw new AgentAccessError(404, 'NOT_FOUND', 'Not found');
  } catch (error) {
    return errorJson(error, id);
  }
}
