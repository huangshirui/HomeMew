import webHandler from './worker.mjs';
import { handleMiniNewDomainBff } from './miniprogram-new-domains-bff.mjs';
import { handleMiniProgramBff } from './miniprogram-bff.mjs';
import { handleMiniProgramFinalEventBff } from './miniprogram-final-event-bff.mjs';
import { handleMiniProgramFamilyBff } from './miniprogram-family-bff.mjs';
import { handleMiniProgramTaskWishBff } from './miniprogram-task-wish-bff.mjs';
import { handleMiniProgramDayDiagnosticBff } from './miniprogram-day-diagnostic-bff.mjs';
import { handleMiniPlaceSearch } from './map-places.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function isBackendPublicRoute(request, url) {
  if (request.method === 'POST' && url.pathname === '/api/v1/login/wechat') return true;
  if (request.method === 'POST' && url.pathname === '/api/v1/activity/me') return true;
  if (request.method === 'POST' && url.pathname === '/api/v1/activity/report') return true;
  if (request.method === 'GET' && url.pathname === '/api/v1/activity') return true;
  return false;
}

async function proxyBackend(request, env) {
  const backend = env.HOMEMEW_BACKEND;
  if (!backend || typeof backend.fetch !== 'function') {
    return json({ error: { code: 'BACKEND_NOT_CONFIGURED', message: 'HomeMew 应用服务暂时不可用' } }, 503);
  }
  return backend.fetch(request);
}

function webApplicationEnv(env) {
  const credential = env.LIFESPACE_APPLICATION_CREDENTIAL;
  if (typeof credential !== 'string' || !credential.startsWith('lsa_')) return env;
  return {
    ...env,
    // Compatibility alias for the existing integration orchestration modules. Both names
    // deliberately resolve to the same canonical HomeMew LifeSpace Application context.
    LIFESPACE_INTEGRATIONS_APPLICATION_CREDENTIAL: credential,
  };
}

export function createFrontDoorHandler({ app = webHandler } = {}) {
  return {
    async fetch(request, env, context) {
      // Legacy /_stage path must never fall through to the current deployment's backend.
      // Production and Preview select their LifeSpace environment solely from Worker bindings.
      if (new URL(request.url).pathname.startsWith('/_stage/')) {
        return json({ error: { code: 'NOT_FOUND', message: 'Legacy staging route is retired' } }, 404);
      }
      const placeBffResponse = await handleMiniPlaceSearch(request, env);
      if (placeBffResponse) return placeBffResponse;

      const newDomainResponse = await handleMiniNewDomainBff(request, env);
      if (newDomainResponse) return newDomainResponse;

      const eventBffResponse = await handleMiniProgramFinalEventBff(request, env);
      if (eventBffResponse) return eventBffResponse;

      const familyBffResponse = await handleMiniProgramFamilyBff(request, env);
      if (familyBffResponse) return familyBffResponse;

      const taskWishBffResponse = await handleMiniProgramTaskWishBff(request, env);
      if (taskWishBffResponse) return taskWishBffResponse;

      const dayDiagnosticBffResponse = await handleMiniProgramDayDiagnosticBff(request, env);
      if (dayDiagnosticBffResponse) return dayDiagnosticBffResponse;

      const miniBffResponse = await handleMiniProgramBff(request, env);
      if (miniBffResponse) return miniBffResponse;

      const url = new URL(request.url);
      if (isBackendPublicRoute(request, url)) {
        return proxyBackend(request, env);
      }
      return app.fetch(request, webApplicationEnv(env), context);
    },
  };
}

export default createFrontDoorHandler();
