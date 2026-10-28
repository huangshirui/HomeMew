import { cleanupIntegrationAgent, handleIntegrationAgentRequest } from './agent-integration-api.mjs';
import {
  decodeIntegrationBinding,
  encodeDiscardedIntegrationBinding,
  encodeIntegrationBinding,
  isDiscardedIntegrationDescription,
  isReservedIntegrationDescription,
} from './integration-binding.mjs';

const MANAGER_SCOPES = ['profile:read', 'grants:manage'];
const LEGACY_MODEL_KEYS = ['event', 'task', 'day_record'];
const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u;
const PERMISSION_RANK = { read: 1, write: 2, manage: 3 };
const MAX_USER_DESCRIPTION_LENGTH = 400;
const CREDENTIAL_MODES = ['api_token', 'oauth_client_credentials'];

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

function parseCredentialId(value) {
  if (typeof value !== 'string' || !/^(sat|soc)_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new IntegrationError(404, 'NOT_FOUND', 'Credential not found');
  }
  return value;
}

function parseCredentialMode(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'credentialMode is required');
  }
  if (!CREDENTIAL_MODES.includes(value)) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'credentialMode must be api_token or oauth_client_credentials');
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
  if (isReservedIntegrationDescription(description)) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', '说明使用了 HomeMew 保留前缀');
  }
  return description || null;
}

function parsePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'permissions is required');
  }
  const keys = Object.keys(value);
  if (keys.length > 200 || keys.some((key) => !MODEL_KEY_PATTERN.test(key))) {
    throw new IntegrationError(422, 'VALIDATION_ERROR', 'permissions contains an invalid model key');
  }
  // The published model and Space authority are verified by LifeSpace when each Grant is changed.
  const result = Object.create(null);
  for (const modelKey of keys) {
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

function tokenCredentialDto(token) {
  return {
    id: token.id,
    type: 'api_token',
    label: token.label,
    displayPrefix: token.displayPrefix,
    suffix: token.lastFour,
    scopes: token.scopes ?? [],
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt ?? null,
    revokedAt: token.revokedAt ?? null,
    active: !token.revokedAt,
  };
}

function oauthCredentialDto(credential, principalId) {
  return {
    id: credential.id,
    type: 'oauth_client_credentials',
    label: credential.label,
    clientId: principalId,
    suffix: credential.secretSuffix,
    scopes: [],
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt ?? null,
    revokedAt: credential.revokedAt ?? null,
    active: credential.status === 'active' && !credential.revokedAt,
  };
}

function sortCredentials(credentials) {
  return [...credentials].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function integrationDto(principal, grants, credentials, bindingStatus = 'bound') {
  const decoded = decodeIntegrationBinding(principal.description);
  const activeWholeSpaceGrants = grants.filter((grant) => activeGrant(grant)
    && grant.resourceType === 'space'
    && grant.resourceId === null
    && ['read', 'write', 'manage'].includes(grant.permission));
  const visibleCredentials = bindingStatus === 'bound' ? sortCredentials(credentials) : [];
  const activeCredentials = visibleCredentials.filter((credential) => credential.active);
  const candidate = activeCredentials[0] ?? null;
  const modelKeys = new Set([...LEGACY_MODEL_KEYS, ...grants
    .filter((grant) => grant.resourceType === 'model' && typeof grant.resourceId === 'string')
    .map((grant) => grant.resourceId)]);
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
    permissions: Object.fromEntries([...modelKeys].map((modelKey) => [modelKey, modelPermission(grants, modelKey, false)])),
    effectivePermissions: Object.fromEntries([...modelKeys].map((modelKey) => [modelKey, modelPermission(grants, modelKey, true)])),
    hasWholeSpaceGrant: activeWholeSpaceGrants.length > 0,
    credentialMode: candidate?.type ?? null,
    rotationPending: activeCredentials.length > 1,
    rotationCandidateId: activeCredentials.length > 1 ? candidate.id : null,
    credentials: visibleCredentials,
  };
}

function upstreamError(response, payload, fallbackCode) {
  const upstream = payload?.error;
  if (response.status >= 400 && response.status < 500 && upstream && typeof upstream.code === 'string') {
    return new IntegrationError(response.status, upstream.code, typeof upstream.message === 'string' ? upstream.message : 'LifeSpace rejected the request');
  }
  if (upstream && typeof upstream.code === 'string' && typeof upstream.message === 'string') {
    return new IntegrationError(502, fallbackCode, `${upstream.message} (${upstream.code})`);
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
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error(`[HomeMew web integrations] ${fallbackCode} upstream fetch failed`, error instanceof Error ? error.message : 'unknown');
    throw new IntegrationError(502, fallbackCode, '连接 LifeSpace 失败，请稍后重试');
  }
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

async function listOAuthCredentials(env, fetcher, principalId, id) {
  const credentials = await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principalId)}/oauth-credentials`, {
    id,
    fallbackCode: 'INTEGRATION_OAUTH_CREDENTIALS_FAILED',
  });
  return Array.isArray(credentials) ? credentials : [];
}

async function listCredentials(env, fetcher, principalId, id) {
  const [tokens, oauthCredentials] = await Promise.all([
    listTokens(env, fetcher, principalId, id),
    listOAuthCredentials(env, fetcher, principalId, id),
  ]);
  return sortCredentials([
    ...tokens.map(tokenCredentialDto),
    ...oauthCredentials.map((credential) => oauthCredentialDto(credential, principalId)),
  ]);
}

async function resolveBoundIntegration(env, fetcher, spaceId, principalId, id) {
  const principals = await listPrincipals(env, fetcher, id);
  const principal = principals.find((item) => item.id === principalId);
  if (!principal || isDiscardedIntegrationDescription(principal.description)) {
    throw new IntegrationError(404, 'INTEGRATION_NOT_FOUND', '当前家庭没有这个外部系统');
  }
  const binding = decodeIntegrationBinding(principal.description);
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
  for (const modelKey of Object.keys(permissions)) {
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

async function createServiceCredential(env, fetcher, principal, managerUserId, mode, id) {
  const scopes = Array.isArray(principal.maxScopes) ? principal.maxScopes : [];
  if (!scopes.length) throw new IntegrationError(409, 'INTEGRATION_HAS_NO_SCOPES', '外部系统当前没有可签发的权限');
  if (mode === 'api_token') {
    const token = await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}/tokens`, {
      method: 'POST',
      body: { label: `${principal.displayName} API Token`, scopes, expiresAt: null, createdByUserId: managerUserId },
      id,
      fallbackCode: 'INTEGRATION_TOKEN_CREATE_FAILED',
    });
    return {
      type: 'api_token',
      credentialId: token?.id ?? null,
      token: token?.token ?? null,
    };
  }
  const credential = await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}/oauth-credentials`, {
    method: 'POST',
    body: { label: `${principal.displayName} OAuth Client`, createdByUserId: managerUserId },
    id,
    fallbackCode: 'INTEGRATION_OAUTH_CREATE_FAILED',
  });
  return {
    type: 'oauth_client_credentials',
    credentialId: credential?.id ?? null,
    clientId: credential?.clientId ?? principal.id,
    clientSecret: credential?.clientSecret ?? null,
  };
}

async function revokeServiceCredential(env, fetcher, principalId, credential, id) {
  const path = credential.type === 'api_token'
    ? `/api/v1/service-principals/${encodeURIComponent(principalId)}/tokens/${encodeURIComponent(credential.id)}`
    : `/api/v1/service-principals/${encodeURIComponent(principalId)}/oauth-credentials/${encodeURIComponent(credential.id)}`;
  await identityIntegrationRequest(env, fetcher, path, {
    method: 'DELETE',
    id,
    fallbackCode: credential.type === 'api_token' ? 'INTEGRATION_TOKEN_REVOKE_FAILED' : 'INTEGRATION_OAUTH_REVOKE_FAILED',
  });
}

async function cleanupCredentialsCreatedAfter(env, fetcher, principalId, baselineIds, id) {
  const credentials = await listCredentials(env, fetcher, principalId, id);
  const unexpected = credentials.filter((credential) => credential.active && !baselineIds.has(credential.id));
  for (const credential of unexpected) {
    await revokeServiceCredential(env, fetcher, principalId, credential, id);
  }
}

async function createServiceCredentialWithReconciliation(env, fetcher, principal, managerUserId, mode, id, baselineCredentials = []) {
  const baselineIds = new Set(baselineCredentials.filter((credential) => credential.active).map((credential) => credential.id));
  try {
    return await createServiceCredential(env, fetcher, principal, managerUserId, mode, id);
  } catch (error) {
    if (!(error instanceof IntegrationError) || error.status < 500) throw error;
    try {
      await cleanupCredentialsCreatedAfter(env, fetcher, principal.id, baselineIds, id);
    } catch {
      throw new IntegrationError(
        502,
        'INTEGRATION_CREDENTIAL_RECONCILIATION_FAILED',
        '创建凭据时连接中断，且无法确认 LifeSpace 是否已生成凭据；已停止自动重试，请稍后重试',
      );
    }
  }

  try {
    return await createServiceCredential(env, fetcher, principal, managerUserId, mode, id);
  } catch (error) {
    await cleanupCredentialsCreatedAfter(env, fetcher, principal.id, baselineIds, id).catch(() => undefined);
    throw error;
  }
}

async function compensateFailedCreation(env, fetcher, managerToken, spaceId, principal, knownGrantIds, description, id) {
  const warnings = [];
  try {
    await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}`, {
      method: 'PATCH',
      body: { status: 'disabled' },
      id,
      fallbackCode: 'INTEGRATION_COMPENSATION_FAILED',
    });
  } catch {
    warnings.push('principal:disable');
  }

  let principalGrants = [];
  try {
    principalGrants = grantsForPrincipal(await listSpaceGrants(env, fetcher, managerToken, spaceId, id), principal.id).filter(activeGrant);
  } catch {
    principalGrants = knownGrantIds.map((grantId) => ({ id: grantId }));
    warnings.push('grants:list');
  }
  const grantIds = new Set([...knownGrantIds, ...principalGrants.map((grant) => grant.id)].filter(Boolean));
  for (const grantId of grantIds) {
    try {
      await revokeGrant(env, fetcher, managerToken, spaceId, grantId, id);
    } catch {
      warnings.push(`grant:${grantId}`);
    }
  }

  try {
    const credentials = await listCredentials(env, fetcher, principal.id, id);
    for (const credential of credentials.filter((item) => item.active)) {
      try {
        await revokeServiceCredential(env, fetcher, principal.id, credential, id);
      } catch {
        warnings.push(`credential:${credential.id}`);
      }
    }
  } catch {
    warnings.push('credentials:list');
  }

  if (!warnings.length) {
    try {
      await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}`, {
        method: 'PATCH',
        body: { status: 'disabled', description: encodeDiscardedIntegrationBinding(spaceId, description) },
        id,
        fallbackCode: 'INTEGRATION_COMPENSATION_FAILED',
      });
    } catch {
      warnings.push('principal:discard');
    }
  }

  if (warnings.length) {
    console.error('[HomeMew web integrations] failed creation compensation incomplete', principal.id, warnings.join(','));
  }
  return warnings;
}

async function reconcileDisabledPartialIntegration(env, fetcher, managerToken, spaceId, principal, principalGrants, credentials, id) {
  const activeGrants = principalGrants.filter(activeGrant);
  const activeCredentials = credentials.filter((credential) => credential.active);
  if (principal.status !== 'disabled' || activeCredentials.length || !activeGrants.length) return false;

  for (const grant of activeGrants) {
    await revokeGrant(env, fetcher, managerToken, spaceId, grant.id, id);
  }
  const description = decodeIntegrationBinding(principal.description).description;
  await identityIntegrationRequest(env, fetcher, `/api/v1/service-principals/${encodeURIComponent(principal.id)}`, {
    method: 'PATCH',
    body: { status: 'disabled', description: encodeDiscardedIntegrationBinding(spaceId, description) },
    id,
    fallbackCode: 'INTEGRATION_COMPENSATION_FAILED',
  });
  return true;
}

async function readIntegration(env, fetcher, managerToken, spaceId, principalId, id) {
  const grants = await listSpaceGrants(env, fetcher, managerToken, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  const credentials = await listCredentials(env, fetcher, principalId, id);
  return integrationDto(principal, grantsForPrincipal(grants, principalId), credentials, 'bound');
}

async function handleList(request, env, fetcher, assertion, id) {
  const url = new URL(request.url);
  const spaceId = parseSpaceId(url.searchParams.get('spaceId'));
  const { manager, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const associated = associatedPrincipalIds(grants);
  const principals = await listPrincipals(env, fetcher, id);
  const integrations = [];

  for (const principal of principals) {
    if (isDiscardedIntegrationDescription(principal.description)) continue;
    const binding = decodeIntegrationBinding(principal.description);
    if (binding.spaceId === spaceId) {
      const principalGrants = grantsForPrincipal(grants, principal.id);
      const credentials = await listCredentials(env, fetcher, principal.id, id);
      if (principal.status === 'disabled' && credentials.every((credential) => !credential.active) && principalGrants.some(activeGrant)) {
        try {
          if (await reconcileDisabledPartialIntegration(env, fetcher, manager.accessToken, spaceId, principal, principalGrants, credentials, id)) continue;
        } catch (error) {
          console.error('[HomeMew web integrations] partial integration reconciliation failed', principal.id, error instanceof Error ? error.message : 'unknown');
        }
      }
      integrations.push(integrationDto(principal, principalGrants, credentials, 'bound'));
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
  const credentialMode = parseCredentialMode(body.credentialMode, 'api_token');
  const scopes = scopesForPermissions(permissions);
  const { manager } = await managementContext(env, fetcher, assertion, spaceId, id);

  const principal = await identityIntegrationRequest(env, fetcher, '/api/v1/service-principals', {
    method: 'POST',
    body: {
      displayName,
      description: encodeIntegrationBinding(spaceId, description),
      maxScopes: scopes,
      createdByUserId: manager.userId,
    },
    id,
    fallbackCode: 'INTEGRATION_CREATE_FAILED',
  });
  if (!principal?.id) throw new IntegrationError(502, 'INTEGRATION_CREATE_FAILED', 'LifeSpace 未返回新外部系统');

  const createdGrants = [];
  try {
    for (const modelKey of Object.keys(permissions)) {
      if (!permissions[modelKey]) continue;
      const grant = await createGrant(env, fetcher, manager.accessToken, spaceId, principal.id, modelKey, permissions[modelKey], id);
      if (grant?.id) createdGrants.push(grant.id);
    }
  } catch (error) {
    await compensateFailedCreation(env, fetcher, manager.accessToken, spaceId, principal, createdGrants, description, id);
    throw error;
  }

  let credential;
  try {
    credential = await createServiceCredentialWithReconciliation(env, fetcher, principal, manager.userId, credentialMode, id, []);
  } catch (error) {
    await compensateFailedCreation(env, fetcher, manager.accessToken, spaceId, principal, createdGrants, description, id);
    throw error;
  }

  const integration = await readIntegration(env, fetcher, manager.accessToken, spaceId, principal.id, id);
  return json({ data: { integration, credential } }, 201, id);
}

async function handleUpdate(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { manager, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  const binding = decodeIntegrationBinding(principal.description);
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
  if (body.description !== undefined) patch.description = encodeIntegrationBinding(spaceId, parseDescription(body.description), binding.agentId);
  let permissions = null;
  if (body.permissions !== undefined) {
    permissions = parsePermissions(body.permissions);
    // Omitted model grants are unchanged, including models no longer shown by Discovery.
    const existing = Object.fromEntries(principalGrants.filter((grant) => activeGrant(grant)
      && grant.resourceType === 'model' && typeof grant.resourceId === 'string')
      .map((grant) => [grant.resourceId, modelPermission(principalGrants, grant.resourceId)]));
    patch.maxScopes = scopesForPermissions({ ...existing, ...permissions });
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

async function handleStartCredentialRotation(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { manager } = await managementContext(env, fetcher, assertion, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  if (principal.status !== 'active') throw new IntegrationError(409, 'INTEGRATION_DISABLED', '已禁用的外部系统不能签发凭据');

  const credentials = await listCredentials(env, fetcher, principalId, id);
  const activeCredentials = credentials.filter((credential) => credential.active);
  if (activeCredentials.length > 1) {
    throw new IntegrationError(409, 'CREDENTIAL_ROTATION_PENDING', '已有一次凭据轮换尚未完成，请先完成或取消');
  }
  const mode = parseCredentialMode(body.credentialMode, activeCredentials[0]?.type ?? 'api_token');
  const credential = await createServiceCredentialWithReconciliation(env, fetcher, principal, manager.userId, mode, id, activeCredentials);
  const integration = await readIntegration(env, fetcher, manager.accessToken, spaceId, principalId, id);
  return json({ data: { integration, credential } }, 201, id);
}

async function handleCompleteCredentialRotation(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const keepCredentialId = parseCredentialId(body.keepCredentialId);
  const { manager } = await managementContext(env, fetcher, assertion, spaceId, id);
  await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);

  const credentials = await listCredentials(env, fetcher, principalId, id);
  const activeCredentials = credentials.filter((credential) => credential.active);
  const keep = activeCredentials.find((credential) => credential.id === keepCredentialId);
  if (!keep) throw new IntegrationError(404, 'CREDENTIAL_NOT_FOUND', '要保留的新凭据不存在或已失效');
  for (const credential of activeCredentials) {
    if (credential.id === keepCredentialId) continue;
    await revokeServiceCredential(env, fetcher, principalId, credential, id);
  }
  return json({ data: await readIntegration(env, fetcher, manager.accessToken, spaceId, principalId, id) }, 200, id);
}

async function handleCancelCredentialRotation(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const candidateCredentialId = parseCredentialId(body.candidateCredentialId);
  const { manager } = await managementContext(env, fetcher, assertion, spaceId, id);
  await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);

  const activeCredentials = (await listCredentials(env, fetcher, principalId, id)).filter((credential) => credential.active);
  if (activeCredentials.length < 2) {
    throw new IntegrationError(409, 'NO_CREDENTIAL_ROTATION_PENDING', '当前没有待完成的凭据轮换');
  }
  const candidate = activeCredentials[0];
  if (candidate.id !== candidateCredentialId) {
    throw new IntegrationError(409, 'INVALID_ROTATION_CANDIDATE', '只能撤销本次轮换中新创建的凭据');
  }
  await revokeServiceCredential(env, fetcher, principalId, candidate, id);
  return json({ data: await readIntegration(env, fetcher, manager.accessToken, spaceId, principalId, id) }, 200, id);
}

async function handleDisable(request, env, fetcher, assertion, id, principalId) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const spaceId = parseSpaceId(body.spaceId);
  const { manager, grants } = await managementContext(env, fetcher, assertion, spaceId, id);
  const principal = await resolveBoundIntegration(env, fetcher, spaceId, principalId, id);
  const binding = decodeIntegrationBinding(principal.description);

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
  const credentials = await listCredentials(env, fetcher, principalId, id).catch(() => []);
  for (const credential of credentials.filter((item) => item.active)) {
    try {
      await revokeServiceCredential(env, fetcher, principalId, credential, id);
    } catch {
      cleanupWarnings.push(`credential:${credential.id}`);
    }
  }
  if (binding.agentId) {
    cleanupWarnings.push(...await cleanupIntegrationAgent(env, fetcher, manager.accessToken, spaceId, binding.agentId, id));
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

    if (parts[3] === 'agent') {
      return await handleIntegrationAgentRequest(request, env, { fetcher, assertion, id, principalId });
    }
    if (parts.length === 3 && request.method === 'PATCH') {
      return await handleUpdate(request, env, fetcher, assertion, id, principalId);
    }
    if (parts.length === 5 && parts[3] === 'credential-rotation' && parts[4] === 'complete' && request.method === 'POST') {
      return await handleCompleteCredentialRotation(request, env, fetcher, assertion, id, principalId);
    }
    if (parts.length === 5 && parts[3] === 'credential-rotation' && parts[4] === 'cancel' && request.method === 'POST') {
      return await handleCancelCredentialRotation(request, env, fetcher, assertion, id, principalId);
    }
    if (parts.length === 4 && parts[3] === 'credential-rotation' && request.method === 'POST') {
      return await handleStartCredentialRotation(request, env, fetcher, assertion, id, principalId);
    }
    if (parts.length === 4 && parts[3] === 'disable' && request.method === 'POST') {
      return await handleDisable(request, env, fetcher, assertion, id, principalId);
    }
    throw new IntegrationError(404, 'NOT_FOUND', 'Not found');
  } catch (error) {
    return errorJson(error, id);
  }
}
