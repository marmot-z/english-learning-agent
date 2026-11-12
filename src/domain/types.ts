export interface DailyWordCounts {
  dailyNewWordCount: number;
  dailyReviewWordCount: number;
}

export interface UserProfile extends DailyWordCounts {
  userId: string;
  displayName: string;
  currentLevel: string;
  progress: string;
  book: string;
  bookIntroduction: string;
  profileSummary: string;
  learningCount: number;
  lastLearningAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LearningStatus = 'in_progress' | 'completed' | 'interrupted';

export interface LearningRecord {
  id: number;
  userId: string;
  newWords: string[];
  reviewWords: string[];
  answers: unknown[];
  evaluation: string;
  score: number | null;
  durationSeconds: number;
  status: LearningStatus;
  startedAt: string;
  completedAt: string | null;
}

export interface WordRecord {
  id: number;
  userId: string;
  book: string;
  word: string;
  learningCount: number;
  errorCount: number;
  lastLearningAt: string | null;
  sentences: string[];
  score: number | null;
  evaluation: string;
}

export interface LearningContext {
  profile: UserProfile | null;
  recentSessions: LearningRecord[];
  learnedWords: WordRecord[];
}
