# 对话内生图设计（轻量版）

> **Status:** Revised Draft v2
> **Updated:** 2026-03-24
> **Related:** `docs/design-multimedia-messages.md`

## 1. 目标

在现有聊天体验中增加生图能力，但保持 Private Talk 的定位不变：

- 它仍然是一个本地优先、私密、安全的聊天工具
- 生图是对话能力的扩展，不是一个独立的设计平台
- 新能力必须尽量复用已有的附件、多模态消息、设置、消息渲染和本地存储能力

这份文档只定义一个”足够好、足够稳、足够轻”的方案，不追求一次把所有生图平台能力都抽象完。

## 2. 设计原则

### 2.1 轻量优先

能复用现有模块，就不新增表、路由、状态机和抽象层。

### 2.2 显式优先于魔法

自动路由可以做，但不能是唯一入口。用户必须始终有一个稳定、可预期的显式生图入口。

### 2.3 本地优先

生成结果必须落本地，消息历史必须能脱离远端继续查看。

### 2.4 安全默认值

默认不上传无关历史图片，不做“猜测式”引用，不做隐式多图拼接。

### 2.5 先统一最小能力，再谈厂商特性

V1 只做最小公共能力：`prompt`、比例、数量、透明背景、参考图。
风格枚举、负向提示、厂商私有参数全部延后。

## 3. 范围

### 3.1 V1 必做

- 在聊天里生成图片
- 允许”文本模型”和”生图模型”分别配置
- 生成结果作为普通图片附件插入消息流
- 支持最多 4 张图
- 支持当前消息附件作为参考图（仅限 `/images/edits` 端点支持的模型）
- 所有结果保存在本地附件目录

### 3.2 V1 可选增强

- 文本模型通过 tool calling 自动触发生图
- 简单的生成进度提示
- “重新生成”按钮
- `last_image` 参考图策略（取最近一张生成图做编辑）

### 3.3 V1 明确不做

- 独立 Gallery 页面
- 收藏、文件夹、检索、跳转会话
- 图片模板库
- ImageBox 全量迁移
- Provider 能力自动探测
- `generated_image` 新附件类型
- `tool_calls` / `generated_images` / `image_templates` 等新表
- 价格、模型生命周期、厂商 API 细表维护

## 4. 现有基础能力

当前项目已经具备以下前提，V1 必须直接复用：

- `src-tauri/src/attachments.rs`
  - 已支持图片附件准备、复制、压缩、本地落盘、读取 base64
  - `Attachment` struct 已有 `metadata: Option<serde_json::Value>` 字段
  - `get_attachments_for_messages()` 已能读取 metadata
  - **但** `save_attachment()` 的 INSERT 语句没有写入 metadata 列（始终为 NULL）
- `src-tauri/src/llm/types.rs`
  - 已支持 `ChatContent::Multipart`，可以把文字和图片一起送给模型
  - `ChatRequest` 目前没有 `tools` 字段（Phase 2 自动路由时需要扩展）
- `src-tauri/src/commands/chat.rs`
  - 已支持把 **用户消息** 中的图片附件注入到多模态消息里
  - **但** assistant 消息保存时没有附件写入逻辑 — 需要新增
- `src/components/chat/MessageItem.tsx`
  - 已支持渲染图片附件
- `settings` 表
  - 已可存任意 JSON 配置
- `providers` 表
  - 已可复用 base URL、API key、模型配置
- `src-tauri/src/llm/provider.rs`
  - URL 拼接规则：`format!(“{}/chat/completions”, base_url.trim_end_matches('/'))`
  - 生图 API 需要换路径为 `/images/generations`，可复用同一 `base_url`

**关于模型列表过滤：**

前端 `src/lib/providerPresets.ts` 的 `excludeNonChatModels()` 会过滤包含 `image`、`imagen`、`video` 等关键字的模型名。这是前端逻辑，不影响后端。因此 V1 中”生图模型”应当作为 **单独设置项** 手填，不依赖聊天模型下拉列表。

## 5. 用户体验

### 5.1 显式入口是主路径

V1 必须提供一个稳定入口，推荐二选一：

