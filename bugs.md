# BUGS

## B1 — `customEditors` 选择器字段名错误

**发现时间**: 2026-06-21 (开发调试阶段)

**现象**: 打开 `.dita` 文件后，右上角预览图标按钮、右键菜单、命令面板均正常，快捷键和按钮点
击后 VS Code 提示 "opening ... in preview" 但没有渲染视图出现。`resolveCustomTextEditor` 未被调
用，VS Code 只是在旁边重新打开了一个源码编辑器。

**原因**: `package.json` 中 `customEditors` 的 `selector` 字段使用了 `fileNamePattern`（驼峰），
而 VS Code 的 JSON schema 要求 `filenamePattern`（全小写连写）。错误的字段名导致 VS Code 无法
将 `.dita` 文件与我们的自定义编辑器关联起来，`vscode.openWith` 回退到默认文本编辑器。

```json
// 错误
"fileNamePattern": "*.dita"
// 正确
"filenamePattern": "*.dita"
```

**修复**: 将 `package.json` 的 `fileNamePattern` 改为 `filenamePattern`。

**影响**: 无（新建扩展，未发布）。

---

## B2 — 缺少 `.vscode/launch.json`

**发现时间**: 2026-06-21 (开发调试阶段)

**现象**: 在 VS Code 中按 F5 不会启动 Extension Development Host，而是调试当前文件。

**原因**: 项目根目录缺少 `.vscode/launch.json` 配置文件，VS Code 不知道这是一个扩展项目。

**修复**: 创建 `.vscode/launch.json`，配置 `type: extensionHost` 的调试任务。

**影响**: 无（仅开发环境）。

---

## B3 — xref 交叉引用显示 href 而非目标标题

**发现时间**: 2026-06-21 (Phase 1 功能验证)

**现象**: 自闭合 `<xref/>` 渲染后显示 `#db_config/section_lists` 而非目标章节标题（如 "操作步骤与列表展示"），像源码引用一样影响阅读。

**原因**: xref 无子节点时直接用 `href` 属性值作为显示文本。

**修复**: 添加 `resolveTitle` 上下文函数，在 `DitaViewerProvider` 中扫描 DITA 文档树构建 `id → title` 映射表，xref 无子节点时通过该函数查找目标标题文本。

**影响**: 无。

---

## B4 — codeblock 语言未显示

**发现时间**: 2026-06-21 (Phase 1 功能验证)

**现象**: `<codeblock outputclass="language-cpp">` 渲染后编程语言未显示。

**原因**: codeblock 渲染器仅将 `outputclass` 作为 CSS class 注入 `<pre>`，未在视觉上显示语言标签。

**修复**: codeblock 外层包裹 `<div class="codeblock-wrapper">`，顶部添加 `<div class="codeblock-lang">cpp</div>` 语言标签。

**影响**: 无。

---

## B5 — sl/sli 简单列表样式与无序列表混淆

**发现时间**: 2026-06-21 (Phase 1 功能验证)

**现象**: Simple List（`<sl>/<sli>`）渲染输出带有 `–` dash 前缀，之后又被改为带点号的列表，与 `<ul>/<li>` 样式相同。

**原因**: CSS 中 `.simple-list` 先后使用 `::before` 和标准 `list-style` 导致样式不唯一。

**修复**: 将 `.simple-list` 设为 `list-style: none; padding-left: 1.5em`，仅留缩进无符号。

**影响**: 无。

---

## B6 — lq 暗黑模式文字不清晰 & 改用 `@media (prefers-color-scheme: dark)` 导致主题错误

**发现时间**: 2026-06-21 (Phase 1 功能验证)

**现象**: `<lq>` 渲染为 `<blockquote>`，浅色主题 OK，暗黑模式下 `#555` 灰色文字看不清。改用 `@media (prefers-color-scheme: dark)` 后，OS 设为暗色但 VS Code 为浅色主题时仍使用暗色 CSS，反之亦然。

**原因**: `@media (prefers-color-scheme)` 检测的是 OS 级偏好，而非 VS Code 主题。VS Code WebView 不自动同步主题。

**修复**: 
1. 移除 `@media`，改为在 `DitaViewerProvider` 中通过 `vscode.window.activeColorTheme.kind` 检测 VS Code 主题
2. 将 `vscode-dark` class 注入 `<html>` 元素
3. CSS 使用 `.vscode-dark` 选择器仅覆盖 `blockquote` 文字颜色

**影响**: 无。
