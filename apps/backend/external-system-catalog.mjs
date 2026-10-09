import { DurableObject } from 'cloudflare:workers';

const SPACE_ID = /^spc_[A-Za-z0-9_-]+$/u;
const EXTERNAL_SYSTEM_ID = /^ext_[a-f0-9]{32}$/u;
const SERVICE_PRINCIPAL_ID = /^svc_[A-Za-z0-9_-]+$/u;
const AGENT_ID = /^agt_[A-Za-z0-9_-]+$/u;
const USER_ID = /^usr_[A-Za-z0-9_-]+$/u;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 400;

class CatalogError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function validateSpaceId(value) {
  const spaceId = typeof value === 'string' ? value.trim() : '';
  if (!SPACE_ID.test(spaceId)) throw new CatalogError(422, 'INVALID_SPACE_ID', 'spaceId must be a LifeSpace spc_* ID');
  return spaceId;
}

function validateExternalSystemId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!EXTERNAL_SYSTEM_ID.test(id)) throw new CatalogError(404, 'EXTERNAL_SYSTEM_NOT_FOUND', 'External system not found');
  return id;
}

function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) throw new CatalogError(422, 'INVALID_EXTERNAL_SYSTEM_NAME', '名称需要 1-100 个字符');
  return name;
}

function validateDescription(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new CatalogError(422, 'INVALID_EXTERNAL_SYSTEM_DESCRIPTION', '说明格式无效');
  const description = value.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new CatalogError(422, 'INVALID_EXTERNAL_SYSTEM_DESCRIPTION', '说明不能超过 400 个字符');
  return description || null;
}

function validateReference(value, pattern, code, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !pattern.test(value)) throw new CatalogError(422, code, `${field} is invalid`);
  return value;
}

function requireInternalRequest(request) {
  if (new URL(request.url).hostname !== 'homemew-backend.internal') {
    throw new CatalogError(404, 'NOT_FOUND', 'Not found');
  }
}

async function readJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CatalogError(400, 'INVALID_REQUEST', 'Request body must be a JSON object');
  return body;
}

function externalSystemKey(id) {
  return `external-system:${id}`;
}

