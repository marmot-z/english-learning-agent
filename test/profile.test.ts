import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createAgentServer } from '../src/agent-server.js';
import { openProfileRepository } from '../src/profile-repository.js';

const books = [
  { id: 101, name: '入门词汇', img: 'https://example.test/101.png', total_words_count: 100, desc: '第一本书的介绍' },
  { id: 102, name: '进阶词汇', total_words_count: 200, desc: '第二本书的介绍' },
];

async function listen(server: Server): Promise<URL> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  return new URL(`http://127.0.0.1:${address.port}/`);
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'learning-agent-profile-'));
  const databasePath = join(dir, 'profile.sqlite');
  const helperState = { outage: false, catalog: books, catalogCalls: 0 };
  const helper = createServer((request, response) => {
    const token = request.headers.access_token;
    response.setHeader('Content-Type', 'application/json');

    if (helperState.outage) {
      response.writeHead(503).end();

      return;
    }

    if (token !== 'test-user-one' && token !== 'test-user-two') {
      response.end(JSON.stringify({ code: 401 }));

      return;
    }

    if (request.url === '/userInfoWithVip') {
      const id = token === 'test-user-one' ? 1 : 2;
      response.end(JSON.stringify({ code: 200, data: { user: { id, token: 'upstream-only' } } }));

      return;
    }

    assert.equal(request.url, '/booksInfo');
    helperState.catalogCalls += 1;
    response.end(JSON.stringify({ code: 200, data: { books_info: helperState.catalog } }));
  });
  const helperUrl = await listen(helper);
  const profiles = openProfileRepository(databasePath);
  const agent = createAgentServer(helperUrl, profiles);
  const agentUrl = await listen(agent);
  const database = new DatabaseSync(databasePath);

  t.after(async () => {
    await close(agent);
    await close(helper);
    database.close();
    profiles.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function request(token?: string, body?: Record<string, unknown>) {
    const path = body ? '/api/learning-agent/profile/book' : '/api/learning-agent/profile';

    return fetch(new URL(path, agentUrl), {
      headers: token ? { access_token: token } : {},
      method: body ? 'PUT' : 'GET',
      body: body && JSON.stringify(body),
    });
  }

  return { agentUrl, database, helperState, request };
}

test('selects, reloads and switches books with account isolation and an atomic reset', async (t) => {
  const { request, database, helperState } = await fixture(t);
  const first = { code: 200, data: {
    bookId: 101,
    bookIntroduction: '第一本书的介绍',
    learningRoute: null,
    book: { id: 101, name: '入门词汇', img: 'https://example.test/101.png', total_words_count: 100 },
  } };
  assert.deepEqual(await (await request('test-user-one')).json(), { code: 200, data: null });
  assert.equal(helperState.catalogCalls, 0);
  assert.deepEqual(await (await request('test-user-one', { bookId: 101 })).json(), first);
  assert.deepEqual(await (await request('test-user-one')).json(), first);
  assert.deepEqual(await (await request('test-user-two')).json(), { code: 200, data: null });

  database.prepare(`
    UPDATE user_agent_profile SET
      book_introduction = '旧简介', learning_route = '旧路线', word_order = '[30, 20]',
      last_learning_date = '2026-11-20',
      created_at = '2026-11-20T00:00:00.000Z', updated_at = '2026-11-21T00:00:00.000Z'
    WHERE user_id = 1
  `).run();
  const findRow = database.prepare('SELECT * FROM user_agent_profile WHERE user_id = 1');
  const saved = findRow.get();
  const sameBook = await request('test-user-one', { bookId: 101 });
  assert.equal(sameBook.status, 200);
  assert.deepEqual(findRow.get(), saved);

  assert.equal((await request('test-user-two', { bookId: 101 })).status, 200);
  const switched = await request('test-user-one', { bookId: 102 });
  assert.equal(switched.status, 200);
  assert.deepEqual(await switched.json(), { code: 200, data: {
    bookId: 102,
    bookIntroduction: '第二本书的介绍',
    learningRoute: null,
    book: { id: 102, name: '进阶词汇', img: '', total_words_count: 200 },
  } });
  const updated = findRow.get();
  assert.ok(updated);
  assert.equal(updated.book_id, 102);
  assert.equal(updated.book_introduction, '第二本书的介绍');
  assert.equal(updated.learning_route, null);
  assert.equal(updated.word_order, null);
  assert.equal(updated.last_learning_date, '2026-11-20');
  assert.equal(updated.created_at, '2026-11-20T00:00:00.000Z');
  assert.notEqual(updated.updated_at, saved?.updated_at);
  assert.deepEqual(await (await request('test-user-two')).json(), first);
});

test('rejects invalid books or authentication without treating proxy failure as logout', async (t) => {
  const { agentUrl, request, helperState, database } = await fixture(t);
  const health = await fetch(new URL('/api/learning-agent/health', agentUrl));
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await request()).status, 401);
  assert.equal((await request('expired')).status, 401);
  assert.equal((await request('test-user-one', { bookId: '101' })).status, 400);
  assert.equal((await request('test-user-one', { bookId: 101, userId: 2 })).status, 400);
  assert.equal((await request('test-user-one', { bookId: 999 })).status, 404);
  assert.equal(database.prepare('SELECT count(*) AS count FROM user_agent_profile').get()?.count, 0);
  assert.equal((await request('test-user-one', { bookId: 101 })).status, 200);
  helperState.outage = true;
  assert.equal((await request('test-user-one')).status, 502);
  assert.equal((await request('test-user-one', { bookId: 102 })).status, 502);
  assert.equal(database.prepare('SELECT book_id FROM user_agent_profile WHERE user_id = 1').get()?.book_id, 101);
});

test('preserves the recorded book when the catalog no longer lists it', async (t) => {
  const { request, helperState } = await fixture(t);
  assert.equal((await request('test-user-one', { bookId: 101 })).status, 200);
  helperState.catalog = [];
  assert.deepEqual(await (await request('test-user-one')).json(), { code: 200, data: {
    bookId: 101, bookIntroduction: '第一本书的介绍', learningRoute: null, book: null,
  } });
});
