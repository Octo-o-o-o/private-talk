import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildMobileEnv, collectFiles, repairGradleWrapperCache, run } from "./common.mjs";

const rootDir = process.cwd();
const env = buildMobileEnv();
const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const tauriArgs =
  rawArgs[0] === "android"
    ? rawArgs
    : [
        "android",
        "build",
        ...(rawArgs.length > 0 ? rawArgs : ["--target", "aarch64"]),
      ];
const androidProjectDir = path.join(rootDir, "src-tauri", "gen", "android");
const androidAppDir = path.join(androidProjectDir, "app");

run("node", ["tools/mobile-toolchain/setup.mjs", "android"], {
  cwd: rootDir,
  env,
});

if (!existsSync(androidProjectDir)) {
  run("node", ["tools/mobile-toolchain/run-tauri.mjs", "android", "init", "--ci"], {
    cwd: rootDir,
    env,
  });
}

rmSync(path.join(androidAppDir, "src", "main", "jniLibs"), {
  recursive: true,
  force: true,
});
rmSync(path.join(androidAppDir, "build"), {
  recursive: true,
  force: true,
});
rmSync(path.join(androidProjectDir, "build"), {
  recursive: true,
  force: true,
});

repairGradleWrapperCache(androidProjectDir, env);

function runAndroidBuild() {
  return spawnSync("pnpm", ["tauri", ...tauriArgs], {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
}

let result = runAndroidBuild();
if (result.status !== 0 && repairGradleWrapperCache(androidProjectDir, env)) {
  result = runAndroidBuild();
}
if (result.status !== 0) {
  const rendered = ["pnpm", "tauri", ...tauriArgs].join(" ");
  throw new Error(`Command failed: ${rendered}`);
}

const outputsRoot = path.join(androidProjectDir, "app", "build", "outputs");
const apks = collectFiles(outputsRoot, (filePath) => filePath.endsWith(".apk"));
const bundles = collectFiles(outputsRoot, (filePath) => filePath.endsWith(".aab"));

console.log("");
for (const apk of apks) {
  console.log(`Android APK: ${apk}`);
}
for (const bundle of bundles) {
  console.log(`Android App Bundle: ${bundle}`);
}
