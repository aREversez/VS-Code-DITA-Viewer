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
3. CSS 使用 `.vscode-dark` 选择器仅覆盖背景/边框色（不覆盖文字颜色）

**影响**: 无。

---

## B7 — `<fig>` 内图片不显示

**发现时间**: 2026-06-23 (Phase 1 功能验证)

**现象**: 简单模式 `<image>`（直接作为 `<body>` 子节点）正常显示；复杂模式 `<fig><title>...</title><image href="..."/></fig>` 中图片不显示。

**原因**: `topic/fig` 渲染器使用 `rest.map(c => renderChildren(c, ctx))` 渲染非标题子节点。`renderChildren(c, ctx)` 渲染的是 `c.children`（`<image>` 的子节点，通常是空的），而非 `c` 自身。简单模式 `<image>` 由 `renderElement` 直接调用图片渲染器，但在 `<fig>` 内部时被 `renderChildren(c, ctx)` 跳过了元素级渲染。

**修复**: 改为 `renderChildren({ ...node, children: rest }, ctx)` — 创建一个过滤后的 `<fig>` 节点版本传给 `renderChildren`，它会为 `rest` 中每个子节点调用 `renderElement`，正确触发元素渲染器。

```typescript
// 错误
const figContent = rest.map((c) => renderChildren(c, ctx)).join('');
// 正确
const figContent = renderChildren({ ...node, children: rest }, ctx);
```

**影响**: 无。

---

## B8 — 双向滚动同步：源码→预览回跳

**发现时间**: 2026-06-23 (双向同步功能验证)

**现象**: 预览页向下连续滑动时屏幕内容突然往上滑回；源码页向下滑动时预览页往回跳。

**原因**: 多因素叠加导致的循环回跳：

1. **平滑滚动阻塞**：`scrollIntoView({ behavior: 'smooth' })` 产生动画，持续触发 scroll 事件，期间 `isScrolling` 标记阻止了后续 `revealLine` 消息，导致 webview 落后于源码位置
2. **过时 scrollSync 回拉**：webview 在滚动停止后 500ms 报告当前顶部行号（`scrollSync`），此时源码已被用户继续向下滚动，扩展收到过时的行号后执行 `revealRange` 把源码往回拖
3. **异步事件多次触发**：`revealRange` 是异步操作，`onDidChangeTextEditorVisibleRanges` 可能触发多次。一次性标记 `skipNextVisibleSync` 只跳过第一次，后续事件仍把 `revealLine` 发回预览
4. **已到底元素仍执行 scrollIntoView**：预览已到末尾后 `scrollToLine` 找到最后元素并执行 `scrollIntoView({ block: 'start' })`，把末尾元素拉到视口顶部，看起来像跳回开头

**修复**（分 4 轮迭代）：

```
迭代 1 — 比较判定法防循环（替换定时锁 isSyncing/isUserScroll）：
- webview→source：扩展收到 scrollSync 后，比较 webview 行号与源码当前顶部行号，
  差值 > 1 才执行 revealRange，否则跳过
- source→webview：不再加锁，onDidChangeTextEditorVisibleRanges +
  onDidChangeTextEditorSelection 双事件触发

迭代 2 — isScrolling 标记：
- 用户滚动时 isScrolling = true，revealLine 消息被忽略
- 停止滚动 500ms 后 isScrolling = false，触发 scrollSync

迭代 3 — skipVisibleUntil 时间窗口（替换一次性 skipNextVisibleSync）：
- scrollSync 处理后设置 skipVisibleUntil = Date.now() + 250ms
- 250ms 内所有 visibleRanges 事件被屏蔽，吸收异步多次触发

迭代 4 — 最终方案：
a) scrollIntoView 改为即时（移除 behavior: 'smooth'），不产生动画
b) scrollSync 仅前向同步：diff = message.line - currentTopLine，仅当 diff > 1
  （webview 领先源码）时才把源码往前拉，绝不往后拖
c) 超出范围保护：revealLine 目标行 > 最后渲染元素+2 时滚到文档底部而非 scrollIntoView
d) 不必要滚动跳过：匹配元素已在视口顶部 ±5px 内时跳过 scrollIntoView
```

**影响**: 无。

---

## B9 — 源码滚动超出预览末尾后预览跳回开头

**发现时间**: 2026-06-23 (双向同步功能验证)

**现象**: 源码行数远多于预览渲染行数。源码往下滑到超出预览末尾后，预览从末尾跳回开头并重新往下滚动。

**原因**: 源码超出预览末尾后，`revealLine` 持续发送大行号（如 300、400）。`scrollToLine` 找到最后渲染元素（data-line ≈ 150）并执行 `scrollIntoView({ block: 'start' })`，该调用把末尾元素拉到视口顶部——当页面内容短于视口高度时，效果等同于跳回文档顶部。随后每个新的 `revealLine` 消息把预览从顶部重新往下拉，产生 "跳到开头继续往下滑" 的视觉效果。

**修复**: `scrollToLine` 中添加保护：若 `revealLine` 目标行比匹配元素行号大 2 以上（即目标远超最后渲染内容），直接 `window.scrollTo(0, document.documentElement.scrollHeight)` 滚到文档底部，不再执行 `scrollIntoView`。同时添加不必要滚动跳过（匹配元素已在视口顶部 ±5px 内时跳过 `scrollIntoView`）。

```typescript
if (targetLine > elLine + 2) {
  window.scrollTo(0, document.documentElement.scrollHeight);
  return;
}
```

**影响**: 无。

---

## B10 — 图片加载失败

**发现时间**: 2026-06-23 (Phase 1 功能验证)

**现象**: 所有图片无法显示（简单模式和 `<fig>` 内均不显示），最终定位为 `<fig>` 内图片问题（B7）。

**原因**: 路径解析不正确——`vscode.Uri.joinPath` 在 Windows 上可能不处理 `../` 路径段，导致 `webview.asWebviewUri` 无法找到图片文件。数据 URI 回退方案使用 `path.join` 但未用 `path.resolve` 正规化路径。

**修复**:

1. 双重加载策略：先尝试 `webview.asWebviewUri`，失败后回退到 data URI
2. 路径正规化：使用 `path.resolve(docRootDir, relPath)` 解析 `../` 相对路径，再转换为 `Uri.file` 传入 `webview.asWebviewUri`
3. CSP `img-src ${webview.cspSource} data:` 同时允许两种方案
4. 始终渲染 `<img>` 元素（即使 src 为空），添加 `onerror` 诊断（红色边框 + 错误路径 + src 长度）

**影响**: 无。
