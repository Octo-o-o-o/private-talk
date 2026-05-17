# Doc Audit – Proposal (2026-05-17)

> 项目：private-talk · 分支：ios-rebuild · 提交时 HEAD：8d77eea
> 配套原始扫描：[2026-05-17-doc-audit-rawscan.md](./2026-05-17-doc-audit-rawscan.md)
>
> 本文件包含 10 条文档的五分类建议。所有"中/高风险"、"提级"、"涉及代码/配置"条目默认 ⚠️ 待用户在阶段 5 集中确认。

## 决策汇总

| # | 文件 | 当前状态 | 建议动作 | 风险 | 决策 |
|---|---|---|---|---|---|
| 1 | `README.md` | 11 行入口，仅介绍栈名 + 引导阅读 IOS26_UI_SPEC | 更新并保留（补全能力描述、运行方式） | 高 | ⚠️ |
| 2 | `IOS26_UI_SPEC.md` | 设计规范文档，被 README + UI_REDESIGN_EXECUTION_PLAN 引用 | 更新并保留（§ 5 即期行动节标注为已实施 / 移除或重写） | 高 | ⚠️ |
| 3 | `PERFORMANCE_OPTIMIZATION_PLAN.md` | 自述 Implemented and verified；实测一致 | 保留不动 | 低 | ✅ |
| 4 | `UI_REDESIGN_EXECUTION_PLAN.md` | 主体已实施；§ 6 "多模态待迁移"过时；§ 2 引用 demo.html 断链 | 更新并保留（更新 § 6 状态、移除 demo.html 引用） | 中 | ⚠️ |
| 5 | `.workflow/intake-20260317-2325-b0e8/01-plan.md` | 一次性 intake plan，schema 自述与实际严重偏离 | 整体处理（见下） | 中 | ⚠️ |
| 6 | `.workflow/intake-20260317-2325-b0e8/02-env-check.md` | 一次性环境快照 | 整体处理（见下） | 低 | ⚠️ |
| 7 | `.workflow/intake-20260317-2325-b0e8/03-implementation.md` | 一次性实现快照，与 A9 内容重叠 | 整体处理（见下） | 中 | ⚠️ |
| 8 | `.workflow/intake-20260317-2325-b0e8/04-code-review.md` | 一次性 review，自指 ".workflow/ 应 gitignore" 仍未修复 | 整体处理（见下） | 低 | ⚠️ |
| 9 | `.workflow/intake-20260317-2325-b0e8/05-test-results.md` | 一次性构建输出 | 整体处理（见下） | 低 | ⚠️ |
| 10 | `.workflow/intake-20260317-2325-b0e8/A9-completion-report.md` | 一次性完成报告 | 整体处理（见下） | 低 | ⚠️ |

> `.workflow/intake-20260317-2325-b0e8/` 这 6 条作为一个 intake 单元，建议整体处理。两个备选方案见 § "决策点 D"。

---

## 提案 1 — README.md → 更新并保留

| 字段 | 内容 |
|---|---|
| 文件路径 | `README.md` |
| 当前状态 | 11 行；仅说项目是 "Private Talk (Tauri + React + Typescript)" 客户端 + 引导阅读 `./IOS26_UI_SPEC.md` + 推荐 IDE |
| 实际状态 | 项目已扩展到 iOS / iPadOS / macOS / Android 多平台；具备 PIN 锁屏、i18n、Assistants、Model routing、Voice 设置、STT、TTS、Image-gen、Attachments 等大量能力；README 全部未提（A/B/C）。引用 `./IOS26_UI_SPEC.md` 仍有效 |
| 建议动作 | **更新并保留**（同路径），增补：1) 完整能力一览；2) 平台支持矩阵；3) 开发/启动命令（`pnpm install` → `pnpm tauri dev` → `pnpm tauri build`）；4) 数据/隐私模型简述（SQLite 本地存储，多 Provider，PIN 可选） |
| 理由 | 顶层 README 是 GitHub 默认入口和项目对外形象；当前内容远落后于项目状态 |
| 风险 | **高**（入口文档 + 涉及外部展示） |
| 决策 | ⚠️ |
| 引用方 | 入口本身，无外部引用 |
| 内链修复清单 | 保留对 `./IOS26_UI_SPEC.md` 的引用；如本次同意把 § 2、§ 4 的提案落地，相应更新链接（IOS26 路径不变） |
| 涉及多语言 | 否（项目无文档级 i18n；可考虑增加中文 README，但属于扩展不属于清理） |
| 涉及孤儿资产 | 否 |
| 是否需要改代码/配置 | 否 |
| 回滚信息 | 修改前 commit = 8d77eea；`git checkout HEAD -- README.md` 可回滚 |

