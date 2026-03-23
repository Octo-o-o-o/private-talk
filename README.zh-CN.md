# Private Talk

[English](./README.md)

Private Talk 是一个本地优先、非常轻量的桌面工具包，用来选择本地助手、连接 OpenClaw Agents，并调试大模型对话、TTS 和 STT 流程。

它适合想要一个小而直接、可自己配置、可自己接模型和语音服务的本地桌面客户端，而不是一整套托管平台的人。

## 项目特点

- 全本地化、无自建云端依赖。对话、Provider、助手配置、Voice、OpenClaw 连接信息都保存在本机 SQLite。
- 自己配置模型。支持接入你自己的 OpenAI-compatible 接口、本地模型网关或云端模型服务。
- 同时支持本地 voice 和云端 voice。
- 支持 OpenClaw Agents，包括本地 OpenClaw Gateway、远程 OpenClaw Gateway、本地 OpenClaw Agents 和原生 OpenClaw Agents。
- 非常轻量。当前从本仓库构建出的 macOS arm64 DMG 大约只有 6.1 MB。
- 内置中英文双语界面。

## 适合做什么

- 快速切换 Agent 和 Prompt
- 调试不同模型服务的对话效果
- 调试 TTS / STT 流程
- 用一个轻量本地客户端连接 OpenClaw
- 做演示、实验和日常开发时保持简洁工具链

## 核心能力

- 本地聊天与自定义 Provider 配置
- 基于助手的提示词管理与可复用系统提示词
- 本地与云端 TTS 配置
- 按角色映射不同 voice
- STT 语音输入
- Token / 费用统计
- 上下文窗口控制与消息置顶
- OpenClaw 实例管理
- 原生 OpenClaw Agent 对话
- 远程 OpenClaw 配对辅助工具

## 隐私模型

Private Talk 是“本地优先”，不是“服务优先”。

- 项目本身不要求你接入官方托管后端。
- 应用状态和本地数据保存在你的设备上。
- 你自己决定它连接哪些模型或语音端点。
- 如果你配置的是云端 API，请求会发往你选择的服务商，而不是发往 Private Talk 的服务端。

## OpenClaw 支持

Private Talk 目前支持两类 OpenClaw 工作流：

- 自动发现并连接本机 OpenClaw Gateway
- 连接远程 OpenClaw Gateway，并直接使用原生 OpenClaw Agents

仓库中还带了一个远程配对小工具：[`tools/private-talk-pair`](./tools/private-talk-pair)，可以为另一台 Private Talk 客户端生成连接串。

OpenClaw 集成设计说明见 [`docs/openclaw-agents-integration-design.md`](./docs/openclaw-agents-integration-design.md)。

## 开发方式

### 依赖

- Node.js 18+
- `pnpm`
- Rust stable toolchain
- 当前系统对应的 Tauri 构建依赖
- 可选：如果你要使用 OpenClaw 功能，需要安装 `openclaw` CLI

### 本地运行

```bash
pnpm install
pnpm tauri dev
```

### 构建

```bash
pnpm build
pnpm tauri build
```

### 已验证打包流程

已经验证过的 macOS、iOS、Android 打包流程见 [`docs/packaging.zh-CN.md`](./docs/packaging.zh-CN.md)。

常用命令：

```bash
pnpm mac:build
pnpm ios:build
pnpm ios:build:device
pnpm android:build
pnpm package:all
```

## 如果你需要更多 OpenClaw 服务能力

Private Talk 的定位是一个轻量本地客户端。

如果你需要更完整的 OpenClaw 服务能力、托管工作流或更偏服务化的使用方式，可以看：

- [ClawButler 官网](https://clawbutler.cc)
- [ClawButler 仓库](https://github.com/Octo-o-o-o/agent-planet)

## 贡献

欢迎提 Issue 和 PR。

提交前请先看 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 安全

安全问题请先阅读 [`SECURITY.md`](./SECURITY.md)。

## 许可证

本项目采用 [Apache License 2.0](./LICENSE)。

附加归属说明见 [`NOTICE`](./NOTICE)，品牌与商标说明见 [`TRADEMARKS.md`](./TRADEMARKS.md)。

如果你想看这套方案背后的判断，见 [`docs/licensing.md`](./docs/licensing.md)。
