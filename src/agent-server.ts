import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { createHelperClient } from './helper-client.js';
import type { CatalogBook } from './helper-client.js';
import type { Profile, ProfileRepository } from './profile-repository.js';
import { RequestError } from './request-error.js';
import { createRoutePlanner } from './route-planner.js';
import { validateRoute } from './route-output.js';
import type { RoutePlanner, RouteUpdate } from './route-types.js';

const profilePath = '/api/learning-agent/profile';
const selectBookBody = z.strictObject({ bookId: z.number().int().positive() });
const routeBody = z.strictObject({
  bookId: z.number().int().positive(),
  bookRevision: z.number().int().nonnegative(),
});

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
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

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, '请选择有效的词书');
  }
}

function profileData(profile: Profile, book: CatalogBook | null) {
  return {
    ...profile,
    book: book && {
      id: book.id,
      name: book.name,
      img: book.img ?? '',
      total_words_count: book.total_words_count,
    },
  };
}

export function createAgentServer(
  helperBaseUrl: URL,
  profiles: ProfileRepository,
  options: {
    routePlanner?: RoutePlanner;
    routeTimeoutMs?: number;
    heartbeatMs?: number;
  } = {},
) {
  const helper = createHelperClient(helperBaseUrl);
  const planner = options.routePlanner ?? createRoutePlanner();
  const activeRoutes = new Map<number, { revision: number; controller: AbortController }>();

  async function streamRoute(response: ServerResponse, token: string, userId: number, input: z.infer<typeof routeBody>) {
    const profile = profiles.find(userId);

    if (!profile || profile.bookId !== input.bookId || profile.bookRevision !== input.bookRevision) {
      throw new RequestError(409, '词书已更换，请为当前词书重新规划');
    }

    const previous = activeRoutes.get(userId);

    if (previous && !previous.controller.signal.aborted) {
      throw new RequestError(409, '学习路线正在规划中，请勿重复提交');
    }

    if (response.destroyed) {
      return;
    }

    const controller = new AbortController();
    activeRoutes.set(userId, { revision: input.bookRevision, controller });
    const onClose = () => controller.abort();
    response.once('close', onClose);
    const timeout = setTimeout(
      () => controller.abort(new RequestError(504, '学习路线规划超时，请重试')),
      options.routeTimeoutMs ?? 600_000,
    );

    const send = (
      event: RouteUpdate | { type: 'done'; profile: ReturnType<typeof profileData> } | { type: 'error'; code: number; message: string },
    ) => {
      if (!response.destroyed) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    const heartbeat = setInterval(() => {
      if (!response.destroyed) {
        response.write(': heartbeat\n\n');
      }
    }, options.heartbeatMs ?? 10_000);

    try {
      send({
        type: 'progress',
        stage: 'loading_words',
        completed: 0,
        total: 0,
      });
      const book = await helper.getBook(token, input.bookId, controller.signal);
      controller.signal.throwIfAborted();

      if (!book) {
        throw new RequestError(404, '该词书已不在目录中，请重新选择');
      }

      const words = await helper.getWords(token, input.bookId, controller.signal, (completed, total) => {
        send({
          type: 'progress',
          stage: 'loading_words',
          completed,
          total,
        });
      });
      controller.signal.throwIfAborted();

      send({
        type: 'progress',
        stage: 'planning',
        completed: 0,
        total: words.length,
      });
      const result = validateRoute(
        await planner({
          bookIntroduction: `${book.name}\n${profile.bookIntroduction || '词书目录未提供简介。'}`,
          words,
          signal: controller.signal,
          onUpdate: send,
        }),
        words.map((word) => word.topicId),
      );
      controller.signal.throwIfAborted();

      send({
        type: 'progress',
        stage: 'saving',
        completed: words.length,
        total: words.length,
      });
      const updated = profiles.saveLearningRoute(userId, input.bookId, input.bookRevision, result.rationale, result.topicIds);
      send({ type: 'done', profile: profileData(updated, book) });
    } catch (error) {
      if (!response.destroyed) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        const failure = reason instanceof RequestError ? reason : new RequestError(500, '学习路线保存或生成失败，请重试');
        send({
          type: 'error',
          code: failure.status,
          message: failure.message,
        });
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      response.removeListener('close', onClose);
      controller.abort();

      if (activeRoutes.get(userId)?.controller === controller) {
        activeRoutes.delete(userId);
      }

      response.end();
    }
  }

  return createServer(async (request, response) => {
    const path = request.url?.split('?', 1)[0];

    if (request.method === 'GET' && path === '/api/learning-agent/health') {
      sendJson(response, 200, { status: 'ok' });

      return;
    }

    const isRead = request.method === 'GET' && path === profilePath;
    const isWrite = request.method === 'PUT' && path === `${profilePath}/book`;
    const isRoute = request.method === 'POST' && path === `${profilePath}/learning-route`;

    if (!isRead && !isWrite && !isRoute) {
      response.writeHead(404).end();

      return;
    }

    try {
      const token = request.headers.access_token;

      if (typeof token !== 'string' || !token.trim()) {
        throw new RequestError(401, '请重新登录');
      }

      const body = isWrite || isRoute ? await readBody(request) : null;
      const selection = isWrite ? selectBookBody.safeParse(body) : null;
      const route = isRoute ? routeBody.safeParse(body) : null;

      if ((selection && !selection.success) || (route && !route.success)) {
        throw new RequestError(400, '请选择有效的词书和选书版本');
      }

      const userId = await helper.getUserId(token);

      if (route?.success) {
        await streamRoute(response, token, userId, route.data);

        return;
      }

      if (!selection?.success) {
        const profile = profiles.find(userId);
        const data = profile && profileData(profile, await helper.getBook(token, profile.bookId));
        sendJson(response, 200, { code: 200, data });

        return;
      }

      const book = await helper.getBook(token, selection.data.bookId);

      if (!book) {
        throw new RequestError(404, '该词书已不在目录中，请重新选择');
      }

      const profile = profiles.selectBook(userId, book.id, book.desc?.trim() || null);
      const active = activeRoutes.get(userId);

      if (active && active.revision !== profile.bookRevision) {
        active.controller.abort(new RequestError(409, '词书已更换，请为当前词书重新规划'));
      }

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
