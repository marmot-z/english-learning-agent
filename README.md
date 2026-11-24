# 英语学习 Agent Web 后端

这是供百词斩助手 Web 接入的独立 Node.js 服务。需要 Node.js 22.13 或更高版本。使用 nvm 时可先运行 `nvm use 22`。

## 本地启动

```sh
npm ci
npm run dev
```

默认监听 `127.0.0.1:18034`。可通过环境变量或项目根目录的 `.env` 设置 `LEARNING_AGENT_HOST` 和 `LEARNING_AGENT_PORT`。`GET /api/learning-agent/health` 返回 `200` 和 `{"status":"ok"}`，表示 HTTP 进程存活。

前端在 `baicizhan-helper-web` 中运行 `npm run dev`。登录后从用户菜单进入「英语学习 Agent」占位页，地址为 `/page/learning-agent`。前端开发服务器将 `/api/learning-agent` 转发到本服务。更换后端地址或端口时，在前端的 `.env.local` 中同步设置 `LEARNING_AGENT_PROXY_TARGET`。

## 类型检查与编译启动

```sh
npm run check
npm run build
npm start
```

## 模型配置

后续模型调用使用服务端的以下环境变量。当前健康接口独立于模型配置。

| 变量 | 开发环境 | 部署环境 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | CLIProxyAPI 的 API 根地址，保留 `/v1` | 阿里云百炼工作空间的 OpenAI 兼容根地址，保留 `/compatible-mode/v1` |
| `OPENAI_API_KEY` | CLIProxyAPI 访问密钥 | 阿里云百炼 API Key |
| `OPENAI_MODEL` | CLIProxyAPI 提供的模型名称 | 百炼工作空间支持的 Qwen 模型名称 |

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
