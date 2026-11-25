import type { SketchBrief } from './brief';
import { DEV_IMAGE_TIER, type GenerateImage } from './generateImage';
import { buildImagePrompt } from './imagePrompt';
import type { ImageStore } from './imageStore';
import type { ImageRecord, RoomImages } from './roomImages';

// From a checked brief to a picture on everyone's canvas, in order:
// prompt (free) → moderation (free, fails closed) → image (paid, through paidCall) → stored on our
// server → logged and a small record into the room's Yjs document. Any step that fails stops the rest: no
// picture is paid for unless the check passed, and none is shared unless it was stored.

export type CheckContent = (text: string) => Promise<void>;

// The picture was paid for but couldn't be stored or shared (disk full, no permission). The cost
// is already counted; this only makes the failure say what really happened.
export class PictureStorageError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The picture was made but could not be saved.', options);
    this.name = 'PictureStorageError';
  }
}

export type Area = { x: number; y: number; w: number; h: number };

export type MakePicture = (request: { roomId: string; brief: SketchBrief; area: Area }) => Promise<ImageRecord>;

export function createMakePicture(deps: {
  checkContent: CheckContent;
  generateImage: GenerateImage;
  store: ImageStore;
  rooms: Pick<RoomImages, 'add'>;
  now?: () => Date;
}): MakePicture {
  const now = deps.now ?? (() => new Date());
  return async ({ roomId, brief, area }) => {
    const prompt = buildImagePrompt(brief);
    await deps.checkContent(prompt);
    const picture = await deps.generateImage({ roomId, prompt, tier: DEV_IMAGE_TIER });
    try {
      const { id, url } = await deps.store.save(picture.png);
      const record: ImageRecord = { kind: 'image', id, url, ...area, createdAt: now().toISOString() };
      await deps.rooms.add(roomId, record);
      return record;
    } catch (error) {
      throw new PictureStorageError({ cause: error });
    }
  };
}
