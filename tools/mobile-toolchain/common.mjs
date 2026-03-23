import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    throw new Error(`Command failed: ${rendered}`);
  }
}

export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    throw new Error(`Command failed: ${rendered}\n${result.stderr || ""}`.trim());
  }
  return (result.stdout || "").trim();
}

export function commandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

export function resolveAndroidHome() {
  return process.env.ANDROID_HOME || path.join(homedir(), "Library", "Android", "sdk");
}

export function resolveJavaHome() {
  if (process.env.JAVA_HOME) {
    return process.env.JAVA_HOME;
  }
  return capture("/usr/libexec/java_home", ["-v", "21"]);
}

export function homebrewCmdlineToolsRoot() {
  return "/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest";
}

export function findSdkManager(androidHome = resolveAndroidHome()) {
  const candidates = [
    path.join(androidHome, "cmdline-tools", "latest", "bin", "sdkmanager"),
    path.join(homebrewCmdlineToolsRoot(), "bin", "sdkmanager"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function linkHomebrewCmdlineTools(androidHome = resolveAndroidHome()) {
  const source = homebrewCmdlineToolsRoot();
  if (!existsSync(source)) {
    return false;
  }
  const target = path.join(androidHome, "cmdline-tools", "latest");
  if (existsSync(target)) {
    return false;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(source, target, "dir");
  return true;
}

export function resolveLatestNdk(androidHome = resolveAndroidHome()) {
  const explicit = process.env.NDK_HOME || process.env.ANDROID_NDK_HOME;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const ndkRoot = path.join(androidHome, "ndk");
  if (!existsSync(ndkRoot)) {
    return null;
  }
  const versions = readdirSync(ndkRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (versions.length === 0) {
    return null;
  }
  return path.join(ndkRoot, versions.at(-1));
}

export function buildMobileEnv(baseEnv = process.env) {
  const projectToolchainDir = path.join(process.cwd(), "tools", "android-toolchain");
  const androidHome = resolveAndroidHome();
  const javaHome = resolveJavaHome();
  const ndkHome = resolveLatestNdk(androidHome) || "";
  const llvmPrebuiltRoot = ndkHome
    ? path.join(ndkHome, "toolchains", "llvm", "prebuilt")
    : "";
  const llvmHostDir =
    llvmPrebuiltRoot && existsSync(llvmPrebuiltRoot)
      ? readdirSync(llvmPrebuiltRoot, { withFileTypes: true })
          .find((entry) => entry.isDirectory())?.name || ""
      : "";
  const llvmBinDir =
    llvmHostDir ? path.join(llvmPrebuiltRoot, llvmHostDir, "bin") : "";
  const pathEntries = [
    projectToolchainDir,
    path.join(androidHome, "cmdline-tools", "latest", "bin"),
    path.join(androidHome, "platform-tools"),
    llvmBinDir,
    baseEnv.PATH || "",
  ];

  return {
    ...baseEnv,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    JAVA_HOME: javaHome,
    ...(ndkHome ? { NDK_HOME: ndkHome, ANDROID_NDK_HOME: ndkHome } : {}),
    ...(llvmBinDir
      ? {
          CC_aarch64_linux_android: path.join(llvmBinDir, "aarch64-linux-android24-clang"),
          AR_aarch64_linux_android: path.join(llvmBinDir, "llvm-ar"),
          CC_armv7_linux_androideabi: path.join(
            llvmBinDir,
            "armv7a-linux-androideabi24-clang"
          ),
          AR_armv7_linux_androideabi: path.join(llvmBinDir, "llvm-ar"),
          CC_i686_linux_android: path.join(llvmBinDir, "i686-linux-android24-clang"),
          AR_i686_linux_android: path.join(llvmBinDir, "llvm-ar"),
          CC_aarch64_linux_android_clang: path.join(
            llvmBinDir,
            "aarch64-linux-android24-clang"
          ),
          CC_aarch64_linux_android_clangxx: path.join(
            llvmBinDir,
            "aarch64-linux-android24-clang++"
          ),
          CC_x86_64_linux_android: path.join(llvmBinDir, "x86_64-linux-android24-clang"),
          AR_x86_64_linux_android: path.join(llvmBinDir, "llvm-ar"),
        }
      : {}),
    PATH: pathEntries.filter(Boolean).join(path.delimiter),
  };
}

export function resolveAppleDevelopmentTeam(cwd, env = process.env) {
  try {
    const output = capture("pnpm", ["tauri", "info"], {
      cwd,
      env,
    });
    const match = output.match(/Developer Teams:\s.*\(ID:\s([A-Z0-9]+)\)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function repairGradleWrapperCache(projectDir, env = process.env) {
  const wrapperPropertiesPath = path.join(
    projectDir,
    "gradle",
    "wrapper",
    "gradle-wrapper.properties"
  );
  if (!existsSync(wrapperPropertiesPath)) {
    return false;
  }

  const properties = capture("sed", ["-n", "1,120p", wrapperPropertiesPath], { env });
  const distributionLine = properties
    .split("\n")
    .find((line) => line.startsWith("distributionUrl="));
  const distributionUrl = distributionLine?.split("=", 2)[1]?.replaceAll("\\:", ":");
  if (!distributionUrl) {
    return false;
  }

  const distributionBaseName = path.basename(distributionUrl, ".zip");
  const gradleUserHome = env.GRADLE_USER_HOME || path.join(homedir(), ".gradle");
  const distributionRoot = path.join(
    gradleUserHome,
    "wrapper",
    "dists",
    distributionBaseName
  );
  if (!existsSync(distributionRoot)) {
    return false;
  }

  let repaired = false;
  for (const entry of readdirSync(distributionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const cacheDir = path.join(distributionRoot, entry.name);
    const archivePath = path.join(cacheDir, `${distributionBaseName}.zip`);
    if (!existsSync(archivePath)) {
      continue;
    }

    const check = spawnSync("unzip", ["-tq", archivePath], {
      stdio: "ignore",
      env,
    });
    if (check.status === 0) {
      continue;
    }

    spawnSync("rm", ["-rf", cacheDir], {
      stdio: "ignore",
      env,
    });
    repaired = true;
  }

  return repaired;
}

export function collectFiles(rootDir, predicate, files = []) {
  if (!existsSync(rootDir)) {
    return files;
  }
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, predicate, files);
      continue;
    }
    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}
