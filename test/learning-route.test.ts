import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentServer } from '../src/agent-server.js';
import { openProfileRepository } from '../src/profile-repository.js';
import { createRoutePlanner } from '../src/route-planner.js';
import type { RoutePlanner } from '../src/route-types.js';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  return new URL(`http://127.0.0.1:${address.port}/`);
}

function events(text: string) {
  return text.split('\n\n').flatMap((frame) => {
    const data = frame.split('\n').find((line) => line.startsWith('data: '));

    return data ? [JSON.parse(data.slice(6))] : [];
  });
}

async function fixture(t: TestContext, count = 6, options: { planner?: RoutePlanner; timeout?: number; legacyLimit?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-route-'));
  const filename = join(directory, 'profile.sqlite');
  const profiles = openProfileRepository(filename);
  const database = new DatabaseSync(filename);
  const signal = new EventEmitter();
  const keys = Array.from({ length: count }, (_, index) => ({
    topic_id: index + 10001,
    word_level_id: 77,
    tag_id: index % 7,
  }));
  const state = {
    modelCalls: 0,
    requests: [] as any[],
    mode: 'success',
    missing: new Set<number>(),
    firstMissing: new Set<number>(),
    metadataCalls: 0,
    activeMetadata: 0,
    maxMetadata: 0,
    badKey: false,
  };
  const seen = new Set<number>();
  const book = (id: number) => ({
    id,
    name: `词书${id}`,
    desc: '常用词入门，循序渐进。',
    total_words_count: count,
  });
  const helper = createServer(async (request, response) => {
    const token = request.headers.access_token;
    response.setHeader('Content-Type', 'application/json');

    if (token !== 'user-a' && token !== 'user-b') {
      response.end(JSON.stringify({ code: 401 }));

      return;
    }

    let data: unknown;

    if (request.url === '/userInfoWithVip') {
      data = { user: { id: token === 'user-a' ? 1 : 2 } };
    } else if (request.url === '/booksInfo') {
      data = { books_info: [book(77), book(88)] };
    } else if (request.url?.startsWith('/roadmap?bookId=')) {
      data = [...keys, keys[0]];
    } else if (request.url === '/wordListWordMetaV2' && request.method === 'POST') {
      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }

      const batch = JSON.parse(Buffer.concat(chunks).toString());
      assert.ok(batch.length <= 200);
      state.metadataCalls++;
      state.activeMetadata++;
      state.maxMetadata = Math.max(state.activeMetadata, state.maxMetadata);
      await delay(2);
      data = batch
        .flatMap((key: (typeof keys)[number]) => {
          assert.deepEqual(key, keys[key.topic_id - 10001]);
          const wasSeen = seen.has(key.topic_id);
          seen.add(key.topic_id);

          if (state.missing.has(key.topic_id) || (state.firstMissing.has(key.topic_id) && !wasSeen)) {
            return [];
          }

          return [
            {
              topic_key: { ...key, tag_id: state.badKey ? 999 : key.tag_id },
              word: `word${key.topic_id}`,
              mean_cn: key.topic_id % 2 ? '常用含义' : null,
            },
          ];
        })
        .reverse();
      state.activeMetadata--;
    } else {
      response.writeHead(404).end();

      return;
    }

    response.end(JSON.stringify({ code: 200, data }));
  });
  const helperUrl = await listen(helper);
  const model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const body = JSON.parse(Buffer.concat(chunks).toString());
    state.modelCalls++;
    state.requests.push(body);
    response.on('close', () => signal.emit('model_closed'));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (content: string, finish_reason: string | null = null) => {
      response.write(
        `data: ${JSON.stringify({
          id: 'test',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason,
            },
          ],
        })}\n\n`,
      );
    };
    signal.emit('model_started');

    if (state.mode === 'error') {
      response.destroy();

      return;
    }

    if (state.mode === 'hold') {
      chunk('{"rationale":"正在规划');

      return;
    }

    const words = JSON.parse(body.messages[1].content).words;
    const ids = words.map((word: { topicId: number }) => word.topicId).reverse();

    if (state.mode === 'duplicate') {
      ids[0] = ids[1];
    }

    if (state.mode === 'missing') {
      ids.pop();
    }

    if (state.mode === 'extra') {
      ids.push(999999);
    }

    let content = JSON.stringify({
      rationale: state.mode === 'empty' ? '' : '先学基础词，再按“场景”串联。\n易混词错开 😀',
      topicIds: ids,
    });

    if (state.mode === 'json') {
      content = content.slice(0, -1);
    }

    for (let offset = 0; offset < content.length; offset += 17) {
      chunk(content.slice(offset, offset + 17));
    }

    chunk('', state.mode === 'length' ? 'length' : 'stop');
    response.end('data: [DONE]\n\n');
  });
  const modelUrl = await listen(model);
  const planner =
    options.planner ??
    createRoutePlanner({
      baseURL: new URL('v1/', modelUrl).href,
      apiKey: 'test-key',
      model: 'test-model',
      ...(options.legacyLimit ? { tokenLimitField: 'max_tokens', maxOutputTokens: 40000 } : {}),
    });
  const agent = createAgentServer(helperUrl, profiles, {
    routePlanner: planner,
    routeTimeoutMs: options.timeout,
    heartbeatMs: 20,
  });
  const agentUrl = await listen(agent);
  t.after(async () => {
    for (const server of [agent, helper, model]) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    database.close();
    profiles.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const select = async (id = 77, token = 'user-a') => {
    const response = await fetch(new URL('api/learning-agent/profile/book', agentUrl), {
      method: 'PUT',
      headers: { access_token: token },
      body: JSON.stringify({ bookId: id }),
    });
    assert.equal(response.status, 200);

    return (await response.json()).data;
  };
  const generate = (revision = 1, controller?: AbortController, token = 'user-a') =>
    fetch(new URL('api/learning-agent/profile/learning-route', agentUrl), {
      method: 'POST',
      headers: { access_token: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: 77, bookRevision: revision }),
      signal: controller?.signal,
    });

  await select();

  return {
    profiles,
    database,
    keys,
    state,
    signal,
    select,
    generate,
    agentUrl,
  };
}

