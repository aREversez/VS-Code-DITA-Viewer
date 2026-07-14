# DITA Viewer 开发路线图

**审查基准**: `dev` 分支 @ `444bb3c`
**日期**: 2026-07-14
**范围**: 本文档整理下一阶段开发方向（DITA 预览加固 → DITAMAP 预览 → DITA-OT Transform 集成），
以及本轮代码审查中发现的具体问题（作为阶段 A 的输入）。当前未对代码做任何改动。

---

## 现状速览

- 架构清晰：`sax` 解析 → `DitaNode` AST（`src/parser`）→ 按 `baseType` 分发渲染（`src/render`）→
  `CustomTextEditorProvider` 承载 webview 并做双向滚动同步（`src/editor/DitaViewerProvider.ts`）。
- `src/test` 下 29 个单测全部通过（parser 9 个 + renderer 20 个）。
- DITA `.dita` 主题（topic）的元素覆盖已经比较完整：段落/列表/表格/图片/代码块/交叉引用/内联格式/
  conref/keyref 均已支持。
- **`.ditamap` 目前只是"被读取"，还不能被预览**——`DitaViewerProvider.ts` 里的 `buildKeyMap()` /
  `findDitamapFiles()` 只是用正则从 ditamap 原始文本里抠 `keydef`/`topicref` 的 `keys` 属性，
  用来支撑 `.dita` 内的 keyref 解析，本身并不渲染 ditamap。
- 尚无 Transform（DITA-OT）能力。
- 仓库里没有 CI（`.github/workflows` 不存在），`npm run lint` 当前无法运行。

---

## 阶段 A：加固现有 DITA 预览

目标：在扩展新功能之前，把现有 `.dita` 预览的地基打牢——安全问题优先级最高，其次是会导致真实
文档无法预览的健壮性问题，再是死代码清理和 CI。这一阶段改动量都不大，但应该在阶段 B/C 之前完成，
否则 DITAMAP/Transform 会在同样的坑上再摔一次（比如同样用正则解析 XML、同样漏转义属性）。

### A1. 安全修复（P0）—— 属性注入 XSS

**问题**：`src/render/baseTypeMap.ts` 定义了 `escapeAttr()`，但只在少数几处（`boolean`、
`abbreviated-form`、`image` 的 `data-src`）被调用。以下位置把属性值**未转义**地拼进 HTML 字符串：

| 渲染器 | 未转义的属性 |
|---|---|
| `topic/topic` | `id` |
| `topic/section` | `id` |
| `topic/example` | `id` |
| `topic/table` | `id` |
| `topic/simpletable` | `id` |
| `topic/fig` | `id` |
| `topic/anchor` / `anchorid` | `id` |
| `topic/xref` | `href`（内部锚点分支） |
| `topic/image` | `alt` |
| `topic/fn` | `id`（拼进 class 属性） |

XML 属性值可以用单引号包裹、内部含字面双引号字符（合法 XML），例如：

```xml
<topic id='x"><img src=x onerror="alert(document.cookie)">'>
```

已实测验证渲染结果：`id` 属性被"越狱"，注入了一个真实的 `<img onerror=...>` 标签；`xref` 的 `href`
同理可被打穿。由于 webview 的 CSP 为 `script-src 'unsafe-inline'`，注入的事件处理器**会真实执行**。
攻击面：任何人只要能让受害者打开一个精心构造的 `.dita` 文件（第三方仓库、邮件附件等），即可在
webview 上下文中执行任意 JS（可拿到 `acquireVsCodeApi()`，可 `postMessage` 影响源码编辑器的
选区/滚动）。

**修复方向**：
1. 不要依赖每个 renderer 自己记得调用 `escapeAttr`，改为在唯一的"属性拼接"出口统一转义
   （例如扩展 `injectAttributes()`，或给所有 renderer 传入的 `getAttr` 包一层自动转义的变体，
   仅在明确需要原始值时才 opt-out）。
2. 收紧 CSP：把 `script-src 'unsafe-inline'` 换成基于 nonce 的白名单。这样即使将来某处转义又漏了，
   也不会直接变成代码执行——是纵深防御，不能替代第 1 条。
