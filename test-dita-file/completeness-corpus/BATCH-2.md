# 批次 2：conref 形状、id 引用、key 与链接、元素 id 重复

给接手的新会话。先读 `CLEAN-ROOM.md`（信息来源与禁止项）、`RULES.md`（账本）和 `BATCH-1.md`
（同一套流程、同一套约定；这里只写这一批特有的部分）。目标：这批 18 个 Oxygen 问题 id，
每个要么在扩展里实现并与真实 Oxygen 报告对上，要么在账本里写明有理由的差异。

## 开工前

- **新开会话**，只读仓库里的说明和公开资料，不查看被撤销的旧提交。
- 提交约定：作者 `aREversez <53844261+aREversez@users.noreply.github.com>`；提交信息写进文件，用
  `git commit -F 文件`，正文里不要用反引号；先交 patch，由维护者 `git am` 后推送。
- 探针放进**第三个语料** `../completeness-corpus-3/`（独立的 `corpus.ditamap`、基线、报告）。约定见该目录的 `README.md`。

## 不在这一批里的

- `dup.cond.filter`、`ref.filtered`、`ref.filtered.conref`：要在 Oxygen 里配置 DITAVAL 过滤文件才会出现，和 profiling 一起放到批次 3。
- `invalid.DITA.reference`、`invalid.DITA.uri.target`、所有依赖 `@class` 的 id（`ref.type.class.mismatch*`、
  `invalid.class.*`）、schema 校验：批次 4 以后。

## 这一批已有的现状

- 已有并对上的：`undefined-key`、`unreferenced-key`、`duplicate-key`、`invalid-ref-topic-id`（topic id 对不上）、
  `unreferenced-reusable`。别重做。
- 语料 2 的真实报告里已经出现了 `dmv.no.link.keyref`（7 条，来自那批 keyref 写法探针）：Oxygen 对"keyref 指向的 key 没有可链接目标"
  报这个 id。这是该规则的一个现成观察点，设计探针时可以参考，但不能代替自己的探针。

## 公开来源（按组）

| 组 | 依据 |
| --- | --- |
| E conref 形状 | DITA 1.3 规范里 `@conref`、`@conrefend`、`@conkeyref` 的定义和范围引用的限制（同一 topic、兄弟元素、先后顺序）、`-dita-use-conref-target` |
| F id 引用 | DITA 1.3 规范里"基于 URI 的寻址"：`#topicID`、`#topicID/elemID`、`#./elemID`，以及 key 到元素的写法 |
| G keys 与链接 | DITA 1.3 规范里 key 定义与 key 引用的解析（引用环的处理）、`<link>`/`<xref>` 需要的属性、`@scope="peer"` 与链接文字、`@processing-role="resource-only"` |
| H 元素 id | DITA 1.3 规范里 `@id` 的唯一性范围（每个 topic 内）；DITA-OT 对 conref/key 环的告警可作旁证 |

**每条规则必须在账本里写明来源。** 规范没说清的地方，写探针让 Oxygen 回答。

## 规则清单与探针

每条规则至少 3 个探针：**应报、不应报、边界**。

### E. conref 形状（7）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.id.miss.conref` | `@conref` 缺 `#id` 部分 | `conref="lib.dita"`；`lib.dita#lib`（指向整个 topic）；`lib.dita#lib/src` | 指向整个 topic 算不算？ |
| `dmv.conref.siblings` | `conref` 与 `conrefend` 不是兄弟元素 | 同父的兄弟；不同父；祖孙 | 范围引用的另一端必须在同一文件吗？ |
| `dmv.conref.proper.order` | `conref` 在 `conrefend` 之后 | 正序；倒序；同一元素 | 倒序时是否也报 `siblings`？ |
| `dmv.conrefend.no.conref` | `conrefend` 却没有 `conref` | 只有 `conrefend`；两者俱全 | 报在哪个元素上？ |
| `dmv.conrefend.confl.conref` | `conrefend` 指向另一个 topic | 同 topic；另一 topic；另一文件 | 同文件不同 topic 呢？ |
| `dmv.no.conref.has.target.attr.value` | 没有 conref 的元素带 `-dita-use-conref-target` | 带属性无 conref；带 conref；属性值为空 | 值的哪些形式会触发？ |
| `dmv.conkeyref.peer.map` | `conkeyref` 指向 peer map 中的 key | key 在本 map；在 `scope="peer"` 的 map；在 submap | 多层嵌套怎么判？ |

### F. id 引用（5）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.invalid.ref.id` | 引用的 id 找不到 | `conref="lib.dita#lib/nope"`；`xref href="lib.dita#lib/nope"`；存在的 id | 对 `xref` 和 `conref` 是否同一个 id？ |
| `dmv.invalid.ref.id.path` | 引用的 id 路径找不到 | `#lib/inner/x`；`#lib/x`；嵌套 topic 的路径 | 与上一条的边界在哪里？ |
| `dmv.invalid.ref.id.path.keyref.elemid` | key 指向的 topic 下找不到元素 id | `keyref="k/nope"`；`k/src`；`k` | 只对 `conkeyref` 还是 `keyref` 也有？ |
| `dmv.bad.id.ref` | id 引用写法不对 | `#lib/`（尾部斜杠）；`#/src`；`#lib//src` | 此前一直没有触发条件，靠探针找出来 |
| `dmv.topicref.to.element` | topicref 指向元素 id 而非 topic id | `href="lib.dita#lib/src"`（元素）；`href="lib.dita#lib"`（topic）| `xref` 指向元素是否同样报？ |

