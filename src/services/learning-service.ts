import { AppError } from '../errors.js';
import type { HistoryRepository } from '../db/history-repository.js';
import type { DailyWordCounts, LearningContext } from '../domain/types.js';
import { defaultBookTitle } from '../materials/default-book.js';

export const defaultUserId = 'default';

interface OnboardingInput extends DailyWordCounts {
  displayName: string;
  preferences: string;
}

type GenerateBookIntroduction = (counts: DailyWordCounts, preferences: string, signal?: AbortSignal) => Promise<string>;

function notImplemented(stage: string): never {
  throw new AppError('NOT_IMPLEMENTED', `${stage}尚未实现。`);
}

export function createLearningService({ historyRepository }: { historyRepository: HistoryRepository }) {
  return {
    findDefaultProfile() {
      return historyRepository.findProfile(defaultUserId);
    },
    async onboardDefaultUser(input: OnboardingInput, generateBookIntroduction: GenerateBookIntroduction, signal?: AbortSignal) {
      const { displayName, preferences, ...counts } = input;
      signal?.throwIfAborted();
      const bookIntroduction = await generateBookIntroduction(counts, preferences, signal);
      signal?.throwIfAborted();
      const created = historyRepository.insertProfile({
        userId: defaultUserId, displayName, book: defaultBookTitle, bookIntroduction, ...counts,
      });
      return created ? bookIntroduction : null;
    },
    loadLearningContext(userId: string = defaultUserId): LearningContext {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new AppError('INVALID_USER_ID', 'userId 必须是非空字符串。');
      }

      return historyRepository.loadContext(userId.trim());
    },
    async prepareLearningPlan(_input: unknown): Promise<never> {
      return notImplemented('学习规划');
    },
    async generateWordLesson(_input: unknown): Promise<never> {
      return notImplemented('单词教学');
    },
    async correctAnswer(_input: unknown): Promise<never> {
      return notImplemented('回答纠正');
    },
    async evaluateSession(_input: unknown): Promise<never> {
      return notImplemented('学习评估');
    },
  };
}