---

## 提案 2 — IOS26_UI_SPEC.md → 更新并保留

| 字段 | 内容 |
|---|---|
| 文件路径 | `IOS26_UI_SPEC.md` |
| 当前状态 | 5 节设计规范：核心理念 / 跨端适配 / 视觉语言 token / CSS 实现代码 / **§ 5 即期优化行动计划** |
| 实际状态 | 1) 文档列出的 `.ios26-glass` / `.ios26-stack-container` / `.action-button` class 名**未在 `src/index.css` 中实际使用**（grep 无命中）；2) 文档定的断点 `768 / 960` 与实际 `767 / 959` 略有不同（off-by-one）；3) § 5 "即期优化行动计划" 列出的 3 项（重构 index.css、重构 AppLayout、改进 Chat Bubble）**均已落地**（index.css 3073 行 / AppLayout.tsx 存在 / MessageItem.tsx 已 memo 化重写）；4) 引用关系活跃：被 `README.md:6` 和 `UI_REDESIGN_EXECUTION_PLAN.md:7` 引用（A） |
| 建议动作 | **更新并保留**（同路径）：1) § 4 "CSS 实现核心代码规范" 节明确标注为**参考性示例**（非真实 source-of-truth class），避免读者误以为 `.ios26-glass` 是项目中正在使用的 class；2) § 5 "即期优化行动计划" 节改写为"实施状态：已完成"或迁到附录；3) 可选：把 768 / 960 断点改写成与 src/index.css 实际一致的 767 / 959 |
| 理由 | 文档自述 token 与实际 token 不一致会误导新人；该文档仍是设计语言的"理念"参考，但落地代码已自成体系 |
| 风险 | **高**（被入口文档直链 + 唯一的 source of truth 候选） |
| 决策 | ⚠️ |
| 引用方 | (A) `README.md:6` markdown 链接、`UI_REDESIGN_EXECUTION_PLAN.md:7` 引用 |
| 内链修复清单 | 路径不变，引用方无需调整 |
| 涉及多语言 | 否 |
| 涉及孤儿资产 | 否 |
| 是否需要改代码/配置 | 否（仅修文档；如要把文档的 CSS 示例改为真实可复制的实际类名，需要先阅读 index.css 抽取真实 token，但这属于扩展） |
| 回滚信息 | 同上，`git checkout HEAD -- IOS26_UI_SPEC.md` 可回滚 |

---

## 提案 3 — PERFORMANCE_OPTIMIZATION_PLAN.md → 保留不动

| 字段 | 内容 |
|---|---|
| 文件路径 | `PERFORMANCE_OPTIMIZATION_PLAN.md` |
| 当前状态 | 11 节完整方案 + § 10 Implementation Status 全 Completed + § 11 Deferred Work |
| 实际状态 | 1) `streamingContent` **已从 `src/stores/appStore.ts` 移除**，迁到 `src/components/chat/ChatView.tsx:178` 本地 state（grep 验证 ✓）；2) `MessageItem` **已 memo**（`src/components/chat/MessageItem.tsx:39: export const MessageItem = memo(...)` ✓）；3) `src-tauri/src/llm/provider.rs` 存在；4) 其他 Phase 3-8 描述与现状一致（无反例） |
| 建议动作 | **保留不动**。文档作为一次完整的"实施计划 + 完成记录"对未来 perf 工作仍有参考价值 |
| 理由 | 文档自述与代码现状一致；无失实信息 |
| 风险 | **低**（不修改） |
| 决策 | ✅ |
| 引用方 | 无外部引用，但内容自洽且最近一次 commit 2026-04-22 仍在 6 月活跃窗口内 |
| 内链修复清单 | 无 |
| 涉及多语言 | 否 |
| 涉及孤儿资产 | 否 |
| 是否需要改代码/配置 | 否 |
| 回滚信息 | 无变动，无需回滚 |

