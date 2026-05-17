# 测试覆盖补充方案 (2026-05-17)

> 目标：为 Private Talk（Tauri 2 + React 19 + Rust）补一张"能挡住核心 bug、不刷数字"的安全网。前端从零搭建；Rust 在已有 3 个迁移测试基础上扩展。范围以本地 hermetic 测试为主，UI 端到端先不上。

## 1. 现状摘要

### 技术栈与命令链

- 前端：React 19 + TypeScript 5.8 + Vite 7 + zustand 5 + Tailwind 4。无测试框架、无 `*.test.*`、无 `test` 脚本。`package.json` scripts 只有 [dev / build / preview / tauri](package.json:6)。
- 后端：Rust 2021 + Tauri 2 + rusqlite (bundled) + reqwest + aes-gcm + pbkdf2 + sha2 + pdf-extract。没有 `[dev-dependencies]`，但 Rust 自带 test runner。
- 平台：macOS 11+ / iOS / iPadOS / Android。无 CI（无 `.github/workflows`）。

### 现有测试盘点

仅 Rust 端 3 个 `#[cfg(test)]` 内嵌测试，全部使用 `Connection::open_in_memory()`，hermetic：

| 文件 | 测试 | 覆盖范围 |
|---|---|---|
| [src-tauri/src/db/schema.rs:287](src-tauri/src/db/schema.rs:287) | `init_db_backfills_usage_record_titles_for_legacy_databases` | usage_records 增列 + 回填 |
| [src-tauri/src/db/schema.rs:344](src-tauri/src/db/schema.rs:344) | `init_db_backfills_message_raw_content_for_legacy_databases` | messages 增 raw_content + 回填 |
| [src-tauri/src/commands/chat.rs:636](src-tauri/src/commands/chat.rs:636) | `save_usage_record_repairs_legacy_schema_before_retrying` | 旧 schema 写入失败时自愈重试 |

> 现有测试可信度：高。证据：
> - 都用内存 SQLite，无外部依赖，不依赖时间或顺序；
> - 断言直接对真实存储读出来比较（`SELECT … FROM usage_records WHERE …`），不是测 mock；
> - 覆盖的恰好是历史已经出过事的迁移路径（看 commit 8d77eea 同时改了 schema.rs 和 conversation.rs，可印证）。
> - 当前分支 `ios-rebuild` 下未运行 `cargo test`（按安全边界禁止 build，见 §10）。

### 基础设施可用性

- 团队/CI 视角：**无 CI**，从未跑过这些测试。Rust 测试要靠开发者本地手动 `cargo test`。这本身不是 P0（项目还在 V1 阶段、单人开发为主），但**一旦引入 P0/P1 的新测试，必须配合 CI**——见 §7 里程碑。
- 本地：未在本任务运行任何测试或构建命令（步骤 0 安全边界）。

## 2. 缺口清单（P0/P1/P2）

> 失败模式 = "如果没有这个测试，最容易漏出的是什么样的 bug"。优先级判定见步骤 2 prompt 规则。

### P0（最关键核心路径 / 安全敏感 / 高频回归区）

| 模块 / 路径 | 缺口 | 能捕获的具体失败模式 | 建议层 | 估算 |
|---|---|---|---|---|
| [src-tauri/src/db/schema.rs:148](src-tauri/src/db/schema.rs:148) `init_db` 全新数据库路径 | 现有 2 个测试都从 legacy schema 起步；新装用户走的"空 DB → 7 表 + index + seed preset" 路径未覆盖 | 新增表 / index 漏写到 `init_db` 后只有"全新装"用户启动失败；preset assistant seed SQL 漂移导致内置 5 个 assistant 不出现；二次调用 `init_db`（重启时）应幂等但被回归破坏 | unit (Rust) | XS |
| [src-tauri/src/pin/mod.rs:3](src-tauri/src/pin/mod.rs:3) `hash_pin` / `verify_pin` | 完全没测 | 任何一方修改 hash 算法（加 salt / 换 hex 大小写 / 切 Sha512）后没改另一方，登录全员失效；或 hash 输出格式变化导致写库后下次启动验证失败 | unit (Rust) | XS |
| [src-tauri/src/commands/config_io.rs:103](src-tauri/src/commands/config_io.rs:103) `encrypt` / `decrypt` | 完全没测 | PBKDF2 迭代数 / nonce 长度 / salt 长度 / magic header 任一改动导致旧备份不可读；wrong password 不再返回 "Decryption failed" 而是 panic | unit (Rust) | S |
| [src-tauri/src/commands/config_io.rs:259](src-tauri/src/commands/config_io.rs:259) `export → import` roundtrip | 完全没测 | 字段增减或 `EXPORTABLE_SETTINGS` 列表漂移导致用户备份恢复后丢配置；`replace` 模式误删 preset assistant；password 空串校验回归 | integration (Rust + 临时 SQLite) | M |
| [src-tauri/src/attachments.rs:41](src-tauri/src/attachments.rs:41) `sanitize_file_name` + `save_upload` | 完全没测 | 攻击者构造 `../../../etc/passwd` 形式 file_name 写出 `$APPDATA` 外；超过 20MB / 空载荷 / NUL 字节 / Windows 保留字符回归；MIME 与扩展名不一致时分类错误 | unit (Rust) + integration | M |
| [src-tauri/src/commands/conversation.rs:41](src-tauri/src/commands/conversation.rs:41) `decode_local_image_uri` + `delete_generated_images_for_messages` | 完全没测 | 解码后 `starts_with(generated_root)` 检查被绕过 → 删用户家目录任意文件；本地图片 URI 格式变化时清理失效（导致泄漏 + 磁盘膨胀） | unit (Rust) | S |
| [src-tauri/src/commands/chat.rs:152](src-tauri/src/commands/chat.rs:152) `build_system_message` | 完全没测 | preset / custom_prompt / language 三种来源组合错位，用户切换 assistant 后系统提示词没换；preset 是 "default" 时不应输出 preset 指令但仍输出 | unit (Rust) | S |
| [src-tauri/src/commands/chat.rs:192](src-tauri/src/commands/chat.rs:192) `message_content_with_attachments` | 完全没测 | vision 模型把图片以 text 形式塞入 / 非 vision 模型反而 inline base64；PDF 抽不出文本时不 fallback；附件 prompt 为空时不用默认 prompt | unit (Rust) | S |
| [src-tauri/src/llm/mod.rs:4](src-tauri/src/llm/mod.rs:4) `is_vision_model` | 完全没测 | 新增模型族（如下个版本 Gemini / Qwen2.5-VL 命名变化）误判 → 上文 §3 message_content_with_attachments 跟着出错 | unit (Rust) | XS |
| [src-tauri/src/image_generation.rs:285](src-tauri/src/image_generation.rs:285) `parse_img_command` | 完全没测 | `/img --ratio 3:2 something` 这种带未知 flag 的输入 prompt 被截断；`--count 5` 不报错而静默 break；`/img\n` 换行变体回归；prompt 内文里写了 `--ratio` 被误识为 flag | unit (Rust) | S |
| [src-tauri/src/llm/provider.rs:15](src-tauri/src/llm/provider.rs:15) `stream_chat` SSE 解析 | 完全没测 | 上游 SSE 边界跨多 chunk（`data:` 半截在 buffer 里）丢内容；`[DONE]` 之外的其他终止标记 / JSON 解析失败后是否丢 chunk；多 choice 时把所有 choice content 拼到一起 | integration (Rust, mock HTTP server) | M |
| [src-tauri/src/commands/conversation.rs:371](src-tauri/src/commands/conversation.rs:371) `truncate_conversation_from_message` | 完全没测 | 同 ms 多条消息（`created_at` 相同）时漏删 / 多删；级联清理 attachments / generated-images / usage_records 三处任一漏掉；`conversations.updated_at` 没回滚到上一条消息 | integration (Rust + 临时 SQLite + temp dir) | M |
| [src/lib/providerModels.ts:74](src/lib/providerModels.ts:74) `parseProviderModelRegistry` + `inferModelPurposes` | 完全没测（前端零基础设施） | 用户在 settings 里填 `whisper-large-v3` 这种新名字被误推为 chat（STT 正则不命中）；JSON registry 损坏后整个 provider 列表挂掉；purpose 字段被序列化成 `[object Object]` 写回库 | unit (vitest) | S |
| [src/stores/appStore.ts:414](src/stores/appStore.ts:414) `loadProviders` 选 active provider 链 | 完全没测 | provider 被删后 storedProviderId 还在 → fallback 链断；`is_default` 标志多个 provider 都为 true 时选错；model 不在新 provider 列表中时未回退到首个 | integration (vitest + mock api) | M |
### P1（重要边界 / 错误路径 / 中频回归）

