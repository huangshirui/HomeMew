import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Phase 4 Web staging is isolated from production and uses Event v6", () => {
  const config = JSON.parse(fs.readFileSync(new URL("./wrangler.phase4-staging.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "homemew-web-staging");
  assert.equal(config.workers_dev, false);
  assert.equal(config.vars?.ENVIRONMENT, "staging");
  assert.equal(config.vars?.LIFESPACE_IDENTITY_URL, "https://auth-staging.aisr.online");
  assert.equal(config.vars?.LIFESPACE_CORE_URL, "https://core-staging.aisr.online");
  assert.equal(config.vars?.LIFESPACE_EVENT_CONTRACT, "temporal_range");

  const services = Object.fromEntries((config.services ?? []).map(entry => [entry.binding, entry.service]));
  assert.equal(services.HOMEMEW_BACKEND, "homemew-backend-staging");
  assert.equal(services.LIFESPACE_CORE, "lifespace-core-staging");
  assert.equal(services.LIFESPACE_IDENTITY, "lifespace-identity-staging");
  assert.notEqual(services.HOMEMEW_BACKEND, "homemew-backend-production");
  assert.notEqual(services.LIFESPACE_CORE, "lifespace-core");
  assert.notEqual(services.LIFESPACE_IDENTITY, "lifespace-identity");

  assert.deepEqual(config.routes, [
    { pattern: "homemew-web-staging.aisr.online", custom_domain: true },
  ]);
});

test("Phase 4 Web staging workflow stays manual and branch-scoped", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/web-phase4-staging-deploy.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\npush:/u);
  assert.match(workflow, /phase4\/event-temporal-range-prep-2026-09-17/u);
  assert.match(workflow, /DEPLOY_HOMEMEW_WEB_PHASE4_STAGING/u);
  assert.match(workflow, /wrangler\.phase4-staging\.jsonc/u);
  assert.match(workflow, /production traffic\/configuration: untouched/iu);
});
