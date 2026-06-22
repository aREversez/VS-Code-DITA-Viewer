# DITA Reading View — VS Code 扩展 — Phase 1 需求规格

> 状态:草稿 v0.1 — 与 SKILL.md 配套使用,随开发过程中暴露的真实问题持续更新。
> 本文档只覆盖 Phase 1(单文件原地渲染,只读)。Phase 2(map 上下文/keyref/conref)、
> Phase 3(DITAVAL 过滤/样式打磨)、编辑能力均明确排除在本阶段之外,见第 7 节。

## 1. 目标

打开 `.dita` topic 文件时**默认仍是普通源码视图**(不改变 VS Code 现有行为);编辑器标题栏
右上角新增一个按钮,点击后**主动切换**到格式化渲染后的只读视图,以恢复接近 Oxygen XML Editor
阅读体验的"阅读流"。这是用户主动触发的切换,不是自动替换默认编辑器——架构上对应
VS Code 自带的 Markdown 预览模式(默认源码,点按钮才出预览),而不是 Jupyter Notebook 那种
"打开即接管"模式。切回源码复用内置的 "Reopen Editor With → Text Editor"。

**非目标(本阶段明确不做,见第 7 节)**:map 上下文解析、跨文件 xref/keyref/conref、
DITAVAL 条件过滤、可编辑能力。但底层架构需要为这些后续阶段留出扩展空间(见第 4、9 节)。

## 2. 技术选型

| 决策点 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript / Node.js | VS Code 扩展宿主层硬性要求,与现有 Java/Maven 技术栈无关 |
| 编辑器集成方式 | `CustomTextEditorProvider`,`customEditors` 贡献点,`priority: "option"`(**不是** `"default"`),绑定 `.dita` | 打开文件默认仍是普通文本编辑器,自定义编辑器只能被显式调用,不会自动接管;底层仍是普通文本文档(git diff / LemMinX 校验等其他工具不受影响);API 双向,Phase 1 只读、Phase 2+ 可平滑加编辑,不需要重写 |
| 视图切换触发方式 | `editor/title` 菜单贡献点加图标按钮(`when: resourceExtname == .dita`,`group: "navigation"`)→ 命令 → `vscode.commands.executeCommand('vscode.openWith', uri, 'ditaReadingView.preview')` | 完全是用户主动触发,不监听文件类型自动接管;切回源码视图复用内置 "Reopen Editor With → Text Editor",Phase 1 不需要额外写"切回"按钮 |
| 渲染呈现 | Webview,扩展宿主侧生成静态 HTML 字符串后 `postMessage`/直接 `webview.html` 赋值 | Phase 1 是只读展示,不需要在 webview 内跑 React/前端框架,减少复杂度 |
| XML 解析 | `sax`(sax-js)包一层,自建带位置信息的轻量 DOM | 需要保留每个节点的源码行列位置(`parser.line`/`parser.column`),为 Phase 2 的"点击渲染内容跳源码行"和未来编辑功能预留;`fast-xml-parser`/`xmldom` 默认不保留位置信息 |
| 资源路径 | `webview.asWebviewUri()` 转换图片等本地资源路径 | Webview 有独立 CSP,直接用文件系统相对路径图片无法加载 |
| 构建工具 | esbuild | VS Code 官方扩展生成器(`yo code`)默认推荐,打包快、配置简单,项目体量用不上 webpack 的复杂度 |
| 代码风格 | ESLint(`@typescript-eslint` 推荐规则)+ Prettier + `eslint-config-prettier` | ESLint 抓逻辑层小问题(忘记 await、未用变量等),对 AI agent 写的代码是低成本安全网;Prettier 只管格式,不影响功能;配置从简,不用定制 |

## 3. 项目结构

