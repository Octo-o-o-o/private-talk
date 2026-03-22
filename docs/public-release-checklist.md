# Public Release Checklist

This repository was prepared for a public open-source release from a previously private codebase.

## Files That Should Be Published To GitHub

- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `NOTICE`
- `TRADEMARKS.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/openclaw-agents-integration-design.md`
- Source code under `src/`, `src-tauri/`, and `tools/`

## Files That Should Stay Private

- `.workflow/**`
- `.openclaw/**`
- `CLAUDE.md`
- `ACCEPTANCE-REPORT.md`
- `docs/UI_standard.md`
- Local signing and notarization notes
- Apple account identifiers, signing identities, and private environment variable setup
- Machine-specific paths, internal review notes, acceptance notes, and planning artifacts

## OpenClaw Workflow Guidance

The following OpenClaw-related material is fine to publish:

- architecture and integration design
- end-user setup steps
- generic CLI examples
- public-facing feature documentation

The following should not be published:

- internal agent workflow notes
- intake plans and implementation journals
- review artifacts
- private operational notes
- anything that exposes local tokens, hostnames, or machine-specific environment setup

## Before Changing Repository Visibility

- Remove internal-only files from the Git tree
- Replace the public history with a clean open-source snapshot if the private history contains internal artifacts
- Recheck repository settings, description, website, topics, and issue templates
- Confirm no secrets or personal signing metadata remain in tracked files
