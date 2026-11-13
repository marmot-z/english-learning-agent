import { z } from 'zod';

export const bookCategorySchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
export const bookPlanSchema = z.object({
  categoryIds: z.array(z.string()).min(1),
  description: z.string().trim().min(1),
});

export const bookProgressSchema = z.object({
  categories: z.array(bookCategorySchema).min(1),
  plan: bookPlanSchema,
  current: z.object({ categoryId: z.string(), summary: z.string() }),
}).refine(({ categories, plan, current }) => {
  const ids = new Set(categories.map(({ id }) => id));
  return ids.size === categories.length && new Set(plan.categoryIds).size === ids.size &&
    plan.categoryIds.length === ids.size && plan.categoryIds.every((id) => ids.has(id)) && ids.has(current.categoryId);
}, '学习路线必须包含全书分类，且当前分类须有效。');

export type BookCategory = z.infer<typeof bookCategorySchema>;
export type BookPlan = z.infer<typeof bookPlanSchema>;
export type BookProgress = z.infer<typeof bookProgressSchema>;
