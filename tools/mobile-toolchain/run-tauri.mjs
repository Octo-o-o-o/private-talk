import { spawnSync } from "node:child_process";

import { buildMobileEnv, resolveAppleDevelopmentTeam } from "./common.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length === 0) {
  throw new Error("Usage: node tools/mobile-toolchain/run-tauri.mjs <tauri args...>");
}

const env = buildMobileEnv();
if (args[0] === "ios" && !env.APPLE_DEVELOPMENT_TEAM) {
  const teamId = resolveAppleDevelopmentTeam(process.cwd(), env);
  if (teamId) {
    env.APPLE_DEVELOPMENT_TEAM = teamId;
  }
}

const result = spawnSync("pnpm", ["tauri", ...args], {
  stdio: "inherit",
  env,
});

if (result.status !== 0) {
  const rendered = ["pnpm", "tauri", ...args].join(" ");
  throw new Error(`Command failed: ${rendered}`);
}