### G. keys 与链接（5）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.circular.keyref` | key 引用成环 | `a→b→a`；`a→a`；`a→b→c` 无环 | 环里每个 key 都报，还是只报一个？ |
| `dmv.no.link.keyref` | 链接用的 key 没有链接目标 | `xref keyref` 指向纯文字 key；指向有 `href` 的 key；`link keyref` | 与 `ph keyref` 纯文字使用的区别 |
| `dmv.link.no.target` | `link`/`xref` 既无 `@href` 也无 `@keyref` | 空 `xref`；带 `conref` 的 `xref`；只有文字 | 带 `conref` 的 `xref` 不能误报（此前踩过的坑） |
| `dmv.empty.link.peer.target` | peer map 引用需要显式链接文字 | `xref scope="peer"` 无文字；有文字；本地引用无文字 | 判定是 `scope` 还是目标类型？ |
| `dmv.ref.to.resource.only` | 交叉引用指向 resource-only topic | 只被 resource-only 引用；同时被正常 topicref 引用；`xref`/`link` 两种 | 同时被正常引用时不应报（此前踩过的坑） |

### H. 元素 id 重复（1）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.dup.el.id` | 同一 topic 内元素 id 重复 | 同 topic 重复；嵌套 topic 各自复用同一 id（**不应报**）；与 topic id 相同 | 与 topic id 同名算不算？ |

## 类别粒度（建议，新会话可调整，但要在账本里写理由）

规则同批次 1：按用户怎么修来分，改法、严重度、依赖数据或选项归属不同才拆。**不要新增选择器条目。**

| 类别 | 包含的 id | 为什么这样分 |
| --- | --- | --- |
| `invalid-conref-form` | `id.miss.conref`、`conref.siblings`、`conref.proper.order`、`conrefend.no.conref`、`conrefend.confl.conref`、`no.conref.has.target.attr.value`、`conkeyref.peer.map` | 都是 conref 类属性写法或组合不对，改法是改属性 |
| `invalid-id-reference` | `invalid.ref.id`、`invalid.ref.id.path`、`invalid.ref.id.path.keyref.elemid`、`bad.id.ref` | 引用的 id 或路径不成立，与已有的 `invalid-ref-topic-id` 并列 |
| `topicref-to-element` | `topicref.to.element` | 改法是把目标改成 topic id，单独便于识别 |
| `circular-keyref` | `circular.keyref` | 在 key 图上判断，与其他 key 问题的数据不同 |
| `link-key-without-target` | `no.link.keyref` | 针对链接用途的 key，改法是给 key 加目标 |
| `link-no-target` | `link.no.target` | 链接元素缺目标 |
| `empty-peer-link-text` | `empty.link.peer.target` | 改法是补链接文字 |
| `resource-only-target` | `ref.to.resource.only` | 改法是改引用或改目标的 `processing-role` |
| `duplicate-element-id` | `dup.el.id` | 与 topic id 重复（`duplicate-id`）不是一回事 |

共 9 个类别。

## 探针设计的特别注意

- **一条规则一个文件**（同 `BATCH-1.md`）。涉及 key 定义的探针放进各自的小 map（`maps/<组>-<规则>.ditamap`），key 名每个探针独立
  （`k-<规则>-<n>`），不要让 key 从一个探针漏进另一个。
- **conref 的被引用方是共享的中性 topic** `topics/lib.dita`：它的每个可复用元素都被一个合法的"对照 conref"消费，否则会混进
  `unreferenced-reusable`，让人分不清哪些是被测规则的结果。
- **两个已踩过的坑要做成探针**：带 `conref`/`conkeyref` 的 `xref` 不是缺目标；既被 resource-only 又被正常 topicref 发布的 topic
  不是 resource-only。
- 依赖操作系统的探针要登记到 `PLATFORM_DEPENDENT_FILES`（见语料 2 的 README），尽量别写。

## 流程与完成标准

同 `BATCH-1.md`：先写完**整批**探针和对照 → 提交并刷新语料 3 的基线 → 请维护者对**语料 3 的 `corpus.ditamap`**
跑一次 Validate and Check for Completeness（只开这一个根 map，选项全开、remote 关），用
`scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-3` 生成报告 → Oxygen-only 列表就是待办 →
照报告实现（类别、消息模板、界面标签、中英文 l10n、`PROBLEM_ID_CATEGORY`、账本行、挂在哪个选项下）→ 刷新 parity 预期 →
`npm run verify`。

完成标准：这批每个 id 在 `OXYGEN-PROBLEMS.md` 里是 *ok* 或有理由的 *n/a*。**没有同 id 的 incident 时，行里要写
"mapped only"**（图例已说明）。语料 3 的 parity 预期里，Oxygen-only 为空或每一项都有记录在案的理由。
`npm run verify` 与 `ruleLedger` 测试通过。
