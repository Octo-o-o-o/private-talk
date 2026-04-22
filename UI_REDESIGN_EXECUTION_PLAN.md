# Private Talk UI 全量重构实施方案

## 1. 目标与原则

- 本次重构只改前端结构、样式系统和窗口最小宽度，不改后端命令、数据模型和业务链路。
- 目标不是局部美化，而是把当前 `phone / tablet / desktop` 三套割裂渲染树收敛为单一 shell，再在其上统一视觉语言、导航模式和适配逻辑。
- 设计落地以 `demo.html` 为结构与交互主参考，`IOS26_UI_SPEC.md` 作为材质、层次、动效和黑白灰 token 的视觉补充。
- 桌面端支持缩到 `tablet` 形态，不进入 `mobile` 形态；手机形态只在实际窄宽度设备上触发。

## 2. 范围与约束

- 保留现有功能：
  - 新建、选择、重命名、删除会话
  - 新增、删除、设默认 provider
  - 发送消息、停止生成、流式展示
  - PIN 启用、禁用、校验、重置本地数据
- 保留现有 Zustand store 与 Tauri command 接口，不引入新状态管理库。
- 允许新增最小必要的 UI 派生状态，但不改变持久化结构。
- 允许扩展 preview dataset 用于验收，不影响生产逻辑。

## 3. 实施阶段

### 阶段 0：文档与 review

- 创建本文件作为唯一实施与 review 基准。
- 以“结构完整性、功能覆盖、响应式覆盖、验收路径、回归风险”五项做文档自 review。
- 确认覆盖状态：
  - welcome
  - chat
  - settings
  - pin
  - provider form
  - pin reset
  - streaming
  - markdown / code block

### 阶段 1：样式系统与基础设施

- 重写 `src/index.css`，建立统一 token：
  - 黑底环境
  - glass panel
  - 连续圆角
  - 边框高光
  - 阴影层级
  - 文本层级
  - 表单、按钮、列表、header、input bar 语义类
- 补齐：
  - `prefers-reduced-motion`
  - `hover: none`
  - safe-area 处理
  - drag / no-drag 规则

### 阶段 2：统一 shell 与布局模式

- 将 `AppLayout.tsx` 改为单一 `app-shell`。
- 左侧永远是 sidebar pane，右侧永远是 main pane。
- `chat / settings / welcome` 只在主 pane 内切层，不再通过早返回切树。
- 布局模式改为宽度驱动：
  - `phone < 768`
  - `tablet 768-959`
  - `desktop >= 960`
- `phone` 使用 `100vw 100vw` 滑动壳；进入 detail 时 sidebar 缩放、失焦、加遮罩。
- `tablet / desktop` 维持双栏常驻，仅在宽度和间距上变化。

### 阶段 3：Sidebar 与导航

- Sidebar 结构贴近 `demo.html`：
  - header
  - conversation list
  - inline new chat
  - settings entry
- 平板只做更紧凑宽度和间距，不做 drawer。
- 桌面与平板使用玻璃浮层。
- 手机列表优先，点击进入 detail。
- 保留会话重命名和删除交互，并使其在新视觉下可用。

### 阶段 4：聊天主面板

- 重做 `ChatView`：
  - 统一 header
  - welcome 状态
  - chat 状态
  - streaming 状态
  - provider / model 选择器
- 桌面 / 平板把 provider / model 选择器收进 header 控制组。
- 手机保留独立模型条，但视觉并入整体 chrome。
- 重做 `ChatInput`：
  - 浮动 capsule 输入区
  - 更强底部悬浮感
  - 安全区适配
- 重做 `MessageItem`：
  - user / assistant 不对称圆角气泡
  - assistant 材质更深
  - markdown、blockquote、inline code、code block 排版收紧
  - 防止窄宽度溢出

### 阶段 5：设置页

- 沿用 `demo.html` 的 section + card-list 结构。
- 保留真实功能：
  - provider preset / custom form
  - default provider 标识与切换
  - API key 显示/隐藏
  - PIN 启停
  - reset data 确认
  - version / about
- 所有展开区、危险操作、描述文案统一进入新视觉系统。

### 阶段 6：PinLock

- 使用与主界面一致的环境背景和 glass/card 语言。
- 保留：
  - 数字键盘
  - 点位状态
  - 错误抖动
  - 解锁逻辑
