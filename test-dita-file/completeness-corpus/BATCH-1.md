# 批次 1：引用写法、keyref/id 语法、`@format`/`@scope`、导航标题

给接手的新会话。先读 `CLEAN-ROOM.md`（信息来源与禁止项）和 `RULES.md`（账本）。
这一批约 29 个 Oxygen 问题 id，目标是：每个 id 要么在扩展里实现并与真实 Oxygen 报告对上，
要么在账本里写明有理由的差异。

## 开工前

- **新开会话。** 只读本仓库的 `CLEAN-ROOM.md`、本文件和公开资料，不查看被撤销的旧提交。
- 提交约定：作者 `aREversez <53844261+aREversez@users.noreply.github.com>`；提交信息写进文件，用
  `git commit -F 文件`，正文里不要用反引号（PowerShell 会把它当转义符）；先交 patch，由维护者
  `git am` 后推送。
- 探针放进**第二个语料** `../completeness-corpus-2/`（独立的 `corpus.ditamap`、基线、报告），
  不要动第一个语料。约定见该目录的 `README.md`。

## 公开来源（按组）

| 组 | 依据 |
| --- | --- |
| A 引用写法 | RFC 3986（URI 语法：路径、百分号编码、保留字符）、RFC 8089（`file:` URI）、操作系统的路径与大小写规则 |
| B keyref / id 语法 | DITA 1.3 规范里 key 名（`@keys`、`@keyref`）与 `@id` 的取值约定；XML 1.0 的 Name 产生式 |
| C `@format` / `@scope` | DITA 1.3 规范里 `@format`、`@scope`、`@href` 的定义，以及 map 引用 map 的规则 |
| D 导航标题 | DITA 1.3 规范里 `topicmeta/navtitle`、`topichead` 的定义 |

DITA-OT（Apache-2.0）可作旁证。**每条规则必须在账本里写明来源。** 规范没说清的地方，写探针让 Oxygen 回答，
不要凭印象定。

## 规则清单与探针

每条规则至少 3 个探针：**应报、不应报、边界**。表里"问 Oxygen"是需要靠真实报告回答的问题。

### A. 引用写法（9）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.win.seps.ref` | href 里用 `\` 作分隔符 | `topics\ok.dita`；`topics/ok.dita`；`topics/ok.dita#id` 里片段含 `\` | 它是否同时报找不到文件？ |
| `dmv.absolute.ref` | href 是绝对路径 | `/probe/x.dita`；带盘符 `Z:/probe/x.dita`（该行加 `probe-absolute-path` 标记）；相对路径 | `file:` 开头的算不算？ |
| `dmv.extra.slash.ref` | 路径里有 `//` | `topics//ok.dita`；`topics/ok.dita`；`http://example.invalid//a` 作为外部引用 | 外部 URL 里的 `//` 呢？ |
| `dmv.ref.extra.slash` | topic 文件名后多一个 `/` | `topics/ok.dita/`；`topics/`；`topics/ok.dita` | 与 `folder.ref` 如何区分？ |
| `dmv.file.url.two.slashes` | `file:` URL 的斜杠数不对 | `file://topics/ok.dita`；`file:///probe/x`；`file:/probe/x` | 哪几种形式被接受？ |
| `dmv.unencoded.ref` | 该编码而未编码的字符 | 空格；路径中间的 `#`；`%` 单独出现；`[`、`]`；**非 ASCII（中文文件名）**；已编码的 `%20` | 非 ASCII 是否报？这是此前一直没定论的问题 |
| `dmv.incorect.capit.ref` | 路径大小写与真实文件不同 | `topics/OK.dita`（真实文件 `ok.dita`）；大小写一致 | 在区分大小写与不区分的文件系统上结果是否一致？ |
| `dmv.folder.ref` | 目标是目录而不是文件 | `topics`；`topics/`；`topics/ok.dita` | 与 `ref.extra.slash` 的边界 |
| `dmv.recursive.ref` | map 直接或间接引用自身 | `loopa.ditamap` ↔ `loopb.ditamap`；map 引用自己；正常嵌套 | 环里每个 map 都报，还是只报闭合处？ |

