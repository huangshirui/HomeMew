export {};

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface ProvidedEnv {
      DB: D1Database;
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}