test('4000 words load metadata serially, use one AI request and persist the exact full order', async (t) => {
  const f = await fixture(t, 4000);
  f.state.firstMissing.add(10001);
  const response = await f.generate();
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const stream = events(await response.text());
  const done = stream.at(-1);
  assert.equal(done.type, 'done');
  const expected = f.keys.map((key) => key.topic_id).reverse();
  assert.deepEqual(done.profile.wordOrder, expected);
  assert.deepEqual(f.profiles.find(1)?.wordOrder, expected);
  assert.equal(f.profiles.find(1)?.learningRoute, done.profile.learningRoute);
  assert.equal(f.profiles.find(2), null);
  assert.equal(f.state.modelCalls, 1);
  assert.equal(f.state.metadataCalls, 21);
  assert.equal(f.state.maxMetadata, 1);

  const input = f.state.requests[0];
  assert.equal(input.stream, true);
  assert.deepEqual(input.response_format, { type: 'json_object' });
  assert.equal(input.max_completion_tokens, 32768);

  const prompt = JSON.parse(input.messages[1].content);
  assert.deepEqual(Object.keys(prompt), ['bookIntroduction', 'words']);
  assert.ok(prompt.bookIntroduction.includes('常用词入门'));
  assert.equal(prompt.words.length, 4000);
  assert.deepEqual(
    prompt.words.map((word: any) => word.topicId),
    f.keys.map((key) => key.topic_id),
  );
  assert.equal(prompt.words[1].meanCn, '');
  assert.equal(
    stream
      .filter((event) => event.type === 'rationale_delta')
      .map((event) => event.text)
      .join(''),
    done.profile.learningRoute,
  );
  assert.equal(stream.filter((event) => event.stage === 'ordering').at(-1).completed, 4000);

  const reloaded = await fetch(new URL('api/learning-agent/profile', f.agentUrl), { headers: { access_token: 'user-a' } });
  assert.deepEqual((await reloaded.json()).data, done.profile);
});

test('supports the configured legacy output parameter without a second model call', async (t) => {
  const f = await fixture(t, 3, { legacyLimit: true });
  assert.equal(events(await (await f.generate()).text()).at(-1).type, 'done');
  assert.equal(f.state.requests[0].max_tokens, 40000);
  assert.equal(f.state.requests[0].max_completion_tokens, undefined);
  assert.equal(f.state.modelCalls, 1);
});

test('invalid or truncated AI output never saves or silently repairs the route; retry succeeds', async (t) => {
  const f = await fixture(t);

  for (const mode of ['duplicate', 'missing', 'extra', 'empty', 'json', 'length', 'error']) {
    f.state.mode = mode;
    const calls = f.state.modelCalls;
    const result = events(await (await f.generate()).text()).at(-1);
    assert.equal(result.type, 'error', mode);
    assert.equal(result.code, 502, mode);
    assert.equal(f.state.modelCalls, calls + 1);
    assert.equal(f.profiles.find(1)?.learningRoute, null);
    assert.equal(f.profiles.find(1)?.wordOrder, null);
    assert.equal(f.profiles.find(1)?.bookId, 77);
  }

  f.state.mode = 'success';
  assert.equal(events(await (await f.generate()).text()).at(-1).type, 'done');
});

test('missing or mismatched metadata fails before AI and allows retry', async (t) => {
  const f = await fixture(t);
  f.state.missing.add(10001);
  assert.equal(events(await (await f.generate()).text()).at(-1).type, 'error');
  assert.equal(f.state.metadataCalls, 2);
  assert.equal(f.state.modelCalls, 0);
  f.state.missing.clear();
  f.state.badKey = true;
  assert.equal(events(await (await f.generate()).text()).at(-1).type, 'error');
  assert.equal(f.state.modelCalls, 0);
  f.state.badKey = false;
  assert.equal(events(await (await f.generate()).text()).at(-1).type, 'done');
});

