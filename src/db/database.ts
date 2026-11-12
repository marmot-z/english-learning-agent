import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { addProfileDetailsSql, originalSchemaSql } from './schema.js';
import { AppError } from '../errors.js';
import { z } from 'zod';

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
    return { original, current: schemaObjects(reference) };
  } finally {
    reference.close();
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

function validateSchema(db: DatabaseSync, allowMissing: boolean): { missing: string[]; legacyProfile: boolean } {
  const actual = new Map(schemaObjects(db).map((entry) => [entry.name, entry]));
  const { original, current } = expectedObjects();
  const originalProfile = original.find((entry) => entry.name === 'user_profile');
  const missing: string[] = [];
  let legacyProfile = false;

  for (const expected of current) {
    const existing = actual.get(expected.name);
    const legacy = expected.name === 'user_profile' ? originalProfile : undefined;

    if (!existing) {
      if (!allowMissing) {
        throw new AppError('DB_NOT_INITIALIZED', `缺少 ${expected.name}，请先运行 npm run db:init。`);
      }

      missing.push(legacy?.sql ?? expected.sql);
      legacyProfile ||= legacy !== undefined;
      continue;
    }

    const actualSql = normalizeSql(existing.sql);
    const matchesLegacy = legacy !== undefined && actualSql === normalizeSql(legacy.sql);

    if (existing.type !== expected.type || (!matchesLegacy && actualSql !== normalizeSql(expected.sql))) {
      throw new AppError('DB_SCHEMA_INCOMPATIBLE', `${expected.name} 与当前结构不兼容；未执行迁移或重建。`);
    }

    legacyProfile ||= matchesLegacy;
  }

  return { missing, legacyProfile };
}

export function writeDatabase<T>(databasePath: string, write: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(databasePath);

  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');

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

export function initializeDatabase(databasePath: string): { databasePath: string; tables: string[] } {
  mkdirSync(dirname(databasePath), { recursive: true });
  writeDatabase(databasePath, (db) => {
    const { missing, legacyProfile } = validateSchema(db, true);

    for (const sql of missing) {
      db.exec(sql);
    }

    if (legacyProfile) {
      db.exec(addProfileDetailsSql);
    }
  });
  return { databasePath, tables: ['user_profile', 'learning_record', 'word_record'] };
}

export function readDatabase<T>(databasePath: string, read: (db: DatabaseSync, legacyProfile: boolean) => T): T {
  if (!existsSync(databasePath)) {
    throw new AppError('DB_NOT_INITIALIZED', '数据库不存在，请先运行 npm run db:init。');
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });

  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN');
    const { legacyProfile } = validateSchema(db, false);
    return read(db, legacyProfile);
  } finally {
    db.close();
  }
}
