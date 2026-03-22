# 多媒体消息支持设计方案

## 设计原则

**轻量优先**：Private-Talk 是一个桌面聊天客户端，不是文件处理工具。多媒体支持的目标是让对话更自然，而不是成为万能文件解析器。

核心判断标准：**如果某个功能需要引入 >1MB 的新依赖或 sidecar 二进制，就应该重新审视是否值得**。

---

## 支持范围

### 支持

| 类型 | 说明 | 实现成本 |
|------|------|---------|
| **图片** | 粘贴/拖拽/选择图片，发送给 LLM 和 Agent | 核心功能，优先级最高 |
| **纯文本类文件** | .md, .txt, .json, .yaml, .csv, .py, .rs, .js, .ts 等 | `std::fs::read_to_string`，零额外依赖 |
| **语音输入** | 录音 → 云端 STT → 转为文本发送 | 复用现有 `reqwest`，零额外依赖 |

### 不支持（刻意排除）

| 类型 | 排除原因 |
|------|---------|
| **PDF** | 本地渲染为图片需要 `pdfium` sidecar（~20MB）或 `mupdf`（AGPL 协议不兼容）。文本提取质量也参差不齐。不符合轻量原则。 |
| **Office 文档** | .docx/.xlsx/.pptx 解析库重且不成熟，完全超出聊天客户端的职责。 |
| **视频** | 超大体积，LLM 支持有限，不在 scope 内。 |
| **本地离线 STT** | `whisper-rs` 增加 ~2-5MB 二进制 + 31MB+ 模型文件。作为可选的 Phase 2 扩展考虑。 |

> **关于 PDF**：用户如果需要讨论 PDF 内容，可以自行截图后以图片形式发送。这保持了应用的轻量性，同时通过 vision 能力仍然可以理解 PDF 内容。这是一个务实的 tradeoff。

---

## 架构设计

### 1. 数据模型

#### DB Schema（新增 V10 migration）

```sql
CREATE TABLE attachments (
    id            TEXT PRIMARY KEY,
    message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_type     TEXT NOT NULL CHECK(file_type IN ('image', 'text_file', 'audio')),
    file_name     TEXT NOT NULL,
    file_path     TEXT NOT NULL,    -- 相对于 app_data_dir/attachments/ 的路径
    mime_type     TEXT NOT NULL,
    file_size     INTEGER NOT NULL, -- bytes
    metadata      TEXT,             -- JSON，可选：图片宽高、音频时长、STT 文本等
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_message ON attachments(message_id);
```

`messages` 表 **不改动**。`content` 字段仍存纯文本部分，附件通过 `attachments` 表关联。这样现有的 context compression、pinning 等逻辑全部不受影响。

