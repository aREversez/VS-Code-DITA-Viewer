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

## 流程

1. 先写完**整批**探针和对照（语料 2 里的 `control-missing.dita` 保留），一条规则一组文件，登记账本行（`RULES.md`，
   来源写 RFC 或规范，探针路径写 `../completeness-corpus-2/...`）。
2. 把扩展的现状跑一遍（`node scripts/completeness-baseline.cjs --corpus completeness-corpus-2`），
   实现这批检查，刷新基线。
3. 每个新类别要补：`ISSUE_CATEGORIES`、消息模板、界面标签、中英文 l10n，并在账本里写它挂在哪个
   `enabledChecks` 选项下；严重度先取临时值，等报告再定。
4. 请维护者对**语料 2 的 `corpus.ditamap`** 跑一次 Validate and Check for Completeness（只开这一个根 map，选项全开、
   remote 关），用 `scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-2` 生成 `oxygen-report.xml`。
5. 对照：`scripts/oxygen-diff.cjs --corpus completeness-corpus-2`。按报告修正实现和账本；
   报告里观察到的结果记为来源 `oxygen-report`。把 `PROBLEM_ID_CATEGORY` 补全。
6. `UPDATE_OXYGEN_PARITY=1 npm test` 刷新语料 2 的 parity 预期，再跑 `npm run verify`。

## 完成标准

- 这批每个 id 在 `OXYGEN-PROBLEMS.md` 里是 *ok*（账本行、探针、报告对照俱全），或是有理由的 *n/a*。
- 语料 2 的 parity 预期里，Oxygen-only 为空，或每一项都有记录在案的理由。
- `npm run verify` 通过；`ruleLedger` 测试通过。

## 注意

- 提交的测试数据里不能出现真实的本机路径。需要绝对路径的探针，用虚构位置（`Z:\probe\...`）并在同一行写
  `probe-absolute-path`；这是唯一的例外。
- 报告必须用 `scripts/sanitize-oxygen-report.cjs` 生成，不要手工编辑。
