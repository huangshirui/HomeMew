export type Bindings = {
  DB: D1Database;
  AVATARS: R2Bucket;
  ASSETS_PUBLIC_URL: string;
  CORS_ORIGINS?: string;
  JWT_SECRET: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_PROMPT_APPENDIX?: string;
  AI_RATE_LIMITER: RateLimit;
};

export type Variables = {
  requestId: string;
  currentUserId: string;
  currentPrincipal: { type: "user" | "system" | "service"; id: string; scopes: string[]; credentialId?: string; tokenId?: string };
  authScopes: string[];
  authType: "user" | "system" | "service";
};
