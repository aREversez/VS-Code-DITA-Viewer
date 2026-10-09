# VS Code DITA Viewer — 路线 B：WebHelp 兼容 DOM 设计计划

状态基线：`dev` 上 `6810d7b`（限定 keyref 之后）。
（原文写的是 `a424f53`，那是计划起草时作者本地的 commit，未进入本仓库任何 ref；此处按实际入库点更正。）
前置：路线 A（7 套内置模板、`.opt` 读元数据）已全部完成，其计划文档 `site-book-templates-plan.md` 与本文档同为起草阶段的私有工作文档，未入库；路线 A 的结果可从 `git log` 的 `feat(templates)` 系列与 README 的 *Templates* 一节读出。

本文档是**设计记录**，不是用户文档。用户/模板作者视角的接口说明在 README 的
*WebHelp-style templates (`"dom": "webhelp"`)* 一节；正文类名的逐项审计在
[`webhelp-body-class-diff.md`](webhelp-body-class-diff.md)。代码注释与 commit message 里的
「route B step N」「§2.3」「§7.3」等引用指向本文档的对应小节，因此**小节编号请勿重排**。

## 0. 调研结果（合规检查，按之前约定先做）

**WebHelp Responsive 本体没有公开源码。** 它是 Oxygen 的商业产品；DITA-OT 自带的 `org.dita.html5`
（Apache-2.0，在 `dita-ot/dita-ot` 仓库里）生成的是 DITA-OT 自己的 html5 DOM，不是 WebHelp 的 DOM，
两者不要混。能公开读到的只有 Oxygen 官方人员发布的几个定制示例仓库：

| 仓库 | 许可证 | 内容 | 本计划怎么用 |
|---|---|---|---|
| `oxygenxml/dita-ot-webhelp-responsive-custom-footer` | Apache-2.0 | XSLT 定制插件 | 不用 |
| `balasaalin/customizing-webhelp-responsive-webinar-2022` | Apache-2.0 | 官方网络研讨会的 7 个模板示例，含 4 份页面布局文件（`wt_topic.html` 等）和 10 份真实模板 css | **只读，作为 DOM 契约的依据** |
| `balasaalin/space-exploration` | 未声明许可证 | 一个 tiles 模板 | 不用 |

从第二个仓库能确认的事实：

1. **真实 `.opt` 比我们之前假设的多两层**：根下有 `<description>`，且 css/logo/favicon/fileset/parameters
   都包在 `<webhelp>` 里，另有 `<html-page-layout-files>`、`<html-fragments>`。我们的 `.opt` 读取器已经只在 `<webhelp>` 内扫描，
   `<logo>`、`<favicon>` 目前没读。
2. **模板 css 依赖三层东西**，不只是类名：
   - **L1 DOM 契约**：约 99 个类名 + 6 个 id（清单见 §1）。
   - **L2 CSS 自定义属性**：新版模板的主题接口，28 个变量（`--primary-color`、`--header-bg-color`、`--toc-bg-color` …）。
   - **L3 Bootstrap 4 栅格/工具类 + Oxygen 的基础 css**：`container-fluid` / `row` / `col-lg-3` / `d-none` / `d-md-block` / `navbar-*` 等。
     模板 css **只覆盖**，真正的结构布局来自 Oxygen 自带的基础 css——**这一层我们没有也不能复制，必须自己写**。
3. 页面骨架（顶栏 → 工具条 → 左目录 / 正文 / 右"本页"目录 → 页脚）在布局文件里是公开写明的。

**合规立场（工程判断，不是法律意见）**：

- 类名、id、DOM 层级属于互操作接口，按这个接口自己实现一份是常规做法；
- 不复制任何 Oxygen 的 css / js / 布局文件 / 图片进仓库或 vsix，上述示例仓库只作本地只读参考，不入库；
- 不实现 `whc:` 宏体系，不兼容 `html-page-layout-files`；
- 用户自己的 Oxygen 模板 css 由用户自己提供，扩展不分发。

