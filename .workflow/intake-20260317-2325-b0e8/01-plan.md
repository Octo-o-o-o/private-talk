# 开发计划

## 任务描述
基于调研方案报告，从零搭建 Private Talk 项目并实现 Phase 0 + Phase 1 + PIN 锁屏功能。

### 开发范围
1. **Phase 0 — 项目脚手架**: Tauri 2 + React + TypeScript + TailwindCSS 初始化 ✅（已完成），SQLite schema + migration，基础 UI 框架（侧边栏 + 聊天区 + 设置页）
2. **Phase 1 — 核心聊天**: OpenAI-compatible LLM Router（流式输出），聊天界面（消息列表 + 流式渲染 + Markdown），模型配置管理（添加/编辑/删除 provider），对话管理（新建/切换/删除/重命名）
3. **PIN 锁屏**: 可选功能，默认关闭。SHA-256 哈希存 SQLite，忘记 PIN 只能重置数据。

## 技术栈
- 前端: React 19 + TypeScript + TailwindCSS 4 + Zustand + react-markdown
- 桌面壳: Tauri 2
- 后端: Rust (reqwest for HTTP, rusqlite for SQLite, sha2 for PIN hashing)
- 构建: Vite + pnpm

## SQLite Schema
```sql
CREATE TABLE conversations (id TEXT PK, title TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE messages (id TEXT PK, conversation_id TEXT FK, role TEXT, content TEXT, created_at TEXT);
CREATE TABLE providers (id TEXT PK, name TEXT, api_type TEXT, base_url TEXT, api_key TEXT, models TEXT JSON, is_default INT, created_at TEXT);
CREATE TABLE settings (key TEXT PK, value TEXT);
```

## 变更方案
1. Rust 后端: db/ (schema, init), llm/ (provider, streaming), commands/ (chat, conversation, provider, settings, pin), pin/ (hash)
2. React 前端: layout, chat, settings, pin components + hooks + stores
3. Tauri config: window size 1200x800, title "Private Talk"
