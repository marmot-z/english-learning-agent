# 设计说明

## 项目目标与控制边界

默认学习材料为《1368个单词就够了》。面向初学者，既学习新词，也根据历史表现复习旧词，最终沉淀单词掌握情况和整体进度。

```text
程序读取上下文
  ├─ 用户画像
  ├─ 最近三次已完成学习记录
  └─ 已学习单词及累计表现
       ↓
AI 规划本次学习队列（复习词、新词、安排理由）
       ↓
程序遍历队列
  ├─ AI 生成词义、音标、例句和中文 → 英文练习
  ├─ 交互层展示内容、获取回答
  └─ AI 纠正，程序记录回答
       ↓
AI 给出逐词评价和整体评价
       ↓
程序校验结果并事务更新单词记录、学习记录、用户画像
```

上图是目标流程，不是当前实现状态。AI 决定教学内容、选词和评价；程序决定执行顺序、用户隔离、循环、参数校验及写入。AI 不直接执行数据库写操作。暂缓某个新词不等于已掌握；未来规划阶段需要返回暂缓理由，不能把它写成已学习。

词书末尾有独立的分类词表，后续选词以其为来源。首次建档向 AI 提供固定词书介绍、参考路线、每日配额和用户自述。词书材料和用户自述作为参考数据。

## 模块与接口

| 模块 | 职责 |
| --- | --- |
| `src/cli.ts` | 命令参数、展示、退出码；动态加载对应能力 |
| `src/config.ts` | 本地环境配置及路径解析，不在读取历史时校验 AI |
| `src/domain/types.ts` | 用户画像、学习记录、单词记录和学习上下文类型 |
| `src/services/` | 应用用例；不直接读 stdin 或写 stdout |
| `src/db/` | Schema、事务、只读连接、参数化查询及 JSON 转换 |
| `src/ai/` | OpenAI 客户端、Chat Completions 模型、Runner、错误映射 |
| `src/materials/` | 词书文件读取 |
| `src/prompts/` | 连通性提示词和未来教学材料边界说明 |

`createLearningService({ historyRepository })` 返回以下接口：

- `findDefaultProfile()` 只查询本地用户 `default` 的档案。`onboardDefaultUser(input, generateBookIntroduction, signal)` 在词书介绍和学习路线生成成功后保存档案。
- `loadLearningContext(userId = 'default')`：返回 `{ profile, recentSessions, learnedWords }`，查询是同步的、只读的。
- `prepareLearningPlan(input)`、`generateWordLesson(input)`、`correctAnswer(input)`、`evaluateSession(input)`：输入暂为 `unknown`，返回 `Promise<never>`，目前抛出 `NOT_IMPLEMENTED`。输入输出的业务结构在对应阶段确定，不提前伪造契约。

`createAiRunner(config)` 提供 `runText({ name, instructions, input, maxTokens })` 和 `close()`；调用者必须关闭连接资源。本阶段一次运行最多一轮，无工具、无 handoff、无结构化输出。采用独立模型对象避免隐式选用 Responses API。

未来 Web 适配层只负责把 HTTP/流式交互映射到应用服务；队列状态和回答持久化由应用层管理，不复制 CLI 业务逻辑。本阶段没有 HTTP 服务、认证或会话恢复实现。

## 数据模型

默认单用户 `default`，所有查询仍显式接收用户标识，不实现登录。表结构以 `src/db/schema.ts` 为准。空数据库的完整建表脚本见 [SQLite DDL](schema.sql)。

| 表 | 核心字段与约束 |
| --- | --- |
| user_profile | user_id 主键、display_name、book、book_introduction、current_level、progress、profile_summary、daily_new_word_count、daily_review_word_count、learning_count、last_learning_at |
| learning_record | id 主键；user_id；new_words_json、review_words_json、answers_json；evaluation、score、duration_seconds；status、started_at、completed_at |
| word_record | id 主键；user_id、book、word 联合唯一；learning_count、error_count、last_learning_at、sentences_json、score、evaluation |

三张表均有 created_at、updated_at。时间统一约定为 UTC ISO 8601（写入时使用 `toISOString()`），展示层再转换本地时间。评分预留 0–100，未评分为 null；学习次数、错误次数和耗时为非负值。具体评分规则尚未实现。

学习状态为 `in_progress`、`completed`、`interrupted`；completed 必须有 completed_at。前三次仅取 completed，按 completed_at 倒序，同时间按 id 倒序。已学词仅取 learning_count > 0，保留词书标识以供后续规划区分。列表字段在数据库校验 JSON 有效性，repository 进一步要求为数组；坏数据明确报错，不静默替换为空。

repository 使用 Zod 校验数据库结果后返回领域类型。新词、复习词、相关句子为 `string[]`，回答记录为 `unknown[]`。无效 JSON 或非数组报 `DB_INVALID_JSON`，不符合字段类型的记录报 `DB_INVALID_ROW`。

历史读取在一个只读事务中完成，避免三个查询读到不同版本。查询按 user_id 参数化过滤。历史读取不会初始化画像、增加学习次数、刷新最近学习时间或调用 AI。

`npm start` 和 `db:init` 在事务中创建缺少的表与索引，为已知旧版 `user_profile` 追加建档字段。兼容检查基于 DDL 比较，遇到未知结构时回滚。读取旧画像时以用户 ID 作为称呼，配额默认为 `10,5`。

首次建档把生成的词书介绍和基础学习路线一并写入 `book_introduction`。当前水平、学习进度和画像摘要留空。开启会话、学习计次和结束后更新画像由后续阶段实现。

## 错误与配置

CLI 统一输出稳定错误码和可操作的简短提示，失败退出码为 1。内部包装错误保留原始 cause，但 CLI 不直接输出堆栈或第三方响应，避免回显凭证。AI 配置无效、认证、超时、网络、HTTP 状态及非预期输出分别区分。

本地 `.env` 仅作运行配置，不写入文档或 Git。AI 请求显式直连，默认关闭 tracing；数据库和词书不需要 AI 服务在线。学习业务后续通过提示词和输入显式传给模型，不能以为 Runner 的本地 context 会自动成为模型上下文。

## TypeScript 工程约定

使用 NodeNext 模块解析、strict、noUncheckedIndexedAccess、verbatimModuleSyntax 和 noEmitOnError。类型导入使用 `import type`；相对模块路径保留 `.js` 后缀。配置类型从 AI 的 Zod schema 推导，其余边界通过显式接口声明。

编译库包含 ES2022 和 DOM：当前 Agents SDK 顶层声明导出了 Realtime/WebRTC 类型，完整检查其声明需要 DOM 类型；这不代表项目启用了浏览器运行环境或音频功能。不关闭依赖声明检查。

Node 原生 fetch 与显式 Undici dispatcher 组合，返回原生 Response，避免不同 fetch 类型之间的 `as any` 转换。catch 使用 unknown，通过错误类或属性检查收窄。数据库读取通过泛型回调保留结果类型。

开发入口使用 tsx；类型检查运行 `npm run check`；发布构建运行 `npm run build`，输出 dist。两种入口下 config 模块的上一级均为项目根目录，因此无需改变环境配置与数据路径。
