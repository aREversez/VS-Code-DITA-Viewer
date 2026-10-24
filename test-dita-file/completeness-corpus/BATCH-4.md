# 批次 4：依赖 `@class` 的规则、引用的 DITA 有效性、解析与结构

给接手的新会话。先读 `CLEAN-ROOM.md`（信息来源与禁止项）、`RULES.md`（账本）、`BATCH-1.md` 至
`BATCH-3.md`（同一套流程与约定，这里只写这一批特有的部分）。这是最后一批：做完之后，84 个 Oxygen 问题 id 都应该有
结论。这批 11 个 id，加上 Oxygen 实际报告里出现、目前没有映射的 3 个 `MSG_*`（schema 校验）。目标：每个要么在扩展里
实现并与真实 Oxygen 报告对上，要么在账本里写明有理由的差异。

## 开工前

- **新开会话**，只读仓库里的说明和公开资料，不查看被撤销的旧提交。
- 作者 `aREversez <53844261+aREversez@users.noreply.github.com>`；提交信息写进文件，用 `git commit -F 文件`，正文里
  不要用反引号；先交 patch，由维护者 `git am` 后推送。
- 探针放进**第五个语料** `../completeness-corpus-5/`。每个文件都带 DOCTYPE，这是有意的，原因见该目录的 README。

## 这批的根本问题：class 是 DTD 的默认值

DITA 1.x 里 `@class` 通常不写在文件里，而是 DTD 的默认值。语料的文件都有 DOCTYPE，所以 Oxygen 看得到每个元素的 class；
扩展读的是原始 XML，看不到。**要靠一张"元素名 → class"的表补上。** 仓库里已经有：

- `scripts/dita-class-extracted.json`：从 DITA-OT 的 DTD（base、technicalContent、bookmap）提取的完整表，228 个 topic 元素、
  35 个 map 元素，带 `classValue`（完整的 class 链）和来源文件与行号。生成脚本是 `scripts/extract-dita-class.cjs`。
- `src/parser/standardTagMap.ts` 与 `mapTagMap.ts`：手工维护的"元素 → 基类型"（只有第一对）。

会话要先回答：**这张表怎么进入扩展运行时**（现在它只是脚本的产物）：是生成一个模块并在构建时更新，还是别的办法；
表之外的元素（自定义特化）没有 class，相关检查对它们要跳过并写进账本，不要猜。

## 现有观察点（来自已提交的真实报告）

别重新发现，直接用，但仍要写自己的探针：

| 观察到的 | 在哪里 | 说明 |
| --- | --- | --- |
| `dmv.invalid.class.format`，消息 "Class attribute not specified." | 语料 2 里被当作 DITA 引用的非 DITA 文件（`c-resource.txt`、`c-resource.html` 等），语料 1 里 `invalid.dita` 的未声明元素 | **触发形态：一个被按 DITA 解析的文件里有没有 class 的元素**，不是"class 写得不对" |
| `dmv.invalid.class.generalization`，消息 "The source element with class value `- topic/p ` is not a generalization of target element with class value `- topic/…`" | 语料 3 `e-id-miss-conref-edge.dita` | **触发形态：conref 的源元素与目标元素的 class 不兼容** |
| `dmv.invalid.parse.dita.content`，消息 "Problem parsing … as DITA content" | 语料 1：报在**引用它的 map** 上，不是出问题的文件；语料 2：非 DITA 文件无 `@format` | 归属与扩展的 `validation` 不同（已记作 B 类差异） |
| `MSG_ELEMENT_NOT_DECLARED`、`MSG_ATTRIBUTE_NOT_DECLARED`、`MSG_CONTENT_INVALID_UNEXPECTED_ELEMENT` | 语料 1 `invalid.dita` | DTD 校验器的消息，没有 `dmv.*` id |

## 不在这一批里，不要碰

- 前面各批已完成的 id。
- 任何需要新增选项选择器条目的东西。