按公开示例推断 DOM 契约、自己实现、不入库任何 Oxygen 内容——这一条已获同意，路线 B 据此实施。
（原文此处是「如果你对这一步有顾虑，说一声，我们就停在路线 A」的待确认提问。）

## 1. DOM 契约清单（v1 要支持的钩子）

按页面区域分组，括号内为模板 css 里出现频率最高的：

| 区域 | 钩子 |
|---|---|
| 顶栏 | `header.wh_header`、`.wh_header_flex_container`、`.wh_logo`、`.wh_publication_title`、`.wh_top_menu`（83 次，最常见）、`.wh_search_input` / `#searchForm` / `.wh_search_textfield` / `.wh_search_button` |
| 工具条 | `nav.wh_tools`、`.wh_breadcrumb`、`.wh_right_tools`、`.wh_navigation_links`（`.navprev` / `.navnext`）、`.wh_print_link`、`#wh_toc_button` |
| 左目录 | `#wh_publication_toc`、`.wh_publication_toc`、`li.topicref`（56 次）、`.has-children`、`.active`、`.expanded`、`.wh-tooltip`、`.close-toc-button` |
| 正文 | `#wh_topic_container`、`#wh_topic_body`、`.wh_topic_content`（带 `.body`）、`.wh_child_links`、`.wh_related_links`、`h1.topictitle1` … `topictitle6` |
| 右侧"本页" | `nav#wh_topic_toc`、`#wh_topic_toc_content` |
| 页脚 / 其它 | `footer.wh_footer`、`#go2top`、`body.wh_topic_page` / `wh_main_page` |
| 首页 tiles | `.wh_welcome`、`.wh_tiles`、`.wh_tile`、`.wh_tile_title`、`.wh_tile_shortdesc`、`.wh_tile_text`、`.wh_main_page_toc` |

v1 **不做**：搜索结果页（`wh_search_page`）、索引词页、`webhelp.*` 参数、`html-fragments` 占位符、`html-page-layout-files`、模板自带 js（`js/**`，与"模板不带脚本"一致）。

### 1.1 实施后的实际契约（与上表的差异）

上表是**调研到的全集**，不是实现范围。实现出来的契约是 `src/editor/webhelpContract.ts` 里的
`WEBHELP_HOOKS`（36 条：19 条 `required` + 17 条 `optional`）与 `WEBHELP_CSS_VARS`（28 个变量，与 §0 的计数一致）。
上表里有、但**没有进入契约**的钩子：搜索四件套（`.wh_search_input` / `#searchForm` / `.wh_search_textfield` /
`.wh_search_button`）、`.wh-tooltip`、`.close-toc-button`、`.wh_publication_toc`（class 形式，只保留了 `nav#wh_publication_toc`）。
原因是预览里没有对应的功能可挂——没有搜索页、没有 tooltip 系统、没有可关闭的目录抽屉。

契约里标为 `optional` 且**当前永不发出**的钩子：`.wh_welcome`、`.wh_tile_shortdesc`、`.wh_main_page_toc`、
`.wh_child_links`、`.wh_related_links`（related links 渲染为 `aside.related-links`）、`.wh_print_link`、`#wh_toc_button`。
`#go2top` 是唯一"发出但被隐藏"的：壳渲染按钮，`media/webhelp-compat.css` 把它 `display: none`，因为还没有脚本接线滚动行为。
这几项的语义在 README 的 *Never emitted* 段落里对模板作者说明，并由
`src/test/editor/webhelpContractTemplate.test.ts` 反向钉住（断言它们确实不出现），以免将来被无意加上。

## 2. 方案

### 2.1 新增一种 DOM 模式，不重写现有外壳

- 模板声明 `"dom": "webhelp"`（`template.json`）；**只有 `.opt` 的模板默认走 webhelp DOM**（它们的 css 本来就是按 WebHelp 写的），可用 `template.json` 的 `"dom": "own"` 强制回路线 A。
- 现有 7 套内置模板与路线 A 的 DOM 一行不动。`wrapShell` 加一个 `dom` 分支，webhelp 外壳由新的纯函数模块 `webhelpShell.ts` 生成（可单测，不依赖 vscode）。

