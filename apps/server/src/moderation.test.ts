import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import {
  checkContent,
  ContentFlaggedError,
  MODERATION_MODEL,
  MODERATION_TIMEOUT_MS,
  ModerationUnavailableError,
  openAiModerationClient,
  type ModerationClient,
} from './moderation';

const answering = (results: unknown): ModerationClient => ({ moderate: vi.fn(async () => results as { flagged: boolean }[]) });

describe('checkContent', () => {
  it('resolves when nothing is flagged', async () => {
    await expect(checkContent(answering([{ flagged: false }]), 'a cat')).resolves.toBeUndefined();
  });

  it('passes the text and an abort signal for the timeout to the client', async () => {
    const client = answering([{ flagged: false }]);
    await checkContent(client, 'a cat');
    const [text, signal] = vi.mocked(client.moderate).mock.calls[0]!;
    expect(text).toBe('a cat');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(MODERATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('throws ContentFlaggedError when the result is flagged', async () => {
    await expect(checkContent(answering([{ flagged: true }]), 'x')).rejects.toBeInstanceOf(ContentFlaggedError);
  });

  it('throws ContentFlaggedError when any one of several results is flagged', async () => {
    await expect(
      checkContent(answering([{ flagged: false }, { flagged: true }, { flagged: false }]), 'x'),
    ).rejects.toBeInstanceOf(ContentFlaggedError);
  });

  it.each([
    ['missing', {}],
    ['a string', { flagged: 'false' }],
    ['a number', { flagged: 0 }],
    ['null', { flagged: null }],
    ['undefined', { flagged: undefined }],
  ])('treats a result whose flagged is %s as flagged (never as fine)', async (_label, result) => {
    await expect(checkContent(answering([result]), 'x')).rejects.toBeInstanceOf(ContentFlaggedError);
  });

  it('fails closed when the client rejects, keeping the cause', async () => {
    const cause = new Error('network down');
    const client: ModerationClient = { moderate: () => Promise.reject(cause) };
    const error = await checkContent(client, 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModerationUnavailableError);
    expect((error as Error).cause).toBe(cause);
  });

  it('fails closed when the client throws synchronously', async () => {
    const client: ModerationClient = {
      moderate: () => {
        throw new Error('boom');
      },
    };
    await expect(checkContent(client, 'x')).rejects.toBeInstanceOf(ModerationUnavailableError);
  });

  it.each([
    ['an empty list', []],
    ['undefined', undefined],
    ['null', null],
    ['an object', { flagged: false }],
  ])('fails closed when the answer is %s', async (_label, results) => {
    await expect(checkContent(answering(results), 'x')).rejects.toBeInstanceOf(ModerationUnavailableError);
  });
});

describe('openAiModerationClient', () => {
  it('asks the moderation model, with the signal and no SDK retries, and returns the results', async () => {
    const create = vi.fn(async () => ({ results: [{ flagged: false }] }));
    const client = openAiModerationClient({ moderations: { create } } as unknown as OpenAI);
    const signal = new AbortController().signal;
    const results = await client.moderate('a prompt', signal);
    expect(results).toEqual([{ flagged: false }]);
    expect(create).toHaveBeenCalledWith({ model: MODERATION_MODEL, input: 'a prompt' }, { signal, maxRetries: 0 });
    expect(MODERATION_MODEL).toBe('omni-moderation-latest');
  });
});

describe('a failed check is logged with name and status only', () => {
  it('logs the status of an API error (e.g. 401: missing permission), not its message', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: ModerationClient = { moderate: () => Promise.reject(new OpenAI.APIError(401, undefined, 'SECRET detail', new Headers())) };
    await expect(checkContent(failing, 'x')).rejects.toBeInstanceOf(ModerationUnavailableError);
    expect(error.mock.calls).toEqual([['moderation: check failed (Error 401)']]);
    error.mockRestore();
  });
});
