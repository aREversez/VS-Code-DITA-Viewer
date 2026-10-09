# WebHelp html5 body-class 对齐差异表（已按 DITA-OT 源码核对）

本表审计「渲染器实际发出的 CSS 类名」与「DITA-OT `org.dita.html5` 输出类名」之间的差异，
供 M2 系列（route B 计划 §2.4「只加不减」）逐条对齐使用。

- 渲染器类名来源：`src/render/baseTypeMap.ts`
- html5 基准来源（两层）：
  1. 项目自带的真实 DITA-OT 输出 fixture（`src/test/editor/siteChromeContent.test.ts` 的
     `REAL_TOPIC_BODY` / `REAL_TABLE` / `REAL_CODEBLOCK`）；
  2. **DITA-OT 源码本身**（Apache-2.0，`dita-ot/dita-ot` 仓库的 `org.dita.html5/xsl`，核对时为 `2feba49`，
     2026-09-30）与 OASIS DITA 1.3 DTD（同仓库 `org.oasis-open.dita.v1_3/dtd`）。只读类名事实，不复制任何代码。
- 对齐原则：§2.4 纯附加——加 html5 类 token，保留自有关键字与语义标签，以免破坏 7 个内置模板与 diff/export。
- 本表只覆盖 topic 侧 body 内容类名；map 侧树类另见 `ac45a05`。

## 0. 先更正前一版的前提：html5 类名是机械规则，不是「legacy 名表」

前一版写「html5 输出名走 legacy 名表而非 localname 推导，必须抓到真实输出」。**这个前提不成立。** 源码里的规则是：

1. `args.html5.classattr` 默认 `yes`（`plugin.xml` 该参数 `default="true"` 的值是 `yes`；`topic.xsl:28`
   `PRESERVE-DITA-CLASS` 默认 `'yes'`）。此时每个元素的 `class` = **DITA `@class` 祖先链的元素名**
   （去掉模块前缀，`mode="get-element-ancestry"`），按祖先顺序排列。
2. 再叠加各模板写死的 `default-output-class` token（如 `dlterm`、`sliexpand`、`compact`、`note_{type}`、
   `topictitle{N}`），最后是作者的 `@outputclass`，整体去重。

fixture 里那几个「看起来像 legacy」的 token 正是这两部分：`body conbody` = 祖先链
`topic/body concept/conbody`；`note caution note_caution` = 祖先 `note` + 默认 token；`topictitle1` = 默认 token。
所以：**C/D 级各项的期望类名现在就能从 DTD 的 `@class` 直接推出，不必先抓真实输出**；抓输出仍有用，
但作为回归 fixture，而不是前置条件。

> 由此，凡「期望类 = 元素 localname」的写法都要改成「期望类 = 祖先链」。下表已按此重算。

## 1. 逐项核对（DTD `@class` → html5 类名 → 现状 → 动作）

标记：✅ 与 html5 一致；➕ 缺 token，可纯附加；⚠️ 原表期望值有误（已更正）。

### 1.1 已对齐（A 级，fixture 背书）

| 元素 | html5 类（祖先 + 默认） | 渲染器现状 | |
|---|---|---|---|
| title | `title topictitle{N}` / `title sectiontitle` | 同 | ✅ |
| shortdesc / p / section / ul / li / image | `shortdesc` / `p` / `section` / `ul` / `li` / `image` | 同 | ✅ |
| note | `note {type} note_{type}`（fixture 为 `note caution note_caution`） | `note note--{type} {type} note_{type}`（多一个自有 `note--`） | ✅（原表漏写裸 `{type}`，渲染器其实已输出） |
| fig | `fig`（+ 默认 `fignone`） | `fig` | ✅（`fignone` 见延后段） |
| CALS table | `table` + `thead`/`tbody`/`row`/`entry` | 同 | ✅ |
| codeblock | `+ topic/pre pr-d/codeblock` → `pre codeblock` | `pre codeblock` | ✅ |

### 1.2 已提交但需复核（原 B 级）

| 元素 | DTD `@class` | html5 类 | 现状 | 结论 |
|---|---|---|---|---|
| ol | `- topic/ol` | `ol`（`compact="yes"` 时 + `compact`） | `ol` | ✅ |
| screen | `+ topic/pre ui-d/screen` | `pre screen` | `pre screen` | ✅ 祖先链即如此 |
| msgblock | `+ topic/pre sw-d/msgblock` | `pre msgblock` | `pre msgblock`（原表归 C 级待加） | ✅ 期望正确，仍待加 |
| lines | **`- topic/lines`** | **`lines`**（元素是 `<p>`） | `pre lines` | ⚠️ 原表期望 `pre lines` 有误：`lines` 不在 pre 族。现状多一个 `pre` token |
| pre（原表称 `preformatted`） | `- topic/pre` | `pre` | `pre preformatted` | ✅ 超集可保留；注意 DITA 没有 `preformatted` 元素，这是 `topic/pre` 的自有 token |

