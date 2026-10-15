/**
 * Anthropic list prices in US dollars per million tokens (checked October 2026). Used to
 * record what each AI report cost so the shared daily budget can be enforced in dollars.
 * An unknown model is priced at the most expensive rate below, so it can never undercount.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const FALLBACK = { input: 10, output: 50 };

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

const rate = (model: string) => PRICES[model] ?? FALLBACK;

/**
 * Cost of one request in micro-dollars (1,000,000 = $1), rounded up. When the API served the
 * request on a fallback model, the more expensive of the two rates is used.
 */
export function costMicros(usage: TokenUsage, ...models: string[]): number {
  const prices = models.map(rate);
  const input = Math.max(...prices.map((p) => p.input));
  const output = Math.max(...prices.map((p) => p.output));
  // Per-million-token prices are exactly micro-dollars per token.
  const total =
    usage.input_tokens * input +
    (usage.cache_creation_input_tokens ?? 0) * input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * input * 0.1 +
    usage.output_tokens * output;
  return Math.ceil(total);
}
