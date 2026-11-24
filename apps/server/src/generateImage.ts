import OpenAI from 'openai';
import { NotBilledError, type CostTracker } from './cost';
import { decodeBase64, readPngInfo } from './png';
import { imageCostUsd, type ImageModel } from './pricing';

// The image step: OpenAI draws the picture from the image prompt. Like the brief, everything that
// decides the price is a constant here, never something the brief or a player can change: the
// model, the size, the tier, one picture per call, SDK retries off.
//
// One small function for every image call (CLAUDE.md instant-mode rule 8). Instant mode will add
// `image` (image-to-image) as a new branch here, not a new pipeline.

// The official API host, set explicitly so a stray OPENAI_BASE_URL can't send the key and
// prompts elsewhere.
export const OPENAI_API_URL = 'https://api.openai.com/v1';

export const IMAGE_MODEL: ImageModel = 'gpt-image-2.6-flare';
// 4:3 like the 800x600 canvas, so the picture lines up with the sketch.
export const IMAGE_SIZE = '1024x768';
export const IMAGE_TIMEOUT_MS = 120_000;

export type ImageTier = 'low' | 'medium' | 'high';
// Development uses the cheapest tier (CLAUDE.md rule 4); higher tiers only for the evals.
export const DEV_IMAGE_TIER: ImageTier = 'low';

// Upper bounds for the estimate. Output tokens per 1024x768 picture, from OpenAI's calculator on
// Nov 23 ($0.0169 low, $0.0298 medium, $0.0361 high at $30 per million) plus about 25% margin.
const MAX_OUTPUT_TOKENS: Record<ImageTier, number> = { low: 720, medium: 1_250, high: 1_520 };
// The prompt is about 1 KB; a token is at least one byte, so this many bytes bound its tokens.
export const MAX_PROMPT_BYTES = 2_000;

export class ImageBlockedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The image service's own moderation blocked the picture.", options);
    this.name = 'ImageBlockedError';
  }
}

export class InvalidImageError extends Error {
  constructor() {
    super('The image service returned something that is not a usable PNG.');
    this.name = 'InvalidImageError';
  }
}

// The one API method we use, so tests can pass a fake.
export type ImageClient = {
  generate(body: OpenAI.ImageGenerateParamsNonStreaming, signal: AbortSignal): Promise<OpenAI.ImagesResponse>;
};

// maxRetries 0: one paidCall must be one billed request. paidCall owns the timeout; the signal
// stops the request when it fires.
export function openAiImageClient(client: OpenAI): ImageClient {
  return { generate: (body, signal) => client.images.generate(body, { signal, maxRetries: 0 }) };
}

// Not billed, and not something a player can cause: our key or setup (401, 403, 404), or a rate
// or spend limit (429). Anything else, including a 400 from a hostile prompt, keeps the estimate.
const NOT_BILLED_STATUSES = new Set([401, 403, 404, 429]);

export function isImageNotBilled(error: unknown): number | null {
  if (!(error instanceof OpenAI.APIError) || typeof error.status !== 'number') return null;
  return NOT_BILLED_STATUSES.has(error.status) ? error.status : null;
}

const MAX_IMAGE_BYTES = 10_000_000;
const MAX_IMAGE_SIDE = 4_096;

export type GeneratedImage = { png: Uint8Array; width: number; height: number };

// The picture from the reply, checked by its bytes: real PNG data, sane size. Never trusts the
// reply's claim of what it contains. Null if anything is off.
export function readGeneratedImage(response: Pick<OpenAI.ImagesResponse, 'data'>): GeneratedImage | null {
  const b64 = response.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
  const png = decodeBase64(b64);
  const info = png && readPngInfo(png);
  if (!png || !info || info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) return null;
  return { png, width: info.width, height: info.height };
}

export type GenerateImageRequest = {
  roomId: string;
  prompt: string;
  tier: ImageTier;
  // Instant mode (later): refine an existing image. Not built; passing one is refused.
  image?: Uint8Array;
};

export type GenerateImage = (request: GenerateImageRequest) => Promise<GeneratedImage>;

export function createGenerateImage({ client, costs }: { client: ImageClient; costs: CostTracker }): GenerateImage {
  return ({ roomId, prompt, tier, image }) => {
    if (image !== undefined) return Promise.reject(new Error('Image-to-image is not built yet.'));
    // Keeps the estimate an upper bound: a longer prompt would cost more than was reserved.
    if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES) {
      return Promise.reject(new RangeError('The image prompt is longer than the reserved estimate allows.'));
    }
    const estimateUsd = imageCostUsd(IMAGE_MODEL, {
      textInputTokens: MAX_PROMPT_BYTES,
      imageInputTokens: 0,
      outputTokens: MAX_OUTPUT_TOKENS[tier],
    });
    return costs.paidCall(
      { roomId, kind: 'image', model: IMAGE_MODEL, estimateUsd, timeoutMs: IMAGE_TIMEOUT_MS },
      async (signal) => {
        let response: OpenAI.ImagesResponse;
        try {
          response = await client.generate(
            {
              model: IMAGE_MODEL,
              prompt,
              size: IMAGE_SIZE,
              quality: tier, // explicit: the default, auto, may pick a pricier tier
              complexity: 'medium', // explicit: the default, high, is slower (no extra fee)
              output_format: 'png',
              n: 1,
              moderation: 'auto', // OpenAI's own content check stays at its default, never 'low'
            },
            signal,
          );
        } catch (error) {
          const status = isImageNotBilled(error);
          if (status !== null) throw new NotBilledError(status, { cause: error, code: (error as InstanceType<typeof OpenAI.APIError>).code });
          // Billing for a blocked picture is not documented, so it keeps the estimate.
          if (error instanceof OpenAI.APIError && error.code === 'moderation_blocked') throw new ImageBlockedError({ cause: error });
          throw error;
        }
        const usage = response.usage;
        // A reply without usage can't be priced: NaN makes paidCall count the estimate (and say so).
        const usd = usage
          ? imageCostUsd(IMAGE_MODEL, {
              textInputTokens: usage.input_tokens_details?.text_tokens ?? usage.input_tokens,
              imageInputTokens: usage.input_tokens_details?.image_tokens ?? 0,
              outputTokens: usage.output_tokens,
            })
          : Number.NaN;
        return { value: readGeneratedImage(response), usd, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens };
      },
    ).then((picture) => {
      // Paid for, but unusable: counted above, reported here.
      if (!picture) throw new InvalidImageError();
      return picture;
    });
  };
}