- `/img` 前缀
- 输入框中的”生图”按钮，点击后等价于插入 `/img`

示例：

```text
/img 一只戴墨镜的橘猫，赛博朋克风格，16:9
```

优点：

- 不依赖当前文本模型是否支持 tool calling
- 不需要额外的”规划”模型调用
- 失败路径清晰，可调试性强
- 用户知道这一条消息会触发生图

### 5.2 `/img` 参数解析规则

`/img` 后面的文本整体视为 prompt，同时支持可选的结构化参数：

```text
/img <prompt> [--ratio 16:9] [--quality hd] [--count 2] [--bg transparent]
```

解析规则：

1. 从消息末尾提取 `--key value` 形式的参数，剩余部分为 prompt
2. 如果没有任何 `--` 参数，整段文本就是 prompt（使用默认值）
3. prompt 原样发送给生图 API（不做翻译或扩写）

示例：

| 用户输入 | 解析结果 |
|---------|---------|
| `/img a cyberpunk cat` | prompt=”a cyberpunk cat”, 其余取默认 |
| `/img 橘猫 --ratio 16:9 --quality hd` | prompt=”橘猫”, ratio=16:9, quality=hd |
| `/img logo design --bg transparent --count 2` | prompt=”logo design”, bg=transparent, count=2 |

**支持的参数：**

| 参数 | 简写 | 值 | 默认 |
|-----|------|---|------|
| `--ratio` | `-r` | `1:1`, `16:9`, `9:16`, `4:3`, `3:4` | 取设置中的默认值 |
| `--quality` | `-q` | `standard`, `hd` | `standard` |
| `--count` | `-n` | `1`-`4` | `1` |
| `--bg` | | `auto`, `transparent`, `opaque` | `auto` |

当用户附带了图片附件时，自动视为参考图（`reference_policy = current_uploads`）。

### 5.3 自动路由是可选增强，不是唯一入口

当且仅当以下条件同时满足时，才允许自动 tool calling：

- 用户开启”自动生图路由”
- 已配置独立生图 provider + model
- 当前消息不以 `/img` 开头

自动路由失败时，不应让整个对话卡住；应当退回普通文本响应，或提示用户使用 `/img`。

### 5.4 不引入”图片模式页”

用户仍然停留在当前会话里：

1. 输入提示词或带参考图发送
2. 等待生成
3. 结果以 assistant 消息中的图片附件展示
4. 如需继续修改，继续在同一会话里发下一条

## 6. 配置模型

新增一个设置项，存入 `settings` 表（key = `image_gen_config`）：

```json
{
  “enabled”: true,
  “provider_id”: “provider-uuid”,
  “model”: “gpt-image-1”,
  “api_mode”: “openai-images”,
  “allow_auto_tool_call”: false,
  “max_images_per_request”: 4,
  “default_aspect_ratio”: “1:1”,
  “default_quality”: “standard”
}
```

字段说明：

- `enabled` — 总开关，默认关闭
- `provider_id` — 复用现有 provider 的 `base_url` / `api_key`
- `model` — 生图模型名，允许手填（因为前端模型列表会过滤掉 image 类模型）
- `api_mode` — V1 固定支持 `openai-images`
- `allow_auto_tool_call` — 是否允许文本模型自动触发生图（Phase 2）
- `max_images_per_request` — 全局硬限制，默认 `4`
- `default_aspect_ratio` — 用户未指定比例时的默认值
- `default_quality` — 用户未指定质量时的默认值

### 为什么 V1 只支持 `openai-images`

当前 provider 体系本质上是 `openai-compatible`，生图 API 只需要把现有 `base_url` 的路径从 `/chat/completions` 换成 `/images/generations`，鉴权方式完全一样。

如果 V1 一开始就把 Gemini 原生接口（完全不同的请求格式和鉴权方式）、Ark 特殊格式、GRSAI 私有接口都接进来，意味着需要新增多个 provider adapter，这和”轻量”目标冲突。

因此：

- **V1：只支持 OpenAI Images 兼容接口**（覆盖 OpenAI 官方、兼容 OpenAI 格式的第三方如 Azure、OpenRouter 等）
- **Phase 2/3：再按真实需求增加 Gemini 等厂商适配器**

