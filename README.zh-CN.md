# Private Talk

[English](./README.md)

极轻量、完全本地的 AI 对话客户端。基于 Tauri 2.0 构建 — macOS DMG 仅约 6 MB。

> 你的密钥、你的模型、你的数据。除非你主动选择，没有任何数据离开你的设备。

## 下载

| 平台 | 下载 |
|------|------|
| macOS (Apple Silicon) | [Private-Talk_0.1.0_macOS_aarch64.dmg](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/Private-Talk_0.1.0_macOS_aarch64.dmg) |
| Windows (x64) | [PrivateTalk_0.1.0_x64-setup.exe](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_x64-setup.exe) / [.msi](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_x64_en-US.msi) |
| iOS | [PrivateTalk_0.1.0_iOS_arm64.ipa](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_iOS_arm64.ipa) |
| Android | [PrivateTalk_0.1.0_android.apk](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_android.apk) / [.aab](https://github.com/Octo-o-o-o/private-talk/releases/download/v0.1.0/PrivateTalk_0.1.0_android.aab) |

[所有版本](https://github.com/Octo-o-o-o/private-talk/releases)

## 为什么选择 Private Talk

- **极致轻量。** macOS DMG 仅约 6 MB。原生性能，不依赖 Electron。
- **完全本地。** 所有数据存储在本地 SQLite。无需账号、无遥测、无云端依赖。
- **自由接入模型。** 连接任何 OpenAI 兼容端点 — 云端或自建均可。
- **中英双语界面。** 内置中文和英文 UI。

## 功能

### 对话 & LLM

- 多服务商对话，支持流式响应
- 预制服务商：OpenAI、Gemini、DeepSeek、Grok、OpenRouter、火山引擎、智谱 GLM、SiliconFlow，以及本地引擎
- 场景（系统提示词）预设，可复用指令
- 上下文窗口控制、消息置顶、会话管理
- Token / 费用统计

### 图片生成

- `/img` 命令，支持文生图和图生图
- 支持 8+ 服务商：OpenAI (gpt-image-1)、Gemini、Grok、SiliconFlow (FLUX)、智谱 (CogView)、OpenRouter、LocalAI、stable-diffusion.cpp
- 可配置宽高比、质量、数量、背景等参数
- 自动生成缩略图，浏览时节省内存
- 大图灯箱预览

### 语音

- **TTS（文字转语音）：** 本地和云端语音引擎，支持按角色映射不同声音
- **STT（语音转文字）：** 原生平台语音识别（macOS/iOS 使用 AVFoundation，Windows 使用 Media.SpeechRecognition，Android 使用自定义插件）
- 多声音配置文件，支持段落级角色映射

### 附件

- 对话中发送图片和文件附件
- 自动图片压缩和缩略图生成
- 灯箱预览，保持原始画质

### OpenClaw Agents

Private Talk 可作为 [OpenClaw](https://github.com/user/openclaw) Agents 的轻量调试客户端：

- 连接本地或远程 OpenClaw Gateway
- 原生 OpenClaw Agent 对话流程
- 远程配对辅助工具（[`tools/private-talk-pair`](./tools/private-talk-pair)）
- 实例管理和连接信息本地存储

如需更完整的 OpenClaw 服务平台，请参阅 [ClawButler](https://clawbutler.cc)（[仓库](https://github.com/Octo-o-o-o/agent-planet)）。

## 隐私

- 无需托管后端。应用状态保存在你的设备上。
- 你自己决定连接哪些模型和语音端点。
- 云端流量发往你配置的服务商，而非 Private Talk 的服务端。

## 开发

### 依赖

- Node.js 18+、`pnpm`、Rust stable 工具链
- 当前系统对应的 [Tauri 构建依赖](https://tauri.app/start/prerequisites/)
- 可选：使用 OpenClaw 功能需安装 `openclaw` CLI

### 运行 & 构建

```bash
pnpm install
pnpm tauri dev          # 开发服务器 + Tauri 窗口热重载
pnpm tauri build        # 完整原生应用构建
```

### 打包

```bash
pnpm mac:build          # macOS app + DMG
pnpm ios:build:device   # iOS 设备 IPA
pnpm android:build      # Android APK + AAB
pnpm package:all        # 全平台
```

详见 [`docs/packaging.zh-CN.md`](./docs/packaging.zh-CN.md)。

## 贡献

欢迎提 Issue 和 PR。提交前请先阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 安全

请参阅 [`SECURITY.md`](./SECURITY.md)。

## 许可证

[Apache License 2.0](./LICENSE)。另见 [`NOTICE`](./NOTICE) 和 [`TRADEMARKS.md`](./docs/TRADEMARKS.md)。