| 模块 / 路径 | 缺口 | 能捕获的具体失败模式 | 建议层 | 估算 |
|---|---|---|---|---|
| [src/stores/appStore.ts:522](src/stores/appStore.ts:522) `loadSpeechSettings` 6 层三元 fallback | 完全没测 | STT/TTS provider 被切换但 model 字段没相应更新；空白字符串 / null 两种"无值"被不同分支处理；默认值 `whisper-1` / `tts-1` / `alloy` 漂移（注：失败模式偏 UI 显示错位、用户能立刻纠正，因此从初稿 P0 降到 P1） | unit + integration (vitest) | M |
| [src/stores/appStore.ts:69](src/stores/appStore.ts:69) `previewFromContent` / `previewFromMessage` / `updateConversationPreview` | 完全没测 | 含图片 markdown 的消息 sidebar 预览显示原始 `![…](url)`；只附件无文字时 preview 为空；多 attachment 拼接顺序回归；列表重排丢失非匹配 conversation（注：失败模式不致丢数据，从初稿 P0 降到 P1） | unit (vitest, 纯函数) | S |
| [src-tauri/src/commands/conversation.rs:204](src-tauri/src/commands/conversation.rs:204) `delete_conversation` | 完全没测 | soft-delete 写 `deleted_at` 后 `list_conversations` 仍把它列出来；attachments 文件没删但 DB 记录删了，残留磁盘；generated-images 目录 NotFound 应静默却报错 | integration (Rust) | S |
| [src-tauri/src/commands/conversation.rs:142](src-tauri/src/commands/conversation.rs:142) `update_conversation_assistant` | 完全没测 | 已经发过消息后切 assistant 应拒绝（"Cannot change assistant after messages have been sent"），但 `role != 'system'` 计数错位导致允许；system 消息算进去 | unit (Rust + 临时 DB) | S |
| [src-tauri/src/commands/provider.rs:46](src-tauri/src/commands/provider.rs:46) `create_provider` 首个 default | 完全没测 | 第二个 provider 不应 auto-default 但 count 查询时机错；删除当前 default provider 后无 fallback | unit (Rust) | S |
| [src-tauri/src/commands/assistant.rs:93](src-tauri/src/commands/assistant.rs:93) `update_assistant` / `delete_assistant` preset 守卫 | 完全没测 | preset 守卫被绕过（is_preset 字段名变化、查询路径错误）；删自定义 assistant 后 conversations.assistant_id NULL 化失败 | unit (Rust) | S |
| [src-tauri/src/commands/usage.rs:60](src-tauri/src/commands/usage.rs:60) `get_usage_by_conversation` 聚合 | 完全没测 | 同 conversation 多 model 时 token 累加错位；`first_message_preview` 三层 COALESCE fallback 顺序换了；soft-deleted conversation 的 `is_deleted` 标志反了 | integration (Rust) | M |
| [src-tauri/src/commands/pin.rs:79](src-tauri/src/commands/pin.rs:79) `reset_all_data` | 完全没测 | DELETE 漏表（新加了表却忘了加进 batch）；attachments / generated-images 目录残留；reset 后 `init_db` 没重建 → 下次启动空数据库 panic | integration (Rust + temp dir) | M |
| [src/lib/preview.ts:215](src/lib/preview.ts:215) `browserPreviewNeedsBootstrap` + `applyPreviewBootstrap` | 完全没测 | `?preview=chat&dataset=empty` 时本该不显示 conversation 列表但显示了；`lang=zh-CN` 选错语言 bundle；welcome screen 需要 providers=0 时显示却带着 provider | unit (vitest, store stub) | M |
| [src/lib/appearance.ts:44](src/lib/appearance.ts:44) `normalizeZoomFactor` / `stepZoomFactor` / `serializeZoomFactor` | 完全没测 | 用户存入 `"1.234567"` 后读出 `1.23` 又 normalize 成 `1.23000000001`，导致 store 持续 dirty 写回；步进越过 MIN/MAX 边界；`NaN` 输入回退路径 | unit (vitest) | XS |
| [src/lib/uiLanguage.ts:17](src/lib/uiLanguage.ts:17) `normalizeUiLanguage` / `resolveUiLanguage` | 完全没测 | 浏览器 `navigator.languages` 为空数组时不返回 `en` 而 throw；`zh-TW` 被错误归类为 `zh-CN` | unit (vitest) | XS |
| [src-tauri/src/commands/chat.rs:434](src-tauri/src/commands/chat.rs:434) `send_message` STOP_FLAG | 完全没测 | 全局 `static STOP_FLAG`：在 conversation A 流式过程中点 stop，conversation B 同时在流的也被切掉；新一次 send 没 reset 导致瞬时取消 | integration (Rust, 模拟两条并发) | L |
| [src-tauri/src/commands/conversation.rs:78](src-tauri/src/commands/conversation.rs:78) `list_conversations` preview 子查询 | 完全没测 | preview 取 `role != 'system'` 最后一条；只有 system 消息时 preview 应为空但 fallback 错；soft-deleted 仍然出现在列表 | integration (Rust) | S |
| [src-tauri/src/attachments.rs:169](src-tauri/src/attachments.rs:169) `extract_pdf_text` 截断 | 完全没测 | PDF 超过 `MAX_PDF_TEXT_CHARS=500_000` 截断标记丢失；按 char 截断在 multi-byte 边界 panic | unit (Rust，小 PDF fixture) | S |
| [src-tauri/src/image_generation.rs:68](src-tauri/src/image_generation.rs:68) `parse_image_response` | 完全没测 | 上游返回 `images[]` 而非 `data[]` 时 fallback 失败；同时含 `b64_json` 和 `url` 时优先级；url 下载失败时整个请求挂 | integration (Rust, mock HTTP) | M |

