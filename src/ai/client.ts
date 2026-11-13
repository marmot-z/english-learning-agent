import OpenAI from 'openai';
import { Agent as HttpAgent } from 'undici';
import { Agent, OpenAIChatCompletionsModel, Runner, setTracingDisabled } from '@openai/agents';
import { AppError } from '../errors.js';
import { aiConfigSchema } from './config.js';
import type { AiConfig } from './config.js';

export interface TextRequest {
  name: string;
  instructions: string;
  input: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiRunner {
  runText(request: TextRequest): Promise<string>;
  close(): Promise<void>;
}

function mapAiError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AppError('AI_TIMEOUT', 'AI 请求超时，请检查代理服务或 OPENAI_TIMEOUT_MS。', { cause: error });
  }

  if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403)) {
    return new AppError('AI_AUTH_FAILED', '代理认证失败，请检查 OPENAI_API_KEY 和访问权限。', { cause: error });
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new AppError('AI_CONNECTION_FAILED', '无法连接 AI 代理，请检查服务状态和 OPENAI_BASE_URL。', { cause: error });
  }

  if (error instanceof OpenAI.APIError && Number.isInteger(error.status)) {
    return new AppError('AI_HTTP_ERROR', `AI 代理返回 HTTP ${error.status}；请检查模型、API 路径和代理日志。`, { cause: error });
  }

  return new AppError('AI_INVALID_RESPONSE', 'AI 调用失败或响应结构不符合 Chat Completions 协议。', { cause: error });
}

export function createAiRunner(config: AiConfig): AiRunner {
  const parsed = aiConfigSchema.safeParse(config);

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))].join(', ');
    throw new AppError('AI_CONFIG_INVALID', `AI 配置缺失或无效：${fields}。请检查环境变量或 .env。`);
  }

  const { baseURL, apiKey, model, timeout } = parsed.data;
  const dispatcher = new HttpAgent();
  const client = new OpenAI({
    baseURL: baseURL.replace(/\/+$/, ''),
    apiKey,
    timeout,
    maxRetries: 0,
    logLevel: 'off',
    fetch: (url, options) => {
      // Node 原生 fetch 支持 Undici dispatcher，保持原生 Request/Response 类型，避免跨版本强制断言。
      const directOptions = { ...options, dispatcher };

      return globalThis.fetch(url, directOptions);
    },
  });

  setTracingDisabled(true);
  const runner = new Runner({ tracingDisabled: true });
  const chatModel = new OpenAIChatCompletionsModel(client, model);

  return {
    async runText({ name, instructions, input, maxTokens = 256, signal }) {
      const agent = new Agent({ name, instructions, model: chatModel, modelSettings: { maxTokens } });

      try {
        const result = await runner.run(agent, input, { maxTurns: 1, signal });

        if (typeof result.finalOutput !== 'string' || !result.finalOutput.trim()) {
          throw new AppError('AI_EMPTY_RESPONSE', 'AI 返回空文本，无法确认调用成功。');
        }

        return result.finalOutput;
      } catch (error) {
        throw mapAiError(error);
      }
    },
    async close() {
      await dispatcher.close();
    },
  };
}
