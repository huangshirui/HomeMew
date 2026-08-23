import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = { ...process.env, CLOUDFLARE_ENV: "staging" };
const workerName = "homemew-web-staging";
const requiredSecrets = ["LIFESPACE_APPLICATION_CREDENTIAL", "WEB_SESSION_SECRET"];

async function requireSecretsAfterBootstrap() {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) return;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    },
  );

  if (response.status === 404) {
    console.log(`${workerName} does not exist yet; allowing one unprovisioned staging bootstrap deployment.`);
    return;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true || !Array.isArray(payload?.result)) {
    throw new Error(`Could not inspect ${workerName} Worker secrets before deployment (HTTP ${response.status})`);
  }

  const names = new Set(payload.result.map((entry) => entry?.name).filter(Boolean));
  const missing = requiredSecrets.filter((name) => !names.has(name));
  if (missing.length) {
    throw new Error(
      `${workerName} already exists but is not fully provisioned; missing Worker Secrets: ${missing.join(", ")}. `
      + "Run the LifeSpace HomeMew Web staging provisioning workflow before deploying again.",
    );
  }
}

await requireSecretsAfterBootstrap();

for (const args of [
  ["exec", "vite", "build"],
  ["exec", "wrangler", "deploy"],
]) {
  const result = spawnSync(pnpm, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
