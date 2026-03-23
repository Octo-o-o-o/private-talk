import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
const dmgDir = path.join(bundleRoot, "dmg");
const stageDir = path.join(dmgDir, ".stage");
const outputPath = path.join(dmgDir, `${productName}_${version}_${arch}.dmg`);

run("pnpm", ["tauri", "build", "--bundles", "app"], { cwd: rootDir });

if (!existsSync(appPath)) {
  throw new Error(`macOS app bundle was not created at ${appPath}`);
}

rmSync(stageDir, { recursive: true, force: true });
rmSync(outputPath, { force: true });
mkdirSync(stageDir, { recursive: true });

cpSync(appPath, path.join(stageDir, `${productName}.app`), { recursive: true });
symlinkSync("/Applications", path.join(stageDir, "Applications"), "dir");

run("hdiutil", [
  "create",
  "-volname",
  productName,
  "-srcfolder",
  stageDir,
  "-ov",
  "-format",
  "UDZO",
  outputPath,
], { cwd: rootDir });

rmSync(stageDir, { recursive: true, force: true });

console.log("");
console.log(`macOS app bundle: ${appPath}`);
console.log(`macOS dmg: ${outputPath}`);