### P2（低频路径 / 补充覆盖 / 可读性）

| 模块 / 路径 | 缺口 | 能捕获的具体失败模式 | 建议层 | 估算 |
|---|---|---|---|---|
| [src/lib/providerModels.ts:139](src/lib/providerModels.ts:139) `getProviderModelProfiles` / `providerPurposeCounts` | 完全没测 | provider.models 中重复 id；registry 中含 provider.models 里没有的 id（孤儿 profile）；空 purposes 不丢弃 | unit (vitest) | S |
| [src/components/chat/ChatInput.tsx:82](src/components/chat/ChatInput.tsx:82) `pickRecordingMimeType` / `blobToBase64` | 完全没测 | 所有候选 MIME 都不支持时返回 `""` 走 fallback；FileReader.result 不是 string 时正确 reject | unit (vitest, jsdom + mock MediaRecorder) | S |
| [src-tauri/src/db/mod.rs:20](src-tauri/src/db/mod.rs:20) `collect_rows` / `query_optional` helper | 没单独测 | mapper 抛错没 propagate；`QueryReturnedNoRows` 应该返回 `Ok(None)` 不要 Err | unit (Rust) | XS |
| [src-tauri/src/commands/conversation.rs:339](src-tauri/src/commands/conversation.rs:339) `get_message_resend_payload` | 完全没测 | 对 assistant 消息调用应 Err；`raw_content` 为空时 fallback 到 `content`；attachment uploads 回读时 base64 编码错 | integration (Rust) | S |
| [src/lib/i18n.ts:3](src/lib/i18n.ts:3) `useI18n` | 不必要测 | N/A — `t(zh, en)` 极简两元，store 切换覆盖到即可 | N/A | — |

## 3. 用例设计

> 步骤 2 已列缺口与失败模式，本节只说"如何落地"。Rust / TS 分别组织。**测试代码不在本任务范围**，下面只描述意图、文件位置、最小 I/O 与依赖。

### 3.1 Rust unit / integration（内嵌 `#[cfg(test)] mod tests`）

按当前仓库习惯：测试与被测代码同文件，不新增独立 `tests/` 顶层目录（除非要做跨 module 的 integration）。所有测试用 `Connection::open_in_memory()` + `tempfile::TempDir` 临时目录。

- **`src-tauri/src/db/schema.rs`** — 现有 `mod tests` 扩展：
  - `init_db_creates_all_tables_and_indexes_on_fresh_database`：空 connection → `init_db` → 断言 7 张表（conversations / messages / attachments / usage_records / providers / settings / assistants）通过 `SELECT name FROM sqlite_master WHERE type='table'` 都查得到 + 关键 index 存在 + `assistants WHERE is_preset = 1` 计数 = 5（5 个 preset seed）。
  - `init_db_is_idempotent`：连续调两次 `init_db` 不报错、preset 行不重复（ON CONFLICT 应触发 UPDATE 路径，而不是 INSERT 双份）。
- **`src-tauri/src/pin/mod.rs`** — 在文件底部加 `mod tests`：
  - `hash_pin_is_deterministic_lowercase_hex`：固定输入 `"1234"`，断言固定输出（hex 长度 64、全小写）。
  - `verify_pin_accepts_correct_and_rejects_typo`：roundtrip + 错误 PIN。
  - `hash_pin_handles_unicode_and_long_input`：emoji、中文、超长串。
- **`src-tauri/src/commands/config_io.rs`** — `mod tests`：
  - `encrypt_then_decrypt_roundtrip`：随机 plaintext + password → encrypt → decrypt → 等。
  - `decrypt_rejects_wrong_password_with_clear_error`：返回 `"Decryption failed: ..."` 字符串包含。
  - `decrypt_rejects_short_or_bad_magic_or_bad_version`：三个负例分别构造。
  - `export_then_import_roundtrip_in_replace_mode`：注入临时 DB seed 2 provider / 1 assistant / 一些 settings → export → 新 DB import (replace) → SELECT 比对计数与字段值。
  - `export_then_import_merge_preserves_local_only_records`：merge 模式不应删除本地已有 assistant。
  - `import_skips_unexpected_setting_keys`：备份里塞个不在 `EXPORTABLE_SETTINGS` 的 key，断言未写入。
  - `validate_backup_reports_local_config_presence`：先有/先无本地 config 两种情况。
- **`src-tauri/src/attachments.rs`** — `mod tests`：
  - `sanitize_file_name_strips_path_and_reserved_chars`：参数化几组（`"../../etc/passwd"` → `passwd`、`"a:b*c?.txt"` → `a_b_c_.txt`、空串 → `attachment`、纯路径分隔 → `attachment`）。
  - `file_extension_picks_from_name_then_mime_then_fallback`：参数化几组。
  - `classify_attachment_distinguishes_pdf_image_text_other`。
  - `save_upload_writes_to_app_data_dir_with_uuid_name`：用 `TempDir` 当 `app_data_dir`，断言生成路径 `starts_with(temp_dir.path())` 且文件名是 UUID + 扩展名。
  - `save_upload_rejects_empty_and_oversized_payload`：空 + 20MB+1B。
  - `save_upload_extracts_pdf_text_to_sibling_file`：用一个最小合法 PDF fixture（放 `src-tauri/tests/fixtures/minimal.pdf`，几 KB）。
  - `read_text_file_content_truncates_with_marker_above_limit`。
- **`src-tauri/src/commands/conversation.rs`** — `mod tests`（已有 `#[cfg(test)]` 模式参考 chat.rs 即可）：
  - `decode_local_image_uri_rejects_non_localb64_and_invalid_base64`。
  - `delete_generated_images_only_touches_files_inside_generated_root`：在 temp_dir 里放一个 `generated-images/conv/a.png` 和一个 `unrelated/b.png`；构造消息内文混合 `localb64://` 引用两者；断言只删前者。
  - `truncate_from_message_deletes_subsequent_messages_attachments_and_usage`：seed 5 条消息，从第 3 条 truncate → 断言剩 2 条 + attachments / usage 同步删除 + conversations.updated_at 回到第 2 条 created_at。
  - `truncate_handles_same_timestamp_via_rowid_tiebreaker`：两条 created_at 完全相同的消息，truncate 第二条 → 第一条保留。
  - `update_conversation_assistant_rejects_after_sent_user_message`：seed 一条 user msg → update 应返回 Err；system msg 不计入。
  - `delete_conversation_soft_deletes_and_cleans_attachments`：DB `deleted_at` 写入；文件删除；目录 NotFound 静默。
  - `list_conversations_excludes_soft_deleted_and_picks_latest_non_system_preview`。