### B. keyref 与 id 语法（5）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.invalid.keyref.syntax.1` | keyref 里 `/` 多于一个 | `keyref="a/b/c"`；`keyref="a/b"`；`keyref="a"` | 报在 map 还是 topic 里的使用处？ |
| `dmv.invalid.keyref.syntax.2` | keyref 里有非法字符 | `keyref="a$b"`；`a.b`；`a-b` | 哪些字符合法？ |
| `dmv.invalid.keyref.syntax.3` | keyref 里有空白 | `keyref="a b"`；`keyref=" a"`；`keyref="a"` | 首尾空白是否也报？ |
| `dmv.invalid.id.syntax.2` | `@id` 里有非法字符 | `id="a:b"`；`id="a.b"`；`id="a-b"`；`id="1a"` | 数字开头算不算？ |
| `dmv.invalid.id.syntax.3` | `@id` 里有空白 | `id="a b"`；`id="a"` | map 里的 `@id` 是否同样检查？ |

### C. `@format` 与 `@scope`（13）

| id | 内容 | 探针想法 |
| --- | --- | --- |
| `dmv.topicref.no.format` | 目标不是 DITA 而缺 `@format` | `topicref href="x.txt"`；加 `format="txt"` |
| `dmv.topicref.map.no.format` | 看起来是 map，`@format` 不是 `ditamap` | `href="sub.ditamap"` 无 `format`；`format="dita"` |
| `dmv.topicref.topic.no.format` | 看起来是 topic，`@format` 不是 `dita` | `href="ok.dita" format="ditamap"` |
| `dmv.ref.map.no.proper.format` | map 引用的 `@format` 不合适 | `mapref` 加 `format="dita"` |
| `dmv.ref.res.as.dita` | 非 DITA 资源按 DITA 引用 | `href="x.txt" format="dita"` |
| `dmv.ref.res.as.map` | 非 DITA 资源标成 `ditamap` | `href="x.txt" format="ditamap"` |
| `dmv.ref.topic.as.map` | topic 被标成 map | `href="ok.dita" format="ditamap"`（对比上面第三条的区别） |
| `dmv.no.format.non.dita.ref` | 非 DITA 引用缺 `@format` | `xref href="x.pdf"`；加 `format="pdf"` |
| `dmv.topicref.remote` | 外部引用 | `href="http://example.invalid/a.html" scope="external" format="html"` |
| `dmv.topicref.remote.no.external.scope` | URL 却没写 `scope="external"` | 同上去掉 `scope` |
| `dmv.topicref.remote.local.scope` | URL 却写 `scope="local"` | 同上改成 `scope="local"` |
| `dmv.topicref.ext.scope.no.format` | `scope="external"` 缺 `@format` | 同上去掉 `format` |
| `dmv.ref.topic.inside.mapref` | mapref 里面的 topicref 被忽略 | `<topicref href="sub.ditamap" format="ditamap"><topicref href="ok.dita"/></topicref>` |

C 组要特别问 Oxygen：缺 `@format` 时它靠扩展名猜到什么程度（`.dita`、`.xml`、`.html`、无扩展名）。

### D. 导航标题（2）

| id | 内容 | 探针想法 |
| --- | --- | --- |
| `dmv.topichead.no.navtitle` | `topichead` 没有 navtitle | 无 `topicmeta`；有 `topicmeta` 但无 `navtitle`；有 `navtitle` |
| `dmv.topicref.no.navtitle` | 没有 `href` 的 topicref 没有 navtitle | 同上；带 `href` 的对照；`scope="external"` 的情形 |

## 探针设计：一条规则一个文件

对照的键是 `(文件, 类别)`。同一个文件里、同一类别下的几条规则会塌缩成一个签名，其中一条没对上也看不出来。
所以：

- 每条规则的探针放在**自己的文件**里。针对 topic 内容的探针放进各自的 topic；针对 map 里引用本身的探针，
  放进各自的小 map（`maps/<组>-<规则>.ditamap`），再从 `corpus.ditamap` 用 `format="ditamap"` 引用。
- 这样即使几条规则共用一个类别，对照仍能精确到每条规则。

## 类别粒度（建议，新会话可调整，但要在账本里写理由）

类别是用户看到的单位（问题面板的标签、l10n、选项归属），也是对照的单位。按**用户怎么修**来分，不是一个 id 一个类别，
也不是一组一个类别：

