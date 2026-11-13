# 英语学习 Agent

以《1368个单词就够了》为默认材料，结合用户画像、最近三次学习记录和已学单词，逐步实现个性化英语学习。

```text
读取画像与历史 → AI 规划复习和新词 → 程序逐词组织学习/纠正 → AI 评估 → 保存记录并更新画像
```

当前 CLI 支持首次建档、老用户回访和每日选词。开始学习时，分别调用 AI 准备新词和复习词，两份列表通过校验后一起展示。

## 技术选型

- TypeScript 严格模式、ESM、npm、Node.js >= 22.13（当前使用 22.23.2）。
- `tsx` 运行开发入口，`tsc --noEmit` 检查类型，`tsc` 编译到 `dist/`。
- `@openai/agents` + `openai`：显式使用 `OpenAIChatCompletionsModel`，接入现有 Chat Completions 代理。
- Zod：AI 配置、数据库记录及 JSON 字段的运行时类型校验；后续可用于模型输出校验。
- Node 内置 `node:sqlite`：本地持久化，无 ORM；Node 22 可能显示实验性提示。
- Undici：显式直连 HTTP dispatcher，不使用环境中的 HTTP_PROXY/HTTPS_PROXY；本地代理请求不绕行其他代理。

具体依赖版本由 package-lock.json 固定。CLI 与业务服务分离，未来 Web 可复用服务接口。

## 安装与启动

```sh
npm ci
npm start
npm start -- --help
npm run history -- --user default
npm run book:check
```

首次运行 `npm start` 前，按下文配置 AI 代理。建档时输入称呼、每日新词和复习词配额（直接回车使用 `10,5`）以及学习要求。学习要求留空时采用词书默认路线，填写要求时由 AI 生成个性化路线。再次启动时，输入 `y` 或 `yes` 准备词单，输入 `n` 或 `no` 退出。

`npm start` 和 `npm run db:init` 会从词书附录统计实际词条数、初始化默认词书并升级已知旧结构。默认数据库为 `.data/english-learning.sqlite`。`history` 以只读方式查询，返回 `bookId` 和结构化 `progress`。

查看纯 JSON（`--silent` 去掉 npm 自己的命令标题；SQLite 提示位于 stderr）：

```sh
npm run --silent history -- --user default --json
```

空历史应为：

```json
{
  "profile": null,
  "recentSessions": [],
  "learnedWords": []
}
```

数据库不存在时，history 提示先执行 db:init；读取不会自动创建文件或用户。

## AI 代理配置

复制 `.env.example` 为 `.env`，在本地填写配置。也可直接使用 shell 环境变量；环境变量优先于 `.env`。密钥和 `.env` 不纳入 Git。

| 配置 | 默认值 / 说明 |
| --- | --- |
| OPENAI_BASE_URL | 必填，代理 API 根地址；保留服务要求的 `/v1`，不要追加 `/chat/completions` |
| OPENAI_API_KEY | 必填，仅在本地配置 |
| OPENAI_MODEL | `gpt-6-luna` |
| OPENAI_TIMEOUT_MS | `30000`，正整数，上限 `300000` |
| DATABASE_PATH | `.data/english-learning.sqlite` |
| BOOK_PATH | `assets/books/1368个单词就够了.md` |

相对路径基于项目根目录。默认 `.env` 也从项目根目录读取。AI 配置仅在调用 AI 时校验，历史读取和词书检查不需要密钥。

```sh
npm run ai:check
```

通过 Agents SDK 向代理的 `/chat/completions` 发起文本请求，使用 `gpt-6-luna`（可覆盖）、`max_tokens: 16`，输入“只回复 OK”。除空白外必须严格返回 OK 才通过。默认关闭 tracing、自动重试；连接失败、认证失败、超时和非预期响应返回非零退出码。CLI 不打印原始响应体或密钥。

检查成功不代表代理已支持工具调用、结构化输出、音频或完整教学流程，这些能力在对应阶段单独验证。

## 开发与文档

- [设计说明](docs/design.md)：模块、数据模型、流程与扩展边界。
- [当前进度及手工验收](docs/progress.md)：已完成内容、验证结果、未实现功能。
- `npm run check`：TypeScript 类型检查，不生成文件。
- `npm run build`：编译到 `dist/`，类型错误时不输出产物。
- `npm run start:dist`：运行编译产物；例如 `npm run start:dist -- history --user default --json`。

开发命令使用 `tsx`，不会自动执行类型检查；提交前单独运行 `npm run check`。部署可在安装完整依赖后编译，再用 Node 运行 `dist/cli.js`，不依赖 tsx。

源码统一为 `.ts`，相对导入保留 `.js` 后缀以适配编译后的 Node ESM。源码入口和编译入口均从项目根目录解析 `.env`、数据库及词书路径。

建档时记录起始分类，已学内容概要、画像摘要和水平留空，学习次数为 `0`，最近学习时间为 `null`。词单展示后 CLI 结束，学习会话和计次由后续学习流程处理。
