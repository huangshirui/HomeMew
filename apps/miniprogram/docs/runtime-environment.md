# Mini Program runtime environment

Updated: 2026-08-21

HomeMew Phase 7 production cutover is complete. The current `main` branch intentionally pins the Mini Program runtime to **production** for post-cutover production validation and normal release use.

This means all WeChat runtime variants currently use the production endpoints:

```text
develop / trial / release
  -> https://homemew.aisr.online
  -> https://auth.aisr.online
  -> https://core.aisr.online
```

`homemew.aisr.online` is the HomeMew Cloudflare application backend used for WeChat provider login. Household business requests continue directly to LifeSpace Identity/Core with the short-lived LifeSpace user token.

The staging endpoint constants remain in `miniprogram/services/config.ts`, but staging is not selected by the current `main` runtime. Restoring `develop`/`trial` staging isolation requires an explicit code change and corresponding test update; do not rely on `envVersion` alone while the production pin is active.

When a client first moves from the previous staging selection to production, environment-related cached tokens, Space/family selection and service URLs are cleared automatically before fresh production authentication.