---

## 提案 4 — UI_REDESIGN_EXECUTION_PLAN.md → 更新并保留

| 字段 | 内容 |
|---|---|
| 文件路径 | `UI_REDESIGN_EXECUTION_PLAN.md` |
| 当前状态 | 8 节实施方案 + Phase 0-7 + 验收 + § 6 风险与回归 + § 7 文档自 Review |
| 实际状态 | 1) `tauri.conf.json:18` minWidth = 768 ✓；2) `AppLayout.tsx` / `useLayoutMode.ts` / `Sidebar.tsx` / `ChatView.tsx` / `ChatInput.tsx` / `MessageItem.tsx` / `index.css` 均存在 ✓；3) **§ 6 "历史功能差异" 节里 "语音转写 / TTS / 图片生成仍需单独的多模态迁移阶段" 已过时**：`src-tauri/src/commands/stt.rs` / `tts.rs` / `image_gen.rs` 均已存在并在 `lib.rs` 注册（line 47-49）；4) **§ 2 / § 4 引用 `demo.html` 是断链**：`demo.html` 在项目根的 `.gitignore` 中（`# Local design/demo scratch files`），未跟踪存在但**对仓库 clone 者不可见** |
| 建议动作 | **更新并保留**（同路径）：1) § 6 "历史功能差异" 节标注语音/TTS/image-gen 已迁回；2) § 2.0 / § 4 关于 demo.html 的引用改写为"原型参考已存档/已删除"或换成 git 历史指向；3) 可选：把已完成 phase 标注为 ✅，并把整份文档定位调整为"重构实施记录"而非"执行方案" |
| 理由 | 文档大部分内容仍有效，仅个别节区与现状偏离；保留更新比删除更稳 |
| 风险 | **中**（内容偏差较小、不涉及外部发布、改完仍准确） |
| 决策 | ⚠️ |
| 引用方 | 无外部直接引用；本文档反向引用 `IOS26_UI_SPEC.md` 和 `demo.html` |
| 内链修复清单 | demo.html 引用需要选定替代说法（"已存档" / "已删除" / "见 git 历史" 等） |
| 涉及多语言 | 否 |
| 涉及孤儿资产 | demo.html 本身不在仓库（已 gitignore），改文档侧引用即可；不会让任何资产变孤儿 |
| 是否需要改代码/配置 | 否 |
| 回滚信息 | `git checkout HEAD -- UI_REDESIGN_EXECUTION_PLAN.md` |

---

## 决策点 D — `.workflow/intake-20260317-2325-b0e8/` 整体处理（提案 5-10）

> 该目录是 2026-03-17~18 的一次性 intake 工作流产物，6 个文档之间互不引用、外部零活跃引用、04-code-review.md:18 自己提示 ".workflow/ 应被 gitignore"。
>
> 历史价值在 git log 中已永久保留（commit `3dce8af chore: add workflow artifacts for intake-20260317-2325-b0e8` 仍存在）。

### 共同实际状态摘要

| 文档 | 关键偏差 |
|---|---|
| `01-plan.md` | schema 自述 **4 表**（conversations / messages / providers / settings），实际 **7 表**（+ attachments / usage_records / assistants）+ 大量列扩展（如 messages.raw_content / conversations.deleted_at / usage_records.conversation_title） |
| `02-env-check.md` | 工具版本快照，无致命错误，但仅对 2026-03-17 当晚有效 |
| `03-implementation.md` | 33 files / 2200 lines 快照、commit 列表停留在 `5ae43c1`~`4ca969c`（HEAD 已到 8d77eea）；commit hash 均仍存在 ✓ |
| `04-code-review.md` | API key 仍明文 ✓ / `.workflow/` 仍未 gitignore ✓（自指仍准确，但行动从未发生） |
| `05-test-results.md` | 单元测试状态 "无" 已过期 —— 当前 `src-tauri/src/db/schema.rs` 在 commit 8d77eea 中含 `#[cfg(test)] mod tests` |
| `A9-completion-report.md` | commit 列表与 `03-implementation.md` 完全重叠（重复信息） |

### 两个备选方案

#### 方案 D-1 — 整体归档（保留历史可读）

