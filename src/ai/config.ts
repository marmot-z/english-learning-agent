import { z } from 'zod';

export const aiConfigSchema = z.object({
  baseURL: z.url().refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }

    const url = new URL(value);

    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }),
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1),
  timeout: z.number().int().positive().max(300000),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;