- **`src-tauri/src/commands/chat.rs`** — 已有 `mod tests`，扩展：
  - `build_system_message_uses_assistant_prompt_when_provided`。
  - `build_system_message_falls_back_to_preset_when_prompt_empty`。
  - `build_system_message_appends_language_instruction`。
  - `build_system_message_returns_none_for_all_defaults`。
  - `message_content_with_attachments_inlines_images_only_for_vision_models`：vision=true → multipart 含 `ChatContentPart::ImageUrl`；vision=false → 全 Text。
  - `message_content_with_attachments_uses_default_prompt_when_content_empty_with_attachments`。
  - `message_content_with_attachments_reads_pdf_sibling_text_file`（用 attachments tests 同款 fixture）。
  - `context_message_limit_parses_setting_with_defaults_and_clamps_zero`。
- **`src-tauri/src/llm/mod.rs`** — `mod tests`：
  - `is_vision_model_recognizes_known_vision_families`：参数化全部 16 个 hint 各举 1 例 + 大小写混合。
  - `is_vision_model_rejects_plain_text_models`：`gpt-3.5-turbo`、`llama-3`、`mistral`、`whisper-1`、`tts-1`、`dall-e-3` 等。
- **`src-tauri/src/image_generation.rs`** — `mod tests`：
  - `parse_img_command_extracts_flags_from_tail`：`/img a cat --ratio 16:9 --quality hd --count 2 --bg transparent` → prompt=`a cat`、各 flag 正确。
  - `parse_img_command_stops_at_first_unknown_flag_pair`：`/img --ratio 16:9 --foo bar a cat` → 把 `--foo bar a cat` 当 prompt。
  - `parse_img_command_rejects_invalid_count_and_ratio_values`：`--count 5`、`--ratio 3:2`。
  - `parse_img_command_handles_slash_img_with_newline_and_bare_command`。
  - `parse_img_command_errors_when_prompt_is_only_flags`：`/img --ratio 16:9` → Err。
  - `detect_provider_identifies_grok_by_host`：`https://api.x.ai/v1` → Grok；其他 → OpenAiCompatible。
  - `map_size_and_map_quality_round_trip_known_inputs`。
- **`src-tauri/src/llm/provider.rs`** + **mock HTTP**（需要新 dev-deps，见 §7）：
  - `stream_chat_emits_content_chunks_in_order_until_done`：mock server 返回标准 SSE，断言 receiver 顺序收到内容片段。
  - `stream_chat_buffers_partial_lines_across_chunks`：把同一行拆到两个 HTTP chunk 里。
  - `stream_chat_propagates_api_error_status_with_body`：HTTP 500。
  - `stream_chat_yields_usage_event_when_present`。
  - `stream_chat_handles_done_terminator`。
- **`src-tauri/src/commands/usage.rs`** — `mod tests`：
  - `get_usage_by_conversation_aggregates_tokens_per_model`：seed 3 usage_records → 断言聚合后 `model_usages` 数量与 token 累加。
  - `get_usage_by_conversation_marks_soft_deleted_conversations`。
  - `get_usage_by_date_counts_distinct_conversations_per_day`。
- **`src-tauri/src/commands/pin.rs`** — `mod tests`：
  - `enable_then_verify_then_disable_pin_roundtrip`。
  - `disable_pin_returns_true_when_no_pin_stored`。
  - `reset_all_data_clears_all_tables_and_reinitializes`：seed 各表 + 临时 app_data_dir 的 attachments/generated-images 子目录 → reset → 全空 + 子目录已删 + schema 仍可写。
- **`src-tauri/src/commands/provider.rs`** — `mod tests`：
  - `create_provider_sets_default_only_for_first_one`。
  - `update_provider_only_writes_provided_fields`。
  - `set_default_provider_unsets_all_others`。
- **`src-tauri/src/commands/assistant.rs`** — `mod tests`：
  - `update_assistant_rejects_preset`。
  - `delete_assistant_rejects_preset_and_nulls_conversation_link`。
  - `duplicate_assistant_preserves_fields_with_copy_suffix`。

### 3.2 前端 unit / integration（vitest + jsdom + RTL）

按"测试在被测代码旁"约定，文件名 `<name>.test.ts(x)` 放同目录。所有 IPC 通过模块级 mock（`vi.mock('../lib/tauri', ...)`）。

- **`src/lib/providerModels.test.ts`**：
  - `inferModelPurposes` 参数化（whisper / tts-1 / dall-e-3 / gpt-image-1 / flux / midjourney / gpt-4o / 普通 chat 模型）。
  - `parseProviderModelRegistry` 对损坏 JSON / null / 数组 / 嵌套对象 / 字符串列表混合返回兼容结果。
  - `normalizeProviderModelProfiles` 去重 + 过滤空 purposes。
  - `getProviderModelsForPurpose` 优先 saved registry → fallback infer。
  - `getProvidersForPurpose` 过滤无 chat model 的 provider。
- **`src/lib/appearance.test.ts`**：纯函数全部参数化。`detectDesktopPlatform` 需要 stub `navigator` 三种值。
- **`src/lib/uiLanguage.test.ts`**：mock `navigator.languages` 三种（空 / zh-TW / en-US）。
- **`src/lib/preview.test.ts`**：mock `window.location.search`，断言 `readBrowserPreviewBootstrap` 返回值；`browserPreviewNeedsBootstrap` 用 table-driven case 覆盖每个 screen × dataset × runtime state 组合；`applyPreviewBootstrap` 副作用通过读 `useAppStore.getState()` 验证。
- **`src/stores/appStore.test.ts`**（最大）：
  - `previewFromContent` / `previewFromMessage` / `updateConversationPreview` 纯函数。
  - `loadProviders` 系列（mock api 返回不同 providers / settings 组合）：
    - 无 stored，选 default；
    - stored 已删，回退 default；
    - 都没 default，选第一个；
    - model 在 active provider 列表里 → 保留；不在 → 回退首个。
  - `loadSpeechSettings`：6 个组合（provider 存在/不存在 × model 存在/不存在 × stored model 空字符串/null）。
  - `loadImageGenConfig`：provider 失效时自动 disable。
  - `addMessage` 触发 `updateConversationPreview` 重排。
- **`src/lib/tauri.test.ts`**：
  - `getImageGenConfig` JSON 坏掉时返回 DEFAULT 不 throw。
  - `isTauri()` false 时 `getSetting` / `setSetting` / `listAssistants` / `getUsageBy*` / `exportConfigData` 等走 preview mock，断言返回值结构。

### 3.3 不在本期范围

- React 组件渲染测试（ChatInput / PinLock / Sidebar）—— 价值密度低于 store + lib，本期不写，但留好基础设施（RTL 已配）以便后续加。
- E2E（Playwright / Tauri WebDriver）—— 见 §5 替换为 contract / smoke 设计。

## 4. Mock、数据与隔离策略

### 真依赖 vs mock 边界

