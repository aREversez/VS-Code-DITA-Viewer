# 批次 3：profiling 的值与偏好、subject scheme、过滤文件

给接手的新会话。先读 `CLEAN-ROOM.md`（信息来源与禁止项）、`RULES.md`（账本）、`BATCH-1.md` 和 `BATCH-2.md`
（同一套流程与约定，这里只写这一批特有的部分）。目标：这批 9 个 Oxygen 问题 id，每个要么在扩展里实现并与真实
Oxygen 报告对上，要么在账本里写明有理由的差异。

## 与前两批不同的地方：这一批依赖 Oxygen 里的设置

前两批的探针只靠语料本身就能复现。这一批不行：profiling 偏好和过滤文件是 **Oxygen 自己的设置**，
报告只有在这些设置确定的前提下才有意义。所以：

1. **设置要记录并镜像。** 偏好和过滤文件的确切状态写进 `../completeness-corpus-4/README.md` 的"Oxygen setup"表，
   同一份状态写进 `completenessHarness.ts` 里的 `CORPUS_SETTINGS['completeness-corpus-4']`（`ditavalFiles`、`preferences`，
   骨架已经有这两个字段）。扩展那边用什么，Oxygen 那边就必须是什么，否则对照没有意义。
2. **请维护者在 Oxygen 里配置，再跑。** 新会话先写出需要的偏好清单和过滤文件，维护者照表配置、确认，再运行。
   Oxygen 里这些设置页面的具体名称以维护者看到的为准，不要凭记忆写菜单路径；表里写"要达到的状态"。
3. **报告要记录 Oxygen 的产品与版本**（语料 4 的 README）。偏好页面的行为随版本变，换版本要重跑。

## 新开会话与提交约定

- **新开会话**，只读仓库里的说明和公开资料，不查看被撤销的旧提交。
- 作者 `aREversez <53844261+aREversez@users.noreply.github.com>`；提交信息写进文件，用 `git commit -F 文件`，正文里不要用反引号；
  先交 patch，由维护者 `git am` 后推送。
- 探针放进**第四个语料** `../completeness-corpus-4/`。过滤文件 `filters/probe.ditaval` 骨架里已经有一条
  `audience="expert"` 的排除。

## 不在这一批里的

- 依赖 `@class` 的 id、`invalid.DITA.reference`、`invalid.DITA.uri.target`：批次 4。
- 结构与 schema 校验（`section.first.title`、`parse.dita.content` 等）：批次 5。

## 公开来源（按组）

| 组 | 依据 |
| --- | --- |
| I profiling 值与偏好 | DITA 1.3 规范里条件处理属性（`@audience`、`@platform`、`@product`、`@props`、`@otherprops`、`@rev`）的取值语法、属性特化（`props="audience(novice)"` 这种分组写法）、空值的含义 |
| J subject scheme | DITA 1.3 规范里 subject scheme map：`subjectScheme`、`subjectdef`、`enumerationdef`、`attributedef`、`defaultSubject`，以及 map 里引用 scheme 的方式（`schemeref`） |
| K 过滤 | DITA 1.3 规范里 DITAVAL（`val`、`prop`、`revprop`、`action`）及过滤对引用和内容引用的影响；DITA-OT（Apache-2.0）对 DITAVAL 的处理可作旁证 |

**每条规则必须在账本里写明来源。** 规范没说清的地方，写探针让 Oxygen 回答。

## 规则清单与探针

每条规则至少 3 个探针：**应报、不应报、边界**。

### I. profiling 的值与偏好（3）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.prof.attr.empty.value` | profiling 属性取值为空 | `audience=""`；`audience=" "`；`audience="novice"`；`props="audience()"` | 只有空白算不算空？分组里空括号呢？ |
| `dmv.prof.attr.val.prefs.confl` | 多值属性在偏好里被定义为单值 | 偏好里把某属性设成"只允许一个值"，探针写一个值、两个值、空 | 偏好页面怎么表达"单值"？违反时报在使用处还是别处？ |
| `dmv.prof.group.val.prefs.undef` | 分组值在偏好里没有定义 | `props="audience(novice)"`；`props="audience(nobody)"`；`props="color(red)"`（该特化属性无偏好） | 分组写法里未定义的属性本身和未定义的值是否分开报？ |

扩展里已经有的：未定义的值（`profiling-preference`，这是批次 0 就对上的）、单值违反的消息（`prof.singleValue`）。
先看现有实现再补，别重写。

