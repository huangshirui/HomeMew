import {
  decodeIntegrationBinding,
  encodeIntegrationBinding,
  isDiscardedIntegrationDescription,
} from './integration-binding.mjs';

const MANAGER_SCOPES = ['profile:read', 'grants:manage'];
const LEGACY_MODEL_KEYS = ['event', 'task', 'day_record'];
const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const PERMISSION_RANK = { read: 1, write: 2, manage: 3 };

class AgentIntegrationError extends Error {
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
  if (error instanceof AgentIntegrationError) {
    return json({ error: { code: error.code, message: error.message, requestId: id } }, error.status, id);
  }
  console.error('[HomeMew web agent integration] unhandled error', error instanceof Error ? error.message : 'unknown');
  return json({ error: { code: 'INTERNAL_ERROR', message: 'Agent 接入服务暂时不可用', requestId: id } }, 500, id);
}

function requiredString(value, name, status = 500, code = 'WEB_NOT_CONFIGURED') {
  if (typeof value !== 'string' || !value.trim()) throw new AgentIntegrationError(status, code, `${name} is not configured`);
  return value.trim();
}

function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}

function webApplicationCredential(env) {
  const value = requiredString(env.LIFESPACE_APPLICATION_CREDENTIAL, 'LIFESPACE_APPLICATION_CREDENTIAL');
  if (!value.startsWith('lsa_')) throw new AgentIntegrationError(500, 'WEB_NOT_CONFIGURED', 'LIFESPACE_APPLICATION_CREDENTIAL is invalid');
  return value;
}

function integrationsApplicationCredential(env) {
  const value = requiredString(
    env.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL,
    'LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL',
    503,
    'INTEGRATIONS_NOT_CONFIGURED',
  );
  if (!value.startsWith('lsa_')) {
    throw new AgentIntegrationError(503, 'INTEGRATIONS_NOT_CONFIGURED', 'LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL is invalid');
  }
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
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) throw new AgentIntegrationError(403, 'INVALID_ORIGIN', 'Cross-origin state-changing requests are not allowed');
}

async function readJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AgentIntegrationError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  }
  return body;
}

function parseSpaceId(value) {
  if (typeof value !== 'string' || !/^spc_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new AgentIntegrationError(422, 'VALIDATION_ERROR', 'spaceId is invalid');
  }
  return value;
}

function parseServicePrincipalId(value) {
  if (typeof value !== 'string' || !/^svc_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new AgentIntegrationError(404, 'INTEGRATION_NOT_FOUND', 'External system not found');
  }
  return value;
}

function parseAgentCredentialId(value) {
  if (typeof value !== 'string' || !/^agc_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new AgentIntegrationError(404, 'AGENT_CREDENTIAL_NOT_FOUND', 'Agent credential not found');
  }
  return value;
}

function parsePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentIntegrationError(422, 'VALIDATION_ERROR', 'permissions is required');
  }
  const keys = Object.keys(value);
  if (keys.length > 200 || keys.some((key) => !MODEL_KEY_PATTERN.test(key))) {
    throw new AgentIntegrationError(422, 'VALIDATION_ERROR', 'permissions contains an invalid model key');
  }
  const result = Object.create(null);
  for (const modelKey of keys) {
    const permission = value[modelKey];
    if (permission === undefined || permission === null || permission === 'none') {
      result[modelKey] = null;
      continue;
    }
    if (!['read', 'write'].includes(permission)) {
      throw new AgentIntegrationError(422, 'VALIDATION_ERROR', `${modelKey} permission must be read, write or none`);
    }
    result[modelKey] = permission;
  }
  return result;
}

