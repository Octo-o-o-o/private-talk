# 打包说明

当前仓库已经在 macOS 主机上验证通过了 macOS、iOS、Android 三端打包流程。

## 已验证脚本

在仓库根目录执行：

```bash
pnpm mobile:setup
pnpm mac:build
pnpm ios:build
pnpm ios:build:device
pnpm android:build
pnpm package:all
```

## 这些脚本会自动处理什么

- 缺少 Android command-line tools 时自动安装
- 自动安装 Android SDK 35 和 36
- 自动安装 Android NDK `27.2.12479018`
- 自动安装 Android / iOS 需要的 Rust targets
- iOS 构建时自动识别本机 Apple development team
- Android 打包前自动修复损坏的 Gradle wrapper 缓存
- iOS / Android 打包前自动清理旧产物，避免重复打包时因为旧目录或旧 so 残留而失败

## 命令说明

### `pnpm mobile:setup`

在 macOS 上准备移动端工具链：

- Android SDK / NDK
- Rust 移动端 targets
- 构建脚本需要的 Java 环境

### `pnpm mac:build`

构建桌面应用并生成 DMG。

产物：

- `src-tauri/target/release/bundle/macos/Private Talk.app`
- `src-tauri/target/release/bundle/dmg/Private Talk_0.1.0_aarch64.dmg`

### `pnpm ios:build`

构建 iOS 模拟器 `.app`。

产物：

- `src-tauri/gen/apple/build/arm64-sim/Private Talk.app`

### `pnpm ios:build:device`

构建 iOS 真机包并导出 IPA。

产物：

- `src-tauri/gen/apple/build/arm64/Private Talk.ipa`

### `pnpm android:build`

使用已经验证过的移动端包装脚本构建 Android 包。

产物：

- `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- `src-tauri/gen/android/app/build/outputs/bundle/universalDebug/app-universal-debug.aab`

虽然 Gradle 产物目录名仍然是 `universal`，但脚本会先清理旧的 `jniLibs`，确保最终打进去的原生库只来自当前这次构建。

### `pnpm package:all`

执行当前完整的三端打包流程：

- macOS `.app` 和 `.dmg`
- iOS 真机 `.ipa`
- Android `.apk` 和 `.aab`

## 当前原生 STT 对齐情况

- macOS / iOS：Apple `Speech.framework`
- Android：`android.speech.SpeechRecognizer`

这样三端系统原生 STT 路径已经对齐。

## 说明

- 这套移动端打包自动化是面向 macOS 主机的。
- 对于 `pnpm ios:build:device`，机器上仍然需要已经存在完整 Xcode 和可用的 Apple 签名资产。脚本可以自动识别并使用本机 development team，但不能静默安装 Apple 开发者账号、证书或 provisioning profile。
- `pnpm android:build` 当前产出的是调试包，适合开发和真机测试；如果后续要做应用商店分发，仍然需要你自己的签名与 release 流程。
- 当前前端仍有大 chunk 警告，Android 生成工程也仍有 Java 21 / Gradle 的弃用警告，但这些不会阻塞实际打包。
