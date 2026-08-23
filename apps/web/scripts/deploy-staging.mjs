import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = { ...process.env, CLOUDFLARE_ENV: "staging" };

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
