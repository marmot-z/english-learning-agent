import { AppError } from '../errors.js';
import type { HistoryRepository } from '../db/history-repository.js';
import type { Book, DailyWordCounts, LearningContext, LearningPlan } from '../domain/types.js';
import type { BookProgress } from '../domain/progress.js';
import { bookProgressSchema } from '../domain/progress.js';
import { defaultBookId, initialBookProgress } from '../materials/default-book.js';
import { wordKey } from '../materials/book.js';
import type { BookWord } from '../materials/book.js';
import { selectWords } from '../ai/word-selection.js';
import type { RunSelection, TrackSelection } from '../ai/word-selection.js';

export const defaultUserId = 'default';

interface OnboardingInput extends DailyWordCounts {
  displayName: string;
  preferences: string;
}

type GenerateBookIntroduction = (
  book: Book, counts: DailyWordCounts, preferences: string,
  signal?: AbortSignal,
) => Promise<{ introduction: string; progress: BookProgress }>;

function notImplemented(stage: string): never {
  throw new AppError('NOT_IMPLEMENTED', `${stage}尚未实现。`);
}

export function createLearningService({ historyRepository }: { historyRepository: HistoryRepository }) {
  return {
    loadDefaultBook() {
      return historyRepository.loadDefaultBook();
    },
    findDefaultProfile() {
      return historyRepository.findProfile(defaultUserId);
    },
    async onboardDefaultUser(
      book: Book,
      input: OnboardingInput,
      generateBookIntroduction: GenerateBookIntroduction,
      signal?: AbortSignal,
    ) {
      const { displayName, preferences, ...counts } = input;
      signal?.throwIfAborted();

      const details = preferences ?
        await generateBookIntroduction(book, counts, preferences, signal) :
        { introduction: book.introduction, progress: initialBookProgress(book.defaultPlan) };
      signal?.throwIfAborted();

      const progress = bookProgressSchema.parse(details.progress);
      const created = historyRepository.insertProfile({
        userId: defaultUserId,
        displayName,
        bookId: book.id,
        progress,
        bookIntroduction: details.introduction,
        ...counts,
      });

      return created ? details : null;
    },
    loadLearningContext(userId: string = defaultUserId): LearningContext {
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new AppError('INVALID_USER_ID', 'userId 必须是非空字符串。');
      }

      return historyRepository.loadContext(userId.trim());
    },
    async prepareLearningPlan(
      words: BookWord[], run: RunSelection, signal?: AbortSignal, trackSelection?: TrackSelection,
    ): Promise<LearningPlan> {
      const { profile, book, learnedWords, reviewCandidates } = historyRepository.loadPlanContext(defaultUserId);

      if (book.id !== defaultBookId) {
        throw new AppError('BOOK_WORD_LIST_UNSUPPORTED', '当前词书没有可用的分类词表。');
      }

      const learned = new Set(learnedWords.map(wordKey));
      const newCandidates = words.filter(({ word }) => !learned.has(wordKey(word)));

      const categoryIdsByWord = new Map(words.map(({ word, categoryIds }) => [wordKey(word), categoryIds]));
      const reviewByWord = new Map<string, (typeof reviewCandidates)[number] & { categoryIds: string[] }>();

      for (const candidate of reviewCandidates) {
        const key = wordKey(candidate.word);

        if (!reviewByWord.has(key)) {
          reviewByWord.set(key, { ...candidate, categoryIds: categoryIdsByWord.get(key) ?? [] });
        }
      }

      const review = [...reviewByWord.values()];
      const newWords = await selectWords(
        run, 'new', newCandidates,
        profile.dailyNewWordCount, { progress: profile.progress },
        signal, trackSelection,
      );
      const reviewWords = await selectWords(
        run, 'review', review,
        profile.dailyReviewWordCount,
        { categories: profile.progress.categories },
        signal, trackSelection,
      );

      return { newWords, reviewWords };
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
