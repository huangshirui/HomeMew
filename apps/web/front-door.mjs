import webHandler from './worker.mjs';
import { handleMiniProgramBff } from './miniprogram-bff.mjs';
import { handleMiniProgramEventBff } from './miniprogram-event-bff.mjs';
import { handleMiniProgramFamilyBff } from './miniprogram-family-bff.mjs';
import { handleMiniProgramTaskWishBff } from './miniprogram-task-wish-bff.mjs';

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

export function createFrontDoorHandler({ app = webHandler } = {}) {
  return {
    async fetch(request, env, context) {
      const eventBffResponse = await handleMiniProgramEventBff(request, env);
      if (eventBffResponse) return eventBffResponse;

      const familyBffResponse = await handleMiniProgramFamilyBff(request, env);
      if (familyBffResponse) return familyBffResponse;

      const taskWishBffResponse = await handleMiniProgramTaskWishBff(request, env);
      if (taskWishBffResponse) return taskWishBffResponse;

      const miniBffResponse = await handleMiniProgramBff(request, env);
      if (miniBffResponse) return miniBffResponse;

      const url = new URL(request.url);
      if (isBackendPublicRoute(request, url)) {
        return proxyBackend(request, env);
      }
      return app.fetch(request, env, context);
    },
  };
}

export default createFrontDoorHandler();
