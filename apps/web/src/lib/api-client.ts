import { environmentApiPath } from './runtime-environment';
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(environmentApiPath(path), {
    ...init,
    credentials: 'same-origin',
    cache: init.method === undefined || init.method === 'GET' ? 'no-store' : init.cache,
    headers,
  });
  const payload = await response.json().catch(() => ({} as Envelope<T>)) as Envelope<T>;

  if (!response.ok) {
    throw new ApiError(
      payload.error?.code || `HTTP_${response.status}`,
      payload.error?.message || `请求失败 (${response.status})`,
      payload.error?.requestId || response.headers.get('x-request-id') || undefined,
      response.status,
    );
  }

  return payload.data as T;
}