### 2.2 同一批节点同时带两套类名，行为 JS 不复制

- 侧栏树：`<li class="site-nav-item topicref has-children expanded">`，我们的折叠/搜索/持久化/键盘导航/历史 JS 继续挂在自己的类与 `data-*` 上，模板 css 挂在 `wh_*` 类上。**不另做一套 DOM + 一套 JS**（parallel implementations drift 的教训）。
- 工具栏沿用路线 A 的做法"停靠进模板头部"：webhelp 模式下停靠进 `.wh_right_tools`，上一页/下一页的 handler 复用，不新写。
- 正文：`#dita-content-root` 仍是唯一被增量替换的节点，外面包 `#wh_topic_body`，自己带 `.wh_topic_content body`。
- "本页"目录：复用 Atlas 的 outline 列，输出到 `#wh_topic_toc`。

### 2.3 样式分层：用 `@layer` 解决"我们的默认样式 vs 模板样式"

- `media/styles.css` 的侧栏/外壳视觉规则放进 `@layer dv-base`，新增的 `media/webhelp-compat.css`（我们自己写的结构基础 css + Bootstrap 子集 + 28 个变量的默认值）放进 `@layer wh-compat`，**模板 css 不分层**，天然压过两者，无需 `!important`。
- Bootstrap 子集只写契约里实际用到的那几个类（`container-fluid` / `row` / `col-*` / `d-none` / `d-md-block` / `navbar*` / `collapse` / `sr-only`），不引入 Bootstrap。
- 性能相关声明（`content-visibility`、`.book-part`）按路线 A 的规定保留 `!important`，不在 layer 内。

实施后的补充：`styles.css` 里有**两条** webhelp 专属的 `!important`（`body.wh_topic_page` 作用域内），
刻意让模板覆盖不了——`#wh_topic_body { overflow: hidden }`（保证 `#dita-content-root` 是唯一的滚动容器，
Book 的滚动跟踪、outline、历史、搜索脚本都依赖它）和空的 outline 列隐藏
（`nav#wh_topic_toc:not(:has(#__site-outline:not(.tpl-outline--empty)))`）。
（`styles.css` 另有与 webhelp 无关的 `!important`，如 `.profile-filtered-out` 与 `body.mode-tree` 的工具栏隐藏，
不在本节范围。）理由与验证见 README 的 *Theme and cascade* 段。

### 2.4 正文 DOM 与 DITA-OT html5 类名的差距（最大的不确定项）

WebHelp 正文里是 DITA-OT html5 的类（`topictitle1`、`shortdesc`、`note_note`、`sectiontitle` …），模板 css 大量引用。
我们的渲染器现在 `topictitle1` 为 0 处、`sectiontitle` 为 0 处，与之有差距。依据用 `org.dita.html5` 的 XSLT（Apache-2.0，公开）里的类名，
**只对齐类名，不改标签结构**，并且只加类、不删现有类，避免影响现有 7 套模板与 diff/导出。这是单独一步，先审计出差异表再动手。

实施后的更正（详见 [`webhelp-body-class-diff.md`](webhelp-body-class-diff.md) §0）：起草时以为 html5 类名来自一张
「legacy 名表」，必须抓真实输出才能对齐；核对 DITA-OT 源码（`org.dita.html5/xsl`，核对时 `2feba49`）后确认它是**机械规则**——
`class` = DITA `@class` 祖先链的元素名 + 各模板写死的 `default-output-class` token + 作者的 `@outputclass`。
因此 C/D 级各项的期望类名可以直接从 DTD 推出，不必先抓输出。这一更正改变了 M2 的做法，也解释了为什么
`b` / `i` / `tt` 这类元素要输出 `ph b` 而不是 `b`。

## 3. 保真度预期（先说清楚）

