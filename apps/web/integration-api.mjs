const MANAGER_SCOPES = ['profile:read', 'grants:manage'];
const MODEL_KEYS = ['event', 'task', 'day_record'];
const PERMISSION_RANK = { read: 1, write: 2, manage: 3 };
const BINDING_PREFIX = 'homemew:v1:space=';
const MAX_USER_DESCRIPTION_LENGTH = 400;

class IntegrationError extends Error {
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
  if (error instanceof IntegrationError) {
    return json({ error: { code: error.code, message: error.message, requestId: id } }, error.status, id);
  }
  console.error('[HomeMew web integrations] unhandled error', error instanceof Error ? error.message : 'unknown');
  return json({ error: { code: 'INTERNAL_ERROR', message: '外部系统服务暂时不可用', requestId: id } }, 500, id);
}

function requiredString(value, name, status = 500, code = 'WEB_NOT_CONFIGURED') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IntegrationError(status, code, `${name} is not configured`);
  }
  return value.trim();
}

function baseUrl(value, name) {
  return requiredString(value, name).replace(/\/+$/u, '');
}

function webApplicationCredential(env) {
  const value = requiredString(env.LIFESPACE_APPLICATION_CREDENTIAL, 'LIFESPACE_APPLICATION_CREDENTIAL');
  if (!value.startsWith('lsa_')) throw new IntegrationError(500, 'WEB_NOT_CONFIGURED', 'LIFESPACE_APPLICATION_CREDENTIAL is invalid');
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
    throw new IntegrationError(503, 'INTEGRATIONS_NOT_CONFIGURED', 'LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL is invalid');
  }
  return value;
}

export function integrationsReady(env) {
  return typeof env.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL === 'string'
    && env.LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL.startsWith('lsa_');
}

function requireSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    throw new IntegrationError(403, 'INVALID_ORIGIN', 'Cross-origin state-changing requests are not allowed');
  }
}

async function readJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new IntegrationError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  }
  return body;
}

function isSpaceId(value) {
  return typeof value === 'string' && /^spc_[A-Za-z0-9_-]+$/u.test(value);
}

function parseSpaceId(value) {
  if (!isSpaceId(value)) throw new IntegrationError(422, 'VALIDATION_ERROR', 'spaceId is invalid');
  return value;
}

function parsePrincipalId(value) {
  if (typeof value !== 'string' || !/^svc_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new IntegrationError(404, 'NOT_FOUND', 'External system not found');
  }
  return value;
}

function parseTokenId(value) {
  if (typeof value !== 'string' || !/^sat_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new IntegrationError(404, 'NOT_FOUND', 'API Token not found');
  }
  return value;
}

function parseName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 100) throw new IntegrationError(422, 'VALIDATION_ERROR', '名称需要 1-100 个字符');
  return name;
}

function parseDescription(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new IntegrationError(422, 'VALIDATION_ERROR', '说明格式无效');
  const description = value.trim();
  if (description.length > MAX_USER_DESCRIPTION_LENGTH) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', `说明不能超过 ${MAX_USER_DESCRIPTION_LENGTH} 个字符`);
  }
  if (description.startsWith(BINDING_PREFIX)) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', '说明使用了 HomeMew 保留前缀');
  }
  return description || null;
}

function encodeBoundDescription(spaceId, description) {
  return `${BINDING_PREFIX}${spaceId}\n${description ?? ''}`;
}

function decodeBoundDescription(value) {
  if (typeof value !== 'string' || !value.startsWith(BINDING_PREFIX)) {
    return { spaceId: null, description: typeof value === 'string' && value.trim() ? value.trim() : null };
  }
  const newline = value.indexOf('\n');
  const marker = newline < 0 ? value : value.slice(0, newline);
  const spaceId = marker.slice(BINDING_PREFIX.length);
  if (!isSpaceId(spaceId)) return { spaceId: null, description: value.trim() || null };
  const description = newline < 0 ? '' : value.slice(newline + 1).trim();
  return { spaceId, description: description || null };
}

function parseLabel(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'Token 名称需要 1-100 个字符');
  }
  return value.trim();
}

function parsePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'permissions is required');
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !MODEL_KEYS.includes(key))) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'permissions contains an unsupported model');
  }
  const result = {};
  for (const modelKey of MODEL_KEYS) {
    const permission = value[modelKey];
    if (permission === undefined || permission === null || permission === 'none') {
      result[modelKey] = null;
      continue;
    }
    if (!['read', 'write'].includes(permission)) {
      throw new IntegrationError(422, 'VALIDATION_ERROR', `${modelKey} permission must be read, write or none`);
    }
    result[modelKey] = permission;
  }
  if (!Object.values(result).some(Boolean)) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', '至少需要选择一个模型权限');
  }
  return result;
}

function scopesForPermissions(permissions) {
  const values = Object.values(permissions).filter(Boolean);
  const scopes = values.length ? ['resources:read'] : [];
  if (values.includes('write')) scopes.push('resources:write');
  return scopes;
}

function activeGrant(grant) {
  if (grant.revokedAt) return false;
  return !grant.expiresAt || Date.parse(grant.expiresAt) > Date.now();
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

function integrationDto(principal, grants, tokens, bindingStatus = 'bound') {
  const decoded = decodeBoundDescription(principal.description);
  const activeWholeSpaceGrants = grants.filter((grant) => activeGrant(grant)
    && grant.resourceType === 'space'
    && grant.resourceId === null
    && ['read', 'write', 'manage'].includes(grant.permission));
  return {
    id: principal.id,
    displayName: principal.displayName,
    description: decoded.description,
    status: principal.status,
    bindingStatus,
    maxScopes: principal.maxScopes ?? [],
    createdByUserId: principal.createdByUserId ?? null,
    createdAt: principal.createdAt,
    updatedAt: principal.updatedAt,
    permissions: Object.fromEntries(MODEL_KEYS.map((modelKey) => [modelKey, modelPermission(grants, modelKey, false)])),
    effectivePermissions: Object.fromEntries(MODEL_KEYS.map((modelKey) => [modelKey, modelPermission(grants, modelKey, true)])),
    hasWholeSpaceGrant: activeWholeSpaceGrants.length > 0,
    tokens: bindingStatus === 'bound' && Array.isArray(tokens) ? tokens : [],
  };
}

function upstreamError(response, payload, fallbackCode) {
  const upstream = payload?.error;
  if (response.status >= 400 && response.status < 500 && upstream && typeof upstream.code === 'string') {
    return new IntegrationError(response.status, upstream.code, typeof upstream.message === 'string' ? upstream.message : 'LifeSpace rejected the request');
  }
  return new IntegrationError(502, fallbackCode, 'LifeSpace 服务暂时不可用');
}

async function requestJson(fetcher, url, { method = 'GET', credential, body, id, fallbackCode }) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${credential}`,
    'x-request-id': id,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetcher(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw upstreamError(response, payload, fallbackCode);
  return payload?.data;
}

function identityUrl(env, path) {
  return `${baseUrl(env.LIFESPACE_IDENTITY_URL, 'LIFESPACE_IDENTITY_URL')}${path}`;
}

function coreUrl(env, path) {
  return `${baseUrl(env.LIFESPACE_CORE_URL, 'LIFESPACE_CORE_URL')}${path}`;
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
    throw new IntegrationError(502, 'INTEGRATION_MANAGER_EXCHANGE_FAILED', 'LifeSpace 未返回有效的管理会话');
  }
  const profile = await requestJson(fetcher, identityUrl(env, '/api/v1/me'), {
    credential: exchange.accessToken,
    id,
    fallbackCode: 'INTEGRATION_MANAGER_PROFILE_FAILED',
  });
  if (!profile || typeof profile.id !== 'string') {
    throw new IntegrationError(502, 'INTEGRATION_MANAGER_PROFILE_FAILED', 'LifeSpace 未返回当前用户');
  }
  return { accessToken: exchange.accessToken, userId: profile.id };
}

async function listSpaceGrants(env, fetcher, managerToken, spaceId, id) {
  const grants = await requestJson(fetcher, coreUrl(env, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants?includeRevoked=true`), {
    credential: managerToken,
    id,
    fallbackCode: 'INTEGRATION_GRANTS_FAILED',
  });
  if (!Array.isArray(grants)) throw new IntegrationError(502, 'INTEGRATION_GRANTS_FAILED', 'LifeSpace 未返回有效授权列表');
  return grants;
}