| 依赖 | 策略 | 理由 |
|---|---|---|
| SQLite | **真依赖**（`open_in_memory` 或 temp file） | 项目本身就是 SQLite-native，迁移测试已证明此模式可信；mock rusqlite 会绕过 schema 实际行为 |
| 文件系统 | **真依赖**（`tempfile::TempDir`） | 附件 / 生成图片清理逻辑高度依赖路径前缀检查，mock 会让 traversal 检测变成空操作 |
| HTTP（reqwest） | **mock server**（`wiremock` 或 `mockito` crate，加到 `[dev-dependencies]`） | 不能用真 LLM API：违反步骤 0 安全边界、慢、需要密钥 |
| Tauri AppHandle / State | **手动构造或抽出纯函数** | 现有的 Rust 测试（chat.rs:636）直接调 `save_usage_record(&conn, ...)` 而非 `send_message` 整体；继续这种模式，把可纯化的逻辑下沉成 free function |
| `chrono::Utc::now()` | 不 mock | 当前测试都接受真实时间；如果以后做时序敏感测试再注入 clock |
| 前端 Tauri IPC (`invoke`) | **模块级 mock**（`vi.mock('../lib/tauri')`） | tauri.ts 已经是薄包装；mock 它能让 store / lib 测试不需要 Tauri runtime |
| `navigator` / `window` / `MediaRecorder` | jsdom + 局部 stub | vitest 默认 jsdom env，剩余的 API stub 即可 |

### Fixture

- `src-tauri/tests/fixtures/minimal.pdf` —— 最小合法 PDF，几 KB，供 `extract_pdf_text` 和 `message_content_with_attachments` 用。
- `src-tauri/tests/fixtures/sample.png` —— 1×1 PNG，供附件 image classification 用。
- 前端无文件 fixture，所有数据 inline。

### 测试数据生命周期

- 每个 Rust 测试函数自起一个新 `open_in_memory` connection 调 `init_db`，互不共享。
- 文件系统测试用 `TempDir`，作用域结束自动清。
- 前端 vitest 在每个 test file 开头 `beforeEach(() => useAppStore.setState(initialState, true))` 重置 store；`vi.clearAllMocks()` 清 mock 计数。

### 时区、locale、随机性

- chrono::Utc 在测试断言里不直接比较时间戳字符串；只比较"存进去 = 读出来"或"先写 A 后写 B 时间单调递增"。
- 现有 `now_timestamp()` 精度到秒，已知存在同秒多消息情况（`truncate_conversation_from_message` 用 rowid 兜底），测试明确覆盖。
- vitest 默认 locale 不强制；涉及 locale 的测试单独 stub `navigator.language(s)`。

## 5. Smoke / E2E / 等价测试设计

> Tauri 桌面应用不适合本地批量 E2E（启 desktop / iOS 模拟器都属于"持久副作用 + 慢")。等价替换：

### 替代策略

1. **Public API contract test**（最高价值）：在 Rust 端把每个 `#[tauri::command]` 的"参数 → DB 状态/返回值"作为合同测试覆盖，等同于"前端发的每条 IPC 都能稳定返回正确结果"。§3.1 已覆盖大部分。
2. **前端 store 集成测试**：mock IPC + 触发 store action 序列（如"create_conversation → send_message → addMessage → switch conversation → reload"），等同于"用户连续操作 30 秒"的脚本。在 §3.2 `appStore.test.ts` 里。
3. **Smoke（手动 + 文档化）**：保留人工 smoke 清单，但不自动化。在本仓库 README / RUNBOOK 里维护"上线前 5 分钟手动跑通"清单，不进 PR gate。
4. **未来 E2E（不在本期）**：等以后引入 GitHub Actions 后，再评估 `@playwright/test` 测**浏览器预览模式**（`pnpm dev` + URL `?preview=chat&dataset=demo`）——这是项目里现成的、不依赖 Tauri runtime 的 UI 测试入口。本期不做。

### 7 条核心用户旅程（contract / store integration 形式覆盖）

| 旅程 | 现已被覆盖（设计） | 实施层 |
|---|---|---|
| 首次启动 → 设 PIN → 锁屏 → 解锁 | §3.1 `enable_then_verify_then_disable_pin_roundtrip` + §3.2 `appStore.checkPinStatus` | Rust + 前端 |
| 添加 provider → 选 model → 发首条消息 → 收流式响应 | §3.1 `create_provider_sets_default_only_for_first_one` + `stream_chat_*` + 前端 `loadProviders` | Rust + 前端 |
| 切换 assistant → 发消息（验证 system prompt 拼接） | §3.1 `build_system_message_*` | Rust |
| 上传图片附件 + vision model → 多模态请求构造 | §3.1 `message_content_with_attachments_inlines_images_only_for_vision_models` | Rust |
| `/img` 图片生成 → 写本地图片 → markdown 引用 | §3.1 `parse_img_command_*` + `parse_image_response_*` | Rust |
| 截断历史从某条消息开始 → 级联清理 | §3.1 `truncate_from_message_deletes_subsequent_messages_attachments_and_usage` | Rust |
| 导出 backup → 在新设备/重置后导入 | §3.1 `export_then_import_roundtrip_in_replace_mode` | Rust |

## 6. 待精简 / 删除的测试

扫描范围：`src-tauri/src/` 全部 `#[cfg(test)]` 块（共 3 个测试）+ 前端全部测试目录（0 个）。

**未发现需要删除/重写的测试**。理由：

- 现有 3 个 Rust 测试都聚焦真实迁移场景，断言"数据从 A 状态变到 B 状态"，不是测实现细节；
- 都用 `open_in_memory` + 真 SQL，没 mock 掏空被测对象；
- 没有 skip / only / TODO；
- 都不依赖时间或顺序，hermetic；
- 项目还没引入 flaky 测试的条件（无 CI、无并发跑、无固定端口）。

如果将来按 §3 扩展后出现以下情况，再回头清理：
- 多个 test 重复 seed 相同 schema → 抽 helper（不删，重构）；
- `chat.rs::save_usage_record_repairs_legacy_schema_before_retrying` 与 schema.rs 的迁移测试出现 schema 覆盖重叠 → 保留两者，因为它们测的是不同入口（直接 `init_db` vs `save_usage_record` 的自愈路径）。

## 7. 实施顺序与里程碑

> 沿用 §2 优先级。每个里程碑可独立提 PR。

### 里程碑 M0：测试基础设施落地（前置，1 PR）—— ✅ 已实施

1. ✅ `src-tauri/Cargo.toml` 增 `[dev-dependencies]`：`tempfile`、`wiremock`（最终选 wiremock 而非 mockito：与 reqwest 0.12 / hyper 1 兼容更新）+ `tokio` features = `macros + rt-multi-thread` 给 `#[tokio::test]` 用。
2. ✅ `package.json` devDependencies 增 `vitest@3` + `@testing-library/{react,user-event,jest-dom}` + `jsdom`（选 jsdom 不选 happy-dom：DOM API 兼容性更稳）。
3. ✅ 新增 [vitest.config.ts](vitest.config.ts)：jsdom env / include `src/**/*.test.{ts,tsx}` / clearMocks + restoreMocks / 未启 coverage 工具（按方案不强制阈值）。
4. ✅ `package.json` scripts 加 `"test": "vitest run"` + `"test:watch": "vitest"`。
5. ✅ README "Development" 段后加 "Running tests" 子段。
6. ⏸️ GitHub Actions workflow —— 未做（项目目前无 `.github/`，留待项目负责人）。

**验收**：✅ `cargo test --manifest-path src-tauri/Cargo.toml --lib` = **144 passed; 0 failed**（~9s）；`pnpm test` = **138 passed; 0 failed**（~1s）。