## 7. 数据模型

### 7.1 不新增附件类型

生成图片仍然使用现有 `attachments.file_type = 'image'`。

原因：

- 前端现有渲染逻辑已经能展示 `image`
- 删除消息时，现有附件清理逻辑已经能工作
- 没必要引入 `generated_image` 这种只会制造分支判断的新类型

**注意：** `attachments` 表有 CHECK 约束 `file_type IN ('image', 'text_file', 'audio')`，`'image'` 已在其中，无需修改 schema。

### 7.2 使用 `attachments.metadata` 记录生成信息

建议在已有 `metadata` 字段中写入最小必要信息：

```json
{
  “source”: “generated”,
  “generation”: {
    “provider_id”: “provider-uuid”,
    “model”: “gpt-image-1”,
    “prompt”: “a cyberpunk orange cat wearing sunglasses”,
    “revised_prompt”: null,
    “aspect_ratio”: “16:9”,
    “quality”: “hd”,
    “count”: 1,
    “background”: “auto”
  }
}
```

这已经足够支持：

- UI 上显示”AI 生成”标记
- 将来做”重新生成”
- 故障排查

V1 不需要单独的 `generated_images` 表。

### 7.3 需要的后端改动

**问题 1：`save_attachment()` 不写入 metadata**

当前 INSERT 语句只有 8 个字段，没有 metadata。需要新增一个函数：

```rust
pub fn save_generated_attachment(
    conn: &Connection,
    file_path: &str,
    file_name: &str,
    mime_type: &str,
    file_size: i64,
    message_id: &str,
    metadata: serde_json::Value,
) -> Result<Attachment, String>
```

这个函数执行 INSERT 时包含 metadata 列。不修改现有 `save_attachment()`，避免影响已有流程。

**问题 2：assistant 消息目前不支持附件**

当前 `send_message()` 中，只有 user 消息会调用 `save_attachment()`（chat.rs:85-87）。assistant 消息保存时（chat.rs:253-257）只存文本。

生图结果需要挂在 assistant 消息下，因此需要在 assistant 消息保存后，调用 `save_generated_attachment()` 关联生成的图片。

**不需要数据库迁移。**

## 8. 统一参数模型

V1 的统一参数应当刻意收窄：

```rust
pub struct ImageGenerationRequest {
    pub prompt: String,
    pub aspect_ratio: Option<String>,   // 1:1, 16:9, 9:16, 4:3, 3:4
    pub quality: Option<String>,        // standard | hd
    pub count: Option<u8>,              // 1..=4
    pub background: Option<String>,     // auto | transparent | opaque
    pub reference_images: Vec<(Vec<u8>, String)>, // (bytes, mime_type) - 已解析的参考图
}
```

### 为什么不保留大而全的字段集

- `style` — V1 直接并入 `prompt`，不做大枚举
- `negative_prompt` — 并非所有 provider 都支持，V1 不做一等字段
- 像素级 `width` / `height` — 不同模型支持集不一致，V1 只收比例
- `reference_policy` / `reference_context` — 在请求构造前就已经解析为具体图片数据，不需要传策略字符串

### 参考图处理

V1 的参考图在进入 `ImageGenerationRequest` 之前就已经确定：

1. **显式 `/img`** — 如果当前消息带了图片附件，直接读取作为参考图
2. **自动 tool calling（Phase 2）** — 由文本模型判断是否需要参考图，后端从最近消息中查找

V1 不做”从历史里猜最相关的一张图”。

### 参考图与 API 端点的关系

**重要：** OpenAI 的文生图和图编辑是两个不同端点：

| 场景 | API 端点 | 请求格式 |
|------|---------|---------|
| 纯文生图 | `POST /images/generations` | JSON body |
| 带参考图编辑 | `POST /images/edits` | **multipart/form-data** |

V1 必须同时支持这两个端点。当 `reference_images` 非空时，走 `/images/edits`。

## 9. 自动 Tool Calling 设计（Phase 2）

### 9.1 定位

自动 tool calling 只是增强项，用来让自然语言更顺手；它不是底层唯一协议。