async function identityIntegrationRequest(env, fetcher, path, { method = 'GET', body, id, fallbackCode }) {
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

async function managementContext(env, fetcher, assertion, spaceId, id) {
  integrationsApplicationCredential(env);
  const manager = await exchangeManager(env, fetcher, assertion, id);
  const grants = await listSpaceGrants(env, fetcher, manager.accessToken, spaceId, id);
  return { manager, grants };
}

function associatedPrincipalIds(grants) {
  return new Set(grants.filter((grant) => grant.granteeType === 'service').map((grant) => grant.granteeId));
}

function grantsForPrincipal(grants, principalId) {
  return grants.filter((grant) => grant.granteeType === 'service' && grant.granteeId === principalId);
}

async function listPrincipals(env, fetcher, id) {
  const principals = await identityIntegrationRequest(env, fetcher, '/api/v1/service-principals', {
    id,
    fallbackCode: 'INTEGRATION_PRINCIPALS_FAILED',
  });
  if (!Array.isArray(principals)) throw new IntegrationError(502, 'INTEGRATION_PRINCIPALS_FAILED', 'LifeSpace 未返回有效外部系统列表');
  return principals;
}

async function listTokens(env, fetcher, principalId, id) {
  const tokens = await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}/tokens`, {
    id,
    fallbackCode: 'INTEGRATION_TOKENS_FAILED',
  });
  return Array.isArray(tokens) ? tokens : [];
}

async function resolveBoundIntegration(env, fetcher, spaceId, principalId, id) {
  const principals = await listPrincipals(env, fetcher, id);
  const principal = principals.find((item) => item.id === principalId);
  if (!principal) throw new IntegrationError(404, 'INTEGRATION_NOT_FOUND', '当前家庭没有这个外部系统');
  const binding = decodeBoundDescription(principal.description);
  if (!binding.spaceId) {
    throw new IntegrationError(409, 'INTEGRATION_BINDING_REQUIRED', '这个迁移外部系统尚未建立 HomeMew 家庭管理归属，当前仅可查看');
  }
  if (binding.spaceId !== spaceId) throw new IntegrationError(404, 'INTEGRATION_NOT_FOUND', '当前家庭没有这个外部系统');
  return principal;
}

async function createGrant(env, fetcher, managerToken, spaceId, principalId, modelKey, permission, id) {
  return coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants`, {
    method: 'POST',
    body: {
      granteeType: 'service',
      granteeId: principalId,
      resourceType: 'model',
      resourceId: modelKey,
      permission,
      expiresAt: null,
    },
    id,
    fallbackCode: 'INTEGRATION_GRANT_CREATE_FAILED',
  });
}

