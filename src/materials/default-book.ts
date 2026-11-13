import type { BookCategory, BookProgress } from '../domain/progress.js';
import type { Book } from '../domain/types.js';

export const defaultBookId = '1368';
export const defaultBookTitle = '1368个单词就够了';

const introduction = '《1368个单词就够了》是一本面向英语初学者的基础口语词书，通过学习核心词汇的含义、搭配和用法，帮助读者用简单词汇表达日常想法。';

export const appendixCategories = [
  { id: 'concrete-nouns', name: '具体名词', heading: '具体名词：背下来就可以' },
  { id: 'abstract-nouns', name: '抽象名词', heading: '抽象名词：光背下来还不够' },
  { id: 'component-nouns', name: '构成类名词', heading: '构成类名词：你的外在与内在' },
  { id: 'attribute-nouns', name: '属性类名词', heading: '属性类名词：你的状态' },
  { id: 'simple-verbs', name: '单纯型动词', heading: '单纯型动词：广交天下朋友' },
  { id: 'specialized-verbs', name: '世故型动词', heading: '世故型动词：朋友少，但效率高' },
  { id: 'adjectives', name: '形容词', heading: '让感觉飞起来：形容词' },
  { id: 'prepositions', name: '介词', heading: '英语的灵魂：介词' },
  { id: 'adverbs-and-others', name: '副词及其他', heading: '英语的配角：副词及其他' },
] as const;

const categories: BookCategory[] = appendixCategories.map(({ id, name }) => ({ id, name }));

const defaultPlan = {
  categoryIds: [
    'adverbs-and-others', 'simple-verbs', 'prepositions', 'concrete-nouns', 'adjectives',
    'abstract-nouns', 'component-nouns', 'attribute-nouns', 'specialized-verbs',
  ],
  description: [
    '1. 从副词及其他类中的基础功能词入手，先学代词、冠词和连词。',
    '2. 学习 be、go、make 等核心动词，再练习常用介词。',
    '3. 学习具体名词与形容词，再扩展到抽象、构成和属性类名词。',
    '4. 学习世故型动词和常用搭配，通过日常场景练习口语。',
  ].join('\n'),
};

export function defaultBookMetadata(wordCount: number): Book {
  return { id: defaultBookId, title: defaultBookTitle, introduction, defaultPlan, wordCount };
}

export function initialBookProgress(plan = defaultPlan, summary = ''): BookProgress {
  const [categoryId = 'adverbs-and-others'] = plan.categoryIds;
  return { categories, plan, current: { categoryId, summary } };
}

export function bookOverview(book: Book): string {
  return `您当前的学习词书为 《${book.title}》\n\n一、词书介绍\n${book.introduction}\n\n二、建议学习路线\n${book.defaultPlan.description}`;
}
