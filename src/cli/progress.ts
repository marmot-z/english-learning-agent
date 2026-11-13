import { stderr } from 'node:process';
import { clearLine, cursorTo } from 'node:readline';
import { styleText } from 'node:util';
import { fitTerminalLine, isInteractiveTerminal } from './conversation.js';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export async function withProgress<T>(label: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();

  const animated = isInteractiveTerminal() && stderr.isTTY && process.env.TERM !== 'dumb';
  const useColor = animated && !('NO_COLOR' in process.env);
  const startedAt = performance.now();
  let frame = 0;
  let finished = false;
  let timer: NodeJS.Timeout | undefined;

  function render(): void {
    cursorTo(stderr, 0);
    clearLine(stderr, 0);
    const line = fitTerminalLine(`${frames[frame]} 正在${label}…`, stderr.columns - 1);
    stderr.write(useColor ? styleText('yellow', line, { stream: stderr }) : line);
    frame = (frame + 1) % frames.length;
  }

  function finish(status: '完成' | '失败' | '已取消'): void {
    if (finished) {
      return;
    }

    finished = true;
    clearInterval(timer);

    if (animated) {
      cursorTo(stderr, 0);
      clearLine(stderr, 0);
    }

    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    const marker = animated ? (status === '完成' ? '✓ ' : status === '失败' ? '✗ ' : '– ') : '';
    stderr.write(`${marker}${label}${status}（${seconds} 秒）\n`);
  }

  function cancel(): void {
    finish('已取消');
  }

  if (animated) {
    render();
    timer = setInterval(render, 80).unref();
  } else {
    stderr.write(`正在${label}…\n`);
  }

  signal?.addEventListener('abort', cancel, { once: true });

  try {
    const result = await operation();
    signal?.throwIfAborted();
    finish('完成');

    return result;
  } catch (error) {
    finish(signal?.aborted ? '已取消' : '失败');
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