### 9.2 为什么不能直接做流式 tool call 解析

旧文档设计了完整的：

- tool call delta 累积
- tool result continuation
- tool-call-start / progress / done / error 事件

这套机制太重，且和当前代码差距很大。当前 `stream_chat()` 只处理文本 delta，不处理 tool delta。

V1 更务实的做法是：

1. 保留当前普通聊天的流式实现不变
2. 仅在“明显可能是生图请求”时，走一次非流式规划调用
3. 由文本模型返回 `generate_image` 参数
4. 后端直接调用生图模型
5. 生成完成后插入最终 assistant 消息

这样做的好处：

- 不需要重写现有 SSE 解析器
- 不需要在前端维护复杂的 tool call 生命周期
- 图片生成本身就慢，规划这一步非流式带来的体验损失可接受

### 9.3 触发条件

自动规划只在满足以下条件时触发：

- `allow_auto_tool_call = true`
- 当前消息不以 `/img` 开头
- 用户语义明显是“生成/画/设计/改图”
- 已配置生图 provider

否则直接走现有聊天流。

### 9.4 精简后的 tool schema

```json
{
  "type": "function",
  "function": {
    "name": "generate_image",
    "description": "Generate an image based on a text description. Call this when the user asks to create, draw, paint, or generate an image.",
    "parameters": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Detailed English description of the desired image. Translate and expand if user writes in other languages."
        },
        "aspect_ratio": {
          "type": "string",
          "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"],
          "description": "Image aspect ratio. Infer from context: landscape/横版→16:9, portrait/竖版→9:16, square/方形→1:1."
        },
        "quality": {
          "type": "string",
          "enum": ["standard", "hd"],
          "description": "Use 'hd' when user asks for high quality/高清/精细."
        },
        "count": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4,
          "description": "Number of images. Default 1, only increase if user explicitly asks."
        },
        "background": {
          "type": "string",
          "enum": ["auto", "transparent", "opaque"],
          "description": "Use 'transparent' for logos, stickers, cutouts."
        },
        "use_reference": {
          "type": "boolean",
          "description": "Set true if user wants to edit/modify the most recent image in conversation."
        }
      },
      "required": ["prompt"]
    }
  }
}
```

说明：

- 故意不放长风格枚举，不放负向提示，不放厂商私有字段
- `use_reference` 替代了模糊的 `reference_context`，后端收到 `true` 时自动取最近图片
- `prompt` 的 description 指导 LLM 做翻译和扩写

## 10. 后端方案

### 10.1 新增一个最小 `image_gen` 模块

**新文件：** `src-tauri/src/image_gen.rs`（或 `src-tauri/src/image_gen/mod.rs`）

职责只有 3 件事：

1. 把 `ImageGenerationRequest` 映射成 OpenAI Images API 请求
2. 执行 HTTP 请求并解析结果
3. 把返回的图片保存为本地文件

V1 不需要 provider trait 抽象，不需要 adapter 模式。一个模块，一种 API 格式。

### 10.2 OpenAI Images API 映射

**文生图 (`POST {base_url}/images/generations`)：**

```json
{
  “model”: “gpt-image-1”,
  “prompt”: “...”,
  “n”: 1,
  “size”: “1536x1024”,
  “quality”: “high”,
  “background”: “auto”,
  “output_format”: “png”
}
```

**aspect_ratio → size 映射：**

| aspect_ratio | gpt-image-1 size | dall-e-3 size |
|:---:|:---:|:---:|
| 1:1 | 1024x1024 | 1024x1024 |
| 16:9 | 1536x1024 | 1792x1024 |
| 9:16 | 1024x1536 | 1024x1792 |
| 4:3 | 1024x1024 (fallback) | 1024x1024 (fallback) |
| 3:4 | 1024x1024 (fallback) | 1024x1024 (fallback) |

**quality 映射：**

| 统一值 | gpt-image-1 | dall-e-3 |
|:---:|:---:|:---:|
| standard | medium | standard |
| hd | high | hd |

**图编辑 (`POST {base_url}/images/edits`)：**

当有参考图时，使用 multipart/form-data：

