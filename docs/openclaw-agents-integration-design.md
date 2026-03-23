# OpenClaw Agents 集成设计

## 1. 目标

用户在 Private Talk 中：

- 连接任意一个可达的 OpenClaw Gateway（本机、局域网、远程）
- 直接看到并选择原生 OpenClaw Agents
- 为某个 Agent 新建会话
- 在同一个会话里持续多轮提问
- 流式输出
- 重开应用后继续该会话

## 2. 最终推荐：通过 ACP 桥接

### 2.1 结论

推荐方案是 **spawn `openclaw acp` 子进程，通过 ACP (Agent Client Protocol) 标准协议通信**。

这是目前发现的**最简单、最标准、最可行**的接入方式。

### 2.2 为什么是 ACP

OpenClaw 提供了 `openclaw acp` 命令（文档：https://docs.openclaw.ai/cli/acp），它是一个 **Gateway-backed ACP bridge**：

- 对上：暴露标准 ACP 接口（JSON-RPC over stdio）
- 对下：内部自动连接 Gateway WebSocket，处理所有协议细节

这意味着 Private Talk **不需要**：

- 自己实现 Gateway WS 协议（challenge-response、ed25519 签名、RPC 消息格式）
- 处理 WS 事件广播过滤问题（issue #32579）
- 自己实现 Device Pairing 状态机
- 自己实现 HTTP Chat Completions 的 session key 注入
- 自己管理 agent 列表同步

这些全部由 `openclaw acp` 内部处理。

### 2.3 架构

```
┌─────────────────────────────────────────────────┐
│ Private Talk (Tauri)                            │
│                                                 │
│  Rust Backend                                   │
│    ├── spawn "openclaw acp" subprocess          │
│    ├── JSON-RPC over stdio                      │
│    └── ACP client: session mgmt, streaming      │
│                                                 │
│  React Frontend                                 │
│    └── 正常的 ChatView / Agent 列表 / Sidebar    │
└──────────────┬──────────────────────────────────┘
               │ stdio (stdin/stdout)
               │ JSON-RPC 2.0
┌──────────────▼──────────────────────────────────┐
│ openclaw acp                                    │
│   ├── 连接 Gateway WebSocket                     │
│   ├── 处理 challenge / auth / device identity    │
│   ├── Agent 路由                                 │
│   ├── Session 管理                               │
│   └── 流式响应转 ACP notifications               │
└──────────────┬──────────────────────────────────┘
               │ WebSocket
┌──────────────▼──────────────────────────────────┐
│ OpenClaw Gateway                                │
│   ├── Agents                                    │
│   ├── Sessions / History                        │
│   └── Tools / Nodes                             │
└─────────────────────────────────────────────────┘
```

### 2.4 三种方案对比

| 维度 | ACP 桥接 | 自建 WS 客户端 | HTTP Chat Completions |
| --- | --- | --- | --- |
| 实现复杂度 | **低**（spawn 子进程 + JSON-RPC） | 高（从零实现协议） | 低 |
| 协议正确性 | **最高**（OpenClaw 官方实现） | 取决于实现质量 | 有限（HTTP 不是原生入口） |
| Session 管理 | **内置** | 需自行实现 | 需 header 注入 |
| 流式输出 | **内置**（ACP notifications） | 需自行处理事件过滤 | SSE（兼容） |
| Agent 列表 | **内置**（`listSessions`/slash） | 需自行同步 | 不支持 |
| 远程 Gateway | **内置**（`--url wss://...`） | 需自行实现 | 仅 HTTP 可达时 |
| Device Pairing | **内置** | 需自行实现 | 不需要 |
| 前置依赖 | 需安装 `openclaw` CLI | 无 | 无 |
| 维护成本 | **最低**（协议升级由 openclaw 处理） | 高（跟随协议变化） | 中 |

### 2.5 前置条件

用户需要安装 `openclaw` CLI：

```bash
npm install -g openclaw
```

这是合理的前置条件——用户既然要连接 OpenClaw Gateway，大概率已经安装了 CLI。Private Talk 可以在首次配置时检测 `openclaw` 是否可用，不可用时提示安装。

