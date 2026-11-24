import { describe, expect, it } from 'vitest';
import { estimateTextUsd, IMAGE_PRICES, imageCostUsd, imageInputTokens, TEXT_PRICES, textCostUsd } from './pricing';

const model = 'claude-haiku-5-5';
const price = TEXT_PRICES[model];

describe('imageInputTokens', () => {
  it.each([
    ['800x600 (the canvas)', 800, 600, 638],
    ['1x1', 1, 1, 1],
    ['28x28, exactly one tile', 28, 28, 1],
    ['29x28, one pixel into a second tile', 29, 28, 2],
    ['28x29', 28, 29, 2],
    ['56x56', 56, 56, 4],
  ])('counts %s as %i tokens', (_label, w, h, tokens) => {
    expect(imageInputTokens(w, h)).toBe(tokens);
  });
});

describe('textCostUsd', () => {
  it('prices a short prompt at $0.10 in and $0.50 out per million tokens', () => {
    expect(textCostUsd(model, { inputTokens: 100_000, outputTokens: 100_000 })).toBeCloseTo(0.06, 10);
    expect(textCostUsd(model, { inputTokens: 100_000, outputTokens: 0 })).toBeCloseTo(0.01, 10);
    expect(textCostUsd(model, { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(price.outputPerMTok, 10);
  });

  it('prices a million input and a million output tokens at the long-prompt rates ($0.50 + $2.50)', () => {
    expect(textCostUsd(model, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(3, 10);
  });

  it('costs nothing for no tokens', () => {
    expect(textCostUsd(model, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('switches to the long-prompt rates at exactly longPromptFrom input tokens', () => {
    const below = price.longPromptFrom - 1;
    const at = price.longPromptFrom;
    expect(textCostUsd(model, { inputTokens: below, outputTokens: 1000 })).toBeCloseTo(
      (below * price.inputPerMTok + 1000 * price.outputPerMTok) / 1e6,
      10,
    );
    expect(textCostUsd(model, { inputTokens: at, outputTokens: 1000 })).toBeCloseTo(
      (at * price.longInputPerMTok + 1000 * price.longOutputPerMTok) / 1e6,
      10,
    );
  });

  it('never gets cheaper when the prompt grows past the long-prompt threshold', () => {
    const below = textCostUsd(model, { inputTokens: price.longPromptFrom - 1, outputTokens: 0 });
    const at = textCostUsd(model, { inputTokens: price.longPromptFrom, outputTokens: 0 });
    expect(at).toBeGreaterThan(below);
  });
});

describe('estimateTextUsd', () => {
  it('equals the cost of the full max_tokens of output', () => {
    expect(estimateTextUsd(model, { inputTokens: 1000, maxTokens: 800 })).toBe(
      textCostUsd(model, { inputTokens: 1000, outputTokens: 800 }),
    );
  });

  it.each([0, 1, 400, 800])('is at least the real cost for %i output tokens when max_tokens is 800', (outputTokens) => {
    const estimate = estimateTextUsd(model, { inputTokens: 2638, maxTokens: 800 });
    expect(estimate).toBeGreaterThanOrEqual(textCostUsd(model, { inputTokens: 2638, outputTokens }));
  });
});

describe('imageCostUsd', () => {
  const imageModel = 'gpt-image-2.6-flare';
  const p = IMAGE_PRICES[imageModel];

  it('prices text input, image input and output tokens at their own rates', () => {
    expect(imageCostUsd(imageModel, { textInputTokens: 1000, imageInputTokens: 0, outputTokens: 600 })).toBeCloseTo(
      (1000 * p.textInputPerMTok + 600 * p.imageOutputPerMTok) / 1e6,
      10,
    );
    expect(imageCostUsd(imageModel, { textInputTokens: 0, imageInputTokens: 500, outputTokens: 0 })).toBeCloseTo(
      (500 * p.imageInputPerMTok) / 1e6,
      10,
    );
  });

  it('matches the documented price of a low-tier picture (about $0.017)', () => {
    expect(imageCostUsd(imageModel, { textInputTokens: 0, imageInputTokens: 0, outputTokens: 563 })).toBeCloseTo(0.0169, 4);
  });

  it('costs nothing for no tokens', () => {
    expect(imageCostUsd(imageModel, { textInputTokens: 0, imageInputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