**M0 期间踩到的坑（已修正，记录给未来避免）**：
- 初版 [src/test-setup.ts](src/test-setup.ts) 在 setup 阶段 `import { useAppStore }`，把真实 `lib/tauri` 锁进 worker module cache → 后续测试文件的 `vi.mock("../lib/tauri", ...)` 全部失效。改成 setup 只做 `@testing-library/jest-dom` 注入，store reset 留给具体测试文件。
- 初版 [tsconfig.json](tsconfig.json) `include: ["src"]` 把 `*.test.ts` 也算进 production build → `pnpm build` 时若 devDeps 被裁会失败。加了 `exclude` 排除 test 文件。

### 里程碑 M1：安全 + 数据完整性 P0（2-3 PR）—— ✅ 已实施

按 §2 P0 顺序：
- ✅ M1a：PIN + config_io encrypt/decrypt + sanitize_file_name + decode_local_image_uri
- ✅ M1b：build_system_message + message_content_with_attachments + is_vision_model + parse_img_command
- ✅ M1c：truncate_conversation_from_message + stream_chat SSE + 前端 providerModels + appStore.loadProviders / loadSpeechSettings / previewFrom* + parseProviderModelRegistry

**验收**：✅ 所有 P0 用例通过；本机两条命令都绿；coverage 工具未启用（按方案不强制阈值）。

### 里程碑 M2：业务边界 P1（按需，多 PR）—— ✅ 主要项已实施

按 §2 P1 的顺序拣价值高的做：
- ✅ `reset_all_data` 端到端 + 返回需删 attachments
- ✅ `get_usage_by_conversation` + `get_usage_by_date` 聚合
- ✅ `stream_chat` 错误路径
- ✅ `delete_conversation` + `update_conversation_assistant` cascade / 守卫
- ✅ provider / assistant CRUD 端到端
- ✅ `parse_image_response` 多响应格式
- ⏸️ `send_message` STOP_FLAG 并发回归 —— 加了行为固化测试（标注 known bug），完整测试要等业务重构 per-conv 信号。
- ⏸️ `extract_pdf_text` 截断 —— 截断分支未直接覆盖（只测了错误路径）；要测要引 lopdf 程序化生成 PDF，ROI 不划算。

### 里程碑 M3：补充覆盖 P2（无紧迫性）

文案、helper、UI 杂项。可作为新人 onboarding 任务。

### 通用验收标准

- 每个 PR 自带新测试 + 让 CI 绿。
- 新测试必须 hermetic（`cargo test --lib` 跑完不留任何 `target/` 之外的副产物；vitest 不写本地 fs）。
- 不要为了凑覆盖率写"调用一次然后 assert true"的空测试。

## 8. 明确不做什么

- **不**测 React 组件 visual snapshot。理由：UI 还在 iOS 26 重设计期，每周变；snapshot 会变成纯 churn。
- **不**测 `useI18n` / `useLayoutMode` 这种极薄 hook。理由：直接 reach into store / matchMedia，测它等同于测库。
- **不**做 Playwright / Tauri WebDriver E2E。理由：本地启动 desktop app 属于持久副作用 + 慢；浏览器预览路径的 E2E 留给"接入 CI 后单独立项"。
- **不**对真实 LLM provider 发请求。理由：成本、密钥、不稳定。一律 mock。
- **不**为 `commands/preview.rs::get_preview_bootstrap`（仅读环境变量）写测试。理由：3 行代码、没分支、依赖 env var stubbing 不划算。
- **不**把 `index.css` / `tailwind` 样式纳入测试范围。理由：视觉回归靠人眼 + 截图，工具链成本远高于价值。
- **不**追求统一的 coverage 阈值。理由：项目里有大量"展示组件" + "薄包装"，平均覆盖率无意义，按 §2 表格按风险点逐个攻。
- **不**在本期重构 `appStore.ts` 的 6 层三元（`loadSpeechSettings`）。理由：本任务只读不动业务代码；测试先到位再重构（test-driven cleanup）。

## 9. 待澄清项

| 项 | 关联路径 / 上下文 | 建议询问 / 信息来源 |
|---|---|---|
| PIN 是否计划加 salt + 提高迭代数？ | [src-tauri/src/pin/mod.rs:3](src-tauri/src/pin/mod.rs:3) 当前裸 SHA-256；README "API keys / PIN" 标记 V1 限制。**P0 待澄清安全风险** —— 测试可固化当前行为但不掩盖弱点。 | 项目负责人（看 git blame `pin/mod.rs` 是同一作者）；如果有 V2 路线图 issue 应该写明 |
| API key 明文存 SQLite 是否计划迁 Keychain？ | [src-tauri/src/commands/provider.rs](src-tauri/src/commands/provider.rs)、README. **P0 待澄清安全风险** | 同上 |
| Android target 是否在活跃？ | `src-tauri/gen/android/` 存在但 README 主要讲 iOS；60 天 commit 几乎都是 iOS。如果 Android 不维护，相关路径就不必上 CI matrix。 | 项目负责人 |
| 备份文件 version=1 升级策略？ | [src-tauri/src/commands/config_io.rs:17](src-tauri/src/commands/config_io.rs:17) `FILE_VERSION = 1`，目前只允许相等。未来如果改 schema，要测试旧文件兼容路径。 | 决策未定，先按当前实现测，将来补 V2 解析时再扩 |
| `wiremock` vs `mockito` 选择 | §4 真 vs mock 表。需要小、轻、Rust 主流、与 reqwest 0.12 兼容。 | 在 M0 PR 里选定一个，PR description 给理由 |
| 是否要测 `commands/preview.rs::get_preview_bootstrap` 的 env 读取 | 步骤 0 我标了"不做"，但若以后 preview 路径成为 demo / QA 的核心入口可能要补 | 询问项目负责人当前 preview 用途 |
| iOS native bridge (`keyboard_accessory.m`) 测试 | 不属于 Rust crate，不能用 `cargo test`；属于 iOS 单元测试（XCTest）范畴 | 询问是否有 iOS 测试方案；当前不在本方案范围 |

> 处置：表中除明确标"P0 待澄清安全风险"的两项外，其余作为信息收集项，不阻塞 §7 里程碑。

## 10. 跑测副产物

**首版方案产出时**：未运行任何命令，无副产物（步骤 0 安全边界）。

**实施阶段（用户明确要求"实施并检查"后）**：

