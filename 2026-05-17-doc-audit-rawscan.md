# Doc Audit – Raw Scan (2026-05-17)

> 项目：private-talk · 分支：ios-rebuild · 提交时 HEAD：8d77eea
> 任务：文档全量盘点（仅文档，不动代码）。本文件为阶段 1 原始扫描数据，供阶段 2-3 决策使用。

## 0. 仓库识别快照

| 项 | 值 |
|---|---|
| 名称 | private-talk |
| 类型 | Tauri 2 + React 19 + TypeScript + Rust 单仓桌面/移动 IM 客户端 |
| 包管理器 | pnpm（pnpm-lock.yaml） |
| 文档站 | 无（无 Docusaurus / MkDocs / VitePress / Hugo） |
| 多语言文档 | 无 |
| 顶层 docs/ / archive/ / legacy/ / plan/ | 均不存在 |
| 跨平台 | macOS / iOS (`src-tauri/gen/apple/`) + Android (`src-tauri/gen/android/`)，Tauri 自动生成 |
| 远程 | `git@github.com:Octo-o-o-o/private-talk.git`（origin/ios-rebuild） |

## 1. 范围内文档清单（共 10 个 .md）

| # | 路径 | bytes | 最后 commit | 创建 commit |
|---|---|---:|---|---|
| 1 | `README.md` | 577 | 2026-04-22T00:46 WangYixiao · `feat(iOS+UI): add iOS/iPadOS targets ...` | 2026-03-17 Octoooo · 初始脚手架 |
| 2 | `IOS26_UI_SPEC.md` | 6 184 | 2026-04-22T00:46 WangYixiao · 同上 | 2026-04-22T00:46 WangYixiao · 同上 |
| 3 | `PERFORMANCE_OPTIMIZATION_PLAN.md` | 12 257 | 2026-04-22T12:10 WangYixiao · `feat: assistants, model routing ...` | 2026-04-22T12:10 同上 |
| 4 | `UI_REDESIGN_EXECUTION_PLAN.md` | 7 805 | 2026-04-22T10:22 WangYixiao · `Rebuild the UI shell ...` | 2026-04-22T00:46 WangYixiao · iOS+UI commit |
| 5 | `.workflow/intake-20260317-2325-b0e8/01-plan.md` | 1 611 | 2026-03-17T23:43 Octoooo · `chore: add TailwindCSS ...` | 同左 |
| 6 | `.workflow/intake-20260317-2325-b0e8/02-env-check.md` | 288 | 2026-03-17T23:43 Octoooo · 同上 | 同左 |
| 7 | `.workflow/intake-20260317-2325-b0e8/03-implementation.md` | 1 835 | 2026-03-18T00:13 Octoooo · `chore: add workflow artifacts for intake-20260317-2325-b0e8` | 同左 |
| 8 | `.workflow/intake-20260317-2325-b0e8/04-code-review.md` | 996 | 2026-03-18T00:13 Octoooo · 同上 | 同左 |
| 9 | `.workflow/intake-20260317-2325-b0e8/05-test-results.md` | 977 | 2026-03-18T00:13 Octoooo · 同上 | 同左 |
| 10 | `.workflow/intake-20260317-2325-b0e8/A9-completion-report.md` | 1 649 | 2026-03-18T00:13 Octoooo · 同上 | 同左 |

> 全部 10 个文件均在近 6 个月内有 commit（Today: 2026-05-17，阈值 2025-11-17）。按术语定义全部视为 "Current"，不属于 Archive。

## 2. 完全排除项（不审计）

`.gitignore` 已忽略：
- `node_modules/`、`dist/`、`src-tauri/target/`、`.codex-artifacts/`、`.playwright-mcp/`
- `screenshots/`（含 `screenshots/AGENTS.md`、`screenshots/CLAUDE.md` 未跟踪）
- `screenshots-out/`、`demo.html`、`after-*.png`、`probe-*.png`
- 未跟踪目录 `.claude/`（Claude Code 本地工具状态）
- 临时备份 `src/index.css.tmp`

