# WebHelp html5 body-class 对齐差异表

本表审计「渲染器实际发出的 CSS 类名」与「DITA-OT `org.dita.html5` 输出类名」之间的差异，
供 M2 系列（route B 计划 §2.4「只加不减」）逐条对齐使用。

- 渲染器类名来源：`src/render/baseTypeMap.ts`
- html5 基准来源：项目自带的真实 DITA-OT 输出 fixture
  （`src/test/editor/siteChromeContent.test.ts` 的 `REAL_TOPIC_BODY` / `REAL_TABLE` / `REAL_CODEBLOCK`）
- 对齐原则：§2.4 纯附加——加 html5 类 token，保留自有关键字与语义标签
  （`<strong>`/`<em>`/`<code>` 等不动），以免破坏 7 个内置模板与 diff/export。
- 注 1：这不是 `scripts/dita-class-diff.md`（那份是 `@class → baseType` 的**输入侧**映射差异，另一码事，
  见下方「为什么不能拿它当输出名依据」）。
- 注 2：本表只覆盖 topic 侧 body 内容类名；**map 侧树类**（topicref / bookmap 结构）另见
  `ac45a05`（侧栏行已带 topicref 类），不在本表范围内。
- 注 3：`foreign` / `imagemap` / `tgroup` / `colspec` / `hazardstatement` / `indexterm*` /
  `anchor*` / `prolog` 等属特殊容器或无语义载荷元素，不参与 body-class 对齐，故不列。
  （`anchor`/`anchorid` 并非「不可见」——`baseTypeMap.ts:1173/1177` 发出带 id 的 `<a>`/`<span>`；
  排除它们的理由是这些节点本身不承载 body-class 语义，不是看不见。）

## 证据分级（先定级，再谈改）

| 级别 | 含义 | 能否直接动手 |
|---|---|---|
| A 真实 fixture | 在 `REAL_TOPIC_BODY` / `REAL_TABLE` / `REAL_CODEBLOCK` 里逐字出现过 | 可以 |
| B 自渲染自断言 | 只有 `webhelpBodyClasses.test.ts` 用我们自己的渲染器输出钉住，未对照真实 html5 输出 | 需补 fixture |
| C 同名推定 | token 等于元素 localname，无 fixture，但碰撞面已查空 | 低风险，可附加 |
| D legacy 名待核 | html5 用的是 legacy 名表（非 localname 推导），必须抓到真实输出 | 必须补 fixture |

**为什么不能拿 `dita-class-diff.md` 当输出名依据**：自带 fixture 已证明 html5 输出名不是由 localname
机械推导的——`class="body conbody"`、`class="fig fignone"`、`class="note caution note_caution"`、
`class="title topictitle1"`、`table--title-label` 这些 token 在 DTD 里都不存在，是 legacy HTML
名表与编号后缀。因此 DTD localname 只能证明「输入侧标签名」，不能证明「输出侧类名」；
`sl` / `simpletable` / `div` 一类到底是 `simpletable` 还是别的名字，只有真实输出说了算。

## ✅ 已对齐 — A 级（真实 fixture 背书）

| 元素 | 渲染器类名 | fixture 出处 |
|---|---|---|
| title | `title topictitle{N}` / `title sectiontitle` | `REAL_TOPIC_BODY` + `b832308` |
| shortdesc | `shortdesc` | `REAL_TOPIC_BODY` |
| p | `p` | `REAL_TOPIC_BODY` + `b832308` |
| note | `note note_{type}` + `note__title` + `note__body` | `REAL_TOPIC_BODY` + `b832308` |
| fig | `fig` | `REAL_TOPIC_BODY`（含 `fignone`/`fig--title-label`，见延后段） |
| section | `section` | `REAL_TOPIC_BODY` + `da5c795` |
| ul / li | `ul` / `li` | `REAL_TOPIC_BODY` + `da5c795` |
| image | `image` | `REAL_TOPIC_BODY` + `da5c795` |
| CALS table | `table` + `thead` / `tbody` / `row` / `entry` | `REAL_TABLE` + `da5c795` |
| codeblock | `pre codeblock` | `REAL_CODEBLOCK` + `da5c795` |

