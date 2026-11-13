import { z } from 'zod';
import { AppError } from '../errors.js';
import { newWordInstructions, reviewWordInstructions } from '../prompts/index.js';
import type { TextRequest } from './client.js';

export type RunSelection = (request: TextRequest) => Promise<string>;
export type TrackSelection = (kind: keyof typeof selection, operation: () => Promise<string[]>) => Promise<string[]>;

const selection = {
  new: { name: 'SelectNewWords', instructions: newWordInstructions, label: '新词' },
  review: { name: 'SelectReviewWords', instructions: reviewWordInstructions, label: '复习词' },
};

export async function selectWords(
  run: RunSelection,
  kind: keyof typeof selection,
  candidates: { id: number; word: string }[],
  quota: number, context: object,
  signal?: AbortSignal,
  trackSelection?: TrackSelection,
): Promise<string[]> {
  signal?.throwIfAborted();

  const targetCount = Math.min(quota, candidates.length);

  if (!targetCount) {
    return [];
  }

  const { name, instructions, label } = selection[kind];
  async function runAndValidate(): Promise<string[]> {
    const output = await run({
      name,
      instructions,
      input: JSON.stringify({ ...context, targetCount, candidates }),
      maxTokens: 64 + targetCount * 8,
      signal,
    });

    signal?.throwIfAborted();

    try {
      const wordsById = new Map(candidates.map(({ id, word }) => [id, word]));
      const ids = z.array(z.int()).length(targetCount).parse(JSON.parse(output));

      if (new Set(ids).size !== ids.length) {
        throw new Error('Repeated candidate ID');
      }

      return ids.map((id) => {
        const word = wordsById.get(id);

        if (word === undefined) {
          throw new Error('Unknown candidate ID');
        }

        return word;
      });
    } catch (error) {
      throw new AppError(
        'AI_INVALID_WORD_SELECTION',
        `AI 返回的${label}列表数量不符，或包含重复或不在候选中的词条。`,
        { cause: error },
      );
    }
  }

  return trackSelection ? trackSelection(kind, runAndValidate) : runAndValidate();
}
