# Private Talk

[简体中文](./README.zh-CN.md)

Private Talk is a local-first, lightweight desktop toolkit for choosing local assistants, working with OpenClaw Agents, and debugging LLM chat, TTS, and STT flows.

It is built for people who want a small, direct, hackable desktop client instead of a full hosted platform.

## Highlights

- Local-first. Conversations, providers, assistant presets, voices, and OpenClaw connection metadata are stored on your device in local SQLite.
- Bring your own model endpoints. Use your own OpenAI-compatible APIs, self-hosted gateways, or cloud providers.
- Voice included. Supports both local voice engines and cloud voice endpoints.
- OpenClaw ready. Works with local OpenClaw Gateways, remote OpenClaw Gateways, local OpenClaw Agents, and native OpenClaw Agents.
- Lightweight. The current macOS arm64 DMG built from this repo is about 6.1 MB.
- Bilingual UI. Chinese and English are both built in.

## What It Is Good For

- Quickly switching between agents and prompts
- Debugging chat behavior across different model backends
- Testing TTS and STT flows
- Connecting to OpenClaw from a simple local desktop client
- Keeping a compact local toolchain for demos, experiments, and daily development

## Core Features

- Local chat with your own provider configuration
- Assistant presets with reusable instructions and system prompts
- Local and cloud TTS profiles
- Voice routing per role
- STT input support
- Usage tracking and token/cost summaries
- Context window controls and message pinning
- OpenClaw instance management
- Native OpenClaw Agent conversation flow
- Pairing helper for remote OpenClaw connections

## Privacy Model

Private Talk is local-first, not SaaS-first.

- There is no required hosted backend from this project.
- Your app state lives locally on your machine.
- You decide which model or voice endpoints the app talks to.
- If you point it to cloud APIs, that traffic goes to the providers you configured, not to a Private Talk service.

## OpenClaw Support

Private Talk supports two OpenClaw workflows:

- Connect to a local OpenClaw Gateway detected on your machine
- Connect to remote OpenClaw Gateways and talk to native OpenClaw Agents

For remote pairing, the repo also includes a small helper under [`tools/private-talk-pair`](./tools/private-talk-pair) that can generate a connection string for another Private Talk client.

The OpenClaw integration design notes are available in [`docs/openclaw-agents-integration-design.md`](./docs/openclaw-agents-integration-design.md).

## Development

### Prerequisites

- Node.js 18+
- `pnpm`
- Rust stable toolchain
- Tauri build prerequisites for your OS
- Optional: `openclaw` CLI if you want to use OpenClaw features

### Run

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm build
pnpm tauri build
```

### Verified Packaging

For the verified macOS, iOS, and Android packaging flow, see [`docs/packaging.md`](./docs/packaging.md).

Quick commands:

```bash
pnpm mac:build
pnpm ios:build
pnpm ios:build:device
pnpm android:build
pnpm package:all
```

## Need More OpenClaw Services?

Private Talk is intentionally the lightweight local client.

If you want a broader OpenClaw service layer, managed workflows, or a more full-service experience around OpenClaw, see:

- [ClawButler website](https://clawbutler.cc)
- [ClawButler repository](https://github.com/Octo-o-o-o/agent-planet)

## Contributing

Issues and pull requests are welcome.

Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before submitting changes.

## Security

Please read [`SECURITY.md`](./SECURITY.md) before reporting vulnerabilities.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).

Additional attribution is in [`NOTICE`](./NOTICE). Trademark guidance is in [`TRADEMARKS.md`](./TRADEMARKS.md).

If you want the reasoning behind this setup, see [`docs/licensing.md`](./docs/licensing.md).
