export type Bindings = {
  DB: D1Database;
  AVATARS: R2Bucket;
  ASSETS_PUBLIC_URL: string;
  CORS_ORIGINS?: string;
  JWT_SECRET: string;
};

export type Variables = {
  requestId: string;
  currentUserId: string;
  authScopes: string[];
};