⚠️ `lines` 的 `pre` token 来自 `da5c795` 的「pre 家族」规则，但按祖先链 `lines` 不属于该家族。
多出的 `pre` 目前无害（无样式点名 `.pre`），但与 html5 不一致；是否去掉是取舍，见 §4。

### 1.3 缺 token，可附加（原 C 级）——期望值已更正

| 元素 | DTD `@class` | **html5 应为** | 原表期望 | 现状 | |
|---|---|---|---|---|---|
| dl | `- topic/dl` | `dl`（+ 源码里按 compact 的默认 token，见 `topic.xsl:763`） | `dl` | 无类 | ➕ |
| dt | `- topic/dt` | **`dt dlterm`**（首项且 `compact="no"` 时 `dt dltermexpand`） | `dt` | 无类 | ⚠️ 漏了默认 token |
| dd | `- topic/dd` | `dd` | `dd` | 无类 | ➕ |
| q | `- topic/q` | `q` | `q` | 无类 | ➕ |
| lq | `- topic/lq` | `lq` | `lq` | 无类 | ➕ |
| cite | `- topic/cite` | `cite` | `cite` | 无类 | ➕ |
| b | `+ topic/ph hi-d/b` | **`ph b`** | `b` | 无类 | ⚠️ |
| i | `+ topic/ph hi-d/i` | **`ph i`** | `i` | 无类 | ⚠️ |
| u | `+ topic/ph hi-d/u` | **`ph u`** | `u` | 无类 | ⚠️ |
| tt | `+ topic/ph hi-d/tt` | **`ph tt`**（html5 元素是 `<span>`，我们是 `<code>`，保留语义标签） | `tt` | 无类 | ⚠️ |
| sup | `+ topic/ph hi-d/sup` | **`ph sup`** | `sup` | 无类 | ⚠️ |
| sub | `+ topic/ph hi-d/sub` | **`ph sub`** | `sub` | 无类 | ⚠️ |
| line-through | `+ topic/ph hi-d/line-through` | **`ph line-through`** | `line-through` | 无类 | ⚠️ |
| overline | `+ topic/ph hi-d/overline` | **`ph overline`** | 未列（漏数） | `overline` | ⚠️ hi-d 第 8 个成员，review/表/commit/测试一致漏掉；渲染为 `<span>`，须额外 `:not(.overline)` 防调暗 |
| synblk | **`+ topic/figgroup pr-d/synblk`** | **`figgroup synblk`** | `pre synblk` | `synblk` | ⚠️ 原表方向错：synblk 是 figgroup 特化，**不是** pre 族，不该加 `pre` |

八个高亮域元素（b/i/u/tt/sup/sub/line-through/overline）的祖先链都含 `ph`，所以应是 `ph b` 而不是 `b`。
按原表只加 `b` 会既不等于 html5，也命不中模板里写成 `.ph` 的规则。

### 1.4 类名分歧（原 D 级）——现在可直接核定，不必先抓输出

祖先链就是答案；自有 token（`simple-list` 等）继续保留，只是**加上** html5 token。

| 元素 | DTD `@class` | html5 类 | 现状 | 动作 |
|---|---|---|---|---|
| sl | `- topic/sl` | `sl`（元素 `<ul>`） | `simple-list` | ➕ 加 `sl`，保留 `simple-list`（`styles.css:433` 依赖） |
| sli | `- topic/sli` | `sli`（父 `compact="no"` 时 + `sliexpand`） | `li` | ➕ 加 `sli`；保留 `li` |
| simpletable | `- topic/simpletable` | `simpletable`（frame/rules 默认 token **未核**） | `simple-table` | ➕ 加 `simpletable`，保留 `simple-table`（`styles.css:488-489`） |
| sthead / strow / stentry | `- topic/sthead` 等 | 同名 | 无类 | ➕ 同名 |
| div | `- topic/div` | `div` | `body-div` | ➕ 保留 `body-div`（`styles.css:713`） |
| bodydiv | `- topic/bodydiv` | `bodydiv` | `body-div` | ➕ |
| sectiondiv | `- topic/sectiondiv` | `sectiondiv` | `section-div` | ➕ 保留 `section-div`（`styles.css:714`） |
| object | `- topic/object` | `object` | `dita-object` | ➕ 保留 `dita-object` |
| linktext | — | — | 裸 passthrough | 仍需结构包裹，走 M2-8 审批 |