async function revokeGrant(env, fetcher, managerToken, spaceId, grantId, id) {
  return coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants/${encodeURIComponent(grantId)}`, {
    method: 'DELETE',
    id,
    fallbackCode: 'INTEGRATION_GRANT_REVOKE_FAILED',
  });
}

async function reconcileModelGrants(env, fetcher, managerToken, spaceId, principalId, allGrants, permissions, id) {
  const principalGrants = grantsForPrincipal(allGrants, principalId);
  for (const modelKey of MODEL_KEYS) {
    const desired = permissions[modelKey];
    const active = principalGrants.filter((grant) => activeGrant(grant) && grant.resourceType === 'model' && grant.resourceId === modelKey);
    if (!desired) {
      for (const grant of active) await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id);
      continue;
    }
    if (!active.length) {
      await createGrant(env, fetcher, managerToken, spaceId, principalId, modelKey, desired, id);
      continue;
    }
    const [keep, ...duplicates] = active;
    if (keep.permission !== desired) {
      await coreManagerRequest(env, fetcher, managerToken, `/api/v1/spaces/${encodeURIComponent(spaceId)}/grants/${encodeURIComponent(keep.id)}`, {
        method: 'PATCH',
        body: { permission: desired },
        id,
        fallbackCode: 'INTEGRATION_GRANT_UPDATE_FAILED',
      });
    }
    for (const grant of duplicates) await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id);
  }
}

async function readIntegration(env, fetcher, managerToken, spaceId, principalId, id) {
  const grants = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  const tokens = await listTokens(env, fetcher, principalId, id);
  return integrationDto(principal, grantsForPrincipal(grants, principalId), tokens, 'bound');
}

async function handleList(request, env, fetcher, assertion, id) {
  const url = new URL(request.url);
  const spaceId = parseSpaceId(url.searchParams.get('spaceId'));
  const { grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const associated = associatedPrincipalIds(grants);
  const principals = await listPrincipals(env, fetcher, id);
  const integrations = [];

  for (const principal of principals) {
    const binding = decodeBoundDescription(principal.description);
    if (binding.spaceId === spaceId) {
      integrations.push(integrationDto(
        principal,
        grantsForPrincipal(grants, principal.id),
        await listTokens(env, fetcher, principal.id, id),
        'bound',
      ));
      continue;
    }
    if (!binding.spaceId && associated.has(principal.id)) {
      integrations.push(integrationDto(principal, grantsForPrincipal(grants, principal.id), [], 'legacy_unbound'));
    }
  }

  integrations.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  return json({ data: integrations }, 200, id);
}

async function handleCreate(request, env, fetcher, assertion, id) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const displayName = parseName(body.displayName);
  const description = parseDescription(body.description);
  const permissions = parsePermissions(body.permissions);
  const scopes = scopesForPermissions(permissions);
  const { manager } = await managementContext(env, fetcher, assertion, spaceId, id);

  const principal = await identityIntegrationRequest(env, fetcher, '/api/v1/service-principals', {
    method: 'POST',
    body: {
      displayName,
      description: encodeBoundDescription(spaceId, description),
      maxScopes: scopes,
      createdByUserId: manager.userId,
    },
    id,
    fallbackCode: 'INTEGRATION_CREATE_FAILED',
  });
  if (!principal?.id) throw new IntegrationError(502, 'INTEGRATION_CREATE_FAILED', 'LifeSpace 未返回新外部系统');

  const createdGrants = [];
  try {
    for (const modelKey of MODEL_KEYS) {
      if (!permissions[modelKey]) continue;
      const grant = await createGrant(env, fetcher, manager.accessToken, spaceId, principal.id, modelKey, permissions[modelKey], id);
      if (grant?.id) createdGrants.push(grant.id);
    }
  } catch (error) {
    for (const grantId of createdGrants) {
      await revokeGrant(env, fetcher, manager.accessToken, spaceId, grantId, id).catch(() => undefined);
    }
    await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}`, {
      method: 'PATCH',
      body: { status: 'disabled' },
      id,
      fallbackCode: 'INTEGRATION_COMPENSATION_FAILED',
    }).catch(() => undefined);
    throw error;
  }

  const tokenLabel = parseLabel(body.tokenLabel, `${displayName} API Token`);
  const token = await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}/tokens`, {
    method: 'POST',
    body: { label: tokenLabel, scopes, expiresAt: null, createdByUserId: manager.userId },
    id,
    fallbackCode: 'INTEGRATION_TOKEN_CREATE_FAILED',
  });
  const integration = await readIntegration(env, fetcher, manager.accessToken, spaceId, principal.id, id);
  return json({ data: { integration, token: token?.token ?? null } }, 201, id);
}

async function handleUpdate(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { manager, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  if (principal.status !== 'active') throw new IntegrationError(409, 'INTEGRATION_DISABLED', '已禁用的外部系统不能继续编辑');

  const principalGrants = grantsForPrincipal(grants, principalId);
  const hasWholeSpaceGrant = principalGrants.some((grant) => activeGrant(grant)
    && grant.resourceType === 'space'
    && grant.resourceId === null
    && ['read', 'write', 'manage'].includes(grant.permission));
  if (body.permissions !== undefined && hasWholeSpaceGrant) {
    throw new IntegrationError(409, 'WHOLE_SPACE_GRANT_REQUIRES_REVIEW', '这个外部系统仍有旧的 Space 级宽泛授权，请先人工确认后再改为模型级权限');
  }

  const patch = {};
  if (body.displayName !== undefined) patch.displayName = parseName(body.displayName);
  if (body.description !== undefined) patch.description = encodeBoundDescription(spaceId, parseDescription(body.description));
  let permissions = null;
  if (body.permissions !== undefined) {
    permissions = parsePermissions(body.permissions);
    patch.maxScopes = scopesForPermissions(permissions);
  }
  if (!Object.keys(patch).length && !permissions) throw new IntegrationError(400, 'INVALID_REQUEST', '没有需要更新的内容');

  if (Object.keys(patch).length) {
    await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}`, {
      method: 'PATCH',
      body: patch,
      id,
      fallbackCode: 'INTEGRATION_UPDATE_FAILED',
    });
  }
  if (permissions) {
    await reconcileModelGrants(env, fetcher, manager.accessToken, spaceId, principalId, grants, permissions, id);
  }
  return json({ data: await readIntegration(env, fetcher, manager.accessToken, spaceId, principalId, id) }, 200, id);
}