证据-only（仅作活跃判据，不进入五分类）：
- `package.json`、`pnpm-lock.yaml`、`tsconfig*.json`、`vite.config.ts`、`.devyard.yml`
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`
- `src-tauri/gen/apple/.gitignore`、`src-tauri/gen/android/.gitignore`
- `index.html`（Vite 入口 HTML，非文档）

## 3. 文档摘要（按编号对应上表）

### 1. `README.md`
- 标题：`Private Talk (Tauri + React + Typescript)`
- 全文 11 行。介绍项目是 Tauri+React+TS 客户端；含一段 "UI Engine & Specification" 引导阅读 `./IOS26_UI_SPEC.md`；推荐 IDE 配置（VS Code + Tauri + rust-analyzer）。
- 自述功能/路径：`./IOS26_UI_SPEC.md`（Markdown 链接）
- 内链：`./IOS26_UI_SPEC.md`、`vscode marketplace tauri-vscode`、`vscode marketplace rust-analyzer`

### 2. `IOS26_UI_SPEC.md`
- 标题：`Private Talk: iOS 26 / macOS 26 跨端 UI 设计规范`
- 5 大节：核心设计理念、跨端适配形态策略、UI 视觉设计语言规范、CSS 实现核心代码规范、即期优化行动计划
- 自述功能/路径：
  - 涉及组件：`AppLayout.tsx`、`index.css`、Chat Bubble、Sidebar
  - 涉及 token：`.ios26-glass`、`.ios26-stack-container`、`.action-button`
  - 即期优化点：重构 `index.css`、重构 `AppLayout.tsx`、改进 `Chat Bubble`

### 3. `PERFORMANCE_OPTIMIZATION_PLAN.md`
- 标题：`Private Talk iOS / macOS Performance Optimization Plan`
- `Status: Implemented and verified` · Date 2026-04-22
- 11 节：Context / Goals / Non-Goals / Evidence / Options / Chosen plan / Phase 1-8 实施计划 / Risk Review / Verification Plan / Implementation Status / Deferred Work
- 自述功能/路径：
  - 评估热点引用的代码：`src-tauri/src/llm/provider.rs`、`src-tauri/src/commands/chat.rs`、Zustand store `streamingContent`、`ChatView` 的 `useAppStore()`、`MessageItem`
  - Implementation Status 节声称 Phase 1-8 + Verification 全部 "Completed"
  - 验证命令：`cargo check --manifest-path src-tauri/Cargo.toml`、`pnpm build`
  - Deferred：deeper attachment-content caching、conversation virtualization、JS chunk splitting

### 4. `UI_REDESIGN_EXECUTION_PLAN.md`
- 标题：`Private Talk UI 全量重构实施方案`
- 8 节 + Phase 0-7 实施步骤 + 验收清单 + 风险 + 文档自 Review + 结论
- 自述功能/路径：
  - 关键改动点列出 `AppLayout.tsx`、`useLayoutMode.ts`、`Sidebar.tsx`、`ChatView.tsx`、`ChatInput.tsx`、`MessageItem.tsx`、`SettingsPage` 系列、`PinLock.tsx`、`index.css`、`tauri.conf.json` 的 minWidth 调整为 768
  - 多模态遗留备忘：声明文本聊天已恢复，**但语音转写 / TTS / 图片生成仍需单独迁移阶段**
- 内链：`demo.html`（**注意：demo.html 在 .gitignore 里，是断链候选**）、`IOS26_UI_SPEC.md`

### 5. `.workflow/intake-20260317-2325-b0e8/01-plan.md`
- 标题：`# 开发计划`
- Phase 0 + Phase 1 + PIN 锁屏初代设计。29 行，含 SQLite schema 草案（4 表）和技术栈描述。
- 自述功能/路径：`db/`、`llm/`、`commands/`、`pin/` 模块草案

### 6. `02-env-check.md` 288B
- 标题：`# 环境预检`
- 工具版本表：Rust 1.89.0、Node v25.7.0、pnpm 10.22.0、Tauri CLI 2.10.1、Xcode CLT。结论"环境就绪"。

### 7. `03-implementation.md` 1 835B
- 标题：`# 实现记录`
- 33 files / ~2200 lines code 的实现清单 + commit 列表（5ae43c1、8245187、4986608、4ca969c）+ 实现说明
- 自述功能/路径：列出 `db/mod.rs`、`db/schema.rs`、`llm/types.rs`、`llm/provider.rs`、`commands/chat.rs`、`commands/conversation.rs`、`commands/provider.rs`、`commands/settings.rs`、`commands/pin.rs`、`pin/mod.rs`、`stores/appStore.ts`、`lib/types.ts`、`lib/tauri.ts`、`components/layout/`、`components/chat/`、`components/settings/`、`components/pin/PinLock`

