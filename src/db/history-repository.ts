import type { DatabaseSync } from 'node:sqlite';
import { assertDefaultBookTitle, readDatabase, writeDatabase } from './database.js';
import type { ProfileSchemaVersion } from './database.js';
import { AppError } from '../errors.js';
import { z } from 'zod';
import type { Book, LearningContext, UserProfile, LearningRecord, ReviewCandidate, WordRecord } from '../domain/types.js';
import { bookPlanSchema, bookProgressSchema } from '../domain/progress.js';
import { defaultBookId, initialBookProgress } from '../materials/default-book.js';

export interface HistoryRepository {
  loadDefaultBook(): Book;
  findProfile(userId: string): UserProfile | null;
  insertProfile(profile: NewUserProfile): boolean;
  loadContext(userId: string): LearningContext;
  loadPlanContext(userId: string): { profile: UserProfile; book: Book; learnedWords: string[]; reviewCandidates: ReviewCandidate[] };
}

type NewUserProfile = Pick<
  UserProfile,
  'userId' | 'displayName' | 'bookId' | 'progress' | 'bookIntroduction' | 'dailyNewWordCount' | 'dailyReviewWordCount'
>;

const profileFields = z.object({
  userId: z.string(),
  displayName: z.string(),
  currentLevel: z.string(),
  bookIntroduction: z.string(),
  profileSummary: z.string(),
  dailyNewWordCount: z.int().nonnegative(),
  dailyReviewWordCount: z.int().nonnegative(),
  learningCount: z.number().int(),
  lastLearningAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const storedProfileSchema = profileFields.extend({ bookId: z.string(), progress: z.string() });
const legacyProfileSchema = profileFields.extend({ book: z.string(), progress: z.string() });
const storedBookSchema = z.object({
  id: z.string(),
  title: z.string(),
  introduction: z.string(),
  defaultPlan: z.string(),
  wordCount: z.int().positive(),
});

const sessionSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  newWords: z.array(z.string()),
  reviewWords: z.array(z.string()),
  answers: z.array(z.unknown()),
  evaluation: z.string(),
  score: z.number().nullable(),
  durationSeconds: z.number().int(),
  status: z.enum(['in_progress', 'completed', 'interrupted']),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
}) satisfies z.ZodType<LearningRecord>;

const wordSchema = z.object({
  id: z.number().int(),
  userId: z.string(),
  book: z.string(),
  word: z.string(),
  learningCount: z.number().int(),
  errorCount: z.number().int(),
  lastLearningAt: z.string().nullable(),
  sentences: z.array(z.string()),
  score: z.number().nullable(),
  evaluation: z.string(),
}) satisfies z.ZodType<WordRecord>;
const reviewCandidateSchema = wordSchema.pick({
  id: true,
  word: true,
  learningCount: true,
  errorCount: true,
  evaluation: true,
  lastLearningAt: true,
});

function parseRow<T>(schema: z.ZodType<T>, row: unknown, table: string): T {
  const result = schema.safeParse(row);

  if (!result.success) {
    throw new AppError('DB_INVALID_ROW', `${table} 字段类型不符合数据契约。`, { cause: result.error });
  }

  return result.data;
}

function arrayFromJson(value: unknown, field: string): unknown[] {
  try {
    if (typeof value !== 'string') {
      throw new Error('Expected JSON text');
    }

    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      throw new Error('Expected an array');
    }

    return parsed;
  } catch (error) {
    throw new AppError('DB_INVALID_JSON', `${field} 必须是 JSON 数组。`, { cause: error });
  }
}

function readStoredJson<T>(schema: z.ZodType<T>, raw: string, field: string): T {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new AppError('DB_INVALID_JSON', `${field} 的 JSON 格式无效。`, { cause: error });
  }
}

function loadBook(db: DatabaseSync, bookId: string): Book {
  const row = db.prepare(`
    SELECT id, title, introduction, default_plan AS defaultPlan, word_count AS wordCount FROM book WHERE id = ?
  `).get(bookId);

  if (!row) {
    throw new AppError('DB_BOOK_NOT_FOUND', '词书记录不存在，请先运行 npm run db:init。');
  }

  const book = parseRow(storedBookSchema, row, 'book');

  return { ...book, defaultPlan: readStoredJson(bookPlanSchema, book.defaultPlan, 'book.default_plan') };
}