function parseCredentialAccess(value) {
  if (value !== 'read' && value !== 'write') {
    throw new AgentIntegrationError(422, 'VALIDATION_ERROR', 'credentialAccess must be read or write');
  }
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

function assertPermissionsWithinCredentialAccess(permissions, access) {
  if (access === 'read' && Object.values(permissions).includes('write')) {
    throw new AgentIntegrationError(
      422,
      'AGENT_SCOPE_TOO_NARROW',
      'Agent API 凭证为只读能力上限，当前家庭直接权限不能包含读写；请先选择读写能力上限',
    );
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

function modelPermission(grants, modelKey, includeWholeSpace = false) {
  let best = null;
  let bestRank = 0;
  for (const grant of grants) {
    if (!activeGrant(grant)) continue;
    const matchesModel = grant.resourceType === 'model' && grant.resourceId === modelKey;
    const matchesSpace = includeWholeSpace && grant.resourceType === 'space' && grant.resourceId === null;
    if (!matchesModel && !matchesSpace) continue;
    const rank = PERMISSION_RANK[grant.permission] ?? 0;
    if (rank > bestRank) {
      best = grant.permission === 'manage' ? 'write' : grant.permission;
      bestRank = rank;
    }
  }
  return best === 'read' || best === 'write' ? best : null;
}

function upstreamError(response, payload, fallbackCode) {
  const upstream = payload?.error;
  if (response.status >= 400 && response.status < 500 && upstream && typeof upstream.code === 'string') {
    return new AgentIntegrationError(response.status, upstream.code, typeof upstream.message === 'string' ? upstream.message : 'LifeSpace rejected the request');
  }
  if (upstream && typeof upstream.code === 'string' && typeof upstream.message === 'string') {
    return new AgentIntegrationError(502, fallbackCode, `${upstream.message} (${upstream.code})`);
  }
  return new AgentIntegrationError(502, fallbackCode, 'LifeSpace 服务暂时不可用');
}

async function requestJson(fetcher, url, { method = 'GET', credential, body, id, fallbackCode }) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${credential}`,
    'x-request-id': id,
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
    console.error(`[HomeMew web agent integration] ${fallbackCode} upstream fetch failed`, error instanceof Error ? error.message : 'unknown');
    throw new AgentIntegrationError(502, fallbackCode, '连接 LifeSpace 失败，请稍后重试');
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw upstreamError(response, payload, fallbackCode);
  return payload?.data;
}

async function identityApplicationRequest(env, fetcher, path, { method = 'GET', body, id, fallbackCode }) {
  return requestJson(fetcher, identityUrl(env, path), {
    method,
    credential: integrationsApplicationCredential(env),
    body,
    id,
    fallbackCode,
  });
}

async function coreManagerRequest(env, fetcher, managerToken, path, { method = 'GET', body, id, fallbackCode }) {
  return requestJson(fetcher, coreUrl(env, path), {
    method,
    credential: managerToken,
    body,
    id,
    fallbackCode,
  });
}

async function exchangeManager(env, fetcher, assertion, id) {
  const exchange = await requestJson(fetcher, identityUrl(env, '/internal/v1/access/tokens'), {
    method: 'POST',
    credential: webApplicationCredential(env),
    body: { accessAssertion: assertion, requestedScopes: MANAGER_SCOPES },
    id,
    fallbackCode: 'INTEGRATION_MANAGER_EXCHANGE_FAILED',
  });
  if (!exchange || typeof exchange.accessToken !== 'string') {
    throw new AgentIntegrationError(502, 'INTEGRATION_MANAGER_EXCHANGE_FAILED', 'LifeSpace 未返回有效的管理会话');
  }
  await requestJson(fetcher, identityUrl(env, '/api/v1/me'), {
    credential: exchange.accessToken,
    id,
    fallbackCode: 'INTEGRATION_MANAGER_PROFILE_FAILED',
  });
  return exchange.accessToken;
}

async function listSpaceGrants(env, fetcher, managerToken, spaceId, id) {
  const grants = await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants?includeRevoked=true`, {
    id,
    fallbackCode: 'INTEGRATION_GRANTS_FAILED',
  });
  if (!Array.isArray(grants)) throw new AgentIntegrationError(502, 'INTEGRATION_GRANTS_FAILED', 'LifeSpace 未返回有效授权列表');
  return grants;
}

async function managementContext(env, fetcher, assertion, spaceId, id) {
  integrationsApplicationCredential(env);
  const managerToken = await exchangeManager(env, fetcher, assertion, id);
  const grants = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
  return { managerToken, grants };
}

async function listServicePrincipals(env, fetcher, id) {
  const principals = await identityApplicationRequest(env, fetcher, '/api/v1/service-principals', {
    id,
    fallbackCode: 'INTEGRATION_PRINCIPALS_FAILED',
  });
  if (!Array.isArray(principals)) throw new AgentIntegrationError(502, 'INTEGRATION_PRINCIPALS_FAILED', 'LifeSpace 未返回有效外部系统列表');
  return principals;
}

async function resolveBoundService(env, fetcher, spaceId, principalId, id) {
  const principal = (await listServicePrincipals(env, fetcher, id)).find((item) => item.id === principalId);
  if (!principal || isDiscardedIntegrationDescription(principal.description)) {
    throw new AgentIntegrationError(404, 'INTEGRATION_NOT_FOUND', '当前家庭没有这个外部系统');
  }
  const binding = decodeIntegrationBinding(principal.description);
  if (!binding.spaceId) {
    throw new AgentIntegrationError(409, 'INTEGRATION_BINDING_REQUIRED', '这个迁移外部系统尚未建立 HomeMew 家庭管理归属');
  }
  if (binding.spaceId !== spaceId) throw new AgentIntegrationError(404, 'INTEGRATION_NOT_FOUND', '当前家庭没有这个外部系统');
  return { principal, binding };
}

async function patchServiceBinding(env, fetcher, principal, spaceId, description, agentId, id) {
  return identityApplicationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}`, {
    method: 'PATCH',
    body: { description: encodeIntegrationBinding(spaceId, description, agentId) },
    id,
    fallbackCode: 'AGENT_BINDING_UPDATE_FAILED',
  });
}

async function listAgents(env, fetcher, id) {
  const result = await identityApplicationRequest(env, fetcher, '/internal/v1/agents', {
    id,
    fallbackCode: 'AGENT_LIST_FAILED',
  });
  const agents = result?.items;
  if (!Array.isArray(agents)) throw new AgentIntegrationError(502, 'AGENT_LIST_FAILED', 'LifeSpace 未返回有效 Agent 列表');
  return agents;
}

async function resolveAgent(env, fetcher, agentId, id) {
  const agent = (await listAgents(env, fetcher, id)).find((item) => item.id === agentId);
  if (!agent) throw new AgentIntegrationError(409, 'AGENT_BINDING_BROKEN', '外部系统绑定的 Agent 已不存在或不再属于当前应用');
  return agent;
}

async function createAgentWithReconciliation(env, fetcher, displayName, id) {
  const baseline = new Set((await listAgents(env, fetcher, id)).map((agent) => agent.id));
  const attempt = async () => identityApplicationRequest(env, fetcher, '/internal/v1/agents', {
    method: 'POST',
    body: { displayName },
    id,
    fallbackCode: 'AGENT_CREATE_FAILED',
  });

  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof AgentIntegrationError) || error.status < 500) throw error;
    const unexpected = (await listAgents(env, fetcher, id)).filter((agent) => !baseline.has(agent.id));
    if (unexpected.length === 1) return unexpected[0];
    if (unexpected.length > 1) {
      throw new AgentIntegrationError(502, 'AGENT_CREATE_RECONCILIATION_FAILED', '创建 Agent 时连接中断，且出现多个新 Agent，无法安全判断本次结果');
    }
  }

  return attempt();
}

function agentCredentialDto(credential) {
  return {
    id: credential.id,
    displayPrefix: credential.displayPrefix,
    suffix: credential.lastFour,
    label: credential.label,
    scopes: Array.isArray(credential.scopes) ? credential.scopes : [],
    expiresAt: credential.expiresAt ?? null,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt ?? null,
    revokedAt: credential.revokedAt ?? null,
    active: activeCredential(credential),
  };
}

async function listAgentCredentials(env, fetcher, agentId, id) {
  const credentials = await identityApplicationRequest(env, fetcher, `/internal/v1/agents/${encodeURIComponent(agentId)}/api-credentials`, {
    id,
    fallbackCode: 'AGENT_CREDENTIALS_FAILED',
  });
  return Array.isArray(credentials)
    ? credentials.map(agentCredentialDto).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    : [];
}

async function revokeAgentCredential(env, fetcher, agentId, credentialId, id) {
  await identityApplicationRequest(env, fetcher, `/internal/v1/agents/${encodeURIComponent(agentId)}/api-credentials/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
    id,
    fallbackCode: 'AGENT_CREDENTIAL_REVOKE_FAILED',
  });
}

