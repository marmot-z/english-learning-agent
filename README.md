# 英语学习 Agent Web 后端

这是供百词斩助手 Web 接入的独立 Node.js 服务。需要 Node.js 22.13 或更高版本。使用 nvm 时可先运行 `nvm use 22`。

## 本地开发

```sh
npm ci
npm run dev
```

默认监听 `127.0.0.1:18034`。可通过环境变量或项目根目录的 `.env` 设置 `LEARNING_AGENT_HOST` 和 `LEARNING_AGENT_PORT`。

开发时 Web 和 Agent 默认都使用 `https://www.baicizhan-helper.cn`。如果 Web 的 `API_PROXY_TARGET` 切到本地 Proxy，Agent 也要使用同一个地址。

```sh
BAICIZHAN_HELPER_API_BASE_URL=http://127.0.0.1:18033 npm run dev
```

前端 Vite 将 `/agent/*` 转发到本服务的 `/api/learning-agent/*`。更换 Agent 的地址或端口时，在 Web 的 `.env.development.local` 中同步设置 `LEARNING_AGENT_PROXY_TARGET`。经过 Web 请求 `GET /agent/health`，或直连 Agent 请求 `GET /api/learning-agent/health`，都应返回 `{"status":"ok"}`。

## 词书与学习档案

- `BAICIZHAN_HELPER_API_BASE_URL` 指向 Web 所用的同一个助手代理。Agent 使用请求中的 `access_token` 调用代理的 `/userInfoWithVip` 核验用户 ID，并通过 `/booksInfo` 查找词书。
- `LEARNING_AGENT_DB_PATH` 指定 Agent 的 SQLite 文件，默认 `.data/learning-agent-web.sqlite`。相对路径以项目根目录为基准，服务启动时创建 `user_agent_profile` 表。
- 对外的 `GET /agent/profile` 读取当前账号的档案，无记录时 `data` 为 `null`。`PUT /agent/profile/book` 接收 `{ "bookId": 123 }` 并返回更新后的档案。换书保存新书的目录简介，清空学习路线和单词排序。
- 选书成功后，Web 自动打开路线弹窗并调用 `POST /agent/profile/learning-route`，提交 `{ "bookId": 123, "bookRevision": 1 }`。服务端通过 `roadmap → wordListWordMetaV2` 获取全书词表，元信息每批 200 条串行加载，上一批完成后再请求下一批，缺失拼写补查一次。
- 全量简介和 `{ topicId, word, meanCn }` 数组通过一次模型请求生成 `{ rationale, topicIds }`。完整校验成功后，一次更新 `learning_route` 和 `word_order`；档案响应包含 `learningRoute`、`wordOrder` 和 `bookRevision`。启动时自动补齐旧表缺失的路线字段。
- SSE 事件包含 `progress`、`rationale_delta`、`done`、`error`，每 10 秒发送心跳。`done.profile` 是已保存的完整档案。换书版本冲突返回 409，避免旧任务覆盖新书。
- 关闭弹窗、离开页面或切换账号会中止未完成规划；新选择的词书仍保留。失败可重试，无路线的档案提供手动生成入口，刷新页面不会自动消耗模型请求。

## 生产部署

```sh
npm ci
npm run check
npm run build
npm test
npm start
```

生产进程监听 `127.0.0.1:18034`，默认连接同机 Proxy `http://127.0.0.1:18033`。通过项目根目录的 `.env` 或进程环境设置生产配置。将 `LEARNING_AGENT_DB_PATH` 指到服务用户可写的持久目录，以便更新程序时保留学习档案。

Nginx 使用 Proxy 仓库的 `deploy/nginx.conf`，将同域 `/agent/*` 映射到本服务的 `/api/learning-agent/*`，并保留 `access_token` 请求头。普通接口走同机 Proxy，登录后在 Web 的 `/page/learning-agent` 使用 Agent 功能。

## 模型配置

学习路线规划使用服务端的以下环境变量。健康检查和选书独立于模型配置，未配置时路线接口会明确提示，仍可保留选书。

| 变量 | 开发环境 | 部署环境 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | CLIProxyAPI 的 API 根地址，保留 `/v1` | 阿里云百炼工作空间的 OpenAI 兼容根地址，保留 `/compatible-mode/v1` |
| `OPENAI_API_KEY` | CLIProxyAPI 访问密钥 | 阿里云百炼 API Key |
| `OPENAI_MODEL` | CLIProxyAPI 提供的模型名称 | 百炼工作空间支持的 Qwen 模型名称 |
| `OPENAI_MAX_OUTPUT_TOKENS` | 默认 `32768` | 按模型能力配置，需容纳整本词书的完整排序 |
| `OPENAI_TOKEN_LIMIT_FIELD` | 默认 `max_completion_tokens` | 服务需要旧参数时设为 `max_tokens` |

模型须支持 Chat Completions、流式响应和 `response_format: { "type": "json_object" }`，并有足够上下文及输出额度容纳 3,000～4,000 词。兼容参数通过配置指定，不自动重发探测；SDK 自动重试已关闭。单次规划超时 10 分钟，输出被截断、词表有遗漏或重复时不保存，也不自动补词或请求修复。

生产 Nginx 的 `/agent/` 代理需要关闭缓冲并允许长连接；参考 Proxy 仓库的 `deploy/nginx.conf`。服务端同时返回 `X-Accel-Buffering: no`。自动测试使用本地模拟模型验证 4,000 词一次完整输出；真实模型验收需要配置上述三个模型连接变量。

更新时先部署 Agent，再部署 Web，使新的 `bookRevision`、`wordOrder` 字段及流式接口先就绪。数据库补列在 Agent 启动时执行，请保留原有 SQLite 文件。

## 单词学习流程

首版学习流程的目标是记住拼写和常用含义，并能在句子中用对这个词。新学时安排主动回忆，后续复习时先测再看。

### 新词

1. **认识单词。** 展示拼写、音标、读音和一个常用释义，配一条能体现常见搭配的例句。
2. **回忆拼写。** 收起英文拼写，根据中文释义或读音默写一次。答不出来时可给提示。
3. **换一句来翻译。** 给出一条新的中文句子，请用户用目标词翻成英文。新句子沿用刚学的含义和搭配。需要时可提示搭配。
4. **反馈并修改。** AI 先检查目标词的含义和搭配，接受多种自然译法。优先指出一处最影响本词用法的问题，让用户改一次。

例如，学习 `avoid` 时先看 `avoid doing something` 和例句 *She avoids driving in heavy traffic.*，再翻译「我尽量避免在晚上喝咖啡。」参考译法为 *I try to avoid drinking coffee at night.*。如果用户写成 `avoid to drink`，提示「`avoid` 后接动名词，把 `to drink` 改成 `drinking`」。

### 复习

隔天可以按上次的表现选一道题，答对就进入下一个词，有错再展开释义、例句或搭配。

- **拼错的词**先默写。
- **用错含义或搭配的词**换一句再翻译。
- **靠提示答出的词**先收起提示，让用户独立作答。

## 后续计划

- 导入百词斩助手已有的学习次数和学习计划。
- 根据已学单词的错误次数规划学习内容。
- 将学习记录回传到百词斩。