- 新建 `docs/archive/intake-20260317-2325-b0e8/` 并把 6 个文件 `git mv` 过去（项目无 `docs/` 也无 `archive/`，需要新建 2 层目录）
- 同时在新归档目录加一份 README.md 说明：这是 2026-03-17 单次 intake 的过程档案，已与现状脱节，仅作历史参考
- 引用更新：A9-completion-report.md:4 中的 `intake_id: intake-20260317-2325-b0e8` 仍指自身，不变；外部无引用
- 风险：**中**（涉及新建目录、影响 6 个文件的路径）

#### 方案 D-2 — 整体删除（git 历史足够回溯）

- 直接 `git rm` 6 个文件 + `git rm` 空目录
- 理由：
  - 6 份文档零外部引用、互不引用
  - 内容严重过期（schema 4 → 7、commit hash 滞后 ~30 个 commit）
  - 历史可在 git log（commit `3dce8af` 及之前）完整回放
  - 顶层已有 PERFORMANCE_OPTIMIZATION_PLAN / UI_REDESIGN_EXECUTION_PLAN 作为更近期的实施记录
- 回滚极简：`git revert <删除 commit>`
- 风险：**低**（可逆 + 零引用）

#### 我倾向

倾向 **方案 D-2（整体删除）**。理由：
1. 文档零活跃引用，且自身内部互不依赖
2. 内容过期到指引价值已为负（新人读 schema 4 表会被误导）
3. 04-code-review.md 自己已经标识 `.workflow/` 是过程工件
4. 历史完整保留在 git 中，删除可逆
5. 顶层 4 份近期文档已经覆盖了项目的"现状描述 + 已完成实施记录 + 设计规范"三类需求，无遗漏

但若你认为该 intake 还有团队成员需要随时查阅、或希望保留作为流程模板，方案 D-1 也是安全选择。

---

## 阶段 4 自评 review

| 检查项 | 结果 |
|---|---|
| 证据是否够硬 | ✓ 所有"实际状态"均来自 grep / 文件存在性核查 / 行号定位，无凭文档自述论断 |
| 引用是否漏看 | ✓ 已 grep 文件名 + 路径 + 目录名 + intake-id 多种形式 |
| 风险打分 | README + IOS26_UI_SPEC 已标高（入口 + 被入口引用 + 涉及外部发布如 GitHub README）；UI_REDESIGN_EXECUTION_PLAN 标中；`.workflow/*` 单条标低/中，因为零引用 + 过期；整体处理标中（涉及 6 个文件路径变动） |
| 入口/约束 | 已尊重 README 入口地位不删；IOS26_UI_SPEC 作为 source of truth 不删 |
| 多语言/资产 | 无多语言；demo.html 已是断链（事实），改文档侧引用不会让资产变孤儿 |
| 回滚 | 每条记录 HEAD = 8d77eea，单文件可 `git checkout HEAD --` 回滚 |
| 5 ✅ 是否真的零影响 | 提案 3 (PERFORMANCE_OPTIMIZATION_PLAN.md → 保留不动) 是唯一 ✅，无任何改动，零影响 |

review 后：所有需要改动的条目仍标 ⚠️，进阶段 5 待确认。

---

## 阶段 5 — 集中提问点（待你回填）

请按以下顺序回答（高风险优先）：

### Q1 - README.md（高风险）
更新内容方向：
- (A) 我自动补全：能力一览 + 平台支持 + 开发命令 + 数据/隐私模型 + 保留对 IOS26_UI_SPEC.md 的引用
- (B) 我先给出文案 diff 草稿，你 review 后再写入
- (C) 不更新，保留当前 11 行版本
- (D) 其他（请说明）

### Q2 - IOS26_UI_SPEC.md（高风险）
处理方向：
- (A) § 4 CSS 示例标注为"参考代码、非实际 token"+ § 5 即期行动节标注为"已完成"
- (B) 把 § 4 的 token 全部替换为 index.css 实际正在用的 class（需要先抽取真实 token，工作量更大）
- (C) 整份重写为"设计语言指南"，删除所有"行动计划"性质内容
- (D) 不更新

### Q3 - UI_REDESIGN_EXECUTION_PLAN.md（中风险）
处理方向：
- (A) § 6 标注多模态已迁回 + demo.html 引用改成"原型已删除，参见 git 历史"
- (B) 整份重定位为"重构实施记录"，所有 phase 标 ✅
- (C) 不更新

