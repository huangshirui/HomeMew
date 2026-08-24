import webHandler from './worker.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function proxyWechatLogin(request, env) {
  const backend = env.HOMEMEW_BACKEND;
  if (!backend || typeof backend.fetch !== 'function') {
    return json({ error: { code: 'BACKEND_NOT_CONFIGURED', message: '微信登录服务暂时不可用' } }, 503);
  }
  return backend.fetch(request);
}

export function createFrontDoorHandler({ app = webHandler } = {}) {
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/api/v1/login/wechat') {
        return proxyWechatLogin(request, env);
      }
      return app.fetch(request, env, context);
    },
  };
}

export default createFrontDoorHandler();
