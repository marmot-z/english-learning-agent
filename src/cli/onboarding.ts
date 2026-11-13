import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import type { AppConfig } from '../config.js';
import type { DailyWordCounts } from '../domain/types.js';
import { AppError } from '../errors.js';
import { initializeDatabase } from '../db/database.js';
import { createHistoryRepository } from '../db/history-repository.js';
import { readBookWords } from '../materials/book.js';
import { bookOverview, defaultBookMetadata } from '../materials/default-book.js';
import type { Book } from '../domain/types.js';
import type { AiRunner } from '../ai/client.js';
import type { TrackSelection } from '../ai/word-selection.js';
import { createLearningService } from '../services/learning-service.js';
import { isInteractiveTerminal, userPrompt, writeAgent } from './conversation.js';
import { withProgress } from './progress.js';

type Ask = (prompt: string) => Promise<string | null>;

function parseWordCounts(input: string): DailyWordCounts | null {
  if (!input) {
    return { dailyNewWordCount: 10, dailyReviewWordCount: 5 };
  }

  const match = input.match(/^(\d+)\s*,\s*(\d+)$/);

  if (!match) {
    return null;
  }

  const dailyNewWordCount = Number(match[1]);
  const dailyReviewWordCount = Number(match[2]);

  return Number.isSafeInteger(dailyNewWordCount) && Number.isSafeInteger(dailyReviewWordCount) ?
    { dailyNewWordCount, dailyReviewWordCount } :
    null;
}

async function readOnboardingInput(ask: Ask, book: Book) {
  let displayName = await ask('欢迎使用 english-learning-agent，怎么称呼？');

  while (displayName !== null && (!displayName || [...displayName].length >= 20)) {
    displayName = await ask('请输入 1–19 个字符作为称呼。');
  }

  if (displayName === null) {
    return null;
  }

  let countInput = await ask('你每天想学习多少个新单词，复习多少个单词？\n默认 10,5，直接回车即可。');

  while (countInput !== null) {
    const counts = parseWordCounts(countInput);

    if (counts) {
      const preferencePrompt = '你已经学过哪些内容？还有什么想重点练习的？直接回车使用默认路线。';
      const preferences = await ask(`${bookOverview(book)}\n\n${preferencePrompt}`);

      return preferences === null ? null : { displayName, ...counts, preferences };
    }

    countInput = await ask('请输入两个用英文逗号分隔的非负整数，例如 10,5。');
  }

  return null;
}

async function confirmStart(ask: Ask, displayName: string): Promise<boolean> {
  let answer = await ask(`欢迎 ${displayName} 回来，准备好今天的学习么？回复 y 或者 yes 开始`);

  while (answer !== null) {
    const choice = answer.toLowerCase();

    if (choice === 'y' || choice === 'yes') {
      return true;
    }

    if (choice === 'n' || choice === 'no') {
      return false;
    }

    answer = await ask('请输入 y 或 yes 开始，或输入 n 或 no 退出。');
  }

  return false;
}

export async function runOnboarding(config: AppConfig): Promise<void> {
  const interactive = isInteractiveTerminal();
  let isShowingProgress = false;
  // 保留 readline 输入和 Ctrl+C 处理，只在进度期间关闭回显。
  const output = Object.assign(new Writable({
    write(chunk, encoding, callback) {
      if (isShowingProgress) {
        callback();

        return;
      }

      stdout.write(chunk, encoding, callback);
    },
  }), { columns: stdout.columns });

  function resize() {
    output.columns = stdout.columns;
    output.emit('resize');
  }

  const terminal = createInterface({ input: stdin, output, terminal: interactive, crlfDelay: Infinity });
  const lines = terminal[Symbol.asyncIterator]();

  const controller = new AbortController();
  const { signal } = controller;

  function interrupt() {
    controller.abort();
    terminal.close();
    process.exitCode = 130;
  }

  terminal.on('SIGINT', interrupt);
  process.on('SIGINT', interrupt);
  stdout.on('resize', resize);

  async function track<T>(label: string, operation: () => Promise<T>): Promise<T> {
    isShowingProgress = true;

    try {
      return await withProgress(label, operation, signal);
    } finally {
      isShowingProgress = false;
    }
  }

  const trackSelection: TrackSelection = (kind, operation) => track(
    kind === 'new' ? '挑选今日新词' : '挑选今日复习词',
    operation,
  );

  const ask: Ask = async (prompt) => {
    if (signal.aborted) {
      return null;
    }

    writeAgent(prompt);

    if (interactive) {
      terminal.setPrompt(userPrompt());
      terminal.prompt();
    }

    const line = await lines.next();

    if (interactive) {
      stdout.write('\n');
    }

    return line.done || signal.aborted ? null : line.value.trim();
  };

  try {
    // 等待 Node 输出启动警告后再显示第一条对话。
    await setImmediate();
    const words = await track('读取词书', () => readBookWords(config.bookPath));
    initializeDatabase(config.databasePath, defaultBookMetadata(words.length));
    const service = createLearningService({ historyRepository: createHistoryRepository(config.databasePath) });
    let profile = service.findDefaultProfile();

    if (!profile) {
      const book = service.loadDefaultBook();
      const input = await readOnboardingInput(ask, book);

      if (!input) {
        return;
      }

      const details = await service.onboardDefaultUser(
        book,
        input,
        (book, counts, preferences, signal) => track('生成个性化学习路线', async () => {
          const { generateBookIntroduction } = await import('../ai/onboarding.js');

          return generateBookIntroduction(config.ai, book, counts, preferences, signal);
        }),
        signal,
      );

      if (details) {
        const route = input.preferences ? details.introduction : details.progress.plan.description;
        writeAgent(`你的基础学习路线\n\n${route}`);
      } else {
        profile = service.findDefaultProfile();

        if (!profile) {
          throw new AppError('DB_PROFILE_NOT_FOUND', '找不到已建档的用户，请重新运行学习助手。');
        }
      }
    }

    if (profile && !(await confirmStart(ask, profile.displayName))) {
      return;
    }

    let runner: AiRunner | undefined;

    try {
      const { newWords, reviewWords } = await service.prepareLearningPlan(words, async (request) => {
        if (!runner) {
          const { createAiRunner } = await import('../ai/client.js');
          runner = createAiRunner(config.ai);
        }

        return runner.runText(request);
      }, signal, trackSelection);

      const newList = newWords.join('、') || '暂无新词';
      const reviewList = reviewWords.join('、') || '暂无复习词';
      writeAgent(`今日新词（${newWords.length}）\n${newList}\n\n今日复习词（${reviewWords.length}）\n${reviewList}`);
    } finally {
      await runner?.close();
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    process.off('SIGINT', interrupt);
    stdout.off('resize', resize);
    terminal.close();
  }
}
