import type { Usage } from "@anthropic-ai/sdk/resources/messages";

// All four rates in US dollars per million tokens. A price is data, not logic:
// it drifts, so it lives in one table you edit, next to the ids it describes.
export type Price = {
  input: number;
  output: number;
  cacheWrite: number; // 5-minute write, 1.25x input
  cacheRead: number; //  cache hit,      0.1x input
};

const PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
};

// Price one response. The buckets are summed separately because a cache read
// costs a tenth of fresh input, and that gap is the whole point of caching.
export function costOf(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  );
}
