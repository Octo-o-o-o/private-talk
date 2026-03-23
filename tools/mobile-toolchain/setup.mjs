import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildMobileEnv,
  findSdkManager,
  linkHomebrewCmdlineTools,
  resolveAndroidHome,
  resolveLatestNdk,
  run,
} from "./common.mjs";

const scope = process.argv[2] || "all";
if (process.platform !== "darwin") {
  throw new Error("Mobile setup is currently automated only for macOS hosts.");
}

function shouldSetupAndroid() {
  return scope === "all" || scope === "android";
}

function shouldSetupIos() {
  return scope === "all" || scope === "ios";
}

if (!shouldSetupAndroid() && !shouldSetupIos()) {
  throw new Error(`Unsupported setup scope: ${scope}`);
}

let androidHome = null;
let env = null;

if (shouldSetupAndroid()) {
  androidHome = resolveAndroidHome();
  mkdirSync(androidHome, { recursive: true });

  if (!findSdkManager(androidHome)) {
    const downloadDir = mkdtempSync(path.join(tmpdir(), "private-talk-android-sdk-"));
    const archivePath = path.join(downloadDir, "commandlinetools-mac.zip");
    const extractDir = path.join(downloadDir, "extract");
    const cmdlineToolsTarget = path.join(androidHome, "cmdline-tools", "latest");
    mkdirSync(extractDir, { recursive: true });

    run("curl", [
      "-L",
      "--fail",
      "--output",
      archivePath,
      "https://dl.google.com/android/repository/commandlinetools-mac-14742923_latest.zip",
    ]);
    run("unzip", ["-qo", archivePath, "-d", extractDir]);

    rmSync(cmdlineToolsTarget, { recursive: true, force: true });
    mkdirSync(path.dirname(cmdlineToolsTarget), { recursive: true });
    renameSync(path.join(extractDir, "cmdline-tools"), cmdlineToolsTarget);
    rmSync(downloadDir, { recursive: true, force: true });
  }

  linkHomebrewCmdlineTools(androidHome);

  env = buildMobileEnv();
  const sdkManager = findSdkManager(androidHome);
  if (!sdkManager) {
    throw new Error("sdkmanager is unavailable after installing Android command-line tools.");
  }

  const packages = [
    "platform-tools",
    "platforms;android-35",
    "platforms;android-36",
    "build-tools;35.0.0",
    "ndk;27.2.12479018",
  ];

  run("bash", ["-lc", `yes | "${sdkManager}" --sdk_root="${androidHome}" --licenses >/dev/null`], {
    env,
  });
  run(sdkManager, ["--sdk_root=" + androidHome, ...packages], { env });

  const ndkHome = resolveLatestNdk(androidHome);
  if (!ndkHome || !existsSync(path.join(ndkHome, "toolchains", "llvm"))) {
    throw new Error("Android NDK installation did not complete successfully.");
  }
}

if (!env) {
  env = buildMobileEnv();
}

const rustTargets = [];
if (shouldSetupAndroid()) {
  rustTargets.push(
    "aarch64-linux-android",
    "armv7-linux-androideabi",
    "i686-linux-android",
    "x86_64-linux-android"
  );
}
if (shouldSetupIos()) {
  rustTargets.push("aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios");
}
if (rustTargets.length > 0) {
  run("rustup", ["target", "add", ...rustTargets], { env });
}

console.log("");
console.log("Mobile toolchains are ready.");
if (androidHome) {
  const ndkHome = resolveLatestNdk(androidHome);
  console.log(`ANDROID_HOME=${androidHome}`);
  console.log(`NDK_HOME=${ndkHome}`);
}
console.log(`JAVA_HOME=${env.JAVA_HOME}`);