### 8. `04-code-review.md` 996B
- 标题：`# 自我代码审查`
- 列出 Warning：API Key 明文存 SQLite、Mutex 跨 await、dead_code finish_reason
- **自评提示："缺少 .gitignore 对 .workflow/ 目录的排除"（line 18）**
- 结论 has-warnings

### 9. `05-test-results.md` 977B
- 标题：`# 测试结果`
- 命令：`pnpm build && cd src-tauri && cargo build`
- 结果：pass。Frontend 2823 modules, 1015.95 kB main chunk；Rust 1 dead_code warning。
- 备注：无单元测试

### 10. `A9-completion-report.md` 1 649B
- 标题：`# Completion Report`
- intake_id `intake-20260317-2325-b0e8` · Phase 0+1+PIN 完成
- commit 列表（同 03-implementation.md，第二份镜像）
- 已知问题与备忘

## 4. 引用关系矩阵

| 文档 | (A) 路径引用 | (B) 标题文字引用 | (C) URL | (D) 误匹配 | 是否文档站 / TOC |
|---|---|---|---|---|---|
| README.md | 0 外部 | 0 | 0 | 0 | 无文档站 |
| IOS26_UI_SPEC.md | **2** (`README.md:6` md 链接 `./IOS26_UI_SPEC.md`; `UI_REDESIGN_EXECUTION_PLAN.md:7` 反引用 `IOS26_UI_SPEC.md`) | 0 | 0 | 0 | 否 |
| PERFORMANCE_OPTIMIZATION_PLAN.md | 0 | 0 | 0 | 0 | 否 |
| UI_REDESIGN_EXECUTION_PLAN.md | 0 | 0 | 0 | 0 | 否 |
| .workflow/01-plan.md ~ A9-completion-report.md（6 个） | 0 外部 | 0 | 0 | 0 | 否 |
| `intake-20260317-2325-b0e8` 目录名 | 1 自引用（`A9-completion-report.md:4` 提到 `intake_id: intake-20260317-2325-b0e8`） | - | - | - | - |
| `.workflow/` 目录名 | 1（`04-code-review.md:18` 自我提示该被 gitignore） | - | - | - | - |

### 入口/源真理直链路径

- README.md → `./IOS26_UI_SPEC.md`（点击可达，markdown 链接）
- UI_REDESIGN_EXECUTION_PLAN.md → `IOS26_UI_SPEC.md`、`demo.html`（**demo.html 在 .gitignore 中，断链候选**）
- A9-completion-report.md → `intake_id: intake-20260317-2325-b0e8`（自引用）

### 活跃引用判定（按"术语 § 活跃引用"）

- 顶层 README/约束 / 文档站 TOC / sidebar / index / 包 manifest / CI / 发布脚本均未引用任何文档（除 README → IOS26_UI_SPEC.md 自身）
- 项目无文档分层（Current / Archive），按"非 archive/legacy 目录下、近 6 个月内有 commit 的文档引用"判：
  - **IOS26_UI_SPEC.md** 被 README.md（入口）+ UI_REDESIGN_EXECUTION_PLAN.md（仍 active）引用 → **活跃**
  - 其他 8 个 plan/intake 文档（除 README）→ **零活跃引用**
  - README.md → 入口本身

## 5. 自述声称 vs. 待核查列表（移交阶段 2）