## ⚠️ B 级 — 已对齐并已提交，但证据不是真实 fixture

这四项在 ✅ 段容易被读成「有 fixture 背书」，实际只有自渲染自断言
（`webhelpBodyClasses.test.ts:81` 一条用例里 ul/ol、image、table、codeblock 混在一起，
而 `REAL_TOPIC_BODY` 里没有 `class="ol"`，也没有 `pre screen` / `pre lines` / `pre preformatted`）：

| 元素 | 当前输出 | 源位置 | 待补 |
|---|---|---|---|
| ol | `class="ol"` | baseTypeMap.ts:510 | 真实 html5 里的 `ol` token |
| screen | `class="pre screen"` | baseTypeMap.ts:1055 | `pre screen` |
| lines | `class="pre lines"` | baseTypeMap.ts:1063 | `pre lines` |
| preformatted | `class="pre preformatted"` | baseTypeMap.ts:885 | `pre preformatted` |

注意：**不要因此回退**。`pre` 前缀已由同族的 `codeblock` 在真实 fixture 里证明，
`da5c795` 也是按该规则做的；补 fixture 只为把 B 级升成 A 级，不是重新讨论要不要加。

## ❌ 尚未对齐 — C 级纯加类 token（13 项，低风险，可直接做）

已在渲染，只是漏了 html5 类名；加 token 即可，不动语义标签。

| 元素 | 当前输出 | 期望类 | 源位置 |
|---|---|---|---|
| `dl` | `<dl>` 无类 | `dl` | baseTypeMap.ts:515 |
| `dt` | `<dt>` 无类 | `dt` | baseTypeMap.ts:517 |
| `dd` | `<dd>` 无类 | `dd` | baseTypeMap.ts:518 |
| `q` | `<q>` 无类 | `q` | baseTypeMap.ts:960 |
| `lq` | `<blockquote>` 无类 | `lq` | baseTypeMap.ts:961 |
| `b` | `<strong>` 无类 | `b` | baseTypeMap.ts:942 |
| `i` | `<em>` 无类 | `i` | baseTypeMap.ts:943 |
| `u` | `<u>` 无类 | `u` | baseTypeMap.ts:944 |
| `tt` | `<code>` 无类 | `tt` | baseTypeMap.ts:945 |
| `sup` | `<sup>` 无类 | `sup` | baseTypeMap.ts:946 |
| `sub` | `<sub>` 无类 | `sub` | baseTypeMap.ts:947 |
| `line-through` | `<s>` 无类 | `line-through` | baseTypeMap.ts:955 |
| `cite` | `<cite>` 无类 | `cite` | baseTypeMap.ts:1069 |

### 加类前已查空的碰撞面

`8a61458` 立的规矩是：内容类 token 会撞上没为内容写过的设计（`<tr class="row">` 撞 Bootstrap 的
`.row` flex 规则；`note__body` 的 div 把 note 文本挤到下一行）。上表逐 token 复查过
渲染器 DOM 能加载的全部样式表——`media/styles.css`、`media/webhelp-compat.css`、
`media/diff-styles.css`、7 个 `media/templates/*/*.css`、
`media/transform-assets/site-shell.css`、`media/transform-assets/template-chrome.css`——
13 个 token 均无命中，故确为纯附加。

（提醒：`media/transform-assets/site-chrome.css` 与 `dark-mode.css` **不**作用于我们的渲染器，
它们只被注入 DITA-OT transform 的输出目录，见 `src/extension.ts:760` → `injectSiteChrome`。
所以那两张表里已有的 `pre.pre`、`.tt` 规则不构成对本段的约束；此前把它们当成本路径的风险，是误判。）

### synblk / msgblock 单列：规则相同，但不属于「零风险」

