# Private Talk

[简体中文](./README.zh-CN.md)

A ultra-lightweight, fully local AI chat client. Built with Tauri 2.0 — macOS DMG is only ~6 MB.

> Your keys, your models, your data. Nothing leaves your device unless you choose it.

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [Private-Talk_0.1.0_macOS_aarch64.dmg](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/Private-Talk_0.1.0_macOS_aarch64.dmg) |
| Windows (x64) | [PrivateTalk_0.1.0_x64-setup.exe](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_x64-setup.exe) / [.msi](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_x64_en-US.msi) |
| iOS | [PrivateTalk_0.1.0_iOS_arm64.ipa](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_iOS_arm64.ipa) |
| Android | [PrivateTalk_0.1.0_android.apk](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_android.apk) / [.aab](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_android.aab) |

[All releases](https://github.com/Octo-o-o-o/private-talk/releases)

## Why Private Talk

- **Ultra-lightweight.** ~6 MB macOS DMG. Native performance, no Electron.
- **Fully local.** All data stored in local SQLite. No account, no telemetry, no cloud dependency.
- **Bring your own models.** Connect any OpenAI-compatible endpoint — cloud or self-hosted.
- **Bilingual UI.** Built-in Chinese & English interface.

## Features

### Chat & LLM

- Multi-provider chat with streaming responses
- Preset-based providers: OpenAI, Gemini, DeepSeek, Grok, OpenRouter, Volcengine, Zhipu GLM, SiliconFlow, and local engines
- Scenario (system prompt) presets with reusable instructions
- Context window controls, message pinning, and conversation management
- Usage tracking with token/cost summaries

### Image Generation

- `/img` command for text-to-image and image-to-image generation
- Supports 8+ providers: OpenAI (gpt-image-1), Gemini, Grok, SiliconFlow (FLUX), Zhipu (CogView), OpenRouter, LocalAI, stable-diffusion.cpp
- Configurable aspect ratio, quality, count, and background options
- Automatic thumbnail generation for memory-efficient browsing
- Full-size lightbox preview

### Voice

- **TTS (Text-to-Speech):** Local and cloud voice engines with per-role voice routing
- **STT (Speech-to-Text):** Native platform speech recognition (macOS/iOS via AVFoundation, Windows via Media.SpeechRecognition, Android via custom plugin)
- Multiple voice profiles with segment-level role mapping

### Attachments

- Image and file attachments in chat
- Automatic image compression and thumbnail generation
- Lightbox preview with original quality

### OpenClaw Agents

Private Talk works as a lightweight debugging client for [OpenClaw](https://github.com/user/openclaw) agents:

- Connect to local or remote OpenClaw Gateways
- Native OpenClaw Agent conversation flow
- Remote pairing helper ([`tools/private-talk-pair`](./tools/private-talk-pair))
- Instance management and connection metadata stored locally

For a full-service OpenClaw platform, see [ClawButler](https://clawbutler.cc) ([repo](https://github.com/Octo-o-o-o/agent-planet)).

## Privacy

- No hosted backend required. Your app state lives on your machine.
- You choose which model and voice endpoints to connect.
- Cloud traffic goes to the providers you configured, never to a Private Talk service.

## Development

### Prerequisites

- Node.js 18+, `pnpm`, Rust stable toolchain
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS
- Optional: `openclaw` CLI for OpenClaw features

### Run & Build

```bash
pnpm install
pnpm tauri dev          # Dev server + Tauri window with hot reload
pnpm tauri build        # Full native app build
```

### Packaging

```bash
pnpm mac:build          # macOS app + DMG
pnpm ios:build:device   # iOS device IPA
pnpm android:build      # Android APK + AAB
pnpm package:all        # All platforms
```

See [`docs/packaging.md`](./docs/packaging.md) for details.

## Contributing

Issues and PRs are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first.

## Security

See [`SECURITY.md`](./SECURITY.md).

## License

[Apache License 2.0](./LICENSE). See [`NOTICE`](./NOTICE) and [`TRADEMARKS.md`](./TRADEMARKS.md).
