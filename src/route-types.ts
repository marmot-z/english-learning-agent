export interface RouteWord {
  topicId: number;
  word: string;
  meanCn: string;
}

export interface RouteResult {
  rationale: string;
  topicIds: number[];
}

export type RouteUpdate =
  | { type: 'progress'; stage: 'loading_words' | 'planning' | 'ordering' | 'saving'; completed: number; total: number }
  | { type: 'rationale_delta'; text: string };

export type RoutePlanner = (input: {
  bookIntroduction: string;
  words: RouteWord[];
  signal: AbortSignal;
  onUpdate: (event: RouteUpdate) => void;
}) => Promise<RouteResult>;
