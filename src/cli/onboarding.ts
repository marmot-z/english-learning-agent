import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { setImmediate } from 'node:timers/promises';
import type { AppConfig } from '../config.js';
import type { DailyWordCounts } from '../domain/types.js';
import { AppError } from '../errors.js';
import { initializeDatabase } from '../db/database.js';
import { createHistoryRepository } from '../db/history-repository.js';
import { defaultBookOverview } from '../materials/default-book.js';
import { createLearningService } from '../services/learning-service.js';
import { isInteractiveTerminal, userPrompt, writeAgent, writeSystem } from './conversation.js';

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

async function readOnboardingInput(ask: Ask) {
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
      const overview = defaultBookOverview.replace('\n二、建议学习路线', '\n\n二、建议学习路线');
      const preferences = await ask(`${overview}\n\n你已经学过哪些内容？还有什么想重点练习的？`);
      return preferences === null ? null : { displayName, ...counts, preferences: preferences || '从头开始学习' };
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
  initializeDatabase(config.databasePath);
  const service = createLearningService({ historyRepository: createHistoryRepository(config.databasePath) });
  const interactive = isInteractiveTerminal();
  const terminal = createInterface({ input: stdin, output: stdout, terminal: interactive, crlfDelay: Infinity });
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
    let profile = service.findDefaultProfile();

    if (!profile) {
      const input = await readOnboardingInput(ask);

      if (!input) {
        return;
      }

      writeSystem('正在生成学习路线…');
      const { generateBookIntroduction } = await import('../ai/onboarding.js');
      const introduction = await service.onboardDefaultUser(input, (counts, preferences, signal) =>
        generateBookIntroduction(config.ai, counts, preferences, signal), signal);

      if (introduction !== null) {
        writeAgent(`你的基础学习路线\n\n${introduction}`);
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

    service.loadLearningContext();
    writeSystem('已准备好进入学习。');
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    process.off('SIGINT', interrupt);
    terminal.close();
  }
}
