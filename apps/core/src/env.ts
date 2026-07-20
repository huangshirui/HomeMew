export type Bindings = {
  DB: D1Database;
  CORS_ORIGINS?: string;
  JWT_SECRET: string;
};

export type Variables = {
  requestId: string;
  currentUserId: string;
  authScopes: string[];
};
