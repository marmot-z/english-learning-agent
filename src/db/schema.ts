// JSON 字段由 repository 解码；未评估的分数、时间允许为空，不用 0 伪装结果。
const originalProfileSql = `
CREATE TABLE user_profile (
  user_id TEXT PRIMARY KEY NOT NULL,
  current_level TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '',
  book TEXT NOT NULL,
  learning_count INTEGER NOT NULL DEFAULT 0 CHECK (learning_count >= 0),
  last_learning_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const historySql = `
CREATE TABLE learning_record (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profile(user_id),
  new_words_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(new_words_json)),
  review_words_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(review_words_json)),
  answers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers_json)),
  evaluation TEXT NOT NULL DEFAULT '',
  score REAL CHECK (score BETWEEN 0 AND 100),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'interrupted')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status != 'completed' OR completed_at IS NOT NULL)
);

CREATE TABLE word_record (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_profile(user_id),
  book TEXT NOT NULL,
  word TEXT NOT NULL,
  learning_count INTEGER NOT NULL DEFAULT 0 CHECK (learning_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  last_learning_at TEXT,
  sentences_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sentences_json)),
  score REAL CHECK (score BETWEEN 0 AND 100),
  evaluation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, book, word)
);

CREATE INDEX idx_learning_record_user_completed ON learning_record(user_id, status, completed_at DESC, id DESC);
CREATE INDEX idx_word_record_user_learned ON word_record(user_id, last_learning_at DESC);
`;

export const originalSchemaSql = originalProfileSql + historySql;

export const addProfileDetailsSql = `
ALTER TABLE user_profile ADD COLUMN display_name TEXT;
ALTER TABLE user_profile ADD COLUMN book_introduction TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profile ADD COLUMN profile_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profile ADD COLUMN daily_new_word_count INTEGER NOT NULL DEFAULT 10 CHECK (daily_new_word_count >= 0);
ALTER TABLE user_profile ADD COLUMN daily_review_word_count INTEGER NOT NULL DEFAULT 5 CHECK (daily_review_word_count >= 0);
`;

const bookSql = `
CREATE TABLE book (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL UNIQUE,
  introduction TEXT NOT NULL,
  default_plan TEXT NOT NULL CHECK (json_valid(default_plan)),
  word_count INTEGER NOT NULL CHECK (word_count > 0)
);
`;

export const profileTableSql = `
CREATE TABLE user_profile (
  user_id TEXT PRIMARY KEY NOT NULL,
  current_level TEXT NOT NULL,
  progress TEXT NOT NULL CHECK (json_valid(progress)),
  book_id TEXT NOT NULL REFERENCES book(id),
  learning_count INTEGER NOT NULL DEFAULT 0 CHECK (learning_count >= 0),
  last_learning_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  display_name TEXT,
  book_introduction TEXT NOT NULL DEFAULT '',
  profile_summary TEXT NOT NULL DEFAULT '',
  daily_new_word_count INTEGER NOT NULL DEFAULT 10 CHECK (daily_new_word_count >= 0),
  daily_review_word_count INTEGER NOT NULL DEFAULT 5 CHECK (daily_review_word_count >= 0)
);
`;

export const currentSchemaSql = bookSql + profileTableSql + historySql;
