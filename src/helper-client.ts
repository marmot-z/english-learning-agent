import { z } from 'zod';
import { RequestError } from './request-error.js';
import type { RouteWord } from './route-types.js';

const helperResponse = z.object({
  code: z.number().int(),
  data: z.unknown().optional(),
});
const identityResponse = z.object({ user: z.object({ id: z.number().int().positive() }) });
const catalogBook = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  total_words_count: z.number().int().nonnegative(),
  img: z.string().nullish(),
  desc: z.string().nullish(),
});
const catalogResponse = z.object({ books_info: z.array(z.unknown()).nullish() });
const topicKey = z.object({
  topic_id: z.number().int().positive(),
  word_level_id: z.number().int().positive(),
  tag_id: z.number().int(),
});
const wordMetadata = z.object({
  topic_key: topicKey,
  word: z.string().trim().min(1),
  mean_cn: z.string().nullish(),
});
const keyOf = (key: z.infer<typeof topicKey>) => `${key.topic_id}:${key.word_level_id}:${key.tag_id}`;

export type CatalogBook = z.infer<typeof catalogBook>;

export function createHelperClient(baseUrl: URL) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/?$/, '/');

  async function get(path: string, token: string, options?: { body?: unknown; signal?: AbortSignal }): Promise<unknown> {
    const url = new URL(path, base);

    try {
      const response = await fetch(url, {
        headers: { access_token: token, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
        method: options?.body ? 'POST' : 'GET',
        body: options?.body ? JSON.stringify(options.body) : undefined,
        redirect: 'error',
        signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(4000),
      });
      const httpStatus = response.status;

      if (httpStatus === 401 || httpStatus === 403) {
        throw new RequestError(httpStatus, httpStatus === 401 ? '请重新登录' : '无法访问助手代理');
      }

      if (!response.ok) {
        throw new RequestError(502, '助手代理暂时不可用');
      }

      const { code, data } = helperResponse.parse(await response.json());

      if (code === 401 || code === 403) {
        throw new RequestError(code, code === 401 ? '请重新登录' : '无法访问助手代理');
      }

      if (code !== 200) {
        throw new RequestError(502, '助手代理暂时不可用');
      }

      return data;
    } catch (error) {
      options?.signal?.throwIfAborted();

      if (error instanceof RequestError) {
        throw error;
      }

      throw new RequestError(502, '助手代理暂时不可用');
    }
  }

  return {
    async getWords(
      token: string,
      bookId: number,
      signal: AbortSignal,
      onProgress: (completed: number, total: number) => void,
    ): Promise<RouteWord[]> {
      const roadmap = z.array(topicKey).safeParse(await get(`roadmap?bookId=${bookId}`, token, { signal }));

      if (!roadmap.success || !roadmap.data.length) {
        throw new RequestError(502, '词书未返回完整的单词列表，请重试');
      }

      const keys = [...new Map(roadmap.data.map((key) => [key.topic_id, key])).values()];
      const metadata = new Map<string, RouteWord>();
      onProgress(0, keys.length);

      async function load(pending: typeof keys) {
        for (let offset = 0; offset < pending.length; offset += 200) {
          signal.throwIfAborted();
          const batch = pending.slice(offset, offset + 200);
          const response = await get('wordListWordMetaV2', token, { body: batch, signal });

          if (!Array.isArray(response)) {
            throw new RequestError(502, '词书单词信息格式异常，请重试');
          }

          const requested = new Set(batch.map(keyOf));

          for (const item of response) {
            const parsed = wordMetadata.safeParse(item);

            if (!parsed.success || !requested.has(keyOf(parsed.data.topic_key))) {
              continue;
            }

            const { topic_key, word, mean_cn } = parsed.data;
            metadata.set(keyOf(topic_key), {
              topicId: topic_key.topic_id,
              word,
              meanCn: mean_cn?.trim() ?? '',
            });
          }

          onProgress(metadata.size, keys.length);
        }
      }

      await load(keys);
      const missing = keys.filter((key) => !metadata.has(keyOf(key)));

      if (missing.length) {
        await load(missing);
      }

      if (metadata.size !== keys.length) {
        throw new RequestError(502, `还有 ${keys.length - metadata.size} 个单词未能获取拼写，请重试`);
      }

      return keys.map((key) => metadata.get(keyOf(key))!);
    },

    async getUserId(token: string): Promise<number> {
      const result = identityResponse.safeParse(await get('userInfoWithVip', token));

      if (!result.success) {
        throw new RequestError(502, '助手代理未返回有效的用户身份');
      }

      return result.data.user.id;
    },

    async getBook(token: string, bookId: number, signal?: AbortSignal): Promise<CatalogBook | null> {
      const result = catalogResponse.safeParse(await get('booksInfo', token, signal ? { signal } : undefined));

      if (!result.success || !Array.isArray(result.data.books_info)) {
        throw new RequestError(502, '助手代理未返回有效的词书目录');
      }

      for (const item of result.data.books_info) {
        if (typeof item !== 'object' || item === null || !('id' in item) || item.id !== bookId) {
          continue;
        }

        const book = catalogBook.safeParse(item);

        if (!book.success) {
          throw new RequestError(502, '助手代理未返回有效的词书资料');
        }

        return book.data;
      }

      return null;
    },
  };
}
