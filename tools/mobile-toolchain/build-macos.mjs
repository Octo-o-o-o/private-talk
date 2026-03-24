import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { run } from "./common.mjs";

const rootDir = process.cwd();
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));

const productName = tauriConfig.productName;
const version = tauriConfig.version;
const arch = process.arch === "arm64" ? "aarch64" : process.arch;
const bundleRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle");
const appPath = path.join(bundleRoot, "macos", `${productName}.app`);
const dmgPath = path.join(bundleRoot, "dmg", `${productName}_${version}_${arch}.dmg`);

// Use Tauri's built-in DMG bundler which handles code signing and notarization
// automatically when the following environment variables are set:
//   APPLE_SIGNING_IDENTITY  — e.g. "Developer ID Application: Name (TEAM_ID)"
//   APPLE_ID                — Apple ID email for notarization
//   APPLE_PASSWORD          — App-specific password
//   APPLE_TEAM_ID           — Developer Team ID
run("pnpm", ["tauri", "build", "--bundles", "dmg"], { cwd: rootDir });

if (!existsSync(dmgPath)) {
  throw new Error(`macOS DMG was not created at ${dmgPath}`);
}

console.log("");
console.log(`macOS dmg: ${dmgPath}`);
