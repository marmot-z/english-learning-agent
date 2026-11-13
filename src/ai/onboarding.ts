import { z } from 'zod';
import { AppError } from '../errors.js';
import { bookOverview, initialBookProgress } from '../materials/default-book.js';
import { onboardingInstructions } from '../prompts/index.js';
import type { Book, DailyWordCounts } from '../domain/types.js';
import { bookProgressSchema } from '../domain/progress.js';
import { createAiRunner } from './client.js';
import type { AiConfig } from './config.js';

const introductionSchema = z.object({
  bookIntroduction: z.string().trim().min(1),
  learningRoute: z.string().trim().min(1),
  categoryIds: z.array(z.string()),
  startCategoryId: z.string(),
});

export async function generateBookIntroduction(
  config: AiConfig, book: Book, counts: DailyWordCounts, preferences: string, signal?: AbortSignal,
) {
  const runner = createAiRunner(config);

  try {
    const output = await runner.runText({
      name: 'OnboardingBookIntroduction',
      instructions: onboardingInstructions,
      input: JSON.stringify({ bookOverview: bookOverview(book), categories: initialBookProgress().categories, ...counts, preferences }),
      maxTokens: 768,
      signal,
    });

    try {
      const { bookIntroduction, learningRoute, categoryIds, startCategoryId } = introductionSchema.parse(JSON.parse(output));
      const progress = bookProgressSchema.parse({
        ...initialBookProgress({ categoryIds, description: learningRoute }),
        current: { categoryId: startCategoryId, summary: '' },
      });
      const introduction = `一、词书介绍\n${bookIntroduction}\n\n二、基础学习路线\n${learningRoute}`;
      return { introduction, progress };
    } catch (error) {
      throw new AppError(
        'AI_INVALID_BOOK_INTRODUCTION',
        'AI 未返回有效的词书介绍和基础学习路线，请重新运行学习助手。',
        { cause: error },
      );
    }
  } finally {
    await runner.close();
  }
}