### Q4 - .workflow/intake-20260317-2325-b0e8/（中风险，整体）
处理方向：
- (A) **方案 D-2：6 个文件整体 git rm**（我倾向）
- (B) 方案 D-1：建 `docs/archive/intake-20260317-2325-b0e8/` 并 git mv 过去（需要新建目录体系）
- (C) 全部保留不动
- (D) 拆分：保留 03-implementation.md + A9-completion-report.md（作为最初实现的历史档案），其余 4 个 git rm

### Q5 - 涉及 `.gitignore` 的边缘建议（不在本任务允许范围）
04-code-review.md:18 提示 ".workflow/ 应 gitignore"。如果方案 D-2 通过，这条提示自动失效。如果方案 D-1 / D-3 / C 通过，是否要单独再开一个任务给 .gitignore 加 `.workflow/`？
- (A) 不需要（本任务结束后我自己处理）
- (B) 把这条加到"建议人工跟进清单"

---

## 阶段 6 执行规则（在阶段 5 全部回填后启动）

- 严格按本表 ✅ 决策执行；⚠️ 未变 ✅ 的不动
- 顺序：低风险优先 → 高风险（PERFORMANCE_OPTIMIZATION_PLAN 已 ✅ 不动 → .workflow 处理 → UI_REDESIGN_EXECUTION_PLAN → IOS26_UI_SPEC → README）
- 移动用 `git mv`、删除用 `git rm`、修改用 Edit/Write
- 每条完成后做局部 grep 残留检查、全部完成后全量 grep
- 不自动 commit / push / 开 PR

---

## 决策回填表（执行后填）

执行前 HEAD = `8d77eea`（commit "feat: persist message raw content, ..."）。所有改动均工作树未提交，可单文件 `git checkout 8d77eea -- <path>` 回滚；已删除的 .workflow 可 `git checkout 8d77eea -- .workflow/intake-20260317-2325-b0e8/` 恢复。

| # | 文件 | 最终决策 | 执行结果 | 动作摘要 | 回滚命令 |
|---|---|---|---|---|---|
| 1 | README.md | ✅ 更新并保留（Q1-A 自动补全） | 已执行 | 完整重写：新增 Features (10 项) / Data & privacy / Platform support 表 / Development 命令块 / 保留 IOS26_UI_SPEC 链接 + 新增 UI_REDESIGN_EXECUTION_PLAN + PERFORMANCE_OPTIMIZATION_PLAN 链接 / 保留 IDE 推荐节 | `git checkout 8d77eea -- README.md` |
| 2 | IOS26_UI_SPEC.md | ✅ 更新并保留（Q2-A 最小修订） | 已执行 | § 4 加 "参考示例、非实际 token" 说明（指出 `.ios26-glass` 等 class 未实际使用、断点实际是 767/959）；§ 5 标题加 "已完成" 后缀 + 加状态说明节，原始行动项保留供回顾 | `git checkout 8d77eea -- IOS26_UI_SPEC.md` |
| 3 | PERFORMANCE_OPTIMIZATION_PLAN.md | ✅ 保留不动 | 无变动 | 保留不动（自述与代码现状一致） | 无需 |
| 4 | UI_REDESIGN_EXECUTION_PLAN.md | ✅ 更新并保留（Q3-A 小幅修订 + 复核精修） | 已执行 | line 7/67/99 三处 `demo.html` 引用改写为"本地设计草稿，未纳入 git 跟踪 / 已在 .gitignore 中"（**复核发现初版"仅存于 git 历史"失实，因 `git log --all -- demo.html` 显示该文件从未被跟踪 → 已二次修正**）；§ 6 风险节将"语音/TTS/图片生成尚未迁回"改为"已在后续提交中全部迁回（stt.rs/tts.rs/image_gen.rs）"；§ 7 文档自 Review § 历史功能差异 同步更新 | `git checkout 8d77eea -- UI_REDESIGN_EXECUTION_PLAN.md` |
| 5 | .workflow/intake-20260317-2325-b0e8/01-plan.md | ✅ 删除（Q4-A 整体 git rm） | 已执行 | `git rm` | `git checkout 8d77eea -- .workflow/intake-20260317-2325-b0e8/01-plan.md` |
| 6 | .workflow/intake-20260317-2325-b0e8/02-env-check.md | ✅ 删除 | 已执行 | `git rm` | 同上替换文件名 |
| 7 | .workflow/intake-20260317-2325-b0e8/03-implementation.md | ✅ 删除 | 已执行 | `git rm` | 同上 |
| 8 | .workflow/intake-20260317-2325-b0e8/04-code-review.md | ✅ 删除 | 已执行 | `git rm` | 同上 |
| 9 | .workflow/intake-20260317-2325-b0e8/05-test-results.md | ✅ 删除 | 已执行 | `git rm` | 同上 |
| 10 | .workflow/intake-20260317-2325-b0e8/A9-completion-report.md | ✅ 删除 | 已执行 | `git rm` | 同上 |
| 边界 | .workflow/intake-20260317-2325-b0e8/.base-commit | ✅ 一并删除（用户单独授权） | 已执行 | `git rm`（intake metadata、非 .md） | `git checkout 8d77eea -- .workflow/intake-20260317-2325-b0e8/.base-commit` |