| 层级 | 预期 |
|---|---|
| 颜色、字体、阴影、圆角（走 28 个变量 + 类名） | 基本可用 |
| 头部/目录/正文/页脚的大布局 | 接近，靠我们自己写的基础 css，没有 Oxygen 真实输出可比对 |
| 像素级一致 | **做不到、也不承诺**：基础 css 是我们重写的，细节必有出入 |
| tiles 首页、搜索页、索引页 | 首页 tiles 放 M3；搜索/索引不做 |

验收只能靠模板作者拿自己的 Oxygen 模板 css 本地试（仓库不收也不看这类文件）。仓库内的自动验收用**我们自己写的
"WebHelp 风格测试模板"**，它引用真实钩子，用来保证契约不回归——即
`test-dita-file/manual/templates/webhelp-contract/`，见 M3-11。

## 4. 实施步骤（每步独立可编译，先写 kill test）

**M1：站点模式主体**
1. `.opt` 读取补全：`<logo>`、`<favicon>`、`<description>`；`SiteTemplate` 增加 `dom`。（单测：真实结构的 `.opt` 夹具，我们自己写一份同结构的）
2. `webhelpContract.ts`：钩子清单做成带类型的常量 + 一个"外壳必须含全部钩子"的断言函数。（kill：用空外壳跑，列出缺失钩子）
3. `webhelpShell.ts` + `wrapShell` 的 `dom` 分支：顶栏/工具条/三栏/页脚。（jsdom 断言每个钩子存在、`#dita-content-root` 仍唯一）
4. 侧栏树双类名（`topicref` / `has-children` / `active` / `expanded`），只在 webhelp 模式输出。（kill：现有 siteNav 全部测试不变，新增断言）
5. `webhelp-compat.css`（`@layer`）+ `styles.css` 外层分层。（kill：styles.css 现有断言测试跟着改；Playwright 截图验证）
6. 头部：logo、出版物标题、顶部菜单（一级章节，`wh_top_menu`）；工具条：面包屑（用现有祖先栈）、上/下一页、停靠工具栏。
7. "本页"目录接入 `#wh_topic_toc`。

**M2：正文类名对齐**
8. 审计：我们的渲染输出 vs `org.dita.html5` 类名，出差异表（只列，不改），交确认范围。
9. 按确认的范围加类名。

**M3：首页与收尾**
10. 站点首页 tiles（`wh_welcome` / `wh_tiles` / `wh_tile*`），仅 site 模式；book 模式沿用"site 先行，book 跟随"。
11. 自带"WebHelp 风格测试模板" + `manual/templates/` 样本；Playwright 真实 Chromium 截图（site + book，浅/深）。
12. README 模板作者说明（支持/不支持的钩子清单）、CHANGELOG。

## 5. 风险

- **最高：L3 基础 css 重写**，没有真实输出可比，只能靠真实模板验收。缓解：M1 先做"能用的大布局"，截图确认再继续。
- 双类名会让 `styles.css` 里的 `.site-nav-*` 规则与 `wh_*` 规则同时命中同一节点：靠 `@layer` 解决，第 5 步单独 commit，先写"模板 css 一定胜出"的测试。
- 正文加类名可能影响 diff 高亮与导出：第 9 步只加不删，并跑全套回归。
- book 模式是单页长文，没有"当前页"：`wh_topic_page` 外壳照用，面包屑退化为 map 标题，同路线 A。

## 6. 明确不做

- 不复制或内置 Oxygen 的任何 css / js / 布局文件 / 图片；不实现 `whc:` 宏、`webhelp.*` 参数、搜索页、索引页、模板脚本。
- 不改路线 A 的 7 套内置模板与它们的 DOM；不动 diff 高亮与单 topic 预览的主题机制。

## 7. 已确认的默认选择

（原文为「待确认的默认选择」。四项均已确认，编号与顺序保持不变——commit message 与代码注释里有 `§7.3` 这样的引用。）