## 2. 碰撞面（按更正后的 token 重查）

原表对其 13 个 token 的「全部无命中」结论成立，但那 13 个里有 7 个本身错了。按**更正后**的 token 重查
渲染器 DOM 能加载的样式表（`styles.css`、`webhelp-compat.css`、`diff-styles.css`、7 个模板、
`site-shell.css`、`template-chrome.css`）：

| token | 命中 | 影响 |
|---|---|---|
| **`ph`** | `styles.css:665` `.ph { opacity: 0.8; }` | **会命中**。给 `<strong>`/`<em>`/`<u>`/`<code>`/`<sup>`/`<sub>`/`<s>` 加 `ph` 后，粗体、斜体、行内代码等会被调暗到 0.8。须先把该规则收窄为 `span.ph`（该规则的本意是短语 `<span class="ph">`），再加 token。`overline` 是 hi-d 里唯一渲染成 `<span>` 的成员，`span.ph` 仍会命中它，故再加 `:not(.overline)`。 |
| `figgroup` | `styles.css:715` `.figgroup { margin: 0.75rem 0; }` | synblk 加 `figgroup` 会多出这个外边距；多半合理，但是视觉变化，需 F5 看。 |
| `lines` / `screen` / `msgblock` | 各有自有规则 | 是渲染器已有的同名自有类，原本就是这些元素的类，无新增影响。 |
| 其余（`dl`/`dt`/`dd`/`dlterm`/`q`/`lq`/`cite`/`b`/`i`/`u`/`tt`/`sup`/`sub`/`line-through`/`overline`/`sl`/`sli`/`simpletable`/`sthead`/`strow`/`stentry`/`div`/`bodydiv`/`sectiondiv`/`object`） | 无 | 纯附加。 |

`transform-assets/site-chrome.css` 与 `dark-mode.css` 只注入 DITA-OT 输出，不作用于渲染器 DOM（`src/extension.ts:760`），
不在碰撞面内。

## 3. 故意延后（维持原结论）

| 项 | 原因 |
|---|---|
| `conbody`（body 上的特化类） | 祖先链 `body conbody` 跟随 concept/task/reference 特化；我们把 body 统一映射成 `topic/body`，无条件输出会错 |
| `fig--title-label` / `table--title-label` 编号 caption span + `fignone` | 结构性改动，M2-8 只批准了 `note__body` 一个结构新增 |

## 4. 处置顺序与进度

1. ✅ `.ph { opacity }` 收窄为 `span.ph:not(.unresolved-keyref):not(.overline)`，加八个高亮域 token（`5546d37`；`overline` 为后续补齐——它是 hi-d 里唯一渲染成 `<span>` 的成员，故用 `:not(.overline)` 排除调暗）。
   `:not(.unresolved-keyref)` 是必要的：`span.ph` 的优先级高于 `.unresolved-keyref`，否则未解析 keyref 的 `opacity: 1` 会被盖掉。
2. ✅ `dl` `dt dlterm` `dd` `q` `lq` `cite` `pre msgblock`。`dt` 只输出 `dlterm`，**不**实现 `dltermexpand`
   （取决于 `compact="no"`，渲染器没有 compact 概念）。
3. ✅ `synblk` → `figgroup synblk`（保留 `<pre>` 元素以保住空白；不带 `pre` token）。F5 需看一眼外边距：
   `.figgroup`（`styles.css` 715 行，0.75rem）排在 `.synblk`（698 行，0.5rem）之后，现在会胜出。
4. ✅ D 级：`sl`、`sli`、`simpletable`、`sthead`、`strow`、`stentry`、`div`、`bodydiv`、`sectiondiv`、`object`，自有 token 保留。
   `simpletable.xsl`（`2feba49`）已核：类只来自 `@frame/@expanse/@scale` 属性，没有写死的默认类，只加 `simpletable`。
   `sli` 的 `sliexpand`（取决于父 `compact`）与 `dltermexpand` 同理，不实现。
5. ⏳ `lines` 的多余 `pre` 去不去：未动，等你决定（对已提交行为的回退）。
6. ⏳ 真实 html5 fixture（`ol`、`pre screen`、`lines`、`dl/dt/dd`、高亮域、simpletable 系）：未做，需要真实 DITA-OT 输出。
