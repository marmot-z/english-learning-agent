import { resolve } from 'node:path';
import { argv, env, loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from './agent-server.js';
import { openProfileRepository } from './profile-repository.js';

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

const defaultHelperUrl = argv.includes('--development') ? 'https://www.baicizhan-helper.cn' : 'http://127.0.0.1:18033';
const helperBaseUrl = new URL(env.BAICIZHAN_HELPER_API_BASE_URL?.trim() || defaultHelperUrl);

if (!['http:', 'https:'].includes(helperBaseUrl.protocol) || helperBaseUrl.username || helperBaseUrl.password ||
    helperBaseUrl.search || helperBaseUrl.hash) {
  throw new Error('BAICIZHAN_HELPER_API_BASE_URL 必须是助手代理的 HTTP 或 HTTPS 根地址。');
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const databasePath = resolve(projectRoot, env.LEARNING_AGENT_DB_PATH?.trim() || '.data/learning-agent-web.sqlite');
const profiles = openProfileRepository(databasePath);
const server = createAgentServer(helperBaseUrl, profiles);
server.on('close', () => profiles.close());

server.listen(port, host, () => {
  console.log(`英语学习 Agent 已监听 ${host}:${port}`);
  console.log(`助手代理地址 ${helperBaseUrl.origin}`);
});