```
model: gpt-image-1
prompt: “transform to watercolor style”
image: <binary file>
n: 1
size: 1024x1024
```

**响应处理：**

```json
{
  “data”: [
    { “b64_json”: “<base64>”, “revised_prompt”: “...” },
    { “url”: “https://...” }
  ]
}
```

- 如果返回 `b64_json`，直接 decode 保存
- 如果返回 `url`，下载后保存
- 始终优先请求 `b64_json`（`”output_format”: “png”`），减少一次网络请求

### 10.3 生成流程

**在 `send_message()` 中拦截 `/img` 前缀：**

```rust
// 在 send_message() 的 user message 保存之后、stream_chat() 之前
if content.starts_with(“/img “) || content.starts_with(“/img\n”) {
    return handle_image_generation(app, db, conversation_id, content, user_msg_id, prepared_attachments).await;
}
// 否则走现有聊天流
```

**`handle_image_generation()` 流程：**

1. 解析 `/img` 后面的文本和 `--key value` 参数 → `ImageGenerationRequest`
2. 读取 `image_gen_config` 设置 → provider_id, model, defaults
3. 加载 provider 的 base_url 和 api_key
4. 如果有图片附件，读取为 bytes（复用 `read_image_as_base64`）
5. 发出进度事件 `image-gen-status: { phase: “generating” }`
6. 调用 OpenAI Images API
7. 将返回的图片逐张保存到 attachments 目录
8. 创建 assistant 消息（固定文案）
9. 对每张图片调用 `save_generated_attachment()` 关联到 assistant 消息
10. 发出 `chat-stream-done` 事件（复用现有前端监听逻辑）

**assistant 文案建议（双语）：**

- 无参考图：`已生成 {n} 张图片。` / `Generated {n} image(s).`
- 有参考图：`已基于参考图生成 {n} 张图片。` / `Generated {n} image(s) from reference.`

V1 不做”生图完成后继续回到文本模型生成评论”。这是有意简化 — 少一次远端调用，少一层 tool result continuation 逻辑。

### 10.4 超时与并发

- 图片生成通常需要 10-60 秒，设置超时为 **120 秒**
- 生成期间 `isStreaming` 为 true，前端禁止发送新消息（复用现有逻辑）
- 如果用户点击”停止”（现有 `stop_generation` command），取消 HTTP 请求

## 11. 前端方案

### 11.1 设置页

在现有 Settings 页面新增一个 section：

- 启用生图（toggle）
- 生图 Provider（从现有 provider 列表选）
- 生图 Model（手填输入框，可提供常见模型名建议）
- 默认比例（下拉）
- 默认质量（下拉）

Phase 2 再加”是否允许自动 tool calling” toggle。

不做 provider capability 标签系统，不做自动探测。

### 11.2 输入框

V1 支持两种等价方式：

- 直接输入 `/img prompt --ratio 16:9`
- 点击”生图”按钮 → 自动在输入框头部插入 `/img ` 前缀

按钮位置建议：附件按钮旁边，小图标即可。

### 11.3 消息渲染

继续复用现有图片附件渲染。

可做的最小增强：

- 若 `attachment.metadata?.source === “generated”`，在图片角落显示一个小 badge：`AI`
- 多张图时，以网格排列（2 列）而非纵向堆叠

除此之外不需要新增专门的 generated image 组件。

### 11.4 进度提示

V1 只需要一个简化事件：

```ts
type ImageGenStatusPayload = {
  conversation_id: string;
  phase: “generating” | “saving” | “done” | “failed”;
  message?: string;
};
```

前端监听 `image-gen-status` 事件，在消息列表底部显示一条临时状态：

- `generating` → 显示 spinner + “正在生成图片...”
- `saving` → “正在保存...”
- `done` → 清除状态（图片已通过 `chat-stream-done` 展示）
- `failed` → 显示错误信息

不需要 `tool-call-start/progress/done/error` 四套事件。

### 11.5 前端类型扩展

`src/lib/types.ts` 中 `Attachment` 的 `metadata` 已经是 `Record<string, unknown>` 类型，无需修改。前端只需判断 `metadata?.source === “generated”` 即可。

## 12. 隐私与安全