## 3. ACP 协议规格

### 3.1 传输

JSON-RPC 2.0 over stdio（stdin/stdout）。

### 3.2 启动 subprocess

```bash
# 连接本机 Gateway
openclaw acp

# 连接远程 Gateway
openclaw acp --url wss://gateway-host:18789 --token <token>

# 使用 token 文件
openclaw acp --url wss://gateway-host:18789 --token-file ~/.openclaw/gateway.token
```

也支持通过 OpenClaw 全局配置预设远程地址：

```bash
openclaw config set gateway.remote.url wss://gateway-host:18789
```

### 3.3 核心 ACP 操作

| 方法 | 用途 |
| --- | --- |
| `initialize` | 初始化连接，获取能力信息 |
| `newSession` | 创建新会话 |
| `prompt` | 发送用户消息到指定 session |
| `cancel` | 取消正在进行的生成 |
| `listSessions` | 列出可用 session |
| slash commands | Agent 内置命令（如 `/new`、`/reset` 等） |

### 3.4 流式响应

发送 `prompt` 后，通过 ACP 的 `agent_message_chunk` notification 逐步接收响应，最终收到完成信号。这是标准的 ACP 流式模式，与 IDE 集成（JetBrains、Zed）使用同一套协议。

### 3.5 已知限制

来自 OpenClaw ACP 文档：

- Per-session MCP servers 不支持（需在 Gateway 侧配置）
- 客户端文件系统和终端方法不可用
- `loadSession` 仅支持文本历史，不支持 tool call replay
- Tool streaming 显示原始 I/O，不支持结构化 diff

这些限制对 Private Talk 的聊天使用影响不大。

## 4. 推荐架构

### 4.1 统一用户概念

对用户暴露四个概念：

- `Providers` — 本地 LLM / Free Chat（保留现有）
- `Assistants` — 本地可配置的聊天助手，负责提示词、语音路由和播放行为
- `Agents` — 远程 OpenClaw Agents
- `OpenClaw Instances` — 远程 Gateway 连接（通过 ACP 桥接）

### 4.2 本地助手与远程 Agent 的统一模型

当前 `Scenario` 内部实体在 UI 上展示为 `Assistant`，远程 OpenClaw 保持 `Agent` 命名：

- `local_prompt` — 本地可编辑，保留 system_prompt、语音映射等
- `openclaw_remote` — 只读，来源于 Gateway

### 4.3 OpenClaw Instance 不是 Provider

OpenClaw Instance 管理的是一个 `openclaw acp` 子进程的生命周期和配置，包含：

- Gateway 地址
- 认证 token
- 子进程状态
- Agent 列表缓存

这与 Provider（一个 HTTP endpoint + API key）是完全不同的概念。

## 5. 实现细节

### 5.1 Tauri 侧：ACP Client

Rust 侧需要实现一个轻量的 ACP client：

```rust
// src-tauri/src/openclaw/acp_client.rs

pub struct AcpClient {
    child: tokio::process::Child,
    stdin: tokio::io::BufWriter<ChildStdin>,
    stdout: tokio::io::BufReader<ChildStdout>,
    next_id: AtomicU64,
}

impl AcpClient {
    /// spawn openclaw acp subprocess
    pub async fn start(gateway_url: Option<&str>, token: Option<&str>) -> Result<Self> { ... }

    /// JSON-RPC request/response
    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value> { ... }

    /// 监听 notifications (streaming)
    pub async fn next_notification(&mut self) -> Result<Notification> { ... }

    /// 初始化
    pub async fn initialize(&mut self) -> Result<InitResult> { ... }

    /// 创建新 session
    pub async fn new_session(&mut self) -> Result<SessionId> { ... }

    /// 发送消息（returns stream of chunks via notifications）
    pub async fn prompt(&mut self, session_id: &str, content: &str) -> Result<()> { ... }

    /// 取消生成
    pub async fn cancel(&mut self, session_id: &str) -> Result<()> { ... }
}
```

JSON-RPC over stdio 的实现非常简单：每条消息是一行 JSON，用 `\n` 分隔。

### 5.2 子进程管理