| 命令 | 用途 | 副产物路径 |
|---|---|---|
| `pnpm install` | 拉新 devDeps（vitest / RTL / jsdom 等） | `node_modules/`（已存在，新增子包）+ `pnpm-lock.yaml` 更新 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` | 编译 lib + dev-deps（wiremock / tempfile） | `src-tauri/target/`（已存在，增量写入）+ `src-tauri/Cargo.lock` 更新 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 运行 144 个 Rust 测试 | 同上（test 二进制 + 内存运行，无落盘 artifact）|
| `pnpm test` | 运行 138 个前端测试 | 无落盘 artifact |

副产物清理状态：**未主动删除**。`target/` 和 `node_modules/` 都是项目正常开发产物，且都在 `.gitignore` 中。要清理由用户决定（`cargo clean` / `rm -rf node_modules`）。

工作区未跟踪文件（`.claude/`、`src/index.css.tmp`）在任务开始前已存在，全程未触碰。

## 11. Review 修订记录

### 自我 review 通过的四道拷问

1. **风险是否覆盖**？
   - 核心路径：PIN / 备份加密 / 附件 sanitize / 本地图片清理 / system message 构造 / 流式 SSE / 历史截断 / provider 选择链 / preview 引导 / TS 端 stores —— **均在 P0**。
   - 错误路径：错误密码、损坏 backup、unknown img flag、SSE 错误、provider 不存在、preset 守卫 —— **均覆盖**。
   - 回归高发区（60 天 commit ≥4 的文件）：`chat.rs`、`conversation.rs`、`appStore.ts`、`tauri.ts`、`preview.ts`、`schema.rs` —— **全部进 P0 或 P1**。

2. **测试层是否合适**？
   - 纯函数（is_vision_model / parse_img_command / hash_pin / normalize* / inferModelPurposes）→ unit ✓
   - 跨边界（truncate / export-import / stream_chat / loadProviders）→ integration ✓
   - **未出现** 用 e2e 测纯函数 或 用 unit 测跨边界 的错位。
   - **未上 Playwright** —— 在 §5 解释了原因（替换为 contract + store integration）。

3. **mock 与数据是否可信**？
   - DB / FS 用真依赖，符合"测真实存储/路径检查"的现实需求（mock 会让 path-traversal 检测变成空操作）。
   - HTTP 用 mock server 而非 mock reqwest（这样仍会真正经过 TLS / HTTP 解析层）。
   - 前端 IPC mock 只 mock `lib/tauri.ts` 这层（最薄边界），不掏空 store / lib 自身逻辑。
   - **可能漏的**：chrono 时间未注入 → 后续如果引入"3 秒不响应应超时"这种测试，需要加 clock injection；当前测试不涉及。
   - **可能漏的**：reqwest TLS 行为差异；mock server 默认 HTTP，可接受。

4. **是否过度设计 / 为测试而测试**？
   - 复查每条 P0 / P1：删掉是否会让"真实 bug 漏出"？
     - `delete_generated_images_for_messages` 测试删掉 → 路径遍历漏出。**留**。
     - `is_vision_model` 测试删掉 → 新模型族判错。**留**。
     - `assistant_preset_instruction` (P2) 删掉 → 文案漂移没人发现。**保留但 P2**（不阻塞）。
   - `useI18n` / `commands/preview.rs::get_preview_bootstrap` / `index.css` 已明确放进 §8 "不做"，没硬塞进 P2。
   - 没有为了凑 P0 数量虚构缺口；P0 共 14 条都来自真实代码风险点。

### 修订项（自我 review 中发现并已在文中改正）

- 初稿 §3.1 把 `stream_chat` 测试放进 unit，复查后改成 integration（需要 mock HTTP server，跨进程边界）。
- 初稿 §6 试图列"loadSpeechSettings 6 层三元应该重构"——这属于业务改动，挪到 §8 明确"本期不做，先测后重构"。
- 初稿 §2 把 `is_vision_model` 放 P1，复查后上调 P0：它是 `message_content_with_attachments` 的依赖，错了会让 P0 上游测试连带误判，是基础。
- 初稿 §5 没明确说"不上 Playwright" 的理由，补了 Tauri 桌面 E2E 的副作用问题与浏览器预览替代路径。
- 初稿没有处理"PIN salt 缺失"为安全风险，补到 §9 "P0 待澄清安全风险"。

### 未修订项及理由

- §6 "未发现需要删除的测试" 复查仍成立：现有 3 个测试都聚焦真实迁移路径，断言来自真实存储读出比对，无 mock 掏空。
- §10 副产物为空复查仍成立：本任务未运行任何测试 / 构建命令。

### 二次 Review 修订（应用户要求重读后追加）

二次走"反过来挑刺"路径，发现 4 处偏差并已修订：

1. **P0 数量虚高，掺了"UI 显示不好看"级别的项**：
   - `appStore::loadSpeechSettings` 失败模式是"用户重选一下就能恢复"的 UI 错位 → 降到 P1（注释已写入对应行）。
   - `previewFromContent` 系列失败模式是 sidebar 预览出错，不丢数据 → 降到 P1。
   - 修订后 P0 收敛到 **14 条**（去 2 + 加 1），更聚焦"数据完整性 / 安全敏感 / LLM 主路径"。

2. **P0 漏了"全新装用户"的 `init_db` 主路径**：
   - 现有两个测试都从 legacy 表起步，新装用户走的"空 DB → 建 7 表 + index + seed preset"路径完全没测。
   - 新增表/新 index 时漏写一行 `init_db` 就会让全新装用户启动失败 → 已新增 P0 条目 + `init_db_creates_all_tables_and_indexes_on_fresh_database` + `init_db_is_idempotent` 到 §3.1。

3. **§7 M0 步骤 5 硬塞 GitHub Actions 不合适**：
   - 当前仓库没有 `.github/`，假设过强；CI 是项目负责人的决策，方案不应预设。
   - 主线改为"README 记本机命令"，CI workflow 标可选、留待决定。

4. **§2 P2 中 `assistant_preset_instruction` / `language_instruction` 属过度设计**：
   - 5 行 match，写测试只能"固化当前文案"，文案改一次测试也跟着改 → churn 高于价值。
   - 已从 §2 P2 删除（不再单列）。

### 二次 Review 未改但说明

- §2 `send_message` 全局 `STOP_FLAG` 是真 bug（任一对话点 stop 会停所有并发流），但**修需要业务重构**（per-conversation 信号 / token），本任务范围只测试 → 保持 P1 + L 估算，作为"已知 bug 的测试占位"。
- §3.2 `loadSpeechSettings` 案例数原写"6 个组合"——意图是 2×2×… 真值矩阵的抽样，实施时按需收敛即可，不必再改文字。
- §4 `useAppStore.setState(initialState, true)` 这种 API 写法在 zustand v5 上会丢 actions，**这是实施细节**：§4 描述意图为"重置 store 到 initial state"已足够，具体实现（保留 actions 的 reset helper）见实施时的 `src/test-setup.ts`。

## 12. 实施总账（追加于实施完成后）

> 本节描述方案产出后**实际写下并跑通**的测试。`cargo test --manifest-path src-tauri/Cargo.toml --lib` = **144 passed; 0 failed**；`pnpm test` = **138 passed; 0 failed**。总计 **282 测试，全绿**。

### Rust 测试分布（144 个）

| 文件 | 测试数 | 覆盖的 §2 缺口 |
|---|---|---|
| [src-tauri/src/db/schema.rs](src-tauri/src/db/schema.rs) | 4 | init_db 全新 DB + 幂等（P0）+ 既有 2 个迁移自愈 |
| [src-tauri/src/pin/mod.rs](src-tauri/src/pin/mod.rs) | 5 | hash_pin / verify_pin（P0 安全核心）|
| [src-tauri/src/attachments.rs](src-tauri/src/attachments.rs) | 13 | sanitize_file_name 路径遍历 / save_upload 边界 / read_text_file 截断（P0/P1）+ extract_pdf_text 错误路径 |
| [src-tauri/src/llm/mod.rs](src-tauri/src/llm/mod.rs) | 3 | is_vision_model 16 族识别（P0）|
| [src-tauri/src/llm/provider.rs](src-tauri/src/llm/provider.rs) | 6 | stream_chat SSE wiremock 集成（P0）|
| [src-tauri/src/image_generation.rs](src-tauri/src/image_generation.rs) | 18 | parse_img_command 11 case（P0）+ detect_provider / map_size / map_quality + parse_image_response 7 case（P1）|
| [src-tauri/src/commands/chat.rs](src-tauri/src/commands/chat.rs) | 13 | build_system_message / message_content_with_attachments / context_message_limit（P0）+ save_usage_record 自愈 + STOP_FLAG 行为固化 |
| [src-tauri/src/commands/config_io.rs](src-tauri/src/commands/config_io.rs) | 8 | encrypt/decrypt roundtrip + AEAD 防篡改 + magic/version header（P0 安全核心）|
| [src-tauri/src/commands/conversation.rs](src-tauri/src/commands/conversation.rs) | 27 | decode_local_image_uri + delete_generated_images path-traversal 守卫（P0）+ truncate cascade + list_visible + update/delete conv + get_message_resend_payload（P1/P2）|
| [src-tauri/src/commands/provider.rs](src-tauri/src/commands/provider.rs) | 7 | CRUD + first-default-only + set_default 单一不变式（P1）|
| [src-tauri/src/commands/assistant.rs](src-tauri/src/commands/assistant.rs) | 9 | CRUD + preset 守卫 + duplicate + 删除时 NULL 化关联（P1）|
| [src-tauri/src/commands/pin.rs](src-tauri/src/commands/pin.rs) | 8 | enable/verify/disable 生命周期 + reset_all_data 6 表清空 + 5 preset reseed（P1）|
| [src-tauri/src/commands/usage.rs](src-tauri/src/commands/usage.rs) | 9 | get_usage_by_conversation 聚合 + get_usage_by_date 分组（P1）|
| [src-tauri/src/commands/settings.rs](src-tauri/src/commands/settings.rs) | 5 | get/set roundtrip + 空字符串透传 + key 独立性 |

### 前端测试分布（138 个，6 个文件）

| 文件 | 测试数 | 覆盖 |
|---|---|---|
| [src/lib/appearance.test.ts](src/lib/appearance.test.ts) | 18 | normalize / step / serialize / format / resolve 全分支 + idempotence（P1）|
| [src/lib/uiLanguage.test.ts](src/lib/uiLanguage.test.ts) | 15 | normalize/resolve + navigator.language mock（P1）|
| [src/lib/providerModels.test.ts](src/lib/providerModels.test.ts) | 39 | inferModelPurposes / parseProviderModelRegistry / getProviderModelsForPurpose / providerPurposeCounts 全 API（P0）|
| [src/lib/preview.test.ts](src/lib/preview.test.ts) | 31 | readBrowserPreviewBootstrap / browserPreviewNeedsBootstrap 13 屏×状态矩阵 / applyPreviewBootstrap 副作用 / previewSettingValue（P1）|
| [src/stores/appStore.test.ts](src/stores/appStore.test.ts) | 14 | previewFromContent / previewFromMessage / updateConversationPreview 纯函数（P1）|
| [src/stores/appStore.actions.test.ts](src/stores/appStore.actions.test.ts) | 21 | loadProviders 选择链 / loadImageGenConfig 失效守卫 / loadSpeechSettings 6 层 fallback（P0/P1）|

### 实施过程中做的微 refactor

为可测性所做、行为完全等价的最小重构（都是命令薄包装 + 抽出 `_db(conn, ...)` 内部 fn）：

| 文件 | 抽出的内部 fn | 命令保留的责任 |
|---|---|---|
| [conversation.rs](src-tauri/src/commands/conversation.rs) | `query_visible_conversations` / `truncate_db_cascade` / `delete_conversation_db` / `update_conversation_assistant_db` / `get_message_resend_payload_db` / `delete_generated_images_in_root` | `AppHandle` 端 fs 清理 |
| [provider.rs](src-tauri/src/commands/provider.rs) | 5 个 `*_db` helper（list/create/update/delete/set_default）| `db.lock()` |
| [assistant.rs](src-tauri/src/commands/assistant.rs) | 5 个 `*_db` helper | `db.lock()` |
| [pin.rs](src-tauri/src/commands/pin.rs) | 6 个 helper + `reset_all_data_db` 返回 attachments | fs cleanup + `app_data_dir` 子目录删除 |
| [usage.rs](src-tauri/src/commands/usage.rs) | `get_usage_by_conversation_db` + `get_usage_by_date_db` | `init_db(conn)` 守护 |
| [settings.rs](src-tauri/src/commands/settings.rs) | `get_setting_db` / `set_setting_db` | `db.lock()` |

为可测性给两个数据结构加 `#[derive(Debug)]`（让 `expect_err` 编译过）：`TruncateCascade`（conversation.rs）、`ImageGenerationResult` + `GeneratedImage`（image_generation.rs）。