function findProfile(db: DatabaseSync, userId: string, version: ProfileSchemaVersion): UserProfile | null {
  const details = version === 'original' ?
    "user_id AS displayName, '' AS bookIntroduction, '' AS profileSummary, 10 AS dailyNewWordCount, 5 AS dailyReviewWordCount" :
    `COALESCE(display_name, user_id) AS displayName, book_introduction AS bookIntroduction, profile_summary AS profileSummary,
     daily_new_word_count AS dailyNewWordCount, daily_review_word_count AS dailyReviewWordCount`;
  const bookColumn = version === 'current' ? 'book_id AS bookId' : 'book';
  const row = db.prepare(`
    SELECT user_id AS userId, current_level AS currentLevel, progress, ${bookColumn}, ${details},
           learning_count AS learningCount, last_learning_at AS lastLearningAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM user_profile WHERE user_id = ?
  `).get(userId);

  if (!row) {
    return null;
  }

  if (version === 'current') {
    const profile = parseRow(storedProfileSchema, row, 'user_profile');

    return { ...profile, progress: readStoredJson(bookProgressSchema, profile.progress, 'user_profile.progress') };
  }

  const { book, progress, ...profile } = parseRow(legacyProfileSchema, row, 'user_profile');
  assertDefaultBookTitle(book);

  return { ...profile, bookId: defaultBookId, progress: initialBookProgress(undefined, progress) };
}

export function createHistoryRepository(databasePath: string): HistoryRepository {
  return {
    loadDefaultBook() {
      return readDatabase(databasePath, (db) => loadBook(db, defaultBookId));
    },
    findProfile(userId) {
      return readDatabase(databasePath, (db, legacyProfile) => findProfile(db, userId, legacyProfile));
    },
    insertProfile({ userId, displayName, bookId, progress, bookIntroduction, dailyNewWordCount, dailyReviewWordCount }) {
      return writeDatabase(databasePath, (db) => {
        const now = new Date().toISOString();
        const result = db.prepare(`
          INSERT INTO user_profile (
            user_id, display_name, current_level, book_id, progress, book_introduction,
            daily_new_word_count, daily_review_word_count, created_at, updated_at
          ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO NOTHING
        `).run(
          userId, displayName, bookId,
          JSON.stringify(progress), bookIntroduction, dailyNewWordCount,
          dailyReviewWordCount, now, now,
        );

        return result.changes === 1;
      });
    },

    loadPlanContext(userId) {
      return readDatabase(databasePath, (db, version) => {
        const profile = findProfile(db, userId, version);

        if (!profile) {
          throw new AppError('DB_PROFILE_NOT_FOUND', '找不到用户档案，请先完成建档。');
        }

        const book = loadBook(db, profile.bookId);
        const learnedWords = db.prepare(`
          SELECT word FROM word_record WHERE user_id = ? AND book = ? AND learning_count > 0
        `)
          .all(userId, book.title)
          .map((row) => parseRow(z.string(), row.word, 'word_record'));
        const reviewCandidates = db.prepare(`
          SELECT id, word, learning_count AS learningCount, error_count AS errorCount,
                 evaluation, last_learning_at AS lastLearningAt
          FROM word_record WHERE user_id = ? AND book = ? AND learning_count > 0
          ORDER BY last_learning_at DESC, id DESC LIMIT 30
        `)
          .all(userId, book.title)
          .map((row) => parseRow(reviewCandidateSchema, row, 'word_record'));

        return { profile, book, learnedWords, reviewCandidates };
      });
    },

    loadContext(userId) {
      return readDatabase(databasePath, (db, legacyProfile) => {
        const profile = findProfile(db, userId, legacyProfile);
        const records = db.prepare(`
          SELECT id, user_id AS userId, new_words_json, review_words_json, answers_json,
                 evaluation, score, duration_seconds AS durationSeconds, status,
                 started_at AS startedAt, completed_at AS completedAt
          FROM learning_record WHERE user_id = ? AND status = 'completed'
          ORDER BY completed_at DESC, id DESC LIMIT 3
        `).all(userId);

        const words = db.prepare(`
          SELECT id, user_id AS userId, book, word, learning_count AS learningCount,
                 error_count AS errorCount, last_learning_at AS lastLearningAt, sentences_json, score, evaluation
          FROM word_record WHERE user_id = ? AND learning_count > 0
          ORDER BY last_learning_at DESC, id DESC
        `).all(userId);

        return {
          profile,
          recentSessions: records.map(({ new_words_json, review_words_json, answers_json, ...record }) =>
            parseRow(
              sessionSchema,
              {
                ...record,
                newWords: arrayFromJson(new_words_json, 'learning_record.new_words_json'),
                reviewWords: arrayFromJson(review_words_json, 'learning_record.review_words_json'),
                answers: arrayFromJson(answers_json, 'learning_record.answers_json'),
              },
              'learning_record',
            ),
          ),
          learnedWords: words.map(({ sentences_json, ...word }) =>
            parseRow(
              wordSchema,
              {
                ...word,
                sentences: arrayFromJson(sentences_json, 'word_record.sentences_json'),
              },
              'word_record',
            ),
          ),
        };
      });
    },
  };
}
