# HomeMew Web

HomeMew's primary browser application. This directory now owns `homemew.aisr.online`; the household display moves to `apps/display/` because it will use a different device-oriented identity and authorization model.

## Stack

- React + TypeScript + Vite
- React Router in SPA/library mode
- Tailwind CSS with shadcn/ui-style local primitives
- Cloudflare Vite plugin + Workers Static Assets

Dependencies are intentionally added only when used. TanStack Query will be introduced with real LifeSpace data integration and Schedule-X with the Calendar implementation.

## Commands

```bash
pnpm --filter @homemew/web dev
pnpm --filter @homemew/web typecheck
pnpm --filter @homemew/web build
pnpm --filter @homemew/web deploy:staging
```

The current UI uses clearly labelled preview data. Production browser authentication must not be invented here; see `docs/web-plan.md` for the LifeSpace browser-auth dependency.