3. 补回归测试：对 `id`/`href`/`alt` 等属性喂入含 `"` / `<` / `>` 的字符串，断言输出中特殊字符已被
   转义。当前测试套件里没有任何一条覆盖属性转义，这类回归很容易在未来重构中被引入而不被发现。

### A2. 健壮性修复

**自定义 XML 实体导致整份文档解析失败**：DITA 常见写法是在 DOCTYPE 内部子集声明变量实体
（例如产品名复用）：

```xml
<!DOCTYPE topic ... [ <!ENTITY prodname "MyProduct"> ]>
...&prodname;...
```

实测 `sax.parser(true, ...)` 遇到非预定义实体直接抛 `Invalid character entity`，导致
`parseDita()` 抛异常（虽然 `generateHtml()` 有 try/catch 兜底显示错误页，不会崩插件，但这类文件
完全无法预览）。标准预定义实体（`&amp;`）、数字字符引用（`&#160;`、`&#x00e9;`）、只有
PUBLIC/SYSTEM 声明不含内部子集的 DOCTYPE 均已验证工作正常，问题仅限于自定义命名实体。

建议：解析前做一次轻量预处理——从 DOCTYPE 内部子集里提取 `<!ENTITY name "value">` 声明，
建立替换表，在喂给 `sax` 之前把文本中的 `&name;` 替换掉。

**DITAMAP 解析目前是正则，不是结构化解析**：`buildKeyMap()` / `findDitamapFiles()` 用正则
（`/<(?:topicref|keydef)[^>]*.../gi`）硬啃 ditamap 原始文本，无法正确处理注释、CDATA、跨行属性、
自闭合标签的各种写法、命名空间前缀等。鉴于阶段 B 就要做结构化的 DITAMAP 解析，这部分应该提前
迁移到复用现有的 `sax` 解析器，一次性解决，避免同一套逻辑维护两份实现。

**`parseDocRoot()` 的无工作区兜底在非 Windows 上是错的**：没有打开 VS Code workspace 时，它用
`dir.split(/[\\/]/).slice(0,2).join('\\')` 硬编码反斜杠拼"根目录"，这是 Windows 盘符假设。
在 Linux/macOS 路径下会拼出类似 `\home` 这种不存在的路径，导致向上查找 `.ditamap`/`custom.css`
的循环提前退出。应改为使用 `path.sep`，或者更稳妥地直接用 `dirname(docUri.fsPath)` 逐级向上找到
文件系统根（`/` 或盘符根）为止。

**`related-links` 里的 `link` 没有使用 `href`**：`topic/link` 渲染器目前只是 pass-through
渲染子节点（即 `linktext`），`href` 属性被完全忽略，点击没有任何反应——连 `xref` 那种
"引用其他文件，Phase 2 支持"的占位提示都没有。

### A3. 死代码 / 维护性清理

- `src/webview/main.ts` 完全没有被打包（`esbuild.config.js` 的 `entryPoints` 只有
  `src/extension.ts`），是孤立死代码，且与 `DitaViewerProvider.ts` 里 `getWebviewScript()`
  内联的锚点滚动逻辑功能重复、已经不同步。建议直接删除，或者反过来把 provider 里的内联脚本
  迁移过来统一维护（如果未来想让 webview 脚本可单测，后者更好）。
- `topic/note` 渲染器里手写的 `conref` 分支是死代码：`renderElement()`（`renderer.ts`）在分发到
  具体 renderer **之前**已经通用地对每个节点解析了 `conref` 并把该属性从 `attributes` 中剥离，
  所以 `note` renderer 里 `getAttr(node, 'conref')` 永远拿到 `undefined`，这段 if 分支永远不会
  被执行到（已用脚本验证）。可以安全删除，减少认知负担。
- `NOTE_LABELS_ZH` / `NOTE_LABELS_EN`（`baseTypeMap.ts`）未被使用（`eslint` 报
  `no-unused-vars` warning），真正生效的 i18n label 是 `DitaViewerProvider.ts` 里单独维护的
  一份同名结构。两份定义容易改一处漏一处，建议合并成一份、从 provider 传入。
