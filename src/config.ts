import { loadEnvFile } from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, errorCode } from './errors.js';
import { defaultBookTitle } from './materials/default-book.js';
import type { AiConfig } from './ai/config.js';

export interface AppConfig {
  databasePath: string;
  bookPath: string;
  ai: AiConfig;
}

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadLocalEnvironment(): void {
  try {
    loadEnvFile(resolve(projectRoot, '.env'));
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw new AppError('CONFIG_READ_FAILED', '无法读取项目 .env 文件。', { cause: error });
    }
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databasePath: resolve(projectRoot, env.DATABASE_PATH || '.data/english-learning.sqlite'),
    bookPath: resolve(projectRoot, env.BOOK_PATH || `assets/books/${defaultBookTitle}.md`),
    ai: {
      baseURL: env.OPENAI_BASE_URL || '',
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-6-luna',
      timeout: Number(env.OPENAI_TIMEOUT_MS || 30000),
    },
  };
}