async function createAgentCredential(env, fetcher, agentId, displayName, access, id) {
  const credential = await identityApplicationRequest(env, fetcher, `/internal/v1/agents/${encodeURIComponent(agentId)}/api-credentials`, {
    method: 'POST',
    body: {
      label: `${displayName} Agent API Token`,
      scopes: scopesForCredentialAccess(access),
      expiresAt: null,
    },
    id,
    fallbackCode: 'AGENT_CREDENTIAL_CREATE_FAILED',
  });
  if (!credential?.id || !credential?.token) {
    throw new AgentIntegrationError(502, 'AGENT_CREDENTIAL_CREATE_FAILED', 'LifeSpace 未返回有效 Agent API Token');
  }
  return { credentialId: credential.id, token: credential.token };
}

async function cleanupAgentCredentialsCreatedAfter(env, fetcher, agentId, baselineIds, id) {
  const credentials = await listAgentCredentials(env, fetcher, agentId, id);
  for (const credential of credentials.filter((item) => item.active && !baselineIds.has(item.id))) {
    await revokeAgentCredential(env, fetcher, agentId, credential.id, id);
  }
}

async function createAgentCredentialWithReconciliation(env, fetcher, agentId, displayName, access, id, baselineCredentials = []) {
  const baselineIds = new Set(baselineCredentials.filter((credential) => credential.active).map((credential) => credential.id));
  try {
    return await createAgentCredential(env, fetcher, agentId, displayName, access, id);
  } catch (error) {
    if (!(error instanceof AgentIntegrationError) || error.status < 500) throw error;
    try {
      await cleanupAgentCredentialsCreatedAfter(env, fetcher, agentId, baselineIds, id);
    } catch {
      throw new AgentIntegrationError(
        502,
        'AGENT_CREDENTIAL_RECONCILIATION_FAILED',
        '创建 Agent Token 时连接中断，且无法确认 LifeSpace 是否已生成凭据；已停止自动重试',
      );
    }
  }

  try {
    return await createAgentCredential(env, fetcher, agentId, displayName, access, id);
  } catch (error) {
    await cleanupAgentCredentialsCreatedAfter(env, fetcher, agentId, baselineIds, id).catch(() => undefined);
    throw error;
  }
}

