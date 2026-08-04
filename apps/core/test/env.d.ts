export {};

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface ProvidedEnv {
      DB: D1Database;
      AI_RATE_LIMITER: RateLimit;
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}