| 文档 | 自述声称 | 阶段 2 需核查 |
|---|---|---|
| README.md | 项目是 "Tauri + React + Typescript" 客户端；引导阅读 IOS26_UI_SPEC.md | 是否仍准确；项目实际已扩展到 iOS+Android；是否漏说重要能力（PIN、image-gen、TTS、attachments 等） |
| IOS26_UI_SPEC.md | 提供 `.ios26-glass`、`.ios26-stack-container`、`.action-button`、`@media (max-width: 768px)` 等 CSS token；要求重构 `index.css`、`AppLayout.tsx`、Chat Bubble | 这些 token / 选择器是否在 `src/index.css` / `AppLayout.tsx` 中真正存在；说明的"即期优化"是否已实施 |
| PERFORMANCE_OPTIMIZATION_PLAN.md | "Implemented and verified"；Phase 1-8 全部 Completed；提及 `src-tauri/src/llm/provider.rs`、`src-tauri/src/commands/chat.rs`、`streamingContent`、`ChatView`、`MessageItem` | 1) `llm/provider.rs` 是否存在（已被 README 内容暗示当前架构在 src-tauri/src/commands/chat.rs 中）；2) `streamingContent` 是否已搬出 store；3) `MessageItem` 是否 memo；4) Rust 端 stream batching 是否实现；5) 触摸设备 blur 优化是否落地；6) send-path history bound 是否落地；7) 前端 base64 preflight 是否落地 |
| UI_REDESIGN_EXECUTION_PLAN.md | 实施 8 个阶段，最终 shell 收敛；`tauri.conf.json` minWidth = 768；语音/TTS/image-gen 待迁移 | 1) AppLayout / Sidebar / ChatView / ChatInput / MessageItem / SettingsPage / PinLock / index.css 是否按计划重构；2) `tauri.conf.json` minWidth 是否 768；3) 语音/TTS/image-gen 迁移在当前 commit 是否已完成（最近的 commit 4ed1ca4 / b8e8a51 / 8d77eea 提示已扩展 image-gen、voice、TTS）→ 文档自述需要刷新 |
| 01-plan.md | Phase 0+1 + PIN 锁屏计划；SQLite schema 4 表（conversations / messages / providers / settings） | 当前 `src-tauri/src/db/schema.rs` 是否仍是 4 表（已知阶段 0 commit 含 `usage_records` 表新增 `conversation_title` 列、`messages` 加 `raw_content` 列、还有 `assistant_presets` 之类预设表）→ schema 已与文档严重偏离 |
| 02-env-check.md | Rust 1.89.0 / Node v25.7.0 / pnpm 10.22.0 / Tauri CLI 2.10.1 | 工具版本是否仍准确（次要） |
| 03-implementation.md | 33 files / 4 commit；commit hash `5ae43c1, 8245187, 4986608, 4ca969c` | 这些 hash 是否仍存在；当时实施清单是否与现状有差异（一定有，因为之后还有 i18n、image-gen、attachments、assistants 等 feat） |
| 04-code-review.md | 3 个 Warning，info 提示 .workflow/ 应被 gitignore | API Key 是否仍明文存 SQLite；其他 warning 是否仍在；.workflow/ 是否仍未被 gitignore |
| 05-test-results.md | `pnpm build && cargo build` pass；main chunk 1 015.95 kB | 当前是否仍构建通过（不在本次允许范围内运行）；chunk 大小估计已变 |
| A9-completion-report.md | Phase 0+1+PIN 完成；commit 列表（同 03） | 同 03-implementation.md，且这两份文档**内容存在重叠** |

## 6. 多语言 / 资产 / Anchor 备注

- 多语言文档：无
- Anchor：所有内链都是文件级 `*.md`，无 `#anchor` 跳转
- 孤儿资产潜在影响：
  - 顶层 PNG 截图（`after-*.png`、`probe-*.png`）在 .gitignore 中且未被任何 .md 引用，与本任务无关
  - `demo.html` 被 UI_REDESIGN_EXECUTION_PLAN.md:7 引用但 .gitignore 排除 → 文档侧已是断链状态（事实，可在阶段 3 标注）
- 外链：README.md 中 VS Code marketplace 链接（claude.com 未涉及），未做完整验证

## 7. 阶段 1 结论与下一步

- 全部 10 个文档已采集元数据、摘要、引用关系
- 活跃文档 = README.md (入口) + IOS26_UI_SPEC.md (被入口引用)
- 高重叠风险：`03-implementation.md` 和 `A9-completion-report.md` 内容大量重叠
- 高过期风险：`01-plan.md`（schema 已变）、`PERFORMANCE_OPTIMIZATION_PLAN.md` / `UI_REDESIGN_EXECUTION_PLAN.md`（声称完成的若干 phase 需要实证）
- 待执行：阶段 2 与真实实施做精细比对，逐条产出五分类建议（阶段 3）
