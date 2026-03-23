import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildMobileEnv, collectFiles, resolveAppleDevelopmentTeam, run } from "./common.mjs";

const rootDir = process.cwd();
const env = buildMobileEnv();
const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

run("node", ["tools/mobile-toolchain/setup.mjs", "ios"], {
  cwd: rootDir,
  env,
});

if (!env.APPLE_DEVELOPMENT_TEAM) {
  const teamId = resolveAppleDevelopmentTeam(rootDir, env);
  if (teamId) {
    env.APPLE_DEVELOPMENT_TEAM = teamId;
  }
}

const appleProjectDir = path.join(rootDir, "src-tauri", "gen", "apple");
if (!existsSync(appleProjectDir)) {
  run("node", ["tools/mobile-toolchain/run-tauri.mjs", "ios", "init"], {
    cwd: rootDir,
    env,
  });
}

const tauriArgs =
  rawArgs[0] === "ios"
    ? rawArgs
    : ["ios", "build", ...(rawArgs.length > 0 ? rawArgs : ["--target", "aarch64-sim"])];
const buildRoot = path.join(appleProjectDir, "build");

rmSync(buildRoot, { recursive: true, force: true });

const result = spawnSync("pnpm", ["tauri", ...tauriArgs], {
  cwd: rootDir,
  env,
  stdio: "inherit",
});

if (result.status !== 0) {
  const rendered = ["pnpm", "tauri", ...tauriArgs].join(" ");
  throw new Error(`Command failed: ${rendered}`);
}

const apps = collectFiles(buildRoot, (filePath) => filePath.endsWith(".app"));
const ipas = collectFiles(buildRoot, (filePath) => filePath.endsWith(".ipa"));

console.log("");
for (const appPath of apps) {
  console.log(`iOS app bundle: ${appPath}`);
}
for (const ipaPath of ipas) {
  console.log(`iOS IPA: ${ipaPath}`);
}