- 让桌面与移动端的锁屏风格不再割裂。

### 阶段 7：回归与收口

- 清理旧布局分支和废弃类名。
- 保证最终实现由少量语义类驱动，而非继续堆叠一次性 Tailwind 字符串。
- 完成后执行构建与多状态验收。

## 4. 关键改动点

- `src/components/layout/AppLayout.tsx`
  - 改为统一 shell 与主 pane 切层
- `src/components/layout/useLayoutMode.ts`
  - 改为纯宽度驱动布局模式
- `src/components/layout/Sidebar.tsx`
  - 改为单一侧栏实现，适配 desktop / tablet / phone
- `src/components/chat/ChatView.tsx`
  - 改为统一聊天主面板
- `src/components/chat/ChatInput.tsx`
  - 改为浮动输入胶囊
- `src/components/chat/MessageItem.tsx`
  - 改为新气泡和 markdown 样式
- `src/components/settings/*.tsx`
  - 改为新的 settings section / card-list 视觉
- `src/components/pin/PinLock.tsx`
  - 改为与主视觉统一的 PIN 锁屏
- `src/index.css`
  - 重写为统一 token + 基础语义类
- `src-tauri/tauri.conf.json`
  - `minWidth` 调整为 `768`

## 5. 验收清单

### 结构验收

- `desktop / tablet / phone` 三种形态都由同一 shell 驱动。
- 切换欢迎态、聊天页、设置页时不再发生整页树切换。

### 功能验收

- 新建会话正常
- 选择会话正常
- 会话重命名 / 删除正常
- 进入设置正常
- provider 新增 / 删除 / 设默认正常
- PIN 启用 / 禁用正常
- 重置本地数据正常
- 流式输出与停止生成正常

### 视觉验收

- 桌面侧栏具备玻璃感与浮层层次
- 主面板与侧栏存在错层关系
- 手机 detail 进入时有平移、缩放、遮罩反馈
- 消息气泡、输入区、设置卡片、PIN 页面风格统一
- 蓝色旧风格与硬分割线全部移除

### 适配验收

- 手机顶部与底部安全区无裁切
- 长 markdown 与代码块不溢出
- 长标题、长 provider 名称、长模型名可截断
- 桌面缩窗到 `768-959` 时仍可用

### 工程验收

- `pnpm build` 通过
- 使用 preview bootstrap 至少检查：
  - welcome
  - chat
  - settings
  - pin

## 6. 风险与回归关注项

- 将多树合并为单树后，`view`、`currentConversationId`、返回行为需要重新梳理，避免手机与桌面状态串扰。
- 侧栏与主面板统一后，Tauri 标题栏拖拽区和交互区边界容易回归。
- markdown 与 code block 在窄宽度下最容易撑破布局，必须重点验证。
- PIN 设置页和 PIN 锁屏页如果 token 不完全复用，会再次出现风格断层。
- 历史版本的语音转写、语音播放、图片生成不仅有设置页，还有独立前后端执行链路；当前重构分支尚未迁回这些运行模块，因此不能把这类回归误判为单纯的 UI 入口缺失。
- 当前工作区已有未提交改动，实施时只修改本次涉及文件，不回退不相关变化。

## 7. 文档自 Review 结论

### 结构完整性

- 已覆盖 shell、sidebar、chat、settings、pin lock、窗口宽度调整与清理收口。

### 功能覆盖

- 已覆盖会话、provider、streaming、PIN、reset data 等全部现有功能路径。

### 响应式覆盖

- 已覆盖 desktop、tablet、phone 三种形态，并明确桌面不进入 mobile。

### 验收路径

- 已给出结构、功能、视觉、适配、工程五类验收清单。

### 回归风险

- 已明确导航状态、拖拽区、markdown 溢出、PIN 风格一致性与脏工作区风险。

### 历史功能差异

- 已确认：历史版本存在 `stt_provider_id`、`stt_model`、`image_gen_config` 等多模态设置与对应运行模块。
- 当前重构分支已恢复文本聊天的默认路由与助手偏好，但语音转写 / TTS / 图片生成仍需单独的多模态迁移阶段，不能仅靠补 settings UI 完成恢复。

## 8. 结论

- 方案可直接实施，不需要额外产品决策。
- 实施顺序固定为：文档与 review、样式与 shell、sidebar、chat、settings、pin、回归收口。