- `src/render/styles.css` 是孤儿文件：代码里 `generateHtml()` 只加载
  `media/styles.css`，`src/render/styles.css` 从未被引用，且两者已经产生 70 行差异。容易有人
  改错文件，建议删除孤儿文件或者建立唯一数据源（build 时从一份拷贝到另一份）。

### A4. 测试与 CI

- `npm run lint` 当前直接报错退出（`Invalid option '--ext'`）——项目已经迁移到 flat config
  （`eslint.config.js`），但 `package.json` 的 `lint` 脚本还在传旧版 CLI 的 `--ext` 参数。
  改成 `eslint src/` 即可（已验证可正常运行，目前有 3 条 unused-vars warning，即上面提到的
  `NOTE_LABELS_ZH`、`renderer.ts` 里的 `_`、测试文件里未用的 `DitaNode` import）。
- 仓库目前没有 `.github/workflows`。建议参考 FocusOCR 项目的做法，加一条最基础的 CI
  （`ubuntu-latest` 上跑 `npm ci && npm run build && npm test`，lint 修好后加进去），
  在测试套件还小、改动频繁的阶段尽早接入，防止回归。

### A5. 现有功能查漏补缺

- `xref` 指向其他文件时目前只显示占位符"→ 引用其他文件，Phase 2 支持"。仓库自带的测试夹具
  `test-dita-file/topics/db_overview.dita` 里就有 `<xref href="db_config.dita#db_config"/>`
  这种真实场景。可以复用 `makeConrefResolver()` 里已有的"加载其他文件 + 按 id 查找元素"逻辑，
  把目标文件的标题解析出来显示，并支持点击后在编辑器里打开目标文件（跳转到对应行）。这一项
  收益大、复用现有代码多，建议和 A1 一起先做。

---

## 阶段 B：DITAMAP 预览

目标：让 `.ditamap`（以及后续可能的 `.bookmap`）像 `.dita` 一样有专门的 Reading View，而不是只
作为 keyref 数据源被正则抠取。

### B1. 结构化解析

新增一套 map 专用的 tag → baseType 映射（类比 `standardTagMap.ts`，但独立一份，因为同名标签在
map 上下文和 topic 上下文含义不同）：`map`、`title`、`topicmeta`、`topicref`、`topichead`、
`topicgroup`、`keydef`、`reltable`/`relheader`/`relrow`/`relcell`、`navref`、`mapref`、`anchor`。
直接复用现有的 `sax` 解析器（`parseDita` 的实现思路可以抽出一个通用的 `parseXml`，不必重写解析层），
替换掉阶段 A2 里提到的正则实现。

需要注意 DITA 特化（specialization）机制：bookmap 里的 `chapter`/`appendix`/`part` 等标签的
`class` 属性会形如 `"- map/topicref bookmap/chapter "`，即同时携带通用基类和特化类。当前
`parseBaseType()` 的 fallback 逻辑（`TOPIC_PATTERN = /^(topic|map)\//`）只会匹配到
`map/topicref`，不会单独识别 `bookmap/chapter`——这对第一版渲染问题不大（按 `topicref` 通用处理
即可），但如果想显示"章节/附录"这类更语义化的标签，需要专门处理 class 属性里的特化 token。

### B2. 渲染 UI

DITAMAP 本质是层级导航结构，不是线性文档，建议渲染成**可展开/折叠的大纲树**，而不是简单堆叠的
`<ul>`：
- 每个 `topicref` 节点显示其 `navtitle`/`linktext`（取自 `topicmeta`）或回退到 `href` 文件名；
- 节点可点击，通过 postMessage 让扩展宿主用 `vscode.window.showTextDocument` 或
  `vscode.commands.executeCommand('vscode.openWith', ...)` 打开对应的 `.dita` 文件（复用现有的
  Reading View）；
- `keydef` 单独分组展示（当前它们没有 `href`，是纯粹的 key-value 定义，不适合出现在导航树里）；
- 可选：增加一个"整书预览"模式——按 map 顺序把每个 `topicref` 指向的 topic 实际解析、渲染并拼接
  成一份完整文档（复用阶段 A 已有的 `parseDita`/`renderDocument`）。这本质上是一个零依赖的
  轻量"合并转换"，也是阶段 C 的自然铺垫。

### B3. 编辑器集成