export class ExternalSystemCatalog extends DurableObject {
  async list() {
    const entries = await this.ctx.storage.list({ prefix: 'external-system:' });
    return [...entries.values()].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async get(id) {
    return await this.ctx.storage.get(externalSystemKey(id)) ?? null;
  }

  async create({ spaceId, displayName, description, createdByUserId }) {
    const now = new Date().toISOString();
    const id = `ext_${crypto.randomUUID().replaceAll('-', '')}`;
    const entry = {
      id,
      spaceId,
      displayName,
      description,
      servicePrincipalId: null,
      agentId: null,
      createdByUserId,
      createdAt: now,
      updatedAt: now,
    };
    await this.ctx.storage.put(externalSystemKey(id), entry);
    return entry;
  }

  async patch(id, patch) {
    const key = externalSystemKey(id);
    const current = await this.ctx.storage.get(key);
    if (!current) throw new CatalogError(404, 'EXTERNAL_SYSTEM_NOT_FOUND', 'External system not found');

    const next = { ...current };
    if (Object.hasOwn(patch, 'displayName')) next.displayName = patch.displayName;
    if (Object.hasOwn(patch, 'description')) next.description = patch.description;

    if (Object.hasOwn(patch, 'servicePrincipalId')) {
      const expected = patch.expectedServicePrincipalId ?? null;
      if ((current.servicePrincipalId ?? null) !== expected) {
        throw new CatalogError(409, 'SERVICE_BINDING_CHANGED', 'Service Access binding changed; reload and retry');
      }
      next.servicePrincipalId = patch.servicePrincipalId;
    }

    if (Object.hasOwn(patch, 'agentId')) {
      const expected = patch.expectedAgentId ?? null;
      if ((current.agentId ?? null) !== expected) {
        throw new CatalogError(409, 'AGENT_BINDING_CHANGED', 'Agent Access binding changed; reload and retry');
      }
      next.agentId = patch.agentId;
    }

    next.updatedAt = new Date().toISOString();
    await this.ctx.storage.put(key, next);
    return next;
  }
}

export function isExternalSystemCatalogReady(env) {
  return Boolean(env.EXTERNAL_SYSTEM_CATALOG && typeof env.EXTERNAL_SYSTEM_CATALOG.getByName === 'function');
}

function catalogStub(env, spaceId) {
  if (!isExternalSystemCatalogReady(env)) throw new CatalogError(503, 'EXTERNAL_SYSTEM_CATALOG_NOT_CONFIGURED', 'External system catalog is not configured');
  return env.EXTERNAL_SYSTEM_CATALOG.getByName(`external-systems:${spaceId}`);
}

function normalizeCreateInput(body) {
  if (Object.keys(body).some((key) => !['spaceId', 'displayName', 'description', 'createdByUserId'].includes(key))) {
    throw new CatalogError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  }
  const createdByUserId = typeof body.createdByUserId === 'string' && USER_ID.test(body.createdByUserId) ? body.createdByUserId : null;
  return {
    spaceId: validateSpaceId(body.spaceId),
    displayName: validateName(body.displayName),
    description: validateDescription(body.description),
    createdByUserId,
  };
}

function normalizePatchInput(body) {
  const allowed = new Set([
    'spaceId', 'displayName', 'description',
    'servicePrincipalId', 'expectedServicePrincipalId',
    'agentId', 'expectedAgentId',
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new CatalogError(400, 'INVALID_REQUEST', 'Request contains unsupported fields');
  const patch = {};
  if (Object.hasOwn(body, 'displayName')) patch.displayName = validateName(body.displayName);
  if (Object.hasOwn(body, 'description')) patch.description = validateDescription(body.description);
  if (Object.hasOwn(body, 'servicePrincipalId')) {
    patch.servicePrincipalId = validateReference(body.servicePrincipalId, SERVICE_PRINCIPAL_ID, 'INVALID_SERVICE_PRINCIPAL_ID', 'servicePrincipalId');
    patch.expectedServicePrincipalId = validateReference(body.expectedServicePrincipalId ?? null, SERVICE_PRINCIPAL_ID, 'INVALID_SERVICE_PRINCIPAL_ID', 'expectedServicePrincipalId');
  }
  if (Object.hasOwn(body, 'agentId')) {
    patch.agentId = validateReference(body.agentId, AGENT_ID, 'INVALID_AGENT_ID', 'agentId');
    patch.expectedAgentId = validateReference(body.expectedAgentId ?? null, AGENT_ID, 'INVALID_AGENT_ID', 'expectedAgentId');
  }
  if (!Object.keys(patch).length) throw new CatalogError(400, 'INVALID_REQUEST', '没有需要更新的内容');
  return { spaceId: validateSpaceId(body.spaceId), patch };
}

export async function handleExternalSystemCatalogRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/internal/v1/external-systems')) return null;

  try {
    requireInternalRequest(request);
    const parts = url.pathname.split('/').filter(Boolean);
    const externalId = parts.length === 4 ? validateExternalSystemId(decodeURIComponent(parts[3])) : null;

    if (parts.length === 3 && request.method === 'GET') {
      const spaceId = validateSpaceId(url.searchParams.get('spaceId'));
      return json({ data: await catalogStub(env, spaceId).list() });
    }

    if (parts.length === 3 && request.method === 'POST') {
      const input = normalizeCreateInput(await readJson(request));
      return json({ data: await catalogStub(env, input.spaceId).create(input) }, 201);
    }

    if (externalId && request.method === 'GET') {
      const spaceId = validateSpaceId(url.searchParams.get('spaceId'));
      const item = await catalogStub(env, spaceId).get(externalId);
      if (!item) throw new CatalogError(404, 'EXTERNAL_SYSTEM_NOT_FOUND', 'External system not found');
      return json({ data: item });
    }

    if (externalId && request.method === 'PATCH') {
      const input = normalizePatchInput(await readJson(request));
      return json({ data: await catalogStub(env, input.spaceId).patch(externalId, input.patch) });
    }

    return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, 405);
  } catch (error) {
    if (error instanceof CatalogError) return json({ error: { code: error.code, message: error.message } }, error.status);
    console.error('[HomeMew external system catalog] unhandled error', error instanceof Error ? error.message : 'unknown');
    return json({ error: { code: 'INTERNAL_ERROR', message: '外部系统目录暂时不可用' } }, 500);
  }
}