### J. subject scheme（3）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.prof.sbj.attr.mult.val.confl` | 多值属性在 scheme 里是单值 | scheme 用 `enumerationdef` 约束某属性，探针给它多个值 | scheme 里"单值"怎么表示？ |
| `dmv.prof.sbj.attr.val.rej` | 值被 scheme 拒绝 | scheme 列出 `a`、`b`；探针用 `c`；用 `a`；用 `a c` | 同时被偏好和 scheme 约束时先报哪个？ |
| `dmv.prof.sbj.attr.val.rej.all` | scheme 拒绝了该属性的全部取值 | scheme 的某个 `enumerationdef` 下没有任何 `subjectdef`；有一个；有多个 | 报在 scheme 里还是使用处？ |

J 组是这一批里最大的一块：要读 subject scheme map（本扩展目前没有这个读取器）。**建议先写 I 组和 K 组，J 组
先写探针、跑 Oxygen，看报告再决定**：如果 Oxygen 对这些探针的行为很窄，就按报告实现窄的那部分；如果不值得，
在账本里写有理由的 n/a。不要在没看到报告前就写完整的 scheme 读取器。

### K. 过滤（3）

| id | 内容 | 探针想法 | 问 Oxygen |
| --- | --- | --- | --- |
| `dmv.ref.filtered` | 引用的目标被过滤掉 | `topicref audience="expert"`（被过滤）；被它指向的 topic 里的 `xref`；对照 `audience="novice"` | 被过滤的 topicref 本身与指向它的 xref，报哪一个？ |
| `dmv.ref.filtered.conref` | conref 的目标在内容引用处理中被丢掉 | `conref` 指向 `audience="expert"` 的元素；指向 `novice` 的元素；范围引用的一端被过滤 | 与 `ref.filtered` 的边界；conkeyref 呢？ |
| `dmv.dup.cond.filter` | DITAVAL 里有重复的条件 | 在 `probe.ditaval` 里写两条相同的 `prop`；相同属性不同动作；不重复 | Oxygen 一次只用一个过滤文件：只能用同一个文件里的内容探，见下 |

K 组的**两个特别注意**：

- **过滤文件对整次运行生效。** `filters/probe.ditaval` 排除 `expert`，所以其他组的探针不要使用 `audience="expert"`，
  否则会被过滤，行为变形。
- **`dup.cond.filter` 只能靠同一个文件探。** 要么把重复条件直接写进 `probe.ditaval`（它不影响过滤结果），要么在维护者
  能给 Oxygen 配多个过滤文件时用多个文件分别探。正例用同一文件，反例和边界没法并存，记录在账本里。

## 类别粒度（建议，新会话可调整，但要在账本里写理由）

规则同前两批：按用户怎么修来分，改法、严重度、依赖数据或选项归属不同才拆；**不新增选择器条目**。

| 类别 | 包含的 id | 为什么这样分 |
| --- | --- | --- |
| `profiling-preference`（已有） | `prof.attr.val.prefs.confl`、`prof.group.val.prefs.undef` | 与已有的未定义值同属"与偏好不一致"，改法同样是调整偏好或文档 |
| `empty-profiling-value` | `prof.attr.empty.value` | 值本身是空，与偏好无关，改法是删属性或补值 |
| `subject-scheme-violation` | `sbj.attr.mult.val.confl`、`sbj.attr.val.rej`、`sbj.attr.val.rej.all` | 都是 scheme 对取值的约束被违反，数据来源是 scheme map |
| `filtered-reference` | `ref.filtered`、`ref.filtered.conref` | 引用的目标被过滤掉，改法是改引用或改过滤 |
| `duplicate-filter-condition` | `dup.cond.filter` | 问题出在 DITAVAL 文件本身，报在该文件上，改法是删重复 |

共 4 个新类别。

## 流程与完成标准

同 `BATCH-1.md`：先写完**整批**探针和对照 → 记录 Oxygen 设置并镜像到 `CORPUS_SETTINGS` → 提交并刷新语料 4 的基线 →
请维护者按表配置 Oxygen，对**语料 4 的 `corpus.ditamap`**（只开这一个根 map，选项全开、remote 关）跑一次，用
`scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-4` 生成报告 → Oxygen-only 列表就是待办 → 照报告实现
（J 组先判断值不值得，再决定实现范围）→ 刷新 parity 预期 → `npm run verify`。

完成标准：这批每个 id 在 `OXYGEN-PROBLEMS.md` 里是 *ok* 或有理由的 *n/a*（没有同 id 的 incident 时写 "mapped only"；
两边都沉默时写明是哪种 n/a）。语料 4 的 parity 预期里，Oxygen-only 为空或每一项都有记录在案的理由。`npm run verify`
与 `ruleLedger` 测试通过。