这是这个功能的硬约束。

### 12.1 默认关闭

用户未配置生图 provider 之前，不注入任何生图工具，不走任何自动路由。

### 12.2 最小上传原则

只上传：

- 当前 prompt
- 当前消息显式附带的参考图
- 或当前会话最近一张图片

不上传无关历史内容。

### 12.3 本地落盘

无论 provider 返回 URL 还是 base64，最终都要转为本地附件文件。

### 12.4 最小元数据

`attachments.metadata` 只记录调试和复现需要的字段，不存：

- 原始 base64
- provider 响应全文
- API key

## 13. 分阶段实施

### Phase 1：最小可用版

**后端：**
- [ ] 新增 `image_gen` 模块（单文件即可）
- [ ] 实现 OpenAI Images API 调用（`/images/generations` + `/images/edits`）
- [ ] 实现 `/img` 前缀解析和参数提取
- [ ] 新增 `save_generated_attachment()` 函数（支持 metadata 写入）
- [ ] 在 `send_message()` 中拦截 `/img` 前缀，走生图分支
- [ ] assistant 消息支持附件关联
- [ ] 新增 `image_gen_config` 设置读写 command
- [ ] 发出 `image-gen-status` 进度事件

**前端：**
- [ ] Settings 页面新增生图配置 section
- [ ] ChatInput 识别 `/img` 前缀（可选：生图按钮）
- [ ] 监听 `image-gen-status` 事件，显示生成进度
- [ ] 图片附件渲染支持 `metadata.source === “generated”` badge

**不需要：**
- 数据库迁移
- 新的附件类型
- 新的 Tauri 事件类型（复用 `chat-stream-done`）
- 修改现有 `stream_chat()` 逻辑

### Phase 2：自动增强

- [ ] `ChatRequest` 新增 `tools` 字段
- [ ] 实现非流式 tool calling 规划调用
- [ ] 设置中增加 `allow_auto_tool_call` toggle
- [ ] 回退逻辑：tool calling 失败时走普通文本
- [ ] “重新生成”按钮（从 metadata 中恢复参数）

### Phase 3：按需扩展

- 如确有真实用户需求，再增加 Gemini 原生 / Ark / 其他私有接口适配
- 如确有真实使用压力，再评估模板、图库、收藏等能力

## 14. 改动清单（Phase 1）

| 文件 | 改动 | 类型 |
|------|------|------|
| `src-tauri/src/image_gen.rs` | 新文件：OpenAI Images API 调用 + 参数映射 | 新增 |
| `src-tauri/src/attachments.rs` | 新增 `save_generated_attachment()` | 小改 |
| `src-tauri/src/commands/chat.rs` | 拦截 `/img` 前缀，调用生图分支 | 中改 |
| `src-tauri/src/commands/image_gen.rs` | 新文件：Tauri command 入口 | 新增 |
| `src-tauri/src/commands/mod.rs` | 导出新 command | 小改 |
| `src-tauri/src/lib.rs` | 注册新 command 到 `invoke_handler!` | 小改 |
| `src/components/settings/SettingsPage.tsx` | 新增生图配置 section | 中改 |
| `src/components/chat/ChatInput.tsx` | 可选：生图按钮 | 小改 |
| `src/components/chat/ChatView.tsx` | 监听 `image-gen-status` 事件 | 小改 |
| `src/components/chat/MessageItem.tsx` | AI 生成 badge + 多图网格 | 小改 |
| `src/lib/tauri.ts` | 新增 `getImageGenConfig` / `setImageGenConfig` wrapper | 小改 |

## 15. 最终结论

这个功能最重要的不是”支持多少 provider”和”抽象得多完整”，而是：

- 用户能在当前会话里稳定生图
- 结果会安全地保存在本地
- 不因为一个增强功能把现有聊天链路搞复杂

因此，最优方案不是”大而全的多模型平台设计”，而是：

- **显式 `/img` 生图为主**
- **自动 function calling 为辅（Phase 2）**
- **复用现有附件和消息体系**
- **V1 只支持 OpenAI Images 兼容接口**

这才符合 Private Talk 的产品边界和工程现实。