```rust
// src-tauri/src/openclaw/manager.rs

pub struct OpenClawManager {
    instances: HashMap<String, AcpClient>,
}

impl OpenClawManager {
    /// 添加实例并启动 acp 子进程
    pub async fn add_instance(&mut self, config: InstanceConfig) -> Result<()> { ... }

    /// 移除实例并终止子进程
    pub async fn remove_instance(&mut self, id: &str) -> Result<()> { ... }

    /// 获取实例的 client
    pub fn get_client(&mut self, id: &str) -> Option<&mut AcpClient> { ... }

    /// 检查子进程健康状态，必要时重启
    pub async fn health_check(&mut self) -> Result<()> { ... }
}
```

应用退出时优雅终止所有子进程。

### 5.3 Tauri Commands

```rust
// src-tauri/src/commands/openclaw_instance.rs

#[tauri::command]
pub async fn add_openclaw_instance(name: String, gateway_url: String, token: String) -> Result<String> { ... }

#[tauri::command]
pub async fn remove_openclaw_instance(id: String) -> Result<()> { ... }

#[tauri::command]
pub async fn list_openclaw_instances() -> Result<Vec<InstanceInfo>> { ... }

#[tauri::command]
pub async fn get_openclaw_agents(instance_id: String) -> Result<Vec<RemoteAgent>> { ... }

// src-tauri/src/commands/chat.rs (扩展)

#[tauri::command]
pub async fn send_openclaw_message(
    conversation_id: String,
    instance_id: String,
    session_id: String,
    content: String,
) -> Result<()> {
    // 1. 通过 AcpClient.prompt() 发送
    // 2. 监听 notifications
    // 3. 通过 Tauri events 推送 streaming chunks 到前端
}
```

### 5.4 Conversation 路由

```rust
// 发送消息时的路由逻辑
match conversation.route_kind {
    "local_llm" => {
        // 现有逻辑：build_context() + stream_chat()
    },
    "openclaw_acp" => {
        // 新逻辑：acp_client.prompt(session_id, content)
        // 不走 context compression
        // 不走 provider HTTP
        // streaming 通过 ACP notifications → Tauri events
    },
}
```

### 5.5 前端

前端几乎不需要感知 ACP。聊天界面的 streaming 仍然通过 Tauri events 接收：

- `chat-stream-chunk`（复用现有事件名）
- `chat-stream-done`

唯一的变化是新增 OpenClaw Instance 管理页面和 Remote Agent 列表展示。

## 6. 数据模型

### 6.1 `openclaw_instances`

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | TEXT PK | 本地实例 ID |
| `name` | TEXT | 显示名称 |
| `gateway_url` | TEXT | Gateway WS 地址 |
| `auth_token` | TEXT | Gateway token（安全存储） |
| `status` | TEXT | `disconnected` / `connecting` / `connected` / `error` |
| `last_error` | TEXT | 最近错误 |
| `last_sync_at` | TEXT | 最近 Agent 同步时间 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

注意：不再需要 `device_id`、`device_keypair`、`pairing_state` 等字段——这些由 `openclaw acp` 内部管理。

### 6.2 `agents`（由 `scenarios` 演进）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | TEXT PK | 本地 agent ID |
| `kind` | TEXT | `local_prompt` / `openclaw_remote` |
| `name` | TEXT | 名称 |
| `description` | TEXT | 描述 |
| `system_prompt` | TEXT | 仅 local_prompt |
| `instance_id` | TEXT FK | 远程所属实例 |
| `remote_agent_id` | TEXT | 远端 agent slug |
| `is_editable` | INTEGER | 本地 true，远程 false |
| `is_preset` | INTEGER | 保留 |
| `voice_mapping` | TEXT | JSON |
| `tts_enabled` | INTEGER | |
| `auto_play` | INTEGER | |
| `remote_meta_json` | TEXT | avatar / identity |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |

