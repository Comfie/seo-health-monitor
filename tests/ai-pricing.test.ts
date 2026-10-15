import { describe, expect, it } from "vitest";
import { costMicros } from "@/lib/ai/pricing";

describe("AI report pricing", () => {
  it("prices a typical Sonnet 5.5 report in micro-dollars", () => {
    // 20k input at $2/M + 4k output at $10/M = $0.04 + $0.04
    expect(costMicros({ input_tokens: 20_000, output_tokens: 4_000 }, "claude-sonnet-5-5")).toBe(80_000);
  });

  it("includes cache writes and reads", () => {
    expect(costMicros({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 10_000 }, "claude-sonnet-5-5")).toBe(4_500);
  });

  it("uses the dearer rate after a fallback and never undercounts an unknown model", () => {
    expect(costMicros({ input_tokens: 1_000, output_tokens: 1_000 }, "claude-sonnet-5-5", "claude-opus-5-5")).toBe(24_000);
    expect(costMicros({ input_tokens: 1_000, output_tokens: 1_000 }, "some-new-model")).toBe(60_000);
  });
});