镜像 `.dita` 现有的注册模式（`package.json` 的 `customEditors`/`languages`/`commands`/
`keybindings`/`menus`），新增：
- `languages` 增加 `.ditamap` 语言关联；
- 新的 `customEditors` 条目（例如 `viewType: ditaViewer.mapPreview`），**特别注意** `bugs.md`
  里 B1 记录过的坑：`selector.filenamePattern` 必须全小写连写，写成 `fileNamePattern` 会导致
  `resolveCustomTextEditor` 完全不被调用；
- 对应的命令、快捷键、右键菜单入口。

### B4. 验收标准

- 打开仓库自带的 `test-dita-file/test.ditamap`，能看到 `topicref` 列表（含 `keys`/`href` 两种
  写法）渲染成可点击的树，`keydef` 单独可见；
- 点击某个 `topicref` 能正确打开 `topics/db_overview.dita` 等对应文件的 Reading View；
- 单测�covers map 专用 tag→baseType 映射与树形渲染的基本形态。

---

## 阶段 C：DITA-OT Transform 集成

目标：在插件里提供"用 DITA-OT 跑一次正式发布转换"的入口，作为阶段 B "轻量整书预览"之外的
高保真发布通道。

### C1. 定位：检测 + 外部调用，而非打包

DITA-OT 是 Java 生态的重量级外部工具（依赖 JRE，体积以百 MB 计），不适合也不应该打包进 VSIX。
合理做法是把它当作可选的外部工具，做"探测 + 调用"：
- 新增配置项 `dita-viewer.ditaOtPath`（用户手动指定安装目录），同时尝试自动探测
  `DITA_HOME` 环境变量或 PATH 上的 `dita` / `dita.bat` 可执行文件；
- 探测不到时不要直接报错，而是给出清晰的安装引导文案（指向 DITA-OT 官方下载页），并让相关命令
  在探测失败时置灰或提示，而不是静默失败。

### C2. 交互流程

新增命令 "DITA: Transform with DITA-OT"：
1. 确定输入：优先取当前打开且被识别为 map 根的 `.ditamap` 文件（没有则提示用户选择）；
2. 弹 `QuickPick` 让用户选 transform 类型（`html5`/`pdf`/`xhtml`/`markdown` 等，可先支持
   `html5` 一个打底，验证流程通顺后再加其他）；
3. 用 `child_process.spawn` 调用 `dita -i <map> -f <transtype> -o <outDir>`，把 stdout/stderr
   实时打到一个专门的 `OutputChannel`，同时用 `vscode.window.withProgress` 显示进度（DITA-OT
   首次启动较慢，需要设置合理的用户预期，比如提示"首次转换可能需要较长时间"）；
4. 转换完成后：
   - `html5` 类型：直接在内部 webview 或系统默认浏览器里打开输出目录下的 `index.html`；
   - 其他类型（如 `pdf`）：提示"转换完成"并提供"打开输出文件夹"的按钮。

### C3. 风险与渐进策略

- DITA-OT 命令行参数、输出目录结构在不同大版本之间有过变化，建议先支持一个明确声明支持的
  版本区间，并在文档里写清楚，而不是假设"能跑就行"；
- 转换失败（比如 map 里有断链、缺少必需的 `bookmap` 元数据）时，DITA-OT 的报错信息本身对最终
  用户并不友好，建议做基本的错误信息分类/高亮（至少把 `[ERROR]` 级别的行单独标红），而不是原样
  甩一堆日志；
- 这一阶段和阶段 A/B 相比风险最高（依赖外部环境、涉及进程管理），建议放在最后，且先以最小可用
  的单一 transform 类型（`html5`）验证完整链路，再逐步扩展。

---

## 优先级小结

| 阶段 | 内容 | 依赖 | 建议顺序 |
|---|---|---|---|
| A | 修 XSS、修健壮性 bug、清死代码、补 CI、xref 跨文件解析 | 无 | 立即开始 |
| B | DITAMAP 结构化解析 + 树形预览 + 编辑器注册 | 依赖 A2 里 ditamap 解析迁移到 sax | A 之后 |
| C | DITA-OT 检测与调用、transform 命令 | 依赖 B（通常以 ditamap 为转换入口） | B 之后 |
