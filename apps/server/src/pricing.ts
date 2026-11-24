// Prices for the models we call, in one place, so estimates and real costs can't drift apart.
// Checked on 2026-11-23 at https://platform.claude.com/docs/en/about-claude/pricing.

type TextPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
  // Above this many prompt tokens, a request is billed at the long-prompt rates.
  longPromptFrom: number;
  longInputPerMTok: number;
  longOutputPerMTok: number;
};

export const TEXT_PRICES = {
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    longPromptFrom: 100_001,
    longInputPerMTok: 0.5,
    longOutputPerMTok: 2.5,
  },
} as const satisfies Record<string, TextPrice>;

export type TextModel = keyof typeof TEXT_PRICES;

export type TextUsage = { inputTokens: number; outputTokens: number };

// What a text call cost, from the token counts the API reports. Prompt caching is not used, so
// every input token is billed at the input rate.
export function textCostUsd(model: TextModel, { inputTokens, outputTokens }: TextUsage): number {
  const price: TextPrice = TEXT_PRICES[model];
  const long = inputTokens >= price.longPromptFrom;
  const input = long ? price.longInputPerMTok : price.inputPerMTok;
  const output = long ? price.longOutputPerMTok : price.outputPerMTok;
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

// An upper bound for a text call, held by paidCall before it starts: every input token we may
// send, plus the full `max_tokens` of output (the model can't write more than that).
export function estimateTextUsd(model: TextModel, { inputTokens, maxTokens }: { inputTokens: number; maxTokens: number }): number {
  return textCostUsd(model, { inputTokens, outputTokens: maxTokens });
}

// Claude's vision cost for an image: one token per 28x28 pixel tile.
// (https://platform.claude.com/docs/en/build-with-claude/vision; 800x600 = 29 x 22 = 638 tokens.)
export function imageInputTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

// Image model prices, checked on 2026-11-23 at https://developers.openai.com/api/docs/pricing.
// The prompt is billed as text input; the picture as image output tokens.
export const IMAGE_PRICES = {
  'gpt-image-2.6-flare': { textInputPerMTok: 5, imageInputPerMTok: 8, imageOutputPerMTok: 30 },
} as const;

export type ImageModel = keyof typeof IMAGE_PRICES;

export type ImageUsage = { textInputTokens: number; imageInputTokens: number; outputTokens: number };

// What an image call cost, from the token counts the API reports.
export function imageCostUsd(model: ImageModel, usage: ImageUsage): number {
  const price = IMAGE_PRICES[model];
  return (
    (usage.textInputTokens * price.textInputPerMTok +
      usage.imageInputTokens * price.imageInputPerMTok +
      usage.outputTokens * price.imageOutputPerMTok) /
    1_000_000
  );
}
