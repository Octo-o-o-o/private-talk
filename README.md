# Private Talk

A local-first AI chat client built with Tauri 2, React 19 and TypeScript. Runs as a native app on macOS, iOS / iPadOS and Android, with a single responsive shell across form factors.

## Features

- **Chat**: streaming responses from OpenAI-compatible providers, with per-conversation history, rename, delete and stop-generation.
- **Multi-provider routing**: bring your own API keys (OpenAI, xAI / Grok, or any custom OpenAI-compatible base URL); pick a default and switch per chat.
- **Assistants**: preset assistants with their own system prompt, plus a custom assistant slot.
- **Attachments**: image / file attachments with size pre-flight before base64 encoding.
- **Image generation**: in-chat image generation and editing with reference images; generated images are kept under `$APPDATA/generated-images/`.
- **Speech**: speech-to-text (STT) for input and text-to-speech (TTS) for assistant replies, both pluggable via provider settings.
- **PIN lock**: optional 4-digit lock for app entry, SHA-256 hashed locally; forgetting the PIN resets local data only.
- **i18n**: in-app UI language switch (built-in language registry under `src/lib/uiLanguage.ts`).
- **Usage stats**: per-conversation token accounting in a local `usage_records` table.
- **Config import / export**: bundle providers, assistant prefs and feature settings to a portable config.

## Data & privacy

All state lives locally:

- SQLite database in the OS app-data directory (`conversations`, `messages`, `attachments`, `usage_records`, `providers`, `settings`, `assistants` tables).
- Attachments under `$APPDATA/attachments/`, generated images under `$APPDATA/generated-images/`.
- API keys are stored in the local SQLite (V1 limitation — migration to system Keychain is on the backlog).
- PIN is stored as a SHA-256 hash only; recovery is by resetting data, not by reset link.

No telemetry, no remote sync.

## Platform support

| Platform | Notes |
|---|---|
| macOS 11+ | Signed bundle, hardened runtime; window min width 768 |
| iOS / iPadOS | `src-tauri/gen/apple/` Xcode project, keyboard-aware layout |
| Android | `src-tauri/gen/android/` Gradle project |

Desktop Linux and Windows are not actively packaged today.

## Development

```bash
pnpm install

# Desktop dev (macOS)
pnpm tauri dev

# iOS dev (requires Xcode + an Apple Developer account)
pnpm tauri ios dev

# Android dev (requires Android Studio + NDK)
pnpm tauri android dev

# Production bundle for the current host platform
pnpm tauri build
```

Frontend-only build (no native shell):

```bash
pnpm build      # tsc + vite build, output in dist/
pnpm preview    # serve the built bundle
```

## Running tests

```bash
# Rust unit / integration tests (in-memory SQLite, no native shell).
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Frontend unit tests (vitest + jsdom, no Tauri runtime).
pnpm test
```

Notes:

- All tests are hermetic — they run against `Connection::open_in_memory()` or temporary directories, hit no real LLM provider, and need no Tauri runtime.
- `cargo test` will compile Rust dev-dependencies (`tempfile`, `wiremock`) on first run.
- `pnpm test` requires `pnpm install` once to pull `vitest` / `@testing-library/*` / `jsdom`.
- See [2026-05-17-test-coverage-plan.md](./2026-05-17-test-coverage-plan.md) for the full coverage plan and implementation roadmap.

## UI design

The cross-platform visual language is described in [iOS 26 / macOS 26 Design Specification](./IOS26_UI_SPEC.md). The actual UI redesign that landed in this branch is recorded in [UI_REDESIGN_EXECUTION_PLAN.md](./UI_REDESIGN_EXECUTION_PLAN.md), and the performance / rendering work that backs the streaming chat experience is in [PERFORMANCE_OPTIMIZATION_PLAN.md](./PERFORMANCE_OPTIMIZATION_PLAN.md).

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
