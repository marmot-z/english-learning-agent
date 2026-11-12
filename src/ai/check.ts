import { createAiRunner } from './client.js';
import { connectivityInstructions, connectivityInput } from '../prompts/index.js';
import { AppError } from '../errors.js';
import type { AiConfig } from './config.js';

export interface ConnectionCheck {
  ok: true;
  model: string;
  output: 'OK';
}

export async function checkAiConnection(config: AiConfig): Promise<ConnectionCheck> {
  const runner = createAiRunner(config);

  try {
    const output = await runner.runText({
      name: 'ConnectivityCheck',
      instructions: connectivityInstructions,
      input: connectivityInput,
      maxTokens: 16,
    });

    if (output.trim() !== 'OK') {
      throw new AppError('AI_UNEXPECTED_RESPONSE', '代理已返回文本，但结果不是预期的 OK；未通过连通性验收。');
    }

    return { ok: true, model: config.model, output: 'OK' };
  } finally {
    await runner.close();
  }
}
