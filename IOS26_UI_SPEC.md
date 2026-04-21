# Private Talk: iOS 26 / macOS 26 跨端 UI 设计规范

## 1. 核心设计理念 (Core Philosophy)

在 iOS 26 与 macOS 26 的时代界限中，界面的定义不再是基于硬性“响应断点 (Breakpoints)”，而是更强调**“流体拓扑编排 (Fluid Topological Orchestration)”**与**“深度光影空间 (Deep Spatial Optics)”**。

为了彻底解决目前 Private Talk 在移动端、iPad 端和 Mac 端上“粗暴切换挂载组件”、“UI 僵硬适配差”的痛点，新规范定义了无缝、丝滑的全局统一样式。

### 核心革新点：
1. **Glassmorphism 3.0 (高能态毛玻璃)**: 使用动态饱和度与极深度的高斯模糊（`blur(48px)` + 动态光晕采样）。在所有悬浮面板（Sidebar, 弹窗）使用。
2. **Squircle 连续曲线**: 任何圆角皆使用平滑过渡的 iOS Squircle 曲率。标准卡片采用 `20px` 连续圆角。
3. **Omni-Responsive (全域自适应)**: 应用在所有端均跑在同一个高弹性容器中，通过 CSS Grid 与 Container Queries (`@container`) 实现自然折叠与流动。告别频繁触发组件层级的 Mount / Unmount。

---

## 2. 跨端适配形态策略 (Cross-Device Formatting)

目前 `AppLayout.tsx` 根据不同端强行执行 `if (layoutMode === "phone") { return <MobileConversationList /> }` 这种打断式渲染体验极差。必须采用响应式重排的策略。

### 2.1 全局弹性网格 (The Elastic Matrix)

界面始终保持一个 `div.app-shell` 作为全局视窗，内部包含 `<Sidebar>` 与 `<ChatMain>`，依据屏幕宽度无缝过渡：

- **宽屏态 / Mac (> 960px)** 
  双栏平行结构。侧边栏以玻璃态悬浮于深色背景壁纸上，拥有独立呼吸阴影；右侧主聊天区无缝衔接。
- **动态平板态 / iPad (768px - 960px)**
  侧边栏压缩为窄条图标栏，或以 35% 比例侧拉滑出层（Drawer）的形态展现。聊天区域依然可见并提供背景失焦反馈。
- **手持深浸态 / iPhone (< 768px)**
  采用原生层叠视图 (iOS Z-Axis Navigation Stack)。列表页 100% 宽度，点击后聊天室以 100% 宽度从右侧滑入，列表页会向左位移缩放 (`transform: scale(0.95); opacity: 0.6`) 并蒙上一层深色遮罩。一切过渡均需阻尼弹簧动画。

### 2.2 多维触控与光标交互 (Unified Interactions)
- **Mac / 妙控键盘指针**：
  Hover 会触发流体高亮环绕光辉 (Fluid Hover Glow)，元素不再是呆板变色，光标所到之处自带局部 15% 提亮，就像光束打在磨砂玻璃背面一样。
- **iOS / iPad 触屏**：
  不再需要 hover，但极度依赖 Active 按压反馈。任何交互元素被按下时，立即触发柔和的 `scale(0.96)` 陷入效果，配合震动触觉反馈 API 进行触感确认。

---

## 3. UI 视觉设计语言规范 (Visual Token System)

### 色彩：极简黑白灰 (Monochrome High-Contrast)
抛弃花哨色彩，聚焦于内容的极致克制，采用类似奢侈品及顶尖设计工具（如 Vercel, Linear）的无级灰阶体系。
- **深渊底色 (Environment Base)**: `#000000` 纯黑背景，将所有内容推向空间前台。
- **悬浮层 (Elevated Material)**: `rgba(18, 18, 20, 0.65)` 叠加 `border: 1px solid rgba(255, 255, 255, 0.08)`，凸显质感。
- **主要响应色 (Accent Energy)**: 反向突破的高光白 `#FFFFFF`，在黑底之上带来最强烈、干脆的视觉对比度。
- **气泡材质 (Bubble Material)**: User 的气泡表现为高亮白色卡片结合黑色文字 `#000000`；Assistant 采用深空灰 `#1C1C1E` 描边 `rgba(255,255,255,0.08)` 辅以白色文字，拉开层次。

### 排版与字形 (Smart Typography)
- 全局切换为 **SF Pro Variable**（或 Inter Variable），启动 `font-variation-settings`。
- 动态字重与跟踪：大标题在移动端自动具有负字间距 (tracking tight) 与高粗度 (wght: 700) 以增强识别率，进入桌面端后舒展开来。

### 分割线与微反馈
取消所有生硬实线 `border-bottom: 1px solid #333`。
改为使用 **弥散投影 (Diffuse Shadows)** 或 **1px 高亮的顶部高光边缘 (Inner Glow Highlight)** 来区隔内容区块。

---

## 4. CSS 实现核心代码规范 (落地要求)

未来的所有样式基于现代化 CSS 搭建：

```css
/* 1. 全局平滑设置与基础材质 */
html, body {
  overscroll-behavior: none;
  background-color: #09090b;
  font-family: "SF Pro Display", -apple-system, sans-serif;
}

.ios26-glass {
  background: rgba(30, 30, 32, 0.65);
  backdrop-filter: blur(48px) saturate(160%);
  -webkit-backdrop-filter: blur(48px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.15); /* 模拟高光 */
  border-radius: 20px;
  box-shadow: 0 16px 32px rgba(0,0,0,0.4);
}

/* 2. Z轴层叠容器 (iPhone无缝导航的核心容器) */
.ios26-stack-container {
  display: grid;
  grid-template-columns: var(--sidebar-width, 320px) 1fr;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1);
}

@media (max-width: 768px) {
  .ios26-stack-container {
    /* 强迫占据双屏宽度，滑动容器实现平滑过渡 */
    grid-template-columns: 100vw 100vw;
    transform: translateX(var(--nav-offset, 0));
  }
}

/* 3. 按压式物理微互动 */
.action-button {
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1.2), background 0.3s;
}
.action-button:active {
  transform: scale(0.94);
  background: rgba(255,255,255, 0.12);
}
```

---

## 5. 即期优化行动计划 (Action Items)

为了让 Private Talk 立刻具备 iOS/macOS 26 级别的设计，需：
1. **重构 `index.css`**：干掉传统的 `border-right: 1px solid var(--separator)`，替换为深空背景 + 磨砂玻璃 Sidebar 面板 + 主页面板的错层悬浮设计。
2. **重构 `AppLayout.tsx`**：停止根据判定 device 使用不同且物理隔绝的组件。引入单一弹性 CSS Grid 容器，仅用 CSS 处理侧边栏入场和隐藏。
3. **改进 `Chat Bubble` 细节**：气泡不能是平平无奇的方框加圆角，应该在左下/右下使用不对称的大曲率弧度，并加入一层内面泛光发散阴影。