test('closing the stream aborts the model, rejects duplicate submissions and leaves the new book saved', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'hold';
  const controller = new AbortController();
  const started = once(f.signal, 'model_started');
  const response = await f.generate(1, controller);
  const closed = once(f.signal, 'model_closed');
  await started;
  assert.equal((await f.generate()).status, 409);
  const text = response.text();
  controller.abort();
  await assert.rejects(text);
  await closed;
  assert.equal(f.profiles.find(1)?.bookId, 77);
  assert.equal(f.profiles.find(1)?.wordOrder, null);
  assert.equal(f.state.modelCalls, 1);
});

test('timeout sends heartbeats and a terminal error without saving', async (t) => {
  const f = await fixture(t, 3, { timeout: 180 });
  f.state.mode = 'hold';
  const text = await (await f.generate()).text();
  assert.ok(text.includes(': heartbeat'));
  assert.equal(events(text).at(-1).code, 504);
  assert.equal(f.profiles.find(1)?.wordOrder, null);
});

test('A to B to A invalidates older requests and their saved revisions', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'hold';
  const started = once(f.signal, 'model_started');
  const response = await f.generate();
  await started;
  await f.select(88);
  const current = await f.select(77);
  assert.equal(current.bookRevision, 3);
  assert.equal(events(await response.text()).at(-1).code, 409);
  assert.equal((await f.generate(1)).status, 409);
  assert.throws(() => f.profiles.saveLearningRoute(1, 77, 1, '旧请求', [1]), /词书已更换/);
  assert.equal(f.profiles.find(1)?.wordOrder, null);
  f.state.mode = 'success';
  assert.equal(events(await (await f.generate(3)).text()).at(-1).type, 'done');
});

test('database failure does not partially persist rationale or order', async (t) => {
  const f = await fixture(t);
  f.database.exec(
    "CREATE TRIGGER reject_route BEFORE UPDATE OF word_order ON user_agent_profile BEGIN SELECT RAISE(FAIL, 'test failure'); END",
  );
  assert.equal(events(await (await f.generate()).text()).at(-1).code, 500);
  assert.equal(f.profiles.find(1)?.learningRoute, null);
  assert.equal(f.profiles.find(1)?.wordOrder, null);
});

test('an aborted previous selection cannot block or overwrite a new route while it winds down', async (t) => {
  let release!: () => void;
  let notify!: () => void;
  let calls = 0;
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, 3, {
    planner: async ({ words }) => {
      calls++;

      if (calls === 1) {
        notify();
        await blocked;
      }

      return { rationale: calls === 1 ? '旧路线' : '新路线', topicIds: words.map((word) => word.topicId) };
    },
  });
  const old = await f.generate();
  await started;
  await f.select(88);
  await f.select(77);
  const fresh = await f.generate(3);
  assert.equal(fresh.status, 200);
  assert.equal(events(await fresh.text()).at(-1).type, 'done');
  const saved = f.profiles.find(1);
  release();
  assert.equal(events(await old.text()).at(-1).code, 409);
  assert.deepEqual(f.profiles.find(1), saved);
});

test('route identity and revision validation prevents unauthenticated or other-account model calls', async (t) => {
  const f = await fixture(t, 3);
  assert.equal((await f.generate(1, undefined, 'expired')).status, 401);
  assert.equal((await f.generate(1, undefined, 'user-b')).status, 409);
  assert.equal((await f.generate(99)).status, 409);
  const invalid = await fetch(new URL('api/learning-agent/profile/learning-route', f.agentUrl), {
    method: 'POST',
    headers: { access_token: 'user-a' },
    body: JSON.stringify({
      bookId: 77,
      bookRevision: 1,
      userId: 2,
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(f.state.modelCalls, 0);
});

test('missing model configuration fails clearly while preserving the chosen book', async (t) => {
  const f = await fixture(t, 3, { planner: createRoutePlanner({}) });
  const result = events(await (await f.generate()).text()).at(-1);
  assert.equal(result.code, 503);
  assert.match(result.message, /OPENAI_MODEL/);
  assert.equal(f.profiles.find(1)?.bookId, 77);
});

test('old databases gain route columns and retain other profile data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-legacy-'));
  const filename = join(directory, 'profile.sqlite');
  const database = new DatabaseSync(filename);
  database.exec(`CREATE TABLE user_agent_profile (user_id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL, book_introduction TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO user_agent_profile VALUES (1, 77, '原简介', 'original', 'original');`);
  database.close();
  const profiles = openProfileRepository(filename);

  try {
    assert.deepEqual(profiles.find(1), {
      bookId: 77,
      bookIntroduction: '原简介',
      learningRoute: null,
      wordOrder: null,
      bookRevision: 1,
    });
    profiles.saveLearningRoute(1, 77, 1, '基础优先', [3, 2, 1]);
    assert.deepEqual(profiles.find(1)?.wordOrder, [3, 2, 1]);
  } finally {
    profiles.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
