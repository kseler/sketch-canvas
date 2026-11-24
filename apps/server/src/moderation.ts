import OpenAI from 'openai';

// A free check that the image prompt isn't harassment, hate, sexual, violent, self-harm or illicit
// content, before we pay for a picture. It only classifies; it can't be talked into anything.
//
// FAILS CLOSED: if the check itself fails (timeout, network, bad key), there is no picture. If a
// failed check meant "go ahead", an attacker would only have to make the check fail.

export const MODERATION_MODEL = 'omni-moderation-latest';
export const MODERATION_TIMEOUT_MS = 10_000;

export class ContentFlaggedError extends Error {
  constructor() {
    super('The image prompt was flagged by moderation.');
    this.name = 'ContentFlaggedError';
  }
}

export class ModerationUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The moderation check could not be completed.', options);
    this.name = 'ModerationUnavailableError';
  }
}

// The one API method we use, so tests can pass a fake.
export type ModerationClient = {
  moderate(input: string, signal: AbortSignal): Promise<{ flagged: boolean }[]>;
};

export function openAiModerationClient(client: OpenAI): ModerationClient {
  return {
    moderate: async (input, signal) => {
      const response = await client.moderations.create({ model: MODERATION_MODEL, input }, { signal, maxRetries: 0 });
      return response.results;
    },
  };
}

// Resolves if the text is fine; throws ContentFlaggedError if flagged, ModerationUnavailableError if
// the check couldn't be done. An empty result list counts as "couldn't be done", not "fine".
export async function checkContent(client: ModerationClient, text: string): Promise<void> {
  let results: { flagged: boolean }[];
  try {
    results = await client.moderate(text, AbortSignal.timeout(MODERATION_TIMEOUT_MS));
  } catch (error) {
    // Name and status only (e.g. 401 = the key lacks the Moderations permission).
    const status = error instanceof OpenAI.APIError ? ` ${error.status}` : '';
    console.error(`moderation: check failed (${error instanceof Error ? error.name : typeof error}${status})`);
    throw new ModerationUnavailableError({ cause: error });
  }
  if (!Array.isArray(results) || results.length === 0) throw new ModerationUnavailableError();
  if (results.some((result) => result.flagged !== false)) throw new ContentFlaggedError();
}