| 类别 | 包含的 id | 为什么这样分 |
| --- | --- | --- |
| `reference-syntax` | `win.seps.ref`、`absolute.ref`、`extra.slash.ref`、`ref.extra.slash`、`file.url.two.slashes`、`unencoded.ref` | 都是字符串写法问题，改法是改 href 的文字 |
| `incorrect-case-reference` | `incorect.capit.ref` | 要读目录才能判断，结果随文件系统而变，单独便于选项和排查 |
| `folder-reference` | `folder.ref` | 目标是目录，改法是指向文件 |
| `recursive-reference` | `recursive.ref` | 在 map 链上判断，和路径写法无关 |
| `invalid-key-syntax` | `invalid.keyref.syntax.1/2/3` | 同一对象（keyref）的三种写法错误 |
| `invalid-id-syntax` | `invalid.id.syntax.2/3` | 同一对象（`@id`）的两种写法错误 |
| `format-missing` | `topicref.no.format`、`no.format.non.dita.ref`、`topicref.ext.scope.no.format` | 改法都是补上 `@format` |
| `format-mismatch` | `topicref.map.no.format`、`topicref.topic.no.format`、`ref.map.no.proper.format`、`ref.res.as.dita`、`ref.res.as.map`、`ref.topic.as.map` | `@format` 与目标实际类型不符，改法是改正 `@format` |
| `external-reference` | `topicref.remote`、`remote.no.external.scope`、`remote.local.scope` | 外部引用与 `@scope` 的关系 |
| `ignored-mapref-content` | `ref.topic.inside.mapref` | 内容被忽略，改法是移走 |
| `missing-navtitle` | `topichead.no.navtitle`、`topicref.no.navtitle` | 同一问题的两种元素 |

共 11 个类别。经验规则：改法不同、Oxygen 给的严重度不同、依赖的数据不同（如文件系统）、归在不同选项下，就拆；
否则合并。**选项归属不要新增选择器条目**，挂到已有的引用类选项下，并在账本里写明。

## 流程：先探针，再跑 Oxygen，最后实现

1. 写完**整批**探针和对照（语料 2 里的 `control-missing.dita` 保留）。这一步不需要实现，也不要先写账本行：
   账本行要求类别已存在，会随实现一起提交。
2. 提交探针，并刷新语料 2 的基线（`node scripts/completeness-baseline.cjs --corpus completeness-corpus-2 --update`）。
3. 请维护者对**语料 2 的 `corpus.ditamap`** 跑一次 Validate and Check for Completeness（只开这一个根 map，
   选项全开、remote 关），用 `scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-2` 生成
   `oxygen-report.xml`，提交，并刷新 parity 预期。**此时 Oxygen-only 列表就是这一批的待办清单**，每一项都有 Oxygen 的真实结论，
   包括非 ASCII href 之类此前没有定论的问题。
4. 照着报告实现：新类别（`ISSUE_CATEGORIES`、消息模板、界面标签、中英文 l10n）、`PROBLEM_ID_CATEGORY`、账本行
   （来源写 RFC / 规范 / `oxygen-report`，并记录挂在哪个选项下）；严重度取报告里的值。
   每实现一组，刷新一次 parity 预期，让这些行从 Oxygen-only 挪进 matched。
5. 全部做完跑 `npm run verify`。只有探针被改动过才需要再跑一次 Oxygen。

这个顺序的好处是实现之前就知道 Oxygen 的真实行为，省掉"先按规范做、再被报告推翻"的返工。

## 完成标准

- 这批每个 id 在 `OXYGEN-PROBLEMS.md` 里是 *ok*（账本行、探针、报告对照俱全），或是有理由的 *n/a*。
- 语料 2 的 parity 预期里，Oxygen-only 为空，或每一项都有记录在案的理由。
- `npm run verify` 通过；`ruleLedger` 测试通过。

## 注意

- 提交的测试数据里不能出现真实的本机路径。需要绝对路径的探针，用虚构位置（`Z:\probe\...`）并在同一行写
  `probe-absolute-path`；这是唯一的例外。
- 报告必须用 `scripts/sanitize-oxygen-report.cjs` 生成，不要手工编辑。
