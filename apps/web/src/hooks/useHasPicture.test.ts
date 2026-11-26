// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { useHasPicture } from './useHasPicture';

const ID = '11111111-1111-4111-8111-111111111111';
const picture = { kind: 'image', id: ID, url: `/api/images/${ID}.png`, x: 0, y: 0, w: 800, h: 600, createdAt: '2026-11-26T00:00:00Z' };
const newImages = () => new Y.Doc().getArray<unknown>('images');

afterEach(cleanup);

describe('useHasPicture', () => {
  it('is false with no room yet, and for a room without pictures', () => {
    expect(renderHook(() => useHasPicture(undefined)).result.current).toBe(false);
    expect(renderHook(() => useHasPicture(newImages())).result.current).toBe(false);
  });

  it('turns true when the server adds a picture', () => {
    const images = newImages();
    const { result } = renderHook(() => useHasPicture(images));
    act(() => {
      images.push([picture]);
    });
    expect(result.current).toBe(true);
  });

  it('ignores records that are not valid pictures', () => {
    const images = newImages();
    images.push([{ kind: 'image', id: 'x', url: 'https://evil.example/x.png' }]);
    expect(renderHook(() => useHasPicture(images)).result.current).toBe(false);
  });
});
