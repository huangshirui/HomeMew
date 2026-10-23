import { ApiError } from './api-client';

/** Human-readable message for household screens; never expose internal contract fields or request IDs. */
const internalWords = /\b(?:LifeSpace|Schema|Core|Worker|BFF|SQL|D1|API|HTTP|Principal|Actor|Grant|unsupported|invalid|undefined|Exception|fetch|recordId|modelKey|requestId|version)\b|\b(?:rec|spc|usr|lsp)_[A-Za-z0-9_]+\b|[a-zA-Z][\w]*\.[a-zA-Z][\w]*/i;
function readable(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value) && !internalWords.test(value);
}
export function householdErrorMessage(cause: unknown, fallback = '暂时无法完成操作，请稍后重试。'): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return '登录已失效，请重新登录。';
    if (cause.status === 403) return '你没有权限进行此操作。';
    if (cause.status === 404 || cause.status === 410) return '内容已不存在，请刷新后重试。';
    if (cause.status === 409) return '内容已被其他人修改，请刷新后重试。';
    if (cause.status === 429) return '操作太频繁，请稍后再试。';
    if (cause.status && cause.status >= 500) return '服务暂时不可用，请稍后再试。';
    return readable(cause.message) ? cause.message : fallback;
  }
  if (cause instanceof Error) {
    if (/network|failed to fetch|fetch failed|networkerror|timeout|econn/i.test(cause.message))
      return '网络连接失败，请检查网络后重试。';
    return readable(cause.message) ? cause.message : fallback;
  }
  return fallback;
}
