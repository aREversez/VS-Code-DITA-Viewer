# Completeness 检查：clean-room 工作说明

给接手 completeness 功能的新会话（人或 agent）。先读完再动手。

## 目标

让扩展的"完整性检查"与 Oxygen 的 **Validate and Check for Completeness** 在同一份
corpus 上报出同样的 `(file, category)`。不要求措辞、行列号、默认选项一致，范围以
parity 计划为准（见本目录的 README 与 `OXYGEN-PROBLEMS.md`）。

## 信息来源：只许用这四类

1. **DITA 1.3 规范**（OASIS，公开）——"应该检查什么"的依据。
2. **DITA-OT 源码与消息表**（Apache-2.0，公开）——处理器会怎么判。
3. **Oxygen 的问题目录**（`messages_en_US.properties`、`links.properties` 里的问题 id 与
   文案，数据文件）——"有哪些类别"的清单，`links.properties` 还给出每个 id 的规范锚点。
4. **Adeline 亲手在 Oxygen 里跑出来的报告**——"Oxygen 实际报不报"的唯一依据，也是严重度的唯一来源。

## 明确禁止

- 打开、反编译、反汇编、阅读 `oxygen.jar`（或任何 Oxygen 安装文件）里的 `.class` 等编译产物，
  也不要在仓库、提交信息、注释、文档里写这类出处。Oxygen 的 EULA 禁止对软件进行
  decompile / reverse engineer / disassemble（适用法律允许的除外）。
- 复制 Oxygen 的代码、样式、布局文件、图片。
- 凭"记得 Oxygen 好像会……"写规则。拿不准就写进探针，让 Adeline 跑一次 Oxygen 再定。
- 不得读取或要求查看此前被撤销的 29 个提交及其备份。

## 工作循环（每个阶段都这样走）

1. **选一组规则**（按 `OXYGEN-PROBLEMS.md` 里的 gap 行）。
2. **查来源**：读规范锚点和 DITA-OT，写出规则。拿不到来源的规则不做。
3. **写探针**：每条规则 2–3 个 corpus 文件——应报、不应报、边界。
4. **登记账本**：在 `RULES.md` 加一行（来源、引用、探针路径）。`ruleLedger.test.ts` 会检查。
5. **先写 kill test**，确认在修复前失败，再实现。
6. **请 Adeline 跑 Oxygen**：对 `corpus.ditamap` 运行 Validate and Check for Completeness，
   把报告存进 `test-dita-file/completeness-corpus/`（沿用 `oxygen-report.sample.xml` 的格式），
   用 `scripts/oxygen-diff.cjs` 比 `(file, category)`。
7. **按差异修**：差异的解释只能来自规范、DITA-OT 或报告本身，不得来自 Oxygen 内部。
   报告里观察到的结果写进账本（来源 `oxygen-report`，引用写探针）。
8. 跑完整验证：`npm run verify`。测试数以**干净构建**为准（`pretest` 已先清掉 `dist-test`）。

## 账本规则（`RULES.md`）

- 每条规则一行；`legacy` 只留给 `R001`–`R015`，这些是账本出现前写的，来源需要补；
  处理到哪个类别，就把对应行改成真实来源。
- 新规则的来源只能是 `spec` / `dita-ot` / `oxygen-report` / `catalog` / `own`，并带引用和探针。
- 严重度不是规则属性：取自真实报告，在此之前视为临时值，不参与对照。

## 已知需要带上的行为要求

这些来自此前的审阅。每一条**先在规范或 DITA-OT 里核实并登记来源，再实现**。

1. `@keyref` 与 `@href` 同时存在：key 已定义则忽略 href；key 未定义时 `@href` 是回退。
   （DITA 1.3.2 规范已核实：`archSpec/base/using-keys-for-addressing` 与 `image` 元素页。）
2. `<ph keyref>`、`<keyword keyref>` 等非链接元素只借用 key 的文字，不算对 key 目标的引用，
   不应触发"重复引用"。（DITA 1.3 规范已核实：`archSpec/base/processing-keyref-for-text`
   规则 2——"For elements that do not allow the @href attribute" 只从 topicmeta 取文字。
   注意：未定义的 key 出现在这类元素上，扩展目前仍报 `undefined-key`，这一点规范没写，
   要看 Oxygen 实际报告。）
3. `<keydef keyref="…">`（key 重定向）不是 `topicref`，且重定向后的 key 应继承目标。（待核实）
4. 元素 `@id` 在**每个 topic 内**唯一，不是每个文件内；嵌套 topic 可以复用父 topic 的元素 id。
   （DITA 1.3 规范已核实：`archSpec/base/id`——非 topic 元素的 id 只需在同一 nearest-ancestor
   topic 内唯一，规范用的是 "should"；topic/map 元素的 `@id` 是 XML ID，整篇文档内唯一。）
5. 一个 topic 只要被某个正常的（非 resource-only、非 reltable）topicref 发布，就不是
   resource-only。（待核实 `processing-role`）
6. `<xref conref>` / `<xref conkeyref>` 靠引用取内容，不需要 `@href`/`@keyref`。（待核实）
7. 路径归一化要跨平台：POSIX 的 `file:///tmp/x` 保留根斜杠，Windows 的 `file:///C:/x` 去掉前导斜杠。
8. 非 ASCII href（如中文文件名）是否应该报"需要编码"，先看 Oxygen 实际报告再定，不要预设。

## 起点

`dev` 在 `18f8ff4`：Phase 0（harness、corpus、基线）和 Phase 1（keyref 解析、`undefined-key`）
已完成，共 15 个类别。其后的工作按上面的循环重做。

## 完成标准

- 每个 gap 行要么是 *ok*（有账本行、探针、Oxygen 报告对照），要么是有理由的 *n/a / 差异*。
- `npm run verify` 通过，`ruleLedger.test.ts` 通过。
- 账本里 `legacy` 行逐步清零。
