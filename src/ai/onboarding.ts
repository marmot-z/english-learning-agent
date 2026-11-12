import { z } from 'zod';
import { AppError } from '../errors.js';
import { defaultBookOverview } from '../materials/default-book.js';
import { onboardingInstructions } from '../prompts/index.js';
import type { DailyWordCounts } from '../domain/types.js';
import { createAiRunner } from './client.js';
import type { AiConfig } from './config.js';

const introductionSchema = z.object({
  bookIntroduction: z.string().trim().min(1),
  learningRoute: z.string().trim().min(1),
});

export async function generateBookIntroduction(config: AiConfig, counts: DailyWordCounts, preferences: string, signal?: AbortSignal) {
  const runner = createAiRunner(config);

  try {
    const output = await runner.runText({
      name: 'OnboardingBookIntroduction',
      instructions: onboardingInstructions,
      input: JSON.stringify({ bookOverview: defaultBookOverview, ...counts, preferences }),
      maxTokens: 768,
      signal,
    });

    try {
      const { bookIntroduction, learningRoute } = introductionSchema.parse(JSON.parse(output));
      return `一、词书介绍\n${bookIntroduction}\n\n二、基础学习路线\n${learningRoute}`;
    } catch (error) {
      throw new AppError(
        'AI_INVALID_BOOK_INTRODUCTION', 'AI 未返回有效的词书介绍和基础学习路线，请重新运行学习助手。', { cause: error },
      );
    }
  } finally {
    await runner.close();
  }
}