## 公开来源（按组）

| 组 | 依据 |
| --- | --- |
| L class 相关 | DITA 1.3 规范里 `@class` 属性的语法与含义、`@domains`、`@type`（xref/link/topicref）、conref 的"目标必须与源兼容"限制（目标与源同类型或更具体）；DITA-OT 的 DTD（Apache-2.0，已提取为上面的表） |
| M 引用的 DITA 有效性 | DITA 1.3 规范里 `@format`、`@scope`、`@href` 与"引用一个有效的 DITA 文档"的含义 |
| N 解析与结构 | XML 1.0（良构性）、DITA 1.3 规范里 `<section>` 与 `<title>` 的内容模型、DITA-OT 的 DTD |

**每条规则必须在账本里写明来源。** 规范没说清的地方，写探针让 Oxygen 回答。

## 规则清单与探针

每条规则至少 3 个探针：**应报、不应报、边界**。

### L. class 相关（6）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.invalid.class.format` | 元素没有 class，或 class 写法不对 | 一个非 DITA 文件被 `format="dita"` 引用；DITA 文件里一个未声明的元素；显式写 `class="topic/p"`（缺 `- `）；`class=""` | 哪些情形真的触发？只在"被按 DITA 解析"时吗？ |
| `dmv.invalid.class.generalization` | conref 的源 class 不是目标 class 的泛化 | `p` 引用 `p`（不报）；`p` 引用 `ul`；`li` 引用 `step`；`ph` 引用 `p` | 兼容的方向？两个方向都要探 |
| `dmv.invalid.class.specialization` | conref 的源 class 不是目标的特化 | 与上一条成对，写出两个方向的探针 | 与 generalization 的边界在哪里 |
| `dmv.ref.type.class.mismatch` | `@type` 与目标的 class 不符 | `xref type="concept"` 指向 task；`type="task"` 指向 task；`link`、`topicref` 各一组 | `@type` 取哪些值会被检查？ |
| `dmv.ref.type.class.mismatch.specific` | `@type` 比目标的 class 更不具体 | `type="topic"` 指向 task；`type="task"` 指向 task | 与上一条的区别：更宽还是不符 |
| `dmv.invalid.domains.format` | `@domains` 缺失或不合法 | 带 DOCTYPE 的 topic（Oxygen 应取到默认值）；**没有 DOCTYPE** 的 topic；`domains=""`；写错的值 | 没有 DOCTYPE 时是不是才触发？ |

### M. 引用的 DITA 有效性（2）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.invalid.DITA.reference` | 引用的不是有效的 DITA | `format="dita"` 指向根元素不是 DITA 的 XML；指向有效 topic；指向非 XML | 与 `parse.dita.content` 的区别 |
| `dmv.invalid.DITA.uri.target` | URI 不指向 DITA 目标 | 指向 http URL 却写 `format="dita"`；`scope="external"` 的同类写法 | 与 `topicref.remote` 家族的区别 |

### N. 解析与结构（3 + schema）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.invalid.parse.dita.content` | 引用的 DITA 内容无法解析 | 不良构的 topic（语料 1 已有一个形态）；引用的 map 不良构；编码声明错误 | 为什么报在引用方 map 上，规则是什么？引用方有 `@copy-to` 时呢？ |
| `dmv.section.first.title` | `<section>` 的 `<title>` 不是第一个子元素 | 标题在段落之后；标题在最前；section 里嵌 section | 嵌套 section 怎么算？只看最外层吗？**这条靠探针回答，不要先假设** |
| `dmv.section.no.dup.title` | 一个 `<section>` 有多个 `<title>` | 两个标题；一个标题；嵌套 section 各一个 | 报在哪个元素上 |
| `MSG_ELEMENT_NOT_DECLARED` 等三个 | DTD 校验的消息 | 未声明的元素；未声明的属性；不允许出现的位置 | 见下面的决定 |

