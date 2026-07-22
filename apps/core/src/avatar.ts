import type { Bindings } from './env';
import { ApiError } from './errors';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type AvatarFile = {
  type: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
};

export function avatarUrl(env: Bindings, key: string | null | undefined): string | null {
  if (!key) return null;
  return `${env.ASSETS_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}

function isAvatarFile(value: unknown): value is File {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AvatarFile>;
  return typeof candidate.type === 'string'
    && typeof candidate.size === 'number'
    && typeof candidate.stream === 'function';
}

export async function parseAvatarFile(request: Request): Promise<File> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError('INVALID_AVATAR', 'Request must be multipart/form-data', 400);
  }

  const value = form.get('file');
  if (!isAvatarFile(value)) {
    throw new ApiError('INVALID_AVATAR', 'Avatar file is required', 400);
  }
  if (!CONTENT_TYPES[value.type]) {
    throw new ApiError('UNSUPPORTED_AVATAR_TYPE', 'Avatar must be JPEG, PNG, or WebP', 415);
  }
  if (value.size <= 0 || value.size > MAX_AVATAR_BYTES) {
    throw new ApiError('AVATAR_TOO_LARGE', 'Avatar must be no larger than 5 MB', 413);
  }
  return value;
}

export function avatarObjectKey(userId: string, contentType: string): string {
  return `avatars/${userId}/${crypto.randomUUID()}.${CONTENT_TYPES[contentType]}`;
}

export async function storeAvatar(env: Bindings, userId: string, file: File): Promise<{ key: string; url: string }> {
  const key = avatarObjectKey(userId, file.type);
  await env.AVATARS.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { userId },
  });

  return { key, url: avatarUrl(env, key)! };
}
