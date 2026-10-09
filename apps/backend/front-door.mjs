import backend from './worker.mjs';
import {
  ExternalSystemCatalog,
  handleExternalSystemCatalogRequest,
  isExternalSystemCatalogReady,
} from './external-system-catalog.mjs';

export {
  WechatIdentity,
  MemberActivity,
  FamilyCatalog,
  FamilyJoinCoordinator,
} from './worker.mjs';
export { ExternalSystemCatalog };

async function enrichHealth(response, env) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return response;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  return new Response(JSON.stringify({
    ...payload,
    externalSystemCatalogReady: isExternalSystemCatalogReady(env),
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, context) {
    const catalogResponse = await handleExternalSystemCatalogRequest(request, env);
    if (catalogResponse) return catalogResponse;

    const response = await backend.fetch(request, env, context);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return enrichHealth(response, env);
    }
    return response;
  },
};