为可测性 export 的前端纯 helper：`previewFromContent` / `previewFromMessage` / `updateConversationPreview`（[appStore.ts](src/stores/appStore.ts)）。

### 仍未做（且不打算做）

- **`send_message` STOP_FLAG 完整并发场景**：要测真正"两个并发对话各自 stop 互不影响"，需要业务先把全局 AtomicBool 改成 per-conversation map。本期加了一个行为固化测试（chat.rs::stop_flag_current_behavior_is_global_and_reset_on_each_send）作为"重构 anchor"。
- **`extract_pdf_text` 500K 字符截断分支**：要触发需要程序化生成合法 PDF（加 `lopdf` dev-dep），ROI < 引入 dep 的成本。已测错误路径 3 case 守住"非 PDF 输入不 panic"。
- **`commands/preview.rs::get_preview_bootstrap` env var 读取**：3 行代码、无分支，明确放进 §8 "不做"。
- **`commands/{stt,tts}.rs` 实际调外部 API**：需要 multipart 上传 wiremock，体量中等价值低（薄包装），未做。

### 累计交付汇总

- **方案文档**：[2026-05-17-test-coverage-plan.md](2026-05-17-test-coverage-plan.md)（本文档，11 章节 + §12 实施总账）
- **配置文件**：[Cargo.toml](src-tauri/Cargo.toml) + [package.json](package.json) + [vitest.config.ts](vitest.config.ts) + [tsconfig.json](tsconfig.json) + [test-setup.ts](src/test-setup.ts)
- **README**：加了 "Running tests" 段
- **Rust 测试**：14 个文件 / **144 测试**
- **前端测试**：6 个文件 / **138 测试**
- **微 refactor**：6 个命令文件抽出 DB-only helper；2 个数据结构加 Debug；3 个前端 helper export

总用时：跨数轮迭代逐步落地，每轮 PR 都跑了全套测试验证（cargo test + pnpm test）+ 修复发现的 fail 后再提交。
