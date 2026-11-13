import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { addProfileDetailsSql, currentSchemaSql, originalSchemaSql, profileTableSql } from './schema.js';
import { AppError } from '../errors.js';
import { z } from 'zod';
import type { Book } from '../domain/types.js';
import { defaultBookTitle, initialBookProgress } from '../materials/default-book.js';

const schemaObjectSchema = z.object({ type: z.string(), name: z.string(), sql: z.string() });

function schemaObjects(db: DatabaseSync) {
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL").all();

  return z.array(schemaObjectSchema).parse(rows);
}

function expectedObjects() {
  const reference = new DatabaseSync(':memory:');

  try {
    reference.exec(originalSchemaSql);
    const original = schemaObjects(reference);
    reference.exec(addProfileDetailsSql);
    const previous = schemaObjects(reference);
    reference.exec('DROP TABLE word_record; DROP TABLE learning_record; DROP TABLE user_profile;');
    reference.exec(currentSchemaSql);

    return { original, previous, current: schemaObjects(reference) };
  } finally {
    reference.close();
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/^CREATE TABLE "user_profile"/, 'CREATE TABLE user_profile').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

export type ProfileSchemaVersion = 'original' | 'previous' | 'current';

function validateSchema(db: DatabaseSync, allowMissing: boolean): { missing: string[]; profileVersion: ProfileSchemaVersion } {
  const actual = new Map(schemaObjects(db).map((entry) => [entry.name, entry]));
  const { original, previous, current } = expectedObjects();
  const originalProfile = original.find((entry) => entry.name === 'user_profile')?.sql ?? '';
  const previousProfile = previous.find((entry) => entry.name === 'user_profile')?.sql ?? '';
  const missing: string[] = [];
  let profileVersion: ProfileSchemaVersion = 'current';

  for (const expected of current) {
    const existing = actual.get(expected.name);

    if (!existing) {
      // 旧库的只读查询使用默认词书元数据。
      if (!allowMissing && expected.name !== 'book') {
        throw new AppError('DB_NOT_INITIALIZED', `缺少 ${expected.name}，请先运行 npm run db:init。`);
      }

      missing.push(expected.sql);
      continue;
    }

    const actualSql = normalizeSql(existing.sql);

    if (expected.name === 'user_profile' && existing.type === expected.type) {
      if (actualSql === normalizeSql(originalProfile)) {
        profileVersion = 'original';
        continue;
      }

      if (actualSql === normalizeSql(previousProfile)) {
        profileVersion = 'previous';
        continue;
      }
    }

    if (existing.type !== expected.type || actualSql !== normalizeSql(expected.sql)) {
      throw new AppError('DB_SCHEMA_INCOMPATIBLE', `${expected.name} 与当前结构不兼容；未执行迁移或重建。`);
    }
  }

  if (!allowMissing && profileVersion === 'current' && missing.length) {
    throw new AppError('DB_NOT_INITIALIZED', '缺少 book，请先运行 npm run db:init。');
  }

  return { missing, profileVersion };
}

export function writeDatabase<T>(databasePath: string, write: (db: DatabaseSync) => T): T {
  return inWriteTransaction(databasePath, write, true);
}

function inWriteTransaction<T>(databasePath: string, write: (db: DatabaseSync) => T, foreignKeys: boolean): T {
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: foreignKeys });

  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');

    try {
      const result = write(db);
      db.exec('COMMIT');

      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function migrateProfile(db: DatabaseSync, book: Book, version: ProfileSchemaVersion): void {
  const unmapped = db.prepare('SELECT 1 FROM user_profile WHERE book <> ? LIMIT 1').get(book.title);

  if (unmapped) {
    throw new AppError('DB_BOOK_UNMAPPED', '旧用户档案存在无法映射的词书，数据库迁移已回滚。');
  }

  if (version === 'original') {
    db.exec(addProfileDetailsSql);
  }

  db.exec(profileTableSql.replace('CREATE TABLE user_profile', 'CREATE TABLE user_profile_new'));
  const progress = JSON.stringify(initialBookProgress(book.defaultPlan));
  db.prepare(`
    INSERT INTO user_profile_new (
      user_id, current_level, progress, book_id, learning_count, last_learning_at, created_at, updated_at,
      display_name, book_introduction, profile_summary, daily_new_word_count, daily_review_word_count
    )
    SELECT user_id, current_level, json_set(?, '$.current.summary', progress), ?, learning_count, last_learning_at, created_at, updated_at,
           display_name, book_introduction, profile_summary, daily_new_word_count, daily_review_word_count
    FROM user_profile
  `).run(progress, book.id);

  db.exec('DROP TABLE user_profile; ALTER TABLE user_profile_new RENAME TO user_profile;');
}

export function initializeDatabase(databasePath: string, book: Book): { databasePath: string; tables: string[] } {
  mkdirSync(dirname(databasePath), { recursive: true });

  // 重建父表时暂停该连接的外键检查，提交前验证所有现有引用。
  inWriteTransaction(databasePath, (db) => {
    const { missing, profileVersion } = validateSchema(db, true);

    for (const sql of missing) {
      db.exec(sql);
    }

    if (db.prepare('SELECT 1 FROM book WHERE id = ? AND title <> ?').get(book.id, book.title)) {
      throw new AppError('DB_BOOK_UNMAPPED', '默认词书 ID 已被其他词书占用，数据库初始化已回滚。');
    }

    db.prepare(`
      INSERT INTO book (id, title, introduction, default_plan, word_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET word_count = excluded.word_count WHERE book.word_count <> excluded.word_count
    `).run(book.id, book.title, book.introduction, JSON.stringify(book.defaultPlan), book.wordCount);

    if (profileVersion !== 'current') {
      migrateProfile(db, book, profileVersion);
    }

    if ((missing.length || profileVersion !== 'current') && db.prepare('PRAGMA foreign_key_check').get()) {
      throw new AppError('DB_FOREIGN_KEY_INVALID', '数据库外键校验失败，结构变更已回滚。');
    }
  }, false);

  return { databasePath, tables: ['book', 'user_profile', 'learning_record', 'word_record'] };
}

export function readDatabase<T>(databasePath: string, read: (db: DatabaseSync, profileVersion: ProfileSchemaVersion) => T): T {
  if (!existsSync(databasePath)) {
    throw new AppError('DB_NOT_INITIALIZED', '数据库不存在，请先运行 npm run db:init。');
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });

  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN');
    const { profileVersion } = validateSchema(db, false);

    return read(db, profileVersion);
  } finally {
    db.close();
  }
}

export function assertDefaultBookTitle(title: string): void {
  if (title !== defaultBookTitle) {
    throw new AppError('DB_BOOK_UNMAPPED', '旧用户档案存在无法映射的词书。');
  }
}