> 副作用：`.workflow/intake-20260317-2325-b0e8/` 与 `.workflow/` 空目录在 git rm 后已自动从文件系统消失。
>
> 残留检查（局部 + 全量 grep）：
> - `intake-20260317-2325-b0e8` 在非审计文档中零残留 ✓
> - `demo.html` 在 UI_REDESIGN_EXECUTION_PLAN.md 中的 3 处已修订为"本地设计草稿，未纳入 git 跟踪"（事实描述）；`.gitignore:31` 仍有 demo.html，属配置文件不在本任务范围 ✓
> - `IOS26_UI_SPEC.md` 引用链（README → spec、UI_REDESIGN_EXECUTION_PLAN → spec）仍然完好 ✓
> - README 新增链接（UI_REDESIGN_EXECUTION_PLAN.md / PERFORMANCE_OPTIMIZATION_PLAN.md）均存在 ✓

## 复核记录（应用户要求"完整检查"）

复核执行了 A-E 五类核查，结果如下：

| 核查项 | 结果 |
|---|---|
| **A. 删除是否过度** | 7 个被删文件均可从 `8d77eea` 完整恢复；零外部引用（按文件名 / intake-id 多种形式全仓 grep，files-with-hits 全为 0） |
| **B. README 声称是否真实** | 全部核实通过：iOS/Android 目标存在（`src-tauri/gen/{apple,android}`）；commands/{stt,tts,image_gen,assistant,config_io,pin,conversation,provider,chat,usage}.rs 均存在；`sha2 = "0.10"` 在 Cargo.toml；`src/lib/uiLanguage.ts` 存在；`grok-3 / grok-3-mini` 预设在 ProviderForm.tsx:56-57；SQLite 7 表全部 CREATE 在 schema.rs；`pnpm tauri ios/android dev` 是 Tauri 2 CLI 子命令（package.json:10 `"tauri": "tauri"` 透传） |
| **C. IOS26_UI_SPEC.md 修订准确性** | ✓ `.ios26-glass / .ios26-stack-container / .action-button` 在 `src/` 下 0 命中；实际断点确为 `max-width: 959px / 767px`（index.css:2781/2793）；§ 5 列出的 3 项即期优化均已落地（index.css 已重写至 3073 行；AppLayout.tsx 使用 `<div className="app-shell">` 单一 shell；MessageItem.tsx 使用 `pt-message__bubble` 新 class 且 `export const MessageItem = memo(...)`） |
| **D. UI_REDESIGN_EXECUTION_PLAN.md 修订准确性** | ✓ `stt_transcribe / tts_synthesize / generate_image_message` 均在 `src-tauri/src/lib.rs:47-49` 注册 |
| **E. demo.html 描述是否准确** | ✗ → ✓（已修正）：`git log --all -- demo.html` 无任何记录 → demo.html **从未** 被 git 跟踪，仅存在于本地 file system 且被 `.gitignore:31` 排除。初版"已退役、仅存于 git 历史"失实，三处描述已二次修订为"本地设计草稿，未纳入 git 跟踪 / 已在 .gitignore 中" |

> 复核共发现并修正 1 处文案失实（条目 4 demo.html）；其余 9 条变更（含删除）均事实准确、可逆、零外部引用。