### 6.3 `conversations`（增强）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | TEXT PK | 本地会话 ID |
| `title` | TEXT | 标题 |
| `agent_id` | TEXT FK | 绑定 Agent |
| `route_kind` | TEXT | `local_llm` / `openclaw_acp` |
| `provider_id` | TEXT | 本地 LLM 快照 |
| `model` | TEXT | 本地 model 快照 |
| `instance_id` | TEXT FK | 远程实例 |
| `remote_agent_id` | TEXT | 远程 agent |
| `acp_session_id` | TEXT | ACP session ID |
| `created_at` | TEXT | |
| `updated_at` | TEXT | |
| `deleted_at` | TEXT | |

## 7. 用户操作流程

### 7.1 首次配置

1. 设置页 → `OpenClaw Instances` → `Add Instance`
2. 填入 Gateway 地址（如 `wss://my-gateway:18789`）和 token
3. 应用检测 `openclaw` CLI 是否已安装；若未安装，提示 `npm install -g openclaw`
4. 应用 spawn `openclaw acp --url <url> --token <token>`
5. 初始化成功后同步 Agent 列表
6. 用户在 Agent 列表中看到远程 Agents

### 7.2 日常使用

1. 在 Agent 列表中选择一个 Remote Agent
2. 点击"新建会话"
3. 应用通过 ACP `newSession` 创建远程 session
4. 用户输入消息 → `prompt` → 流式接收回复
5. 持续多轮提问

### 7.3 重开应用

1. 应用启动时为已保存的 Instance 重新 spawn `openclaw acp`
2. 通过 `listSessions` 恢复已有 session
3. 用户继续之前的会话

## 8. 连接方式

所有连接方式的复杂性都由 `openclaw acp --url` 参数吸收：

| 使用方式 | Gateway URL |
| --- | --- |
| 本机 | `ws://127.0.0.1:18789`（或省略，使用默认） |
| 局域网 | `ws://<lan-ip>:18789` |
| Tailnet | `ws://<tailnet-hostname>:18789` |
| 反向代理 | `wss://gw.example.com` |
| SSH 隧道 | 用户自行建隧道后填 `ws://127.0.0.1:18789` |

Private Talk 不需要自己处理传输层——只管传 URL 给 `openclaw acp`。

## 9. Scenario → Assistant 命名收敛（UI）

将本地 `Scenario` 在 UI 上统一命名为 `Assistant`：

- 对普通用户更直观，不需要理解 Scenario / Agent 区别
- 与远程 OpenClaw `Agent` 保持区分，避免概念混淆
- 内部数据表 `scenarios` 可继续保留，迁移成本最低

策略：先改 UI 文案，保留内部 API 和数据表 `scenarios`。

## 10. 安全要求

### 10.1 凭据存储

Gateway token 需安全存储（Tauri 加密存储或与 PIN 体系联动）。

Device identity 和 pairing 由 `openclaw acp` 内部管理，存储在 `~/.openclaw/` 目录。

### 10.2 子进程安全

- `openclaw acp` 以当前用户权限运行
- token 通过命令行参数或 token file 传递（避免环境变量泄露）
- 建议使用 `--token-file` 而非 `--token` 以避免 token 出现在进程列表中

### 10.3 连接安全

推荐使用 `wss://`、Tailscale 或 SSH 隧道。不推荐公网暴露无 TLS 的 WS。

## 11. 分阶段实施

### Stage A：基础设施（2-3 天）

- `Scenario -> Assistant` UI 命名收敛
- `conversations` 表增加 `route_kind`、`provider_id`、`model`、`instance_id`、`acp_session_id` 字段
- `send_message` 从 conversation 读取 provider/model（不再从前端参数接收）
- `openclaw_instances` 表创建
- `agents` 表增加 `kind`、`instance_id`、`remote_agent_id` 等字段

### Stage B：ACP 核心集成（3-5 天）

- Rust ACP client（JSON-RPC over stdio）
- `openclaw acp` 子进程管理（spawn / terminate / restart）
- `initialize` / `newSession` / `prompt` / `cancel` 实现
- ACP streaming notifications → Tauri events 转换
- 基本的 OpenClaw Instance CRUD UI

### Stage C：Agent 列表 + 会话管理（2-3 天）

- 远程 Agent 列表同步与缓存
- Remote Agent 在 Agent 列表中展示
- Remote Conversation 创建与恢复
- `listSessions` 集成