#### Rust 类型

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub file_type: AttachmentType,  // Image | TextFile | Audio
    pub file_name: String,
    pub file_path: String,
    pub mime_type: String,
    pub file_size: i64,
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentType {
    Image,
    TextFile,
    Audio,
}
```

#### 前端类型

```typescript
interface Attachment {
  id: string;
  message_id: string;
  file_type: "image" | "text_file" | "audio";
  file_name: string;
  file_path: string;   // 用于本地读取/显示
  mime_type: string;
  file_size: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// Message 类型扩展
interface Message {
  // ...existing fields
  attachments?: Attachment[];  // 通过 JOIN 查询填充
}
```

### 2. 文件存储

```
{app_data_dir}/
  attachments/
    {YYYY-MM}/              -- 按月分目录，避免单目录文件过多
      {uuid}.{ext}          -- 图片/音频原文件
      {uuid}_thumb.{ext}    -- 图片缩略图（可选，Phase 2）
```

- 图片和音频 **复制到 attachments 目录**，因为用户可能移动/删除原文件
- 文本类文件也 **复制到 attachments 目录**（文本文件通常很小，复制成本可忽略，且保证一致性——用户删除原文件后仍可在历史消息中查看）

### 3. 消息发送管线改造

#### 3.1 前端 → Tauri IPC

当前：
```typescript
api.sendMessage(conversationId, content, providerId, model)
api.sendOpenClawMessage(conversationId, content)
```

改为：
```typescript
// 新增：先上传附件，获得 attachment ID 列表
api.prepareAttachments(files: File[]) → AttachmentRef[]

// 发送时携带附件引用
api.sendMessage(conversationId, content, providerId, model, attachmentIds?)
api.sendOpenClawMessage(conversationId, content, attachmentIds?)
```

`prepareAttachments` 是一个 Tauri command，负责：
1. 将图片/音频文件复制到 attachments 目录
2. 图片压缩（如果 >4MB，缩放到合理尺寸）
3. 返回 attachment 元信息

#### 3.2 Tauri Backend → LLM API

**OpenAI-compatible vision 格式**（大多数 provider 通用）：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "描述一下这张图" },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,/9j/4AAQ...",
        "detail": "auto"
      }
    }
  ]
}
```

改造 `ChatMessage`：

```rust
// 当前
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// 改为
pub struct ChatMessage {
    pub role: String,
    pub content: ChatContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatContent {
    Text(String),                          // 向后兼容：纯文本
    Multipart(Vec<ChatContentPart>),       // 多模态
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlDetail },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrlDetail {
    pub url: String,     // data:image/...;base64,... 或 https://...
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,  // "auto" | "low" | "high"
}
```

**关键点**：使用 `#[serde(untagged)]` 让纯文本消息序列化为 `"content": "text"`，多模态消息序列化为 `"content": [...]`，完全兼容 OpenAI API 规范。

**文本文件处理**：读取文件内容，作为文本块注入：

```json
{
  "type": "text",
  "text": "--- 文件: config.json ---\n{\"key\": \"value\"}\n--- 文件结束 ---"
}
```

#### 3.3 Tauri Backend → ACP 协议

ACP 协议原生支持 5 种 ContentBlock：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentBlock {
    // 已有
    #[serde(rename = "text")]
    Text { text: String },

    // 新增：图片（base64）
    #[serde(rename = "image")]
    Image {
        data: String,           // base64 编码
        #[serde(rename = "mimeType")]
        mime_type: String,      // image/png, image/jpeg, etc.
    },

    // 新增：音频（base64）
    #[serde(rename = "audio")]
    Audio {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },

    // 新增：内嵌文本资源（用于发送文本文件内容）
    #[serde(rename = "resource")]
    Resource {
        resource: EmbeddedResource,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmbeddedResource {
    pub uri: String,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,  // base64, 预留但当前不使用
}
```

**能力协商**：ACP 协议中 Agent 通过 `promptCapabilities` 声明支持的内容类型。发送前应检查：
- `image` capability → 可发送 Image block
- `audio` capability → 可发送 Audio block
- `embeddedContext` capability → 可发送 Resource block
- Text 和 ResourceLink 是 baseline，始终可用

如果 Agent 不支持某种 capability，降级处理：
- 图片 → 提示用户 "该 Agent 不支持图片"
- 文本文件 → 作为 Text block 发送（始终可用）
- 音频 → 先 STT 转文字，再以 Text block 发送

### 4. 前端 UI 详细设计

> 设计系统：shadcn/ui + Radix primitives + Tailwind v4 + Lucide icons + oklch tokens

#### 4.1 ChatInput 改造

**当前布局**：`[AudioRecorder] [Input ───────── Send]`

**改造后布局**：

```
正常态：
┌──────────────────────────────────────────────────────┐
│  [附件预览条 - 仅有待发送附件时显示]                    │
│  ┌────────┐ ┌─────────┐                               │
│  │ 🖼 缩略 │ │ 📄 main │                               │
│  │   图  ✕ │ │  .rs  ✕ │                               │
│  └────────┘ └─────────┘                               │
├──────────────────────────────────────────────────────-│
│ 🎙  📎  输入消息...                        ➤  │  🎤   │
│ ^   ^                                      ^     ^    │
│ 语音 附件                                 发送  语音   │
│ 转文字                                         消息   │
└──────────────────────────────────────────────────────┘

左侧两按钮: 🎙 语音转文字 (AudioLines icon) + 📎 附件 (Paperclip)
右侧: 发送/停止按钮 (在 Input 内部) + 🎤 语音消息 (Mic icon)

录音态（替换整个输入区域）：
┌──────────────────────────────────────────────────────┐
│  ✕    ● 0:03      ─────●─────────            ■ 完成   │
│  取消  录音中...    波形可视化                  停止发送  │
└──────────────────────────────────────────────────────┘
```

**两个录音按钮的区别**：

| | 🎙 语音转文字 (左) | 🎤 语音消息 (右) |
|---|---|---|
| **位置** | 输入框左侧，📎 旁边 | 输入框右侧，发送按钮外侧 |
| **图标** | `AudioLines` (波形线条) | `Mic` (麦克风) |
| **录音完成后** | 自动 STT → 文字填入输入框 | 自动作为语音气泡发送 |
| **录音态提示** | "松开转为文字" | "松开发送语音" |
| **用户感知** | 语音输入法，辅助打字 | 发语音消息，即录即发 |

**组件结构**：

```tsx
// ChatInput.tsx 改造后的 JSX 骨架
<div className="border-t border-border p-4">
  <div className="mx-auto max-w-3xl">
    {/* 附件预览条 */}
    {pendingAttachments.length > 0 && (
      <AttachmentPreviewBar
        attachments={pendingAttachments}
        onRemove={removePendingAttachment}
      />
    )}

    {/* 录音态 vs 输入态 */}
    {recording ? (
      <RecordingBar
        mode={recording.mode}   // 'voice-message' | 'voice-to-text'
        duration={recordingDuration}
        onStop={handleStopRecording}
        onCancel={handleCancelRecording}
      />
    ) : (
      <div className="flex items-center gap-2">
        {/* 左侧：语音转文字 + 附件 */}
        <VoiceToTextButton onClick={() => startRecording('voice-to-text')} />
        <AttachmentButton onFilesSelected={handleFilesSelected} />

        {/* 中间：文本输入 + 发送/停止 */}
        <div className="relative flex-1">
          <Input ... onPaste={handlePaste} />
          <SendOrStopButton ... />
        </div>

        {/* 右侧：语音消息 */}
        <VoiceMessageButton onClick={() => startRecording('voice-message')} />
      </div>
    )}
  </div>
</div>
```

**左侧 🎙 语音转文字按钮**：

```tsx
// AudioLines icon — 波形图标，暗示"语音 → 文字"
<button
  onClick={startVoiceToText}
  className="shrink-0 rounded-md p-2 text-muted-foreground
             transition-colors hover:bg-accent hover:text-foreground"
  title={t("语音转文字", "Voice to text")}
>
  <AudioLines size={16} />
</button>
```

**右侧 🎤 语音消息按钮**：

```tsx
// Mic icon — 麦克风图标，暗示"录音发送"
<button
  onClick={startVoiceMessage}
  className="shrink-0 rounded-md p-2 text-muted-foreground
             transition-colors hover:bg-accent hover:text-foreground"
  title={t("发送语音消息", "Send voice message")}
>
  <Mic size={16} />
</button>
```

**附件按钮（📎 Paperclip）**：

```tsx
<button
  onClick={openFilePicker}
  className="shrink-0 rounded-md p-2 text-muted-foreground
             transition-colors hover:bg-accent hover:text-foreground"
  title={t("添加附件", "Add attachment")}
>
  <Paperclip size={16} />
</button>
```

**附件预览条（AttachmentPreviewBar）**：

```
出现在输入框上方，与输入框共享同一个 card-like 容器。
使用 flex + gap-2 横向排列，overflow-x-auto 支持多附件。

┌────────┐
│ 🖼     │  ← 图片：48x48 rounded-lg 缩略图，右上角 X 按钮
│   img  │     背景 bg-muted，hover 时 X 按钮 opacity-100
│     ✕  │
└────────┘

┌─────────┐
│ 📄      │  ← 文件：48x48 rounded-lg 色块，中间文件图标
│ main.rs │     下方文件名截断显示
│    ✕    │
└─────────┘

样式：
  容器: px-3 py-2 border-b border-border bg-muted/30
  单项: relative h-12 min-w-12 rounded-lg border border-border bg-card
        group hover → 显示删除按钮
  删除按钮: absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full
            bg-foreground/80 text-background flex items-center justify-center
            opacity-0 group-hover:opacity-100 transition-opacity
```

**录音态（RecordingBar）**：

```
替换整个输入行，全宽显示。根据 mode 显示不同提示：
  - voice-message: "松开发送语音" (红色主题)
  - voice-to-text:  "松开转为文字" (蓝色/primary 主题)

布局: flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5

左侧: 取消按钮 (X, ghost, text-muted-foreground)

中部:
  红色/蓝色圆点脉动 (● animate-pulse)
  + 计时器 "0:03" (font-mono text-sm tabular-nums)
  + 提示文字 (text-xs text-muted-foreground)

波形区: flex-1 录音波形可视化
  简化实现：用 CSS 动画模拟 4-6 个竖条高低变化
  h-6 flex items-center justify-center gap-0.5
  每个 bar: w-0.5 rounded-full bg-destructive/60 (或 bg-primary/60)
           animation: voice-wave 0.8s ease-in-out infinite
           stagger delay 0.1s 递增

右侧: 停止按钮
  voice-message: 圆形按钮 bg-destructive text-destructive-foreground
                 ArrowUp icon (发送图标)
  voice-to-text: 圆形按钮 bg-primary text-primary-foreground
                 Square icon (停止图标)
```

**拖拽覆盖层（Drag Overlay）**：

```
当用户拖拽文件到整个 ChatView 区域时：
  整个消息区显示覆盖层
  fixed inset-0 z-50 bg-primary/5 backdrop-blur-[2px]
  border-2 border-dashed border-primary/40 rounded-xl m-2

  居中显示: Upload 图标 + "拖放图片或文件" 文字
  text-primary/60 flex flex-col items-center justify-center gap-2
```

**粘贴图片**：

```
监听 Input 的 onPaste 事件：
  检查 clipboardData.items 中的 image 类型
  如有，创建 Blob → 添加到 pendingAttachments
  触觉反馈：附件预览条平滑展开 (CSS transition max-height)
```

#### 4.2 MessageItem 改造

附件渲染在消息气泡 **内部**，文字之后。

**图片附件**：

```
User 气泡内：
┌──────────────────────────────────┐
│ 描述一下这张图                     │  ← 文字部分 (现有)
│                                   │
│ ┌────────────────────────┐       │
│ │                        │       │  ← 图片: max-w-[280px] rounded-lg
│ │       image            │       │     object-cover cursor-pointer
│ │                        │       │     hover:brightness-95 transition
│ └────────────────────────┘       │     点击 → ImageViewer lightbox
└──────────────────────────────────┘

多图时使用 grid：
  1张: 单图, max-w-[280px]
  2张: grid-cols-2 gap-1, 每张 max-w-[140px]
  3张+: grid-cols-2 gap-1, 最后一张如果是奇数则 col-span-2

样式细节：
  图片容器: mt-2 (与文字的间距)
  图片: rounded-lg overflow-hidden
  加载态: bg-muted animate-pulse 占位
  加载失败: bg-muted/50 flex items-center justify-center
            ImageOff icon + "图片加载失败" text-xs
```

**ImageViewer（图片灯箱）**：

```
使用 Radix AlertDialog 作为基础，全屏覆盖：
  Overlay: fixed inset-0 z-50 bg-background/90 backdrop-blur-md
  Content: fixed inset-0 flex items-center justify-center p-8

  图片: max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl
  关闭: 右上角 X 按钮, 或点击背景, 或 Esc 键
  底部: 文件名 + 尺寸信息, text-xs text-muted-foreground

  进入动画: fade-in-0 zoom-in-95 duration-200
  退出动画: fade-out-0 zoom-out-95 duration-150
```

**文本文件附件**：

```
┌──────────────────────────────────┐
│ 帮我 review 这个文件               │
│                                   │
│ ┌────────────────────────────┐   │
│ │ 📄  main.rs         2.1 KB │   │  ← 文件卡片
│ └────────────────────────────┘   │     单行, 紧凑
└──────────────────────────────────┘

文件卡片样式：
  mt-2 flex items-center gap-2 rounded-lg
  border border-border/50 bg-background/50
  px-3 py-2 text-xs

  图标: FileText (Lucide), size=14, text-muted-foreground
  文件名: font-medium text-foreground truncate max-w-[200px]
  大小: text-muted-foreground ml-auto whitespace-nowrap

  user 气泡内: border-primary-foreground/20 bg-primary-foreground/10
  （因为 user 气泡是 bg-primary，内部需要用反色方案）
```

**语音消息气泡**：

```
User 发送的语音消息（替代文字气泡）：
┌──────────────────────────────────┐
│  ▶  ────●──────────────  0:05   │  ← 播放按钮 + 进度条 + 时长
│                                  │
│  ┌─ 展开转写 ─────────────────┐  │  ← 可选：点击展开
│  │ "帮我看看这段代码有什么问题" │  │     文字区 text-xs opacity-80
│  └────────────────────────────┘  │
└──────────────────────────────────┘

详细样式：
  整个气泡: 与普通 user 气泡相同的 rounded-2xl rounded-tr-md bg-primary
           但内容不同

  播放行: flex items-center gap-2.5 min-w-[200px]
    播放按钮: h-7 w-7 rounded-full bg-primary-foreground/20
              flex items-center justify-center
              hover:bg-primary-foreground/30 transition-colors
              图标: Play (size=13) 或 Pause, text-primary-foreground
    进度条: flex-1 h-1 rounded-full bg-primary-foreground/20
            内部: h-full rounded-full bg-primary-foreground transition-all
            拖动交互不做（Phase 3 简化），只显示进度
    时长: text-xs font-mono tabular-nums text-primary-foreground/80

  转写折叠区:
    默认折叠，只显示 "查看转写" 按钮
    按钮: mt-2 text-xs text-primary-foreground/60
          hover:text-primary-foreground/80 transition-colors
          flex items-center gap-1 + ChevronDown icon size=12
    展开态: mt-2 pt-2 border-t border-primary-foreground/15
            text-xs text-primary-foreground/80 leading-relaxed
            animate-in fade-in-0 slide-in-from-top-1

  STT 未完成态（正在转写）:
    转写区显示: Loader2 animate-spin size=12 + "正在转写..."
    text-primary-foreground/50

  STT 失败态:
    转写区显示: AlertCircle size=12 + "转写失败"
    text-primary-foreground/40
```

#### 4.4 全局拖拽区域

在 `ChatView.tsx` 层面处理 dragover/drop 事件，覆盖整个消息区+输入区：

```tsx
// ChatView 外层 div
<div
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
  className="relative flex h-full min-h-0 flex-col bg-background"
>
  {/* 消息区 + 输入区 */}
  ...

  {/* 拖拽覆盖层 */}
  {isDragging && (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center
                    rounded-xl border-2 border-dashed border-primary/40
                    bg-primary/5 backdrop-blur-[2px]">
      <Upload size={32} className="mb-2 text-primary/60" />
      <p className="text-sm font-medium text-primary/60">
        拖放图片或文件到这里
      </p>
    </div>
  )}
</div>
```

### 5. 语音输入方案

提供 **两种独立的语音交互模式**，用户按需选择：

#### 模式 A：发送语音消息（Voice Message）

用户录音后 **直接作为语音消息发送**。前端展示为语音气泡，后端静默走 STT 转文字后发给 LLM/Agent。

```
用户点击录音 → 录制完成 → 立即发送
    ↓
前端：立即在消息列表中显示为语音气泡（带波形、时长、播放按钮）
    ↓
后端（异步，用户无感）：
  1. 保存音频到 attachments 目录
  2. 调用 STT API 转写为文字
  3. 将转写文字作为 content 发给 LLM / ACP Agent
  4. 转写文本存入 attachment.metadata.transcription
    ↓
用户看到的：语音气泡 → AI 回复
用户交互：点击语音气泡可展开查看转写文本
```

**前端渲染**：
```
┌─ User ─────────────────────────┐
│ 🎤 0:05  ▶ ───●──────          │  ← 语音气泡，可播放
│                          [展开] │  ← 点击展开显示转写文本
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ "帮我看看这段代码有什么问题"     │  ← 展开后显示的转写文本
└─────────────────────────────────┘
```

**关键体验**：消息发出时是"语音形态"，用户不需要等 STT 完成就能看到自己的消息已发出。STT + LLM 调用在后台串行执行，AI 回复到达时才更新 streaming。

#### 模式 B：语音转文字（Voice-to-Text）

用户录音后，转写文本 **填入输入框**，用户可以编辑后再发送。这是传统的语音输入法体验。

```
用户长按/点击录音 → 录制完成
    ↓
调用 STT API 转写
    ↓
转写文本填入输入框（可编辑）
    ↓
用户确认后手动发送（作为普通文本消息）
```

#### 交互流程（录前选择，两个独立按钮）

```
两个按钮，两条独立路径：

路径 A — 🎙 语音转文字 (左侧 AudioLines 按钮):
    点击 → 开始录音，RecordingBar 显示 "录音中，松开转为文字" (primary 主题)
    点击停止 → 自动调用 STT
    → 输入框显示 loading 状态
    → STT 完成 → 文字填入输入框，用户可编辑后发送
    → STT 失败 → toast 提示，恢复输入框

路径 B — 🎤 语音消息 (右侧 Mic 按钮):
    点击 → 开始录音，RecordingBar 显示 "录音中，松开发送语音" (destructive 主题)
    点击停止 → 立即在消息列表显示语音气泡
    → 后端异步 STT + 发 LLM
    → AI 回复到达时更新 streaming

两条路径共用同一个 RecordingBar 组件，通过 mode 属性区分主题色和提示文案。
取消按钮 (✕) 在两种模式下都可用，丢弃录音恢复输入框。
```

#### 技术实现（两种模式共享）

**录音层**：统一使用 WebView MediaRecorder API，无 Rust 依赖。

**STT 层**：两种模式都需要 STT，区别仅在时机：
- 模式 A：发送后异步 STT（不阻塞 UX）
- 模式 B：录音完成后同步 STT（阻塞，显示 loading）

```
Tauri command: transcribe_audio(audio_bytes) → String
    ↓
通过 reqwest 调用 STT API：
  - OpenAI Whisper API（/v1/audio/transcriptions）
  - Groq Whisper（免费，速度快）
  - 用户配置的其他兼容端点
```

**数据流 — 🎤 语音消息（路径 B）**：
```
用户点击右侧 Mic → 录音 → 点击停止
    ↓
前端：生成临时 message，role=user，附带 audio attachment
    → 立即渲染为语音气泡（此时还没有转写文本）
    ↓
Tauri command: send_voice_message(conversation_id, audio_bytes)
    ↓
后端：
  1. 保存音频文件 → attachments/{YYYY-MM}/{uuid}.webm
  2. 插入 attachment 记录（file_type='audio', metadata=null）
  3. 调用 STT → 获得 transcription 文本
  4. 更新 attachment.metadata = { "transcription": "..." }
  5. 插入 message 记录（content = transcription 文本）
  6. 将 transcription 发给 LLM / ACP（与普通文本消息相同路径）
  7. 流式返回 AI 回复
    ↓
前端：收到 chat-stream-done 后，更新语音气泡的 metadata（转写文本可查看）
```

**数据流 — 🎙 语音转文字（路径 A）**：
```
用户点击左侧 AudioLines → 录音 → 点击停止
    ↓
前端：输入框显示 Loader2 + "转写中..."
    ↓
Tauri command: stt_transcribe(audio_base64, provider_id)  // 已有
    ↓
后端：调用 STT API → 返回文字
    ↓
前端：文字填入输入框，用户可编辑后手动发送
    （不保存音频，不创建 attachment —— 纯输入辅助）
```

**为什么不用 Rust `cpal` 录音**：WebView 的 MediaRecorder API 已经足够好，跨平台兼容，且无需额外 Rust 依赖。Tauri v2 的 WebView 支持 `getUserMedia`。

**STT provider 配置**：复用现有的 Provider 体系。用户配置一个支持 `/v1/audio/transcriptions` 的 provider 即可。或者在设置里增加一个专门的 "语音转文字" 端点配置。

**边界情况**：
- 如果用户没有配置 STT provider（比如纯本地 LLM 用户），录音按钮仍然可用，但录音完成后提示 "请先在设置中配置语音转文字服务"。语音功能是 **可选增强**，不阻塞其他功能。
- 模式 A 中 STT 失败时：语音气泡保留，AI 回复缺失，显示错误提示 "语音转写失败，请重试"。用户可以重新发送或切换到模式 B 手动输入。

---

## 依赖变更总结

| 新增依赖 | 用途 | 大小影响 |
|---------|------|---------|
| `image` (minimal features) | 图片压缩/缩放 | ~1MB，且 `png` 已在依赖树中 |
| `uuid`（如未有） | 附件文件命名 | 极小，通常已有 |

**总增量：~1MB**。无 sidecar 二进制，无系统级依赖，无 C/C++ 编译。

---

## 实施阶段

### Phase 1：图片消息（核心）

**范围**：
- DB migration V10：`attachments` 表
- 文件存储模块（复制、路径管理）
- 图片压缩（`image` crate，限制最大 4MB / 2048px）
- `ChatMessage.content` 从 `String` 改为 `ChatContent` enum
- `ContentBlock` enum 增加 `Image` 变体
- 前端：ChatInput 粘贴/拖拽/选择图片
- 前端：MessageItem 图片渲染 + lightbox
- 前端：附件预览区

**改动文件**：
- `src-tauri/src/db/schema.rs` — migration
- `src-tauri/src/llm/types.rs` — ChatContent enum
- `src-tauri/src/llm/provider.rs` — 构建多模态 request
- `src-tauri/src/acp/types.rs` — ContentBlock 扩展
- `src-tauri/src/acp/client.rs` — prompt 方法支持多内容块
- `src-tauri/src/acp/ws_client.rs` — 同上
- `src-tauri/src/commands/chat.rs` — send_message 接收附件
- `src-tauri/src/commands/openclaw.rs` — send_openclaw_message 接收附件
- 新增 `src-tauri/src/attachments.rs` — 附件存储/管理模块
- `src/lib/types.ts` — Attachment 类型
- `src/lib/tauri.ts` — 新增 IPC 调用
- `src/components/chat/ChatInput.tsx` — 附件输入 UI
- `src/components/chat/MessageItem.tsx` — 图片渲染
- 新增 `src/components/chat/AttachmentPreview.tsx` — 待发送附件预览
- 新增 `src/components/chat/ImageViewer.tsx` — 图片放大查看

### Phase 2：文本文件发送

**范围**：
- ChatInput 文件选择器支持文本类文件
- 后端读取文件内容（`std::fs::read_to_string`）
- LLM 路径：注入为带标记的文本块
- ACP 路径：使用 `Resource { text }` content block
- 前端：文件卡片渲染

**支持的文件类型**（白名单）：
```
.md, .txt, .log, .csv, .tsv,
.json, .yaml, .yml, .toml, .xml,
.py, .rs, .js, .ts, .tsx, .jsx, .go, .java, .c, .cpp, .h, .hpp,
.sh, .bash, .zsh, .fish,
.html, .css, .scss, .less,
.sql, .graphql,
.env, .gitignore, .dockerfile
```

**大小限制**：单文件 ≤ 100KB 直接读取，>100KB 截断并标注。

**改动文件**：
- `src-tauri/src/attachments.rs` — 增加文本文件处理逻辑
- `src/components/chat/ChatInput.tsx` — 扩展文件选择器
- 新增 `src/components/chat/FileCard.tsx` — 文件卡片组件

### Phase 3：语音输入（双模式）

**范围**：
- 前端录音 UI（MediaRecorder API）
- 模式 A：语音消息 — 录完直接发送，后端异步 STT，前端语音气泡
- 模式 B：语音转文字 — 录完 STT 后填入输入框
- 新增 Tauri command：`send_voice_message`（模式 A）、`transcribe_audio`（模式 B）
- STT provider 配置（设置页）
- 音频保存到 attachments 目录
- 前端：语音气泡渲染（波形 + 播放 + 展开转写文本）
**改动文件**：
- 重构 `src/components/audio/AudioRecorder.tsx` → 拆为录音逻辑 hook + UI 按钮
- 新增 `src/hooks/useAudioRecorder.ts` — 录音 hook（MediaRecorder 封装，支持 mode 参数）
- 新增 `src/components/chat/RecordingBar.tsx` — 录音态输入条（波形 + 计时 + 停止，根据 mode 切换主题）
- 新增 `src/components/chat/VoiceBubble.tsx` — 语音气泡（播放 + 展开转写）
- `src-tauri/src/commands/chat.rs` — 新增 `send_voice_message` command
- `src/components/chat/ChatInput.tsx` — 左右两个录音按钮 + RecordingBar 集成
- `src/components/settings/SettingsPage.tsx` — STT provider 配置

---

## 风险与边界

1. **模型兼容性**：不是所有 LLM 都支持 vision。发送图片前不做能力检测（太复杂），但在发送失败时给出清晰的错误提示："当前模型可能不支持图片输入"。

2. **ACP 能力协商**：初始化时检查 Agent 的 `promptCapabilities`，缓存到 `AcpClientEntry` 中。对不支持的类型，在 UI 层禁用相应按钮或给出提示。

3. **Context window 压力**：Base64 图片很大（1MB 图片 ≈ 1.33MB base64）。通过压缩限制在合理范围内。context compressor 只处理文本部分，附件不参与历史压缩——仅当前消息携带附件。

4. **历史消息中的附件**：加载历史消息时，附件仅显示（图片/文件卡片），不重新发给 LLM。只有当前发送的消息才携带附件 content。这大幅简化 context 管理。

5. **对话删除时清理**：删除对话时，关联的 attachments 记录通过 `ON DELETE CASCADE` 自动清理。但物理文件需要额外的清理逻辑（可以在删除对话的 command 中同步处理，也可以做一个定期 GC）。Phase 1 采用同步删除，简单直接。

6. **`serde(untagged)` 反序列化**：`ChatContent` enum 使用 untagged 序列化。由于我们只序列化（发送给 API），不需要从 API 反序列化 user 消息，所以 untagged 的歧义问题不影响我们。

---

## 总结

| 维度 | 决策 |
|------|------|
| **新增二进制依赖** | 仅 `image` crate (~1MB) |
| **支持的输入类型** | 图片、纯文本文件、语音录入 |
| **不支持** | PDF、Office、视频 |
| **PDF 替代方案** | 用户截图后作为图片发送 |
| **语音方案** | 云端 STT，WebView 录音，零 Rust 依赖 |
| **存储方案** | 本地文件系统 + SQLite 元数据 |
| **协议兼容** | OpenAI vision API + ACP 多模态 ContentBlock |
| **历史消息** | 附件仅展示，不重发给 LLM |
