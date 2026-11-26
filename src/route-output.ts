import { z } from 'zod';
import { RequestError } from './request-error.js';
import type { RouteResult } from './route-types.js';

const routeResult = z.strictObject({
  rationale: z.string().trim().min(1),
  topicIds: z.array(z.number().int().positive()),
});

export function validateRoute(value: unknown, expectedIds: number[]): RouteResult {
  const parsed = routeResult.safeParse(value);

  if (!parsed.success) {
    throw new RequestError(502, 'AI 返回的学习路线格式不正确，请重试');
  }

  const expected = new Set(expectedIds);
  const actual = new Set(parsed.data.topicIds);

  if (
    parsed.data.topicIds.length !== expected.size ||
    actual.size !== expected.size ||
    parsed.data.topicIds.some((id) => !expected.has(id))
  ) {
    throw new RequestError(502, 'AI 返回的单词顺序不完整或包含重复单词，请重试');
  }

  return parsed.data;
}

// A small JSON tokenizer for presentation only. JSON.parse + validateRoute remain
// authoritative; incomplete strings and numbers never count as completed values.
export class RouteOutputProgress {
  private depth = 0;
  private key = '';
  private expectsKey = false;
  private string: string | null = null;
  private target: 'key' | 'rationale' | 'other' = 'other';
  private escaped = false;
  private unicode: string | null = null;
  private number = '';
  private inIds = false;
  public count = 0;

  push(chunk: string): string {
    let rationale = '';
    const append = (text: string) => {
      this.string += text;

      if (this.target === 'rationale') {
        rationale += text;
      }
    };

    for (const char of chunk) {
      if (this.string !== null) {
        if (this.unicode !== null) {
          this.unicode += char;

          if (this.unicode.length === 4) {
            if (/^[0-9a-f]{4}$/i.test(this.unicode)) {
              append(String.fromCharCode(parseInt(this.unicode, 16)));
            }

            this.unicode = null;
          }
        } else if (this.escaped) {
          this.escaped = false;

          if (char === 'u') {
            this.unicode = '';
          } else {
            append(
              (
                {
                  n: '\n',
                  r: '\r',
                  t: '\t',
                  b: '\b',
                  f: '\f',
                } as Record<string, string>
              )[char] ?? char,
            );
          }
        } else if (char === '\\') {
          this.escaped = true;
        } else if (char === '"') {
          if (this.target === 'key') {
            this.key = this.string;
            this.expectsKey = false;
          }

          this.string = null;
        } else {
          append(char);
        }

        continue;
      }

      if (this.number) {
        if (/[\d.eE+\-]/.test(char)) {
          this.number += char;
          continue;
        }

        if (this.inIds && this.depth === 2 && /^\d+$/.test(this.number) && /[,\]\s]/.test(char)) {
          this.count += 1;
        }

        this.number = '';
      }

      if (char === '"') {
        this.string = '';

        if (this.depth === 1 && this.expectsKey) {
          this.target = 'key';
        } else if (this.depth === 1 && this.key === 'rationale') {
          this.target = 'rationale';
        } else {
          this.target = 'other';
        }
      } else if (char === '{') {
        this.depth += 1;

        if (this.depth === 1) {
          this.expectsKey = true;
        }
      } else if (char === '[') {
        if (this.depth === 1 && this.key === 'topicIds') {
          this.inIds = true;
        }

        this.depth += 1;
      } else if (char === ']' || char === '}') {
        if (this.depth === 2 && char === ']') {
          this.inIds = false;
        }

        this.depth -= 1;
      } else if (char === ',' && this.depth === 1) {
        this.expectsKey = true;
        this.key = '';
      } else if (this.inIds && this.depth === 2 && /[\d\-]/.test(char)) {
        this.number = char;
      }
    }

    return rationale;
  }
}
