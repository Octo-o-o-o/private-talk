# Contributing

Thanks for contributing to Private Talk.

## Ground Rules

- Keep pull requests focused and easy to review.
- Do not commit secrets, API keys, local tokens, signing identities, or machine-specific configuration.
- Do not commit internal workflow artifacts such as `.workflow/`, `.openclaw/`, or local release notes.
- If you change behavior, update the relevant documentation.

## Development Setup

```bash
pnpm install
pnpm tauri dev
```

## Before Opening a Pull Request

Run the checks that apply to your change:

```bash
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

If you change Tauri or packaging behavior, also verify a local desktop build:

```bash
pnpm tauri build
```

## Pull Request Notes

- Explain the user-facing change and the reasoning behind it.
- Mention any platform-specific behavior.
- Call out follow-ups you intentionally left out.

## Licensing

By submitting a contribution, you agree that your work will be licensed under Apache-2.0 for this repository unless explicitly stated otherwise in advance.
