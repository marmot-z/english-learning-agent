import { parseArgs } from 'node:util';
import { loadLocalEnvironment, readConfig } from './config.js';
import { AppError, errorCode } from './errors.js';
import { writeSystemError } from './cli/conversation.js';

const help = `英语学习 Agent

已实现：首次建档、老用户回访、每日选词、历史读取、AI 代理检查、词书读取。
待实现：逐词教学纠正、评估入库。

命令：
  npm start
  npm run db:init
  npm run history -- --user default [--json]
  npm run ai:check
  npm run book:check

环境配置：项目根目录 .env 或 shell 环境变量；详情见 README.md。`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { user: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  const [command] = positionals;

  if (values.help) {
    console.log(help);
    return;
  }

  if (positionals.length > 1 || (command !== undefined && !['db:init', 'history', 'ai:check', 'book:check'].includes(command))) {
    throw new AppError('INVALID_COMMAND', '未知命令或多余参数，请运行 npm start -- --help 查看用法。');
  }

  if (command !== 'history' && (values.user !== undefined || values.json !== undefined)) {
    throw new AppError('INVALID_ARGUMENT', '--user 和 --json 仅适用于 history 命令。');
  }

  loadLocalEnvironment();
  const config = readConfig();

  if (command === undefined) {
    try {
      const { runOnboarding } = await import('./cli/onboarding.js');
      await runOnboarding(config);
    } catch (error) {
      reportError(error, true);
    }

    return;
  }

  if (command === 'db:init') {
    const { initializeDatabase } = await import('./db/database.js');
    const { readBookWords } = await import('./materials/book.js');
    const { defaultBookMetadata } = await import('./materials/default-book.js');
    const words = await readBookWords(config.bookPath);
    const result = initializeDatabase(config.databasePath, defaultBookMetadata(words.length));
    console.log(`数据库已初始化：${result.databasePath}\n表：${result.tables.join(', ')}\n未插入学习数据。`);
    return;
  }

  if (command === 'history') {
    const { createHistoryRepository } = await import('./db/history-repository.js');
    const { createLearningService } = await import('./services/learning-service.js');
    const service = createLearningService({ historyRepository: createHistoryRepository(config.databasePath) });
    const context = service.loadLearningContext(values.user ?? 'default');

    if (!values.json) {
      console.log(`用户：${values.user ?? 'default'}；最近完成：${context.recentSessions.length} 次；已学词：${context.learnedWords.length}`);

      if (!context.profile) {
        console.log('暂无用户画像，可运行 npm start 完成建档。');
      }
    }

    console.log(JSON.stringify(context, null, 2));
    return;
  }

  if (command === 'book:check') {
    const { readBook } = await import('./materials/book.js');
    const { content: _content, ...info } = await readBook(config.bookPath);
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  const { checkAiConnection } = await import('./ai/check.js');
  console.log(JSON.stringify(await checkAiConnection(config.ai), null, 2));
}

function reportError(error: unknown, conversation = false): void {
  let message: string;

  if (error instanceof AppError) {
    message = `[${error.code}] ${error.message}`;

    if (conversation && error.code === 'AI_CONFIG_INVALID') {
      message += '\n检查上述配置项后，运行 npm run ai:check 验证。';
    }
  } else if (errorCode(error)?.startsWith('ERR_PARSE_ARGS')) {
    message = '[INVALID_ARGUMENT] 命令参数无效，请运行 npm start -- --help 查看用法。';
  } else {
    // 不输出原始异常文本或响应体，避免第三方错误回显密钥；内部异常保留 cause。
    message = `[COMMAND_FAILED] 命令执行失败（${errorCode(error) || 'UNKNOWN'}），请检查文件权限、数据库状态或依赖安装。`;
  }

  if (conversation) {
    writeSystemError(message);
  } else {
    console.error(message);
  }

  process.exitCode = 1;
}

main().catch(reportError);
