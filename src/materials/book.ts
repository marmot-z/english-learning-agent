import { readFile } from 'node:fs/promises';
import { AppError } from '../errors.js';
import { appendixCategories } from './default-book.js';

export interface BookContent {
  path: string;
  content: string;
  bytes: number;
  lines: number;
}

export interface BookWord {
  id: number;
  word: string;
  categoryIds: string[];
}

const phrases = new Set(['instead of', 'according to']);
const categoryByHeading = new Map<string, string>(appendixCategories.map(({ heading, id }) => [heading, id]));

export function wordKey(word: string): string {
  return word.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseBookWords(content: string): BookWord[] {
  const appendix = content.split(/^##[ \t]+1368个单词[ \t]*\r?$/m)[1]?.split(/^#{1,2}[ \t]+/m)[0];
  const entries = new Map<string, BookWord>();
  const populatedCategories = new Set<string>();
  let categoryId: string | undefined;

  for (const rawLine of (appendix ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = categoryByHeading.get(line);

    if (heading) {
      categoryId = heading;
      continue;
    }

    if (!line.startsWith('*')) {
      continue;
    }

    const terms = /^\*([a-zA-Z]+\.?(?:\s+[a-zA-Z]+\.?)*)\*$/.exec(line)?.[1];

    if (!categoryId || !terms) {
      throw new AppError('BOOK_WORD_LIST_INVALID', '词书附录包含无法识别的词条，请检查 BOOK_PATH 指向的词书。');
    }

    populatedCategories.add(categoryId);
    const words = phrases.has(wordKey(terms)) ? [terms] : terms.split(/\s+/);

    for (const word of words) {
      const key = wordKey(word);
      const entry = entries.get(key);

      if (!entry) {
        entries.set(key, { id: entries.size + 1, word, categoryIds: [categoryId] });
      } else if (!entry.categoryIds.includes(categoryId)) {
        entry.categoryIds.push(categoryId);
      }
    }
  }

  if (populatedCategories.size !== appendixCategories.length) {
    throw new AppError('BOOK_WORD_LIST_INVALID', '词书附录缺失或无法识别全部分类，请检查 BOOK_PATH 指向的词书。');
  }

  return [...entries.values()];
}

export async function readBookWords(bookPath: string): Promise<BookWord[]> {
  return parseBookWords((await readBook(bookPath)).content);
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
