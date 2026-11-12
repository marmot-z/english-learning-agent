import { readFile } from 'node:fs/promises';
import { AppError } from '../errors.js';

export interface BookContent {
  path: string;
  content: string;
  bytes: number;
  lines: number;
}

export async function readBook(bookPath: string): Promise<BookContent> {
  try {
    const content = await readFile(bookPath, 'utf8');

    if (!content.trim()) {
      throw new AppError('BOOK_EMPTY', '词书文件为空。');
    }

    return { path: bookPath, content, bytes: Buffer.byteLength(content), lines: content.split(/\r?\n/).length };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('BOOK_READ_FAILED', '词书读取失败，请检查 BOOK_PATH 和文件访问权限。', { cause: error });
  }
}
