import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { RequestError } from './request-error.js';

const profileRow = z.object({
  bookId: z.number().int().positive(),
  bookIntroduction: z.string().nullable(),
  learningRoute: z.string().nullable(),
  wordOrder: z
    .string()
    .nullable()
    .transform((value) => (value === null ? null : z.array(z.number().int().positive()).parse(JSON.parse(value)))),
  bookRevision: z.number().int().nonnegative(),
});

export type Profile = z.infer<typeof profileRow>;

export function openProfileRepository(filename: string) {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS user_agent_profile (
      user_id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL CHECK (book_id > 0),
      book_introduction TEXT,
      learning_route TEXT,
      word_order TEXT,
      book_revision INTEGER NOT NULL DEFAULT 1,
      last_learning_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  // CREATE TABLE does not add columns to an existing installation.
  const columns = new Set(
    database
      .prepare('PRAGMA table_info(user_agent_profile)')
      .all()
      .map((column) => column.name),
  );

  for (const [name, definition] of [
    ['book_introduction', 'TEXT'],
    ['learning_route', 'TEXT'],
    ['word_order', 'TEXT'],
    ['book_revision', 'INTEGER NOT NULL DEFAULT 1'],
  ]) {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE user_agent_profile ADD COLUMN ${name} ${definition}`);
    }
  }

  const select = database.prepare(`
    SELECT book_id AS bookId, book_introduction AS bookIntroduction, learning_route AS learningRoute,
      word_order AS wordOrder, book_revision AS bookRevision
    FROM user_agent_profile WHERE user_id = ?
  `);

  const upsert = database.prepare(`
    INSERT INTO user_agent_profile (user_id, book_id, book_introduction, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      book_id = excluded.book_id,
      book_introduction = excluded.book_introduction,
      learning_route = NULL,
      word_order = NULL,
      book_revision = user_agent_profile.book_revision + 1,
      updated_at = excluded.updated_at
    WHERE user_agent_profile.book_id <> excluded.book_id
  `);

  const saveRoute = database.prepare(`
    UPDATE user_agent_profile SET learning_route = ?, word_order = ?, updated_at = ?
    WHERE user_id = ? AND book_id = ? AND book_revision = ?
  `);

  return {
    find(userId: number): Profile | null {
      const row = select.get(userId);

      return row ? profileRow.parse(row) : null;
    },

    selectBook(userId: number, bookId: number, introduction: string | null): Profile {
      const now = new Date().toISOString();
      database.exec('BEGIN IMMEDIATE');

      try {
        upsert.run(userId, bookId, introduction, now, now);
        const profile = profileRow.parse(select.get(userId));
        database.exec('COMMIT');

        return profile;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    saveLearningRoute(userId: number, bookId: number, bookRevision: number, rationale: string, topicIds: number[]): Profile {
      const result = saveRoute.run(rationale, JSON.stringify(topicIds), new Date().toISOString(), userId, bookId, bookRevision);

      if (result.changes !== 1) {
        throw new RequestError(409, '词书已更换，请为当前词书重新规划');
      }

      return profileRow.parse(select.get(userId));
    },

    close() {
      database.close();
    },
  };
}

export type ProfileRepository = ReturnType<typeof openProfileRepository>;
