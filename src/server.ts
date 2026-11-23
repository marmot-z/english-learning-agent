import { createServer } from 'node:http';
import { env, loadEnvFile } from 'node:process';

try {
  loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
    throw error;
  }
}

const host = env.LEARNING_AGENT_HOST?.trim() || '127.0.0.1';
const port = Number(env.LEARNING_AGENT_PORT ?? '18034');

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('LEARNING_AGENT_PORT 必须是 1 到 65535 之间的整数。');
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url?.split('?', 1)[0] !== '/api/learning-agent/health') {
    response.writeHead(404).end();

    return;
  }

  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ status: 'ok' }));
});

server.listen(port, host, () => {
  console.log(`英语学习 Agent 已监听 ${host}:${port}`);
});
