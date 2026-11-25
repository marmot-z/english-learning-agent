import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const profileRow = z.object({
  bookId: z.number().int().positive(),
  bookIntroduction: z.string().nullable(),
  learningRoute: z.string().nullable(),
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
      last_learning_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  const select = database.prepare(`
    SELECT book_id AS bookId, book_introduction AS bookIntroduction, learning_route AS learningRoute
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
      updated_at = excluded.updated_at
    WHERE user_agent_profile.book_id <> excluded.book_id
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

    close() {
      database.close();
    },
  };
}

export type ProfileRepository = ReturnType<typeof openProfileRepository>;