| 元素 | 当前输出 | 期望类 | 源位置 |
|---|---|---|---|
| `synblk` | `<pre class="synblk">` 缺 `pre` | `pre synblk` | baseTypeMap.ts:1044 |
| `msgblock` | `<pre class="msgblock">` 缺 `pre` | `pre msgblock` | baseTypeMap.ts:1058 |

与已对齐的 codeblock/screen/lines 同属「pre 家族 prepend `pre`」。已核：
`styles.css:607` 是 `pre.codeblock, pre.preformatted`，各模板 CSS 同样只点名这两者，
`pre.synblk` / `pre.msgblock` 均不匹配，加 token 后视觉不变。

之所以不放进上面 13 项一起报「零风险」：这两条规则的形状是 `pre.<具体族名>`，
将来若有人为「pre 家族」统一写 `pre.pre`，这两个元素会立刻被带进一条它们今天不在其中的规则。
建议做这两项时顺手在 `webhelpContentCollision.test.ts` 里钉住「synblk/msgblock 除自身类外
不被任何 `pre.` 组合选择器命中」。

## ⚠️ 故意延后（提交已写明理由，非遗漏）

| 项 | 原因 |
|---|---|
| `conbody`（body 上的特化类） | 跟随 concept/task/reference body 特化，我们已把 body 统一映射成 `topic/body`，无条件输出会错 |
| `fig--title-label` / `table--title-label` 编号 caption span + `fignone` | 属结构性改动，M2-8 审计仅批准 `note__body` 一个结构新增 |
| simpletable 区域名 | `da5c795` 标注「无 fixture，且 html5 名字不同」 |

## 🔍 类名分歧（自造名 ≠ html5 输出名）— D 级，先补真实 fixture 再改

按项目规则「target strings 必须匹配真实 DITA-OT fixture，不能猜」，且如上所述 html5 输出名走
legacy 名表而非 localname 推导，这几项必须抓真实 html5 输出核对，直接改名会破坏内置模板，故单列一档。

| 元素 | 当前类名 | 源位置 | 备注 |
|---|---|---|---|
| `sl` | `simple-list` | baseTypeMap.ts:512 | `styles.css:433` 依赖 `.simple-list`，改名须同步样式 |
| `sli` | `li` | baseTypeMap.ts:513 | 与 `topic/li` 同名 token，改动前需确认 html5 是否区分 |
| `simpletable` | `simple-table` | baseTypeMap.ts:705 | `styles.css:488-489` 依赖 `.simple-table` |
| `sthead` / `strow` / `stentry` | 无类 | baseTypeMap.ts:708-714 | 同 simpletable 区域名，一并核 |
| `linktext` | 裸 passthrough，无元素/类 | baseTypeMap.ts:937 | 需结构包裹才能挂类，属结构改动，走 M2-8 那条审批 |
| `div` / `bodydiv` | `body-div` | baseTypeMap.ts:1111-1116 | `styles.css:713` 依赖 `.body-div` |
| `sectiondiv` | `section-div` | baseTypeMap.ts:1113 | `styles.css:714` 依赖 `.section-div` |
| `object` | `dita-object` | baseTypeMap.ts:1168 | 自造前缀，html5 侧名待核 |

## 处置顺序建议

1. 先做「❌ 纯加类 token」13 项 + 扩展 `webhelpBodyClasses.test.ts` 端到端钉住。
2. 同批做 `synblk` / `msgblock`，并在 `webhelpContentCollision.test.ts` 里加对应断言（见上节）。
3. 补一份真实 html5 fixture，覆盖 `ol` / `pre screen` / `pre lines` / `pre preformatted`
   （把 B 级升 A 级），以及 `sl` / `sli` / `simpletable` / `sthead` / `strow` / `stentry` /
   `div` / `bodydiv` / `sectiondiv` / `object` 的输出名，逐项核对后处理「🔍 类名分歧」。
   项目已有 `dita-viewer.ditaOtPath` 设置项，可走真实 transform，无需猜。
4. 「⚠️ 故意延后」项维持现状，除非有结构改动批准。