```
dita-reading-view/
├── package.json                     # customEditors 贡献点在此声明
├── tsconfig.json
├── src/
│   ├── extension.ts                 # 入口,注册 CustomTextEditorProvider
│   ├── editor/
│   │   └── DitaReadingProvider.ts   # CustomTextEditorProvider 实现,负责文档→webview 的渲染触发
│   ├── parser/
│   │   ├── ditaParser.ts            # 基于 sax 的解析器,产出带位置信息的 DitaNode 树
│   │   └── domTypes.ts              # DitaNode 等类型定义
│   ├── render/
│   │   ├── baseTypeMap.ts           # class 属性 → base type → 渲染函数 的映射表(第 5 节)
│   │   ├── renderer.ts              # DitaNode 树 → HTML 字符串
│   │   └── styles.css               # webview 样式
│   └── webview/
│       └── main.ts                  # webview 侧脚本(Phase 1 仅处理本地锚点跳转,可以很薄)
├── media/                           # 复制进 webview 的静态资源(styles.css 等)
├── REQUIREMENTS.md                  # 本文档
└── SKILL.md                         # 待开发过程中产生真实 bug 后再补充,Phase 1 起步阶段可留空骨架
```

## 4. 核心数据结构

```typescript
// src/parser/domTypes.ts

interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

interface DitaNode {
  type: 'element' | 'text';
  tagName?: string;            // 原始标签名,如 "step"(调试/日志用,渲染时不应依赖它)
  classTokens?: string[];      // class 属性按空格切分后的完整 token 列表,如 ["-", "topic/li", "task/step"]
  baseType?: string;           // 解析后的兜底类型,如 "topic/li" —— 渲染时只认这个字段
  attributes?: Record<string, string>;
  children: DitaNode[];
  text?: string;
  sourceRange: SourceRange;    // 为 Phase 2 的"渲染内容↔源码定位"和未来编辑功能预留
}
```

**关键约定**:渲染层(`renderer.ts`)只允许读取 `baseType` 字段做分支,**禁止**直接用
`tagName` 做渲染判断。这是保证未知特化标签能优雅降级、不需要逐个标签名加规则的核心机制。

## 5. Base Type 解析规则与 Phase 1 映射表

### 5.1 解析规则(两层,2026-06 修订)

> ⚠️ **重要修订**:最初设计("读 class 属性")基于一个错误假设——以为手写 DITA 文件里
> `class` 属性会显式存在。实际上 `class` 是 DTD/Schema 里的 `#FIXED` 属性,只有经过
> DTD 校验或 DITA-OT normalize 处理后才会被"默认填入";**绝大多数真实手写的 `.dita`
> 文件里,这个属性根本不存在**。我们选用的 `sax` 是不做 DTD 校验的轻量解析器,所以照最初
> 设计,任何正常手写文件打开后所有元素的 `baseType` 都会是空的——覆盖率为零,不是
> "优雅降级",是设计本身没生效。下面是修订后的两层规则。

**第一层(主路径,覆盖绝大多数真实内容)**:按**标签名**查一张静态表
(`STANDARD_TAG_TO_BASETYPE`)。标准 DITA 元素(`p`/`note`/`step`/`cmd`/`title`/`table`/...)
不管所在 doctype 有没有做 specialization,标签名本身是固定的,完全不依赖 `class` 属性就能
查到 baseType。

**第二层(兜底,仅用于第一层查不到的标签名)**:当遇到一个**不在静态表里的标签名**
(大概率是某种特化元素)时,检查该元素**是否恰好带有 `class` 属性**(来源可能是经过
DTD/Schema 校验解析、DITA-OT normalize 处理过的文件,或作者手动写了 class 属性)。
如果有,按下面的 token 规则解析:

```
class="- topic/li task/step "
```

token 列表从最通用的祖先类型(靠左)排到最具体的特化类型(靠右),取**第一个**匹配
`topic/*`(或 `map/*`)的 token 作为 `baseType`。

**第三层(最终兜底)**:两层都查不到,落到"原样输出子内容、不包裹语义化标签"的规则
(第 5.2 节表格最后一行)。