## 需要先做的决定：DTD 校验（`MSG_*` 三个）

这三个是 DTD 校验器的结果，不是 `dmv.*` 的检查。要报出和 Oxygen 一样的结果，需要对元素名、属性、内容模型做校验。
会话先把选项和代价写清楚，再由维护者决定：

1. **只做元素与属性是否声明**：元素名可以用上面那张表判断；属性则需要每个元素的属性清单，现有提取脚本没有，要扩展。
   内容模型（"不允许出现在这里"）做不了。
2. **接入一个 DTD 校验器**：要评估一个能在扩展里运行的实现（原生模块、WASM）、DITA DTD 的随包分发条件（OASIS 许可）、体积与
   构建影响。代价最大。
3. **接受差异**：三个 `MSG_*` 记为有理由的 n/a，写明扩展不做 schema 校验。

**这三个选项里，先不要实现任何一个**，先把评估写出来，等维护者定。其余 11 个 id 不依赖这个决定。

## 类别粒度（建议，新会话可调整，但要在账本里写理由）

规则同前几批：按用户怎么修来分，改法、严重度、依赖数据或选项归属不同才拆；**不新增选择器条目**。

| 类别 | 包含的 id | 为什么这样分 |
| --- | --- | --- |
| `invalid-class-format` | `invalid.class.format` | 触发形态是"被按 DITA 解析却没有 class"，改法是改引用或改文件 |
| `incompatible-conref-class` | `invalid.class.generalization`、`invalid.class.specialization` | 同一个问题（conref 的源和目标 class 不兼容）的两个方向 |
| `reference-type-mismatch` | `ref.type.class.mismatch`、`ref.type.class.mismatch.specific` | 改法都是改 `@type` |
| `invalid-domains` | `invalid.domains.format` | 针对 `@domains`，改法不同 |
| `invalid-dita-reference` | `invalid.DITA.reference`、`invalid.DITA.uri.target` | 引用的目标不是有效 DITA |
| `unparsable-dita` | `invalid.parse.dita.content` | 与扩展已有的 `validation` 的关系要先定：映射到它，还是新类别并把归属改成引用方 |
| `section-title-structure` | `section.first.title`、`section.no.dup.title` | 同一个对象（`<section>` 的标题）的两种问题 |

如果 `MSG_*` 选择了选项 1 或 2，再加一个 `schema-violation`。

## 探针设计的特别注意

- **一条规则一个文件**（同前几批）。
- **注意"一个文件同时触发几条"**：被按 DITA 解析的非 DITA 文件既有 class 问题也有解析问题。探针要让每条规则的正例**只**触发它自己，
  或在 README 的表里写明每个文件期望出现什么，不要把一条规则的结果算到另一条头上。
- **DOCTYPE 保留**，只有明确要问"没有 DOCTYPE 时"的探针才去掉，并在注释里写明。
- 控制：沿用 `control-missing.dita`；每组再配一个 Oxygen 一定会报的对照，使沉默有意义。

## 流程与完成标准

同 `BATCH-1.md`：先写完**整批**探针和对照 → 提交并刷新语料 5 的基线 → 请维护者对**语料 5 的 `corpus.ditamap`** 跑一次
Validate and Check for Completeness（只开这一个根 map，选项全开、remote 关），用
`scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-5` 生成报告 → Oxygen-only 列表就是待办 → 先解决 class 表怎么进入运行时
和 DTD 校验的评估 → 照报告实现 → 刷新 parity 预期 → `npm run verify`。

完成标准：这批每个 id 在 `OXYGEN-PROBLEMS.md` 里是 *ok* 或有理由的 *n/a*（没有同 id 的 incident 时写 "mapped only"；两边都沉默时写明是哪种
n/a）。语料 5 的 parity 预期里，Oxygen-only 为空或每一项都有记录在案的理由。`npm run verify` 与 `ruleLedger` 测试通过。
**84 个 id 里没有任何一个还是 gap。**