1. **合规立场**（§0）：按公开示例推断 DOM 契约，自己实现，不入库任何 Oxygen 内容——已同意，据此实施。
2. **只有 `.opt` 的模板默认走 webhelp DOM**，现有 `manual/templates/sample-opt`（按路线 A 写的）需要加 `"dom": "own"` 的 `template.json` 或改成新样本。
   实际处置：`sample-opt` 未加 `template.json`，保留 `.opt` → 走 webhelp DOM；它原有的 own-DOM 选择器在新壳下仍然命中，
   已在该 css 的注释里记为一条活体手动测试。
3. **范围**：M1 先做 site 模式，book 在第 3 步暴露问题就推迟；搜索页/索引页不做。
   实际结果：book 未推迟——Book 模式同样套 webhelp 壳，`test:visual` 里有 book 的浅/深两组断言。
4. 模板作者若有自己的 Oxygen 模板 css，验收时在其本地用；不入库。

## 状态跟踪

- [x] M1-1 `.opt` 补全 + `dom` 字段 — `f1551c4`（附 `e11f7d3` 第三方内容守卫）
- [x] M1-2 契约清单 + 断言 — `4464ba5`
- [x] M1-3 webhelp 外壳 — `eefd358`
- [x] M1-4 侧栏双类名 — `ac45a05`
- [x] M1-5 compat css + `@layer` — `9f620ae`
- [x] M1-6 头部 / 工具条 — `022923f`（修正 `6c8f7f9`、`b1a5188`）
- [x] M1-7 "本页"目录 — `82704c5`
- [x] M2-8 类名差异审计 — `844fcbf`（按 DITA-OT 规则更正：`bf7800f`）
- [x] M2-9 类名对齐 — `b832308`、`da5c795`、`8a61458`、`25f6802`、`50b78e4`、`3436bb1`
- [x] M3-10 首页 tiles — `feat(webhelp): the docsite landing page carries the contract's home hooks`
- [x] M3-11 测试模板 + 截图验证 — `test(webhelp): an acceptance template that styles the contract by name`
- [x] M3-12 文档 — `docs(webhelp): tell template authors which hooks exist`

M3 三项以 commit 主题而非 hash 标注：它们与本文档同批提交，入库后的 hash 取决于应用方式。

### 实施中偏离原计划的地方

- **M3-10 的 `wh_main_page` 语义**：计划未规定它与 `wh_topic_page` 的关系。实现为**附加共存**（首页两个 token 都带），
  而不是互斥——这样壳的规则在首页继续生效，代价是模板里 `body:not(.wh_topic_page)` 这类写法会把首页读成普通 topic 页。
  已写进 README。增量切页时由客户端 `syncMainPageToken()` 以 `#dita-content-root .site-home` 为唯一信号同步，
  因为 `MSG_UPDATE_CONTENT` 只替换 `#dita-content-root` 的内容，不会重发外壳。
- **M3-10 的 `wh_tile_shortdesc`**：实现为**不做**（原计划列在 tiles 里）。它需要读盘取每个 tile 目标的
  `<shortdesc>`，而首页 tiles 目前是纯导航结构；作为 `optional` 钩子留在契约里并被测试钉住缺席。
- **M3-11 的验收模板用 `.opt` 而非 `template.json`**：`parseTemplateJson` 没有顶层 `logo` 字段，而 webhelp 壳读的是
  `logoUri`（不读 `header.logo`），所以 `.wh_logo` 这个钩子只有 `.opt` 描述符能喂饱。模板因此按真实 `.opt` 形状写。
- **验收是双层的**（计划只要求截图验证）：cheerio 对真实渲染输出逐选择器求命中（不需要浏览器，进 `npm test`），
  加真实 Chromium 读回 computed style（进 `npm run test:visual`，独立于 `verify`）。前者防"钩子改名"，后者防"钩子名对但没布局"。
- **§2.4 的"只加不减"被写成可执行的 kill test**：路线 A 的快照输出要求逐字节不变，`test:visual` 里保留一个
  空模板对照组（`webhelp-plain`）来证明 compat 层自身的默认布局。