> ⚠️ 待验证项:第二层的 token 顺序假设、以及静态表的完整性,建议都用真实文件验证。
> 静态表最可靠的来源是直接扫描 DITA-OT 安装目录里的 DTD/RNG 模块文件提取标签名↔class
> 对照,而不是凭记忆手写——后者容易有遗漏或错误(本文档第 5.2 节给的表本身就只是一个
> 起步子集,不是完整覆盖,见下方样例文件里 `<properties>` 系列标签的故意留空测试)。

### 5.2 Phase 1 映射表

| baseType | Phase 1 渲染目标 | 备注 |
|---|---|---|
| `topic/title` | 标题(`h1`~`h6`,按嵌套深度递增) | section/body 嵌套层级决定级别 |
| `topic/shortdesc` | 浅灰背景引导段 | 模拟 Oxygen 短描述视觉 |
| `topic/body`, `topic/section`, `topic/example` | `<section>` 容器 | |
| `topic/p` | `<p>` | |
| `topic/note` | 左侧色条提示框 | 颜色按 `type` 属性(note/warning/danger/important/tip)区分 |
| `topic/ul`, `topic/ol`, `topic/li`, `topic/sl`, `topic/sli` | 对应列表标签 | |
| `topic/dl`, `topic/dlentry`, `topic/dt`, `topic/dd` | 定义列表(`<dl>`/`<dt>`/`<dd>`) | concept/reference 类 topic 常见 |
| `topic/table`, `topic/tgroup`, `topic/thead`, `topic/tbody`, `topic/row`, `topic/entry`, `topic/colspec` | CALS → HTML `<table>` | 仅支持基础 `colspec` 列宽,跨行/跨列(`morerows`/`namest`/`nameend`)推迟到 Phase 1.5,见第 7 节 |
| `topic/simpletable`, `topic/sthead`, `topic/strow`, `topic/stentry` | 简化表格 | 无跨行跨列概念,实现更简单,优先做 |
| `topic/image` | `<img>`,经 `asWebviewUri` 转换路径 | 不要同时写死 width 和 height,否则拉伸变形(沿用之前在 PDF 排版上踩过的同一类坑) |
| `topic/fig` | `<figure>` + `<figcaption>`(取子节点 `topic/title`) | |
| `topic/codeblock`, `topic/pre` | `<pre><code>` | |
| `topic/xref`, `topic/link` | 可点击链接 | Phase 1 仅处理本指向同文档内 `#id` 的锚点,跨文件/keyref 解析推到 Phase 2 |
| `topic/b`, `topic/i`, `topic/u`, `topic/tt`, `topic/sup`, `topic/sub` | `<strong>`/`<em>`/`<u>`/`<code>`/`<sup>`/`<sub>` | |
| `topic/q`, `topic/lq` | 行内引号 / 块引用 | |
| `topic/keyword`, `topic/term` | 轻量高亮 `<span>` | |
| 任何无法匹配上述表的情况(`baseType` 解析不到 `topic/*`,或表里没有对应规则) | 原样输出子内容,不包裹语义化标签 | 保底兜底,**绝不能因为不认识的标签而报错或留空白** |

## 6. 功能需求清单(Phase 1)

- **FR-1** 在 `package.json` 的 `customEditors` 贡献点注册 `.dita` 文件,`priority: "option"`——
  默认打开方式不变,自定义编辑器只在被显式调用时生效。
- **FR-1a** 注册一个命令(如 `ditaReadingView.showRendered`)和对应的编辑器标题栏图标按钮,
  `when` 限定为 `.dita` 文件;点击后执行 `vscode.openWith(document.uri, 'ditaReadingView.preview')`,
  在当前标签页内切换到渲染视图(原地替换,不分屏;如果之后想要分屏同时看源码+渲染,
  改成传 `ViewColumn.Beside` 即可,不影响其他部分设计)。
- **FR-2** `DitaReadingProvider` 在文档打开/内容变化时,调用解析器产出 `DitaNode` 树,再调用
  渲染器生成 HTML,写入 webview。Phase 1 不监听 webview → 文档的反向编辑事件。
- **FR-3** 解析器遇到元素节点时,解析其 `class` 属性,按第 5.1 节规则填充 `baseType`;
  没有 `class` 属性的非标准元素,`baseType` 置空,走表格最后一行的兜底规则。
