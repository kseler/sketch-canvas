import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { createRoomImages, IMAGES_ARRAY, type ImageRecord } from './roomImages';

const record = (id: string): ImageRecord => ({
  kind: 'image',
  id,
  url: `/api/images/${id}.png`,
  x: 0,
  y: 0,
  w: 800,
  h: 600,
  createdAt: '2026-11-24T12:00:00.000Z',
});

describe('createRoomImages add', () => {
  it("pushes the record onto the 'images' array of the room's document", () => {
    const doc = new Y.Doc();
    const getDoc = vi.fn(() => doc);
    createRoomImages(getDoc).add('room-1', record('a'));
    expect(getDoc).toHaveBeenCalledWith('room-1');
    expect(IMAGES_ARRAY).toBe('images');
    expect(doc.getArray(IMAGES_ARRAY).toJSON()).toEqual([record('a')]);
  });

  it('keeps earlier pictures and appends in order', () => {
    const doc = new Y.Doc();
    const rooms = createRoomImages(() => doc);
    rooms.add('room-1', record('a'));
    rooms.add('room-1', record('b'));
    expect(doc.getArray(IMAGES_ARRAY).toJSON().map((r) => (r as ImageRecord).id)).toEqual(['a', 'b']);
  });

  it('does not touch the strokes', () => {
    const doc = new Y.Doc();
    doc.getArray('strokes').push([{ id: 's' }]);
    createRoomImages(() => doc).add('room-1', record('a'));
    expect(doc.getArray('strokes').toJSON()).toEqual([{ id: 's' }]);
  });

  it('writes to the document of the room it was given, not another', () => {
    const docs = new Map<string, Y.Doc>([
      ['room-1', new Y.Doc()],
      ['room-2', new Y.Doc()],
    ]);
    createRoomImages((id) => docs.get(id)!).add('room-2', record('a'));
    expect(docs.get('room-1')!.getArray(IMAGES_ARRAY).length).toBe(0);
    expect(docs.get('room-2')!.getArray(IMAGES_ARRAY).length).toBe(1);
  });
});