### Stage D：体验完善（2-3 天）

- Instance 连接状态展示
- CLI 可用性检测与安装引导
- 错误恢复（子进程崩溃重启、连接断开重连）
- Chat 页头部信息适配（Instance / Agent / Session）

### 总计约 10-14 天

### 涉及的文件

| 文件 | 改动 |
| --- | --- |
| `src-tauri/src/openclaw/mod.rs` | 新增模块 |
| `src-tauri/src/openclaw/acp_client.rs` | ACP JSON-RPC 客户端 |
| `src-tauri/src/openclaw/manager.rs` | 子进程生命周期管理 |
| `src-tauri/src/openclaw/types.rs` | ACP 消息类型 |
| `src-tauri/src/commands/openclaw_instance.rs` | Instance CRUD 命令 |
| `src-tauri/src/commands/agent.rs` | 统一 Agent 命令 |
| `src-tauri/src/commands/chat.rs` | 扩展 send_message 路由 |
| `src-tauri/src/db/schema.rs` | 表迁移 |
| `src-tauri/src/lib.rs` | 注册新模块和命令 |
| `src/lib/types.ts` | 新类型定义 |
| `src/stores/appStore.ts` | 新增 Instance / Remote Agent 状态 |
| `src/components/settings/SettingsPage.tsx` | Instance 管理 UI |
| `src/components/chat/ChatView.tsx` | 路由适配 |

## 12. Fallback：HTTP Bridge

如果用户不想安装 `openclaw` CLI，或在特殊环境下，保留 HTTP bridge 作为备用：

- 在 Provider 里手动添加 OpenClaw Gateway 的 HTTP 地址
- model 填 `openclaw:<agentId>`
- 需 Gateway 侧启用 `chatCompletions` 端点
- 需自行注入 `x-openclaw-session-key` header

这不是推荐路径，仅作为高级用户的手动选项。其实现细节：

- Provider 增加 `provider_type` 字段（`generic` / `openclaw`）
- `stream_chat()` 和 `chat_complete()` 支持自定义 header
- OpenClaw provider 时跳过 context compression，只发当前 user message
- OpenClaw provider 时省略 `stream_options`（OpenAI 特有字段）
- `generate_title` 不注入 session key

## 13. 验收标准

1. 用户能在设置页添加 OpenClaw Instance（填入 Gateway 地址 + token）
2. 应用自动 spawn `openclaw acp` 并连接 Gateway
3. 连接成功后看到远程 Agents
4. 能从 Remote Agent 发起新会话
5. 发送消息后收到流式回复
6. 同一会话持续提问，上下文连续
7. 关闭应用重新打开，恢复会话
8. 不需要修改远端 Agent 配置

## 14. 风险与限制

### 14.1 前置依赖

需要用户安装 `openclaw` CLI。缓解方式：
- 首次配置时检测并引导安装
- 未来可考虑 Tauri sidecar 方式内嵌 openclaw 二进制

### 14.2 ACP 协议稳定性

ACP 尚处于早期阶段（当前 SDK v0.16.0）。缓解方式：
- 我们的 ACP client 只使用核心操作（initialize / newSession / prompt / cancel）
- 协议核心部分相对稳定

### 14.3 子进程管理

需要处理：子进程崩溃、Gateway 断连、应用退出时清理。这是标准的进程管理问题。

### 14.4 `openclaw acp` 的已知限制

- `loadSession` 仅支持文本历史（不影响聊天）
- Per-session MCP servers 不支持（需在 Gateway 侧配置）
- Tool streaming 无结构化展示（可在 UI 中简化显示）

## 15. 参考资料

- [OpenClaw ACP 文档](https://docs.openclaw.ai/cli/acp)
- [Agent Client Protocol 官网](https://agentclientprotocol.com/)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw HTTP API](https://docs.openclaw.ai/gateway/openai-http-api)
- [OpenClaw Remote Access](https://docs.openclaw.ai/gateway/remote)
- [weixin-agent-sdk（ACP adapter 参考实现）](https://github.com/wong2/weixin-agent-sdk)