async function handleCreateToken(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { manager } = await managementContext(env, fetcher, assertion, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  if (principal.status !== 'active') throw new IntegrationError(409, 'INTEGRATION_DISABLED', '已禁用的外部系统不能签发 Token');
  const scopes = Array.isArray(principal.maxScopes) ? principal.maxScopes : [];
  if (!scopes.length) throw new IntegrationError(409, 'INTEGRATION_HAS_NO_SCOPES', '外部系统当前没有可签发的权限');
  const label = parseLabel(body.label, `${principal.displayName} API Token`);
  const token = await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}/tokens`, {
    method: 'POST',
    body: { label, scopes, expiresAt: null, createdByUserId: manager.userId },
    id,
    fallbackCode: 'INTEGRATION_TOKEN_CREATE_FAILED',
  });
  return json({ data: { token: token?.token ?? null, metadata: token ?? null } }, 201, id);
}

async function handleRevokeToken(request, env, fetcher, assertion, id, principalId, tokenId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  await managementContext(env, fetcher, assertion, spaceId, id);
  await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    id,
    fallbackCode: 'INTEGRATION_TOKEN_REVOKE_FAILED',
  });
  return new Response(null, { status: 204, headers: { 'x-request-id': id } });
}

async function handleDisable(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { manager, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);

  await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}`, {
    method: 'PATCH',
    body: { status: 'disabled' },
    id,
    fallbackCode: 'INTEGRATION_DISABLE_FAILED',
  });

  const cleanupWarnings = [];
  for (const grant of grantsForPrincipal(grants, principalId).filter(activeGrant)) {
    try {
      await revokeGrant(env, fetcher, manager.accessToken, spaceId, grant.id, id);
    } catch {
      cleanupWarnings.push(`grant:${grant.id}`);
    }
  }
  const tokens = await listTokens(env, fetcher, principalId, id).catch(() => []);
  for (const token of tokens.filter((item) => !item.revokedAt)) {
    try {
      await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}/tokens/${encodeURIComponent(token.id)}`, {
        method: 'DELETE',
        id,
        fallbackCode: 'INTEGRATION_TOKEN_REVOKE_FAILED',
      });
    } catch {
      cleanupWarnings.push(`token:${token.id}`);
    }
  }
  return json({ data: { disabled: true, cleanupWarnings } }, 200, id);
}

export async function handleIntegrationRequest(request, env, { fetcher = fetch, assertion, id }) {
  try {
    const url = new URL(request.url);
    if (url.pathname === '/api/integrations') {
      if (request.method === 'GET') return await handleList(request, env, fetcher, assertion, id);
      if (request.method === 'POST') return await handleCreate(request, env, fetcher, assertion, id);
      throw new IntegrationError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'integrations' || !parts[2]) {
      throw new IntegrationError(404, 'NOT_FOUND', 'Not found');
    }
    const principalId = parsePrincipalId(decodeURIComponent(parts[2]));

    if (parts.length === 3 && request.method === 'PATCH') {
      return await handleUpdate(request, env, fetcher, assertion, id, principalId);
    }
    if (parts.length === 4 && parts[3] === 'tokens' && request.method === 'POST') {
      return await handleCreateToken(request, env, fetcher, assertion, id, principalId);
    }
    if (parts.length === 5 && parts[3] === 'tokens' && request.method === 'DELETE') {
      return await handleRevokeToken(request, env, fetcher, assertion, id, principalId, parseTokenId(decodeURIComponent(parts[4])));
    }
    if (parts.length === 4 && parts[3] === 'disable' && request.method === 'POST') {
      return await handleDisable(request, env, fetcher, assertion, id, principalId);
    }
    throw new IntegrationError(404, 'NOT_FOUND', 'Not found');
  } catch (error) {
    return errorJson(error, id);
  }
}
