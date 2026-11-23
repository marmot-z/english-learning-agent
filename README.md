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

## 后续计划

- 导入百词斩助手已有的学习次数和学习计划。
- 根据已学单词的错误次数规划学习内容。
- 将学习记录回传到百词斩。
