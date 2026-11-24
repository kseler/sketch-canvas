import { describe, expect, it, vi } from 'vitest';
import type { SketchBrief } from './brief';
import { DEV_IMAGE_TIER, type GenerateImage } from './generateImage';
import { buildImagePrompt } from './imagePrompt';
import type { ImageStore } from './imageStore';
import { ContentFlaggedError, ModerationUnavailableError } from './moderation';
import { createMakePicture, PictureStorageError } from './picture';
import type { RoomImages } from './roomImages';

const BRIEF: SketchBrief = { subject: 'a cat on a hill', style: 'watercolor', mood: 'calm', palette: ['#3a7bd5'], composition: 'cat centered', lettering: '' };
const AREA = { x: 0, y: 0, w: 800, h: 600 };
const PNG = new Uint8Array([1, 2, 3]);
const NOW = new Date('2026-11-24T12:00:00.000Z');
const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

function setup() {
  const order: string[] = [];
  const checkContent = vi.fn(async (_text: string) => {
    order.push('check');
  });
  const generateImage = vi.fn<GenerateImage>(async () => {
    order.push('generate');
    return { png: PNG, width: 1024, height: 768 };
  });
  const save = vi.fn<ImageStore['save']>(async () => {
    order.push('save');
    return { id: ID, url: `/api/images/${ID}.png` };
  });
  const add = vi.fn<RoomImages['add']>(() => {
    order.push('add');
  });
  const make = createMakePicture({
    checkContent,
    generateImage,
    store: { save, read: vi.fn() },
    rooms: { add },
    now: () => NOW,
  });
  return { make, checkContent, generateImage, save, add, order };
}

describe('createMakePicture', () => {
  it('moderates exactly the image prompt built from the brief', async () => {
    const s = setup();
    await s.make({ roomId: 'room-1', brief: BRIEF, area: AREA });
    expect(s.checkContent).toHaveBeenCalledWith(buildImagePrompt(BRIEF));
  });

  it('asks for the cheapest tier with the same prompt that was checked', async () => {
    const s = setup();
    await s.make({ roomId: 'room-1', brief: BRIEF, area: AREA });
    expect(DEV_IMAGE_TIER).toBe('low');
    expect(s.generateImage).toHaveBeenCalledWith({ roomId: 'room-1', prompt: buildImagePrompt(BRIEF), tier: 'low' });
  });

  it('runs check, generate, save, add in that order', async () => {
    const s = setup();
    await s.make({ roomId: 'room-1', brief: BRIEF, area: AREA });
    expect(s.order).toEqual(['check', 'generate', 'save', 'add']);
  });

  it('stores the picture bytes and shares a record with the store id and url, the area and the injected time', async () => {
    const s = setup();
    const record = await s.make({ roomId: 'room-1', brief: BRIEF, area: { x: 10, y: 20, w: 300, h: 200 } });
    expect(s.save).toHaveBeenCalledWith(PNG);
    expect(record).toEqual({
      kind: 'image',
      id: ID,
      url: `/api/images/${ID}.png`,
      x: 10,
      y: 20,
      w: 300,
      h: 200,
      createdAt: NOW.toISOString(),
    });
    expect(s.add).toHaveBeenCalledWith('room-1', record);
  });

  it.each([
    ['flagged', new ContentFlaggedError()],
    ['unavailable (fails closed)', new ModerationUnavailableError()],
  ])('stops before any paid call, storage or sharing when moderation says %s', async (_label, error) => {
    const s = setup();
    s.checkContent.mockRejectedValueOnce(error);
    await expect(s.make({ roomId: 'room-1', brief: BRIEF, area: AREA })).rejects.toBe(error);
    expect(s.generateImage).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
    expect(s.add).not.toHaveBeenCalled();
  });

  it('does not store or share when the image call fails', async () => {
    const s = setup();
    const error = new Error('image failed');
    s.generateImage.mockRejectedValueOnce(error);
    await expect(s.make({ roomId: 'room-1', brief: BRIEF, area: AREA })).rejects.toBe(error);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.add).not.toHaveBeenCalled();
  });

  it('does not share a picture that could not be stored', async () => {
    const s = setup();
    const error = new Error('disk full');
    s.save.mockRejectedValueOnce(error);
    const thrown = await s.make({ roomId: 'room-1', brief: BRIEF, area: AREA }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(PictureStorageError);
    expect((thrown as PictureStorageError).cause).toBe(error);
    expect(s.add).not.toHaveBeenCalled();
  });

  it('reports a picture that was stored but could not be shared as a storage error', async () => {
    const s = setup();
    s.add.mockImplementationOnce(() => {
      throw new Error('doc gone');
    });
    await expect(s.make({ roomId: 'room-1', brief: BRIEF, area: AREA })).rejects.toBeInstanceOf(PictureStorageError);
  });

  it('uses the real clock when none is injected', async () => {
    const add = vi.fn();
    const make = createMakePicture({
      checkContent: async () => {},
      generateImage: async () => ({ png: PNG, width: 1, height: 1 }),
      store: { save: async () => ({ id: ID, url: `/api/images/${ID}.png` }), read: vi.fn() },
      rooms: { add },
    });
    const before = Date.now();
    const record = await make({ roomId: 'r', brief: BRIEF, area: AREA });
    expect(Date.parse(record.createdAt)).toBeGreaterThanOrEqual(before);
  });
});
