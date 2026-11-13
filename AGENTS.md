# 项目协作指南

## JavaScript / TypeScript 代码风格

本项目是 Node.js ESM 命令行应用，源码以 TypeScript 为主。以下规则适用于新增或修改的 `src/` 源码及仓库内手写的 JS／TS 脚本。局部修改沿用相邻代码的结构，格式调整限于本次改动。

### 参考对照

| 维度 | 本项目 | jQuery Core | Vue Core |
| --- | --- | --- | --- |
| 缩进与括号 | 两空格，`if (condition)`、`run(value)` | Tab 缩进，括号内部留空格，如 `if ( condition )` | 两空格，括号内部紧贴内容 |
| 字符串与语句 | 单引号，语句末尾写分号 | 双引号，语句末尾写分号 | 单引号，省略语句末尾分号 |
| 箭头函数 | 单参数保留括号，如 `(word) => word.trim()` | 参考源码主要展示普通函数 | Prettier 配置允许省略单参数括号 |
| 模块与类型 | NodeNext，相对模块路径写 `.js`，纯类型使用 `import type` | Core 的 ESM 源码使用带 `.js` 扩展名的相对导入 | TypeScript 源码同时使用 `import type` 和行内 `type`，相对导入通常省略扩展名 |

缩进、引号、分号和箭头函数括号由仓库统一选择。可跨项目复用的实践包括清晰命名、明确控制流、校验外部输入，以及保持类型和错误处理一致。本项目沿用现有源码的格式。

参考：[jQuery JavaScript Style Guide](https://contribute.jquery.org/style-guide/js/)、[jQuery Core 源码](https://github.com/jquery/jquery/blob/main/src/core.js)、[Vue Core Prettier 配置](https://github.com/vuejs/core/blob/main/.prettierrc)、[Vue Core TypeScript 源码](https://github.com/vuejs/core/blob/main/packages/reactivity/src/ref.ts)、[TypeScript 类型收窄](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)。

### 排版与命名

按业务步骤留空行，按语法结构换行，简单语句保持单行。

- 使用两空格缩进、单引号和语句末尾分号。需要插值或保留多行内容时用模板字面量。对象、数组和参数列表拆成多行时，在语法允许的位置保留尾逗号。
- 读取输入、校验、组装数据、执行操作和返回结果按实际职责分组。不同逻辑步骤之间留一个空行，同一步骤内紧密相关的声明和赋值连续书写。
- `if`、`for`、`while`、`switch`、`try` 等控制流使用花括号，前后各留一个空行。紧贴外层代码块开头或结尾时省略空行。连续的守卫分支之间留一行，`else`、`catch`、`finally` 跟在前一个右花括号同一行。简单的 `return` 或 `throw` 放在块内单独一行。
- 函数、方法和块体回调中的 `return`（含早返回）前必须留一个空行，与同一代码块内的前序语句分隔。若 `return` 是该代码块的第一条语句，则直接写在开括号的下一行。
- 少于 140 字符的简单语句保持单行。达到 140 字符时优先在参数、字段或链式调用边界换行。短对象参数可以单行，字段较多的配置、Zod schema 或包含回调的对象展开后每个字段一行。长字符串、正则及模板内容按语义处理。
- 长参数列表保留函数名和左括号在同一行。短参数可以按每行两个或三个组织。参数带长类型、解构、默认值或嵌套对象时，优先一个参数一行。
- 短链保持单行。长链换行后，每个调用阶段单独一行，以 `.` 开头。同级调用对齐，嵌套链多缩进一级，连续调用之间无需空行。
- 箭头函数保留参数括号，`) =>` 同行。简短回调用单行表达式，长单表达式可在 `=>` 后换行缩进。多语句或带分支的回调用块体，`=> {` 同行，块体内按业务步骤留空行。回调承担多步业务逻辑时，优先提取为具名函数。
- 三元表达式用于简单选值。短三元保持单行。长三元把 `?` 放在条件行末，把 `:` 放在真值分支行末，两个分支对齐。出现嵌套三元或分支需要多步操作时，使用 `if` 或早返回。
- 变量和函数使用 `camelCase`，类、接口和类型使用 `PascalCase`。文件名沿用 `kebab-case`，如 `learning-service.ts`。布尔值使用能直接读成条件的名字，如 `isComplete` 或 `hasProfile`。注释说明业务约束、兼容原因或非显而易见的取舍。

### 模块、控制流与类型

- 默认用 `const`，需要重新赋值时用 `let`。使用 `===`、`!==`，按契约区分 `null`、`undefined`、`0` 和空字符串。仅在需要为空值提供默认值时使用 `??`。
- 使用 ESM 的 `import`／`export`。在 `src/` 中，相对模块导入保留构建产物的 `.js` 后缀，包括动态导入和纯类型导入。Node 内置模块使用 `node:` 前缀，纯类型使用 `import type`。局部修改避免无关的导入重排。
- 局部变量优先使用类型推断。为导出的服务、仓储和运行器等边界函数声明清晰的参数与返回类型。保留 `strict`、`noUncheckedIndexedAccess` 和 `verbatimModuleSyntax` 的约束，数组和索引访问按可能缺失处理。
- 环境变量、JSON、数据库行和 AI 响应按外部输入处理。对不确定的值使用 `unknown`，通过类型守卫或已有 Zod schema 校验后再使用。避免用 `any`、强制断言或非空断言绕过校验。
- 使用早返回处理前置条件，减少嵌套。简单集合变换可以用 `map`、`filter`，涉及副作用、提前退出或多步分支时优先用清晰的循环。
- 顺序异步流程优先用 `async`／`await`。明确等待、返回或处理 Promise。在已有错误边界复用 `AppError` 和稳定错误码，包装异常时保留 `cause`，对外输出避免泄露密钥或原始响应体。

### 验证

文档或排版改动先用 `git diff --check` 和差异核对。需要进行 TypeScript 类型检查时使用项目已有的 `npm run check`（`tsc --noEmit`）。
