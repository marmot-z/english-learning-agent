import { z } from 'zod';
import { RequestError } from './request-error.js';

const helperResponse = z.object({ code: z.number().int(), data: z.unknown().optional() });
const identityResponse = z.object({ user: z.object({ id: z.number().int().positive() }) });
const catalogBook = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  total_words_count: z.number().int().nonnegative(),
  img: z.string().nullish(),
  desc: z.string().nullish(),
});
const catalogResponse = z.object({ books_info: z.array(z.unknown()).nullish() });

export type CatalogBook = z.infer<typeof catalogBook>;

export function createHelperClient(baseUrl: URL) {
  const base = new URL(baseUrl);
  base.pathname = base.pathname.replace(/\/?$/, '/');

  async function get(path: string, token: string): Promise<unknown> {
    const url = new URL(path, base);

    try {
      const response = await fetch(url, {
        headers: { access_token: token },
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
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
      if (error instanceof RequestError) {
        throw error;
      }

      throw new RequestError(502, '助手代理暂时不可用');
    }
  }

  return {
    async getUserId(token: string): Promise<number> {
      const result = identityResponse.safeParse(await get('userInfoWithVip', token));

      if (!result.success) {
        throw new RequestError(502, '助手代理未返回有效的用户身份');
      }

      return result.data.user.id;
    },

    async getBook(token: string, bookId: number): Promise<CatalogBook | null> {
      const result = catalogResponse.safeParse(await get('booksInfo', token));

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
