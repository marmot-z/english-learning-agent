-- 英语学习 Agent 的 SQLite 建表脚本，适用于空数据库。
-- 默认词书由应用初始化时从 BOOK_PATH 对应词表统计并写入。

PRAGMA foreign_keys = ON;
BEGIN;

-- book 词书
-- id           词书唯一标识，默认词书为 1368。
-- title        唯一书名，也用于关联历史单词记录。
-- introduction 词书简介。
-- default_plan 默认学习路线，JSON 对象包含有序分类 ID 和路线说明。
-- word_count   分类词表实际去重后的词条数。
CREATE TABLE book (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL UNIQUE,
  introduction TEXT NOT NULL,
  default_plan TEXT NOT NULL CHECK (json_valid(default_plan)),
  word_count INTEGER NOT NULL CHECK (word_count > 0)
);

-- user_profile 用户学习档案
-- user_id                 用户唯一标识，当前 CLI 使用 default。
-- current_level           用户当前英语水平，首次建档留空。
-- progress                JSON 对象，记录全书分类、用户学习路线、当前分类和已学习内容概要。
-- book_id                 当前学习词书的标识，关联 book.id。
-- learning_count          用户累计学习次数，初始为 0。
-- last_learning_at        用户最近一次学习时间，尚未学习时为 NULL。
-- created_at              档案创建时间。
-- updated_at              档案最近更新时间。
-- display_name            CLI 问候使用的称呼，旧档案为 NULL 时使用 user_id。
-- book_introduction       建档时的词书简介及个性化路线（如有），保留旧档案内容。
-- profile_summary         用户画像摘要，可记录大致水平和其他辅助信息，首次建档留空。
-- daily_new_word_count    每日计划学习的新词数，默认 10。
-- daily_review_word_count 每日计划复习的旧词数，默认 5。
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

-- learning_record 学习会话记录
-- id                学习会话主键。
-- user_id           会话所属用户，关联 user_profile.user_id。
-- new_words_json    本次会话安排的新词，保存为 JSON 字符串数组。
-- review_words_json 本次会话安排的复习词，保存为 JSON 字符串数组。
-- answers_json      本次会话的答题记录，保存为 JSON 数组。
-- evaluation        本次会话的整体评价。
-- score             本次会话的评分，取值 0–100，未评分时为 NULL。
-- duration_seconds  本次会话的耗时，单位为秒。
-- status            会话状态，in_progress 为进行中，completed 为已完成，interrupted 为已中断。
-- started_at        会话开始时间。
-- completed_at      会话完成时间，状态为 completed 时必填。
-- created_at        记录创建时间。
-- updated_at        记录最近更新时间。
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

-- word_record 用户在某本词书中的单词学习记录
-- id               单词学习记录主键。
-- user_id          记录所属用户，关联 user_profile.user_id。
-- book             该单词所属词书的名称。
-- word             单词。同一用户在同一本词书中仅有一条该单词的记录。
-- learning_count   该单词的累计学习次数，历史查询仅返回次数大于 0 的词。
-- error_count      该单词的累计答错次数。
-- last_learning_at 该单词最近一次学习时间，尚未学习时为 NULL。
-- sentences_json   与该单词相关的例句，保存为 JSON 字符串数组。
-- score            该单词的评分，取值 0–100，未评分时为 NULL。
-- evaluation       该单词的文字评价。
-- created_at       记录创建时间。
-- updated_at       记录最近更新时间。
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

COMMIT;