function grantsForAgent(grants, agentId) {
  return grants.filter((grant) => grant.granteeType === 'agent' && grant.granteeId === agentId);
}

async function createAgentGrant(env, fetcher, managerToken, spaceId, agentId, modelKey, permission, id) {
  return coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants`, {
    method: 'POST',
    body: {
      granteeType: 'agent',
      granteeId: agentId,
      resourceType: 'model',
      resourceId: modelKey,
      permission,
      expiresAt: null,
    },
    id,
    fallbackCode: 'AGENT_GRANT_CREATE_FAILED',
  });
}

async function revokeGrant(env, fetcher, managerToken, spaceId, grantId, id) {
  await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants/${encodeURIComponent(grantId)}`, {
    method: 'DELETE',
    id,
    fallbackCode: 'AGENT_GRANT_REVOKE_FAILED',
  });
}

async function reconcileAgentModelGrants(env, fetcher, managerToken, spaceId, agentId, allGrants, permissions, id) {
  const agentGrants = grantsForAgent(allGrants, agentId);
  for (const modelKey of Object.keys(permissions)) {
    const desired = permissions[modelKey];
    const active = agentGrants.filter((grant) => activeGrant(grant) && grant.resourceType === 'model' && grant.resourceId === modelKey);
    if (!desired) {
      for (const grant of active) await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id);
      continue;
    }
    if (!active.length) {
      await createAgentGrant(env, fetcher, managerToken, spaceId, agentId, modelKey, desired, id);
      continue;
    }
    const [keep, ...duplicates] = active;
    if (keep.permission !== desired) {
      await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants/${encodeURIComponent(keep.id)}`, {
        method: 'PATCH',
        body: { permission: desired },
        id,
        fallbackCode: 'AGENT_GRANT_UPDATE_FAILED',
      });
    }
    for (const duplicate of duplicates) await revokeGrant(env, fetcher, managerToken, spaceId, duplicate.id, id);
  }
}

function agentDto(agent, grants, credentials) {
  const activeWholeSpaceGrants = grants.filter((grant) => activeGrant(grant)
    && grant.resourceType === 'space'
    && grant.resourceId === null
    && ['read', 'write', 'manage'].includes(grant.permission));
  const activeCredentials = credentials.filter((credential) => credential.active);
  const candidate = activeCredentials[0] ?? null;
  return {
    id: agent.id,
    displayName: agent.displayName,
    status: agent.status,
    credentialAccess: credentialAccessForScopes(candidate?.scopes ?? []),
    permissions: Object.fromEntries([...new Set([...LEGACY_MODEL_KEYS, ...grants.filter((grant) => grant.resourceType === 'model' && typeof grant.resourceId === 'string').map((grant) => grant.resourceId)])].map((modelKey) => [modelKey, modelPermission(grants, modelKey, false)])),
    effectivePermissions: Object.fromEntries([...new Set([...LEGACY_MODEL_KEYS, ...grants.filter((grant) => grant.resourceType === 'model' && typeof grant.resourceId === 'string').map((grant) => grant.resourceId)])].map((modelKey) => [modelKey, modelPermission(grants, modelKey, true)])),
    hasWholeSpaceGrant: activeWholeSpaceGrants.length > 0,
    rotationPending: activeCredentials.length > 1,
    rotationCandidateId: activeCredentials.length > 1 ? candidate.id : null,
    credentials,
  };
}

async function readBoundAgent(env, fetcher, managerToken, spaceId, binding, id) {
  if (!binding.agentId) return null;
  const [agent, grants, credentials] = await Promise.all([
    resolveAgent(env, fetcher, binding.agentId, id),
    listSpaceGrants(env, fetcher, managerToken, spaceId, id),
    listAgentCredentials(env, fetcher, binding.agentId, id),
  ]);
  return agentDto(agent, grantsForAgent(grants, binding.agentId), credentials);
}

async function compensateFailedAgentCreation(env, fetcher, managerToken, spaceId, principal, agentId, originalDescription, id) {
  const warnings = [];
  try {
    const grants = grantsForAgent(await listSpaceGrants(env, fetcher, managerToken, spaceId, id), agentId).filter(activeGrant);
    for (const grant of grants) {
      try { await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id); }
      catch { warnings.push(`grant:${grant.id}`); }
    }
  } catch {
    warnings.push('grants:list');
  }

  try {
    const credentials = await listAgentCredentials(env, fetcher, agentId, id);
    for (const credential of credentials.filter((item) => item.active)) {
      try { await revokeAgentCredential(env, fetcher, agentId, credential.id, id); }
      catch { warnings.push(`credential:${credential.id}`); }
    }
  } catch {
    warnings.push('credentials:list');
  }

  try {
    const refreshed = (await listServicePrincipals(env, fetcher, id)).find((item) => item.id === principal.id);
    if (refreshed) {
      const refreshedBinding = decodeIntegrationBinding(refreshed.description);
      if (refreshedBinding.agentId === agentId) {
        await patchServiceBinding(env, fetcher, refreshed, spaceId, originalDescription, null, id);
      }
    }
  } catch {
    warnings.push('binding:restore');
  }

  if (warnings.length) {
    console.error('[HomeMew web agent integration] creation compensation incomplete', agentId, warnings.join(','));
  }
  return warnings;
}

async function handleGet(request, env, fetcher, assertion, id, principalId) {
  const url = new URL(request.url);
  const spaceId = parseSpaceId(url.searchParams.get('spaceId'));
  const { managerToken } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  return json({ data: await readBoundAgent(env, fetcher, managerToken, spaceId, binding, id) }, 200, id);
}

async function handleCreate(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const credentialAccess = parseCredentialAccess(body.credentialAccess);
  const permissions = parsePermissions(body.permissions);
  assertPermissionsWithinCredentialAccess(permissions, credentialAccess);
  const { managerToken } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { principal, binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  if (principal.status !== 'active') throw new AgentIntegrationError(409, 'INTEGRATION_DISABLED', '已禁用的外部系统不能创建 Agent 接入');
  if (binding.agentId) throw new AgentIntegrationError(409, 'AGENT_ALREADY_CONFIGURED', '这个外部系统已经配置了 Agent 接入');

  const agent = await createAgentWithReconciliation(env, fetcher, `${principal.displayName} Agent`, id);
  if (!agent?.id || !/^agt_[A-Za-z0-9_-]+$/u.test(agent.id)) {
    throw new AgentIntegrationError(502, 'AGENT_CREATE_FAILED', 'LifeSpace 未返回有效 Agent');
  }

  try {
    const grants = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
    await reconcileAgentModelGrants(env, fetcher, managerToken, spaceId, agent.id, grants, permissions, id);
    const credential = await createAgentCredentialWithReconciliation(env, fetcher, agent.id, principal.displayName, credentialAccess, id, []);
    await patchServiceBinding(env, fetcher, principal, spaceId, binding.description, agent.id, id);
    const refreshedGrants = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
    const refreshedCredentials = await listAgentCredentials(env, fetcher, agent.id, id);
    return json({
      data: {
        agent: agentDto(agent, grantsForAgent(refreshedGrants, agent.id), refreshedCredentials),
        credential,
      },
    }, 201, id);
  } catch (error) {
    await compensateFailedAgentCreation(env, fetcher, managerToken, spaceId, principal, agent.id, binding.description, id);
    throw error;
  }
}

async function handleUpdate(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const permissions = parsePermissions(body.permissions);
  const { managerToken, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  if (!binding.agentId) throw new AgentIntegrationError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent 接入');

  const credentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  const activeCredentials = credentials.filter((credential) => credential.active);
  if (activeCredentials.length > 1) {
    throw new AgentIntegrationError(409, 'AGENT_CREDENTIAL_ROTATION_PENDING', 'Agent 凭据正在轮换，请先完成或取消轮换');
  }
  const access = credentialAccessForScopes(activeCredentials[0]?.scopes ?? []);
  if (!access) throw new AgentIntegrationError(409, 'AGENT_CREDENTIAL_REQUIRED', 'Agent 当前没有有效 API Token，请先重新签发');
  assertPermissionsWithinCredentialAccess(permissions, access);

  const agentGrants = grantsForAgent(grants, binding.agentId);
  if (agentGrants.some((grant) => activeGrant(grant) && grant.resourceType === 'space' && grant.resourceId === null)) {
    throw new AgentIntegrationError(409, 'AGENT_WHOLE_SPACE_GRANT_REQUIRES_REVIEW', '这个 Agent 仍有 Space 级宽泛授权，请在 LifeSpace Console 中先收敛后再修改当前家庭模型权限');
  }
  await reconcileAgentModelGrants(env, fetcher, managerToken, spaceId, binding.agentId, grants, permissions, id);
  const agent = await resolveAgent(env, fetcher, binding.agentId, id);
  const refreshed = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
  return json({ data: agentDto(agent, grantsForAgent(refreshed, binding.agentId), credentials) }, 200, id);
}

async function handleStartCredentialRotation(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const access = parseCredentialAccess(body.credentialAccess);
  const { managerToken, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { principal, binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  if (!binding.agentId) throw new AgentIntegrationError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent 接入');

  const credentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  const activeCredentials = credentials.filter((credential) => credential.active);
  if (activeCredentials.length > 1) throw new AgentIntegrationError(409, 'AGENT_CREDENTIAL_ROTATION_PENDING', '已有一次 Agent 凭据轮换尚未完成');
  const directPermissions = Object.fromEntries([...new Set([...LEGACY_MODEL_KEYS, ...grants.filter((grant) => grant.resourceType === 'model' && typeof grant.resourceId === 'string').map((grant) => grant.resourceId)])].map((modelKey) => [modelKey, modelPermission(grantsForAgent(grants, binding.agentId), modelKey, true)]));
  assertPermissionsWithinCredentialAccess(directPermissions, access);

  const credential = await createAgentCredentialWithReconciliation(
    env,
    fetcher,
    binding.agentId,
    principal.displayName,
    access,
    id,
    activeCredentials,
  );
  const agent = await resolveAgent(env, fetcher, binding.agentId, id);
  const refreshedCredentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  return json({ data: { agent: agentDto(agent, grantsForAgent(grants, binding.agentId), refreshedCredentials), credential } }, 201, id);
}

async function handleCompleteCredentialRotation(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const keepCredentialId = parseAgentCredentialId(body.keepCredentialId);
  const { managerToken, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  if (!binding.agentId) throw new AgentIntegrationError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent 接入');

  const credentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  const activeCredentials = credentials.filter((credential) => credential.active);
  const keep = activeCredentials.find((credential) => credential.id === keepCredentialId);
  if (!keep) throw new AgentIntegrationError(404, 'AGENT_CREDENTIAL_NOT_FOUND', '要保留的新 Agent 凭据不存在或已失效');
  for (const credential of activeCredentials) {
    if (credential.id !== keepCredentialId) await revokeAgentCredential(env, fetcher, binding.agentId, credential.id, id);
  }
  const agent = await resolveAgent(env, fetcher, binding.agentId, id);
  const refreshedCredentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  return json({ data: agentDto(agent, grantsForAgent(grants, binding.agentId), refreshedCredentials) }, 200, id);
}

async function handleCancelCredentialRotation(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const candidateCredentialId = parseAgentCredentialId(body.candidateCredentialId);
  const { managerToken, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  if (!binding.agentId) throw new AgentIntegrationError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent 接入');

  const credentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  const activeCredentials = credentials.filter((credential) => credential.active);
  if (activeCredentials.length < 2) throw new AgentIntegrationError(409, 'NO_AGENT_CREDENTIAL_ROTATION_PENDING', '当前没有待完成的 Agent 凭据轮换');
  if (activeCredentials[0].id !== candidateCredentialId) {
    throw new AgentIntegrationError(409, 'INVALID_AGENT_ROTATION_CANDIDATE', '只能撤销本次轮换中新创建的 Agent 凭据');
  }
  await revokeAgentCredential(env, fetcher, binding.agentId, candidateCredentialId, id);
  const agent = await resolveAgent(env, fetcher, binding.agentId, id);
  const refreshedCredentials = await listAgentCredentials(env, fetcher, binding.agentId, id);
  return json({ data: agentDto(agent, grantsForAgent(grants, binding.agentId), refreshedCredentials) }, 200, id);
}

export async function cleanupIntegrationAgent(env, fetcher, managerToken, spaceId, agentId, id) {
  const warnings = [];
  try {
    const grants = grantsForAgent(await listSpaceGrants(env, fetcher, managerToken, spaceId, id), agentId).filter(activeGrant);
    for (const grant of grants) {
      try { await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id); }
      catch { warnings.push(`agent-grant:${grant.id}`); }
    }
  } catch {
    warnings.push('agent-grants:list');
  }
  try {
    const credentials = await listAgentCredentials(env, fetcher, agentId, id);
    for (const credential of credentials.filter((item) => item.active)) {
      try { await revokeAgentCredential(env, fetcher, agentId, credential.id, id); }
      catch { warnings.push(`agent-credential:${credential.id}`); }
    }
  } catch {
    warnings.push('agent-credentials:list');
  }
  return warnings;
}

async function handleRemove(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { managerToken } = await managementContext(env, fetcher, assertion, spaceId, id);
  const { principal, binding } = await resolveBoundService(env, fetcher, spaceId, principalId, id);
  if (!binding.agentId) throw new AgentIntegrationError(404, 'AGENT_NOT_CONFIGURED', '这个外部系统还没有配置 Agent 接入');

  const warnings = await cleanupIntegrationAgent(env, fetcher, managerToken, spaceId, binding.agentId, id);
  if (warnings.length) {
    throw new AgentIntegrationError(502, 'AGENT_REMOVE_INCOMPLETE', 'Agent 凭据或当前家庭授权未能全部撤销，已保留绑定以便继续清理');
  }
  await patchServiceBinding(env, fetcher, principal, spaceId, binding.description, null, id);
  return json({ data: { removed: true } }, 200, id);
}

export async function handleIntegrationAgentRequest(request, env, { fetcher = fetch, assertion, id, principalId }) {
  try {
    const servicePrincipalId = parseServicePrincipalId(principalId);
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'integrations' || parts[2] !== servicePrincipalId || parts[3] !== 'agent') {
      throw new AgentIntegrationError(404, 'NOT_FOUND', 'Not found');
    }
    if (parts.length === 4 && request.method === 'GET') return await handleGet(request, env, fetcher, assertion, id, servicePrincipalId);
    if (parts.length === 4 && request.method === 'POST') return await handleCreate(request, env, fetcher, assertion, id, servicePrincipalId);
    if (parts.length === 4 && request.method === 'PATCH') return await handleUpdate(request, env, fetcher, assertion, id, servicePrincipalId);
    if (parts.length === 5 && parts[4] === 'credential-rotation' && request.method === 'POST') {
      return await handleStartCredentialRotation(request, env, fetcher, assertion, id, servicePrincipalId);
    }
    if (parts.length === 6 && parts[4] === 'credential-rotation' && parts[5] === 'complete' && request.method === 'POST') {
      return await handleCompleteCredentialRotation(request, env, fetcher, assertion, id, servicePrincipalId);
    }
    if (parts.length === 6 && parts[4] === 'credential-rotation' && parts[5] === 'cancel' && request.method === 'POST') {
      return await handleCancelCredentialRotation(request, env, fetcher, assertion, id, servicePrincipalId);
    }
    if (parts.length === 5 && parts[4] === 'remove' && request.method === 'POST') {
      return await handleRemove(request, env, fetcher, assertion, id, servicePrincipalId);
    }
    throw new AgentIntegrationError(404, 'NOT_FOUND', 'Not found');
  } catch (error) {
    return errorJson(error, id);
  }
}
