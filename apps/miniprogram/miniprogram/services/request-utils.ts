/**
 * 请求相关的纯函数（无外部依赖，便于独立测试）。
 *
 * 普通请求（api.ts）与头像上传（media.ts）共用本文件中的判断与解析逻辑。
 */

/**
 * 是否允许 401 后自动刷新 Token 并重试一次。
 * 规则：仅 GET 请求允许重试一次；写请求（POST/PATCH/DELETE/PUT）不自动重试。
 * 纯函数，便于测试。
 */
export function shouldAutoRetry(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  skipRetry: boolean,
): boolean {
  return method === 'GET' && !skipRetry;
}

/**
 * 从成功响应中提取业务数据。
 * - 204 No Content：直接返回 undefined（无响应体）。
 * - 其他 2xx：解析 { data } 信封。
 * 纯函数，便于测试。
 */
export function extractData(
  statusCode: number,
  rawBody: unknown,
): unknown {
  if (statusCode === 204) {
    return undefined;
  }
  const envelope = rawBody as { data?: unknown };
  return envelope?.data;
}
