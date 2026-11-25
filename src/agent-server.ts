import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { createHelperClient } from './helper-client.js';
import type { CatalogBook } from './helper-client.js';
import type { Profile, ProfileRepository } from './profile-repository.js';
import { RequestError } from './request-error.js';

const profilePath = '/api/learning-agent/profile';
const selectBookBody = z.strictObject({ bookId: z.number().int().positive() });

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBookId(request: IncomingMessage): Promise<number> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;

    if (size > 4096) {
      throw new RequestError(413, '请求体过大');
    }

    chunks.push(bytes);
  }

  let body: unknown;

  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, '请选择有效的词书');
  }

  const result = selectBookBody.safeParse(body);

  if (!result.success) {
    throw new RequestError(400, '请选择有效的词书');
  }

  return result.data.bookId;
}

function profileData(profile: Profile, book: CatalogBook | null) {
  return {
    ...profile,
    book: book && { id: book.id, name: book.name, img: book.img ?? '', total_words_count: book.total_words_count },
  };
}

export function createAgentServer(helperBaseUrl: URL, profiles: ProfileRepository) {
  const helper = createHelperClient(helperBaseUrl);

  return createServer(async (request, response) => {
    const path = request.url?.split('?', 1)[0];

    if (request.method === 'GET' && path === '/api/learning-agent/health') {
      sendJson(response, 200, { status: 'ok' });

      return;
    }

    const isRead = request.method === 'GET' && path === profilePath;
    const isWrite = request.method === 'PUT' && path === `${profilePath}/book`;

    if (!isRead && !isWrite) {
      response.writeHead(404).end();

      return;
    }

    try {
      const token = request.headers.access_token;

      if (typeof token !== 'string' || !token.trim()) {
        throw new RequestError(401, '请重新登录');
      }

      const bookId = isWrite ? await readBookId(request) : null;
      const userId = await helper.getUserId(token);

      if (bookId === null) {
        const profile = profiles.find(userId);
        const data = profile && profileData(profile, await helper.getBook(token, profile.bookId));
        sendJson(response, 200, { code: 200, data });

        return;
      }

      const book = await helper.getBook(token, bookId);

      if (!book) {
        throw new RequestError(404, '该词书已不在目录中，请重新选择');
      }

      const profile = profiles.selectBook(userId, book.id, book.desc?.trim() || null);
      sendJson(response, 200, { code: 200, data: profileData(profile, book) });
    } catch (error) {
      request.resume();

      if (error instanceof RequestError) {
        sendJson(response, error.status, { code: error.status, message: error.message });

        return;
      }

      console.error('处理 Agent 学习档案失败');
      sendJson(response, 500, { code: 500, message: '处理学习档案失败，请稍后重试' });
    }
  });
}
