# Packaging Guide

This repo now has verified packaging flows for macOS, iOS, and Android on a macOS host.

## Verified Scripts

Run from the repo root:

```bash
pnpm mobile:setup
pnpm mac:build
pnpm ios:build
pnpm ios:build:device
pnpm android:build
pnpm package:all
```

## What The Scripts Handle Automatically

- Install Android command-line tools when they are missing
- Install Android SDK platforms 35 and 36
- Install Android NDK `27.2.12479018`
- Install the required Rust targets for Android and iOS
- Detect the local Apple development team for iOS builds
- Repair a corrupted Gradle wrapper download cache before Android packaging
- Clean stale iOS and Android build outputs before packaging so reruns do not fail on old artifacts

## Command Reference

### `pnpm mobile:setup`

Prepares mobile toolchains on macOS:

- Android SDK / NDK
- Rust mobile targets
- Java environment wiring used by the build scripts

### `pnpm mac:build`

Builds the desktop app and creates a DMG.

Outputs:

- `src-tauri/target/release/bundle/macos/Private Talk.app`
- `src-tauri/target/release/bundle/dmg/Private Talk_0.1.0_aarch64.dmg`

### `pnpm ios:build`

Builds the iOS simulator app bundle.

Output:

- `src-tauri/gen/apple/build/arm64-sim/Private Talk.app`

### `pnpm ios:build:device`

Builds the iOS device package and exports an IPA.

Output:

- `src-tauri/gen/apple/build/arm64/Private Talk.ipa`

### `pnpm android:build`

Builds the Android package from the verified mobile toolchain wrapper.

Outputs:

- `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- `src-tauri/gen/android/app/build/outputs/bundle/universalDebug/app-universal-debug.aab`

The Gradle output directory still uses the `universal` flavor name, but the build wrapper clears stale `jniLibs` first so the packaged native library matches the current build.

### `pnpm package:all`

Runs the current end-to-end packaging flow:

- macOS app and DMG
- iOS device IPA
- Android APK and AAB

## Current Native STT Alignment

- macOS and iOS: Apple `Speech.framework`
- Android: `android.speech.SpeechRecognizer`

This keeps the system-native STT path aligned across Apple and Android builds.

## Notes

- These mobile packaging scripts are automated for macOS hosts.
- Full Xcode and Apple signing assets must already exist on the machine for `pnpm ios:build:device`. The scripts can detect and use the local Apple development team, but they cannot silently install an Apple developer account, certificates, or provisioning profiles.
- `pnpm android:build` currently emits a debug APK and debug AAB. This is suitable for development and device testing. Store distribution still needs your normal signing and release workflow.
- The frontend build still warns about large chunks, and the Android build still shows Java 21 / Gradle deprecation warnings from generated mobile scaffolding. Those warnings do not block packaging.