- **FR-4** 渲染器**只**依据 `baseType` 分支,不依据 `tagName`。
- **FR-5** 本地 `xref`(`href="#some-id"` 或不带文件名的纯锚点)点击后,webview 内滚动定位到
  对应元素;非本地 href(指向其他文件)在 Phase 1 暂时渲染为不可点击的纯文本标题提示
  (例如显示"→ 引用其他文件,Phase 2 支持"),不抛错、不静默失败。
- **FR-6** 图片等本地资源路径必须经过 `webview.asWebviewUri()` 转换。
- **FR-7** CALS 表格:Phase 1 支持基础结构(`tgroup`/`colspec` 列宽、普通行列),复杂的
  `morerows`/`namest`/`nameend` 跨行跨列作为 Phase 1.5 验收时再决定是否纳入。
- **FR-8(可选,Fast-follow)** 渲染视图内提供一个"切回源码"按钮,执行
  `vscode.openWith(document.uri, 'default')` 或等效操作。Phase 1 最小范围可以不做这条——
  用户用 VS Code 内置的 "Reopen Editor With → Text Editor" 一样能切回。这个按钮的 `when`
  条件大概率要依赖 `activeCustomEditorId` 这个上下文键,**没有在本机实测验证过准确性**,
  实现前对照 VS Code 官方 "When Clause Contexts" 参考文档核对一下键名,不卡 Phase 1 验收。

## 7. 非目标 / 明确推迟事项

| 事项 | 推迟到 |
|---|---|
| `.ditamap` 渲染、map 结构树/面包屑导航 | Phase 2 |
| 跨文件 `xref`、`conref`/`conref-range`、`keyref`/`conkeyref`、keyspace 解析 | Phase 2 |
| DITAVAL 条件过滤(`audience`/`platform`/`props`) | Phase 3 |
| CALS 表格的跨行跨列(`morerows`/`namest`/`nameend`) | Phase 1.5(视 Phase 1 验收情况) |
| 编辑能力(webview → 文档反向写入) | Phase 2 或更晚,取决于 Phase 1 验收后的优先级判断 |

## 8. 验收标准

1. 用真实的 task / concept / reference 三种 topic 类型样例文件分别打开,**默认仍是普通
   源码视图**;点击编辑器标题栏的新按钮后,正确切换为格式化渲染视图。
2. 准备至少一个**含未知特化标签**的样例文件(例如某个公司内部 domain 的特化元素),打开后
   不报错、不空白,至少按其 `topic/*` 兜底类型正确降级渲染。
3. CALS 表格样例(含 `colspec` 但不含复杂跨行跨列)渲染结构与预期一致。
4. 图片元素能正常显示,验证 `asWebviewUri` 路径转换在嵌套目录结构下也成立。
5. 本地 `id` 锚点 `xref` 点击后能正确滚动定位。
6. 来回切换(按钮触发"源码→渲染"、"Reopen Editor With"触发"渲染→源码")不丢失/不污染文档
   内容(因为 Phase 1 只读,这一条理论上必然满足,但仍需实测确认 webview 渲染过程不会触发任何
   对底层 `TextDocument` 的意外写入)。

## 9. 已知风险 / 待确认事项

- **`class` 属性 token 顺序假设**(第 5.1 节)必须用真实文件验证,这是整个映射表的地基,
  错了会导致所有特化标签的兜底渲染全部失效。建议作为开发第一个任务执行。
- **SAX 解析的位置信息精度**(行列号 vs 字符偏移量)目前只是"留个字段",Phase 1 不会真正用到;
  但 Phase 2 如果要做"点渲染内容跳源码"、未来若做编辑功能,需要回头确认这个精度是否够用,
  现在不需要纠结,但 `sourceRange` 字段的形状不要随便改。
- **非本地 href 在 Phase 1 的展示方式**(FR-5)目前是"占位提示文字",验收时可以根据实际
  阅读体感决定是直接隐藏链接样式还是保留更明显的"待 Phase 2 支持"视觉提示。