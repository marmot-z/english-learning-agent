import { stderr, stdin, stdout } from 'node:process';
import type { WriteStream } from 'node:tty';
import { stripVTControlCharacters, styleText } from 'node:util';

const indent = '         ';
const roles = {
  agent: { label: '● Agent', padding: '  ', color: 'cyan' },
  user: { label: '› 你', padding: '     ', color: 'green' },
  system: { label: '· 系统', padding: '   ', color: 'yellow' },
} as const;
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemes = new Intl.Segmenter();
const wideCharacter = /^(?:[\u1100-\u115f\u2329-\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]|\p{Script=Han}|\p{Emoji_Presentation})|\u20e3/u;
const closingPunctuation = /^[、，。！？：；）》】」』”’]/u;

export function isInteractiveTerminal(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function rolePrefix(role: keyof typeof roles, stream: WriteStream): string {
  const { label, padding, color } = roles[role];
  const useColor = isInteractiveTerminal() && stream.isTTY && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb';
  return (useColor ? styleText(color, label, { stream }) : label) + padding;
}

function wrapLine(line: string, columns: number): string[] {
  const segments: string[] = [];

  for (const { segment } of words.segment(line.trimEnd())) {
    if (segments.length && closingPunctuation.test(segment)) {
      segments[segments.length - 1] += segment;
    } else {
      segments.push(segment);
    }
  }

  const wrapped: string[] = [];
  let current = '';
  let width = 0;

  for (const word of segments) {
    const characters = Array.from(graphemes.segment(word), ({ segment }) => ({ segment, width: wideCharacter.test(segment) ? 2 : 1 }));
    const wordWidth = characters.reduce((sum, character) => sum + character.width, 0);

    if (word.trim() && width && wordWidth <= columns && width + wordWidth > columns) {
      wrapped.push(current.trimEnd());
      current = '';
      width = 0;
    }

    for (const character of characters) {
      if (width + character.width > columns) {
        wrapped.push(current.trimEnd());
        current = '';
        width = 0;
      }

      if (!width && wrapped.length && !character.segment.trim()) {
        continue;
      }

      current += character.segment;
      width += character.width;
    }
  }

  if (current || !wrapped.length) {
    wrapped.push(current.trimEnd());
  }

  return wrapped;
}

function writeMessage(role: 'agent' | 'system', message: string, stream: WriteStream): void {
  const text = stripVTControlCharacters(message).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const width = stream.isTTY ? stream.columns - indent.length : 0;
  const lines = text.split('\n').flatMap((line) => width > 4 ? wrapLine(line, width) : [line]);
  const [first = '', ...rest] = lines;
  const block = [rolePrefix(role, stream) + first, ...rest.map((line) => line && indent + line)];
  stream.write(block.join('\n') + '\n\n');
}

export function writeAgent(message: string): void {
  writeMessage('agent', message, stdout);
}

export function writeSystem(message: string): void {
  writeMessage('system', message, stdout);
}

export function writeSystemError(message: string): void {
  writeMessage('system', message, stderr);
}

export function userPrompt(): string {
  return rolePrefix('user', stdout);
}
