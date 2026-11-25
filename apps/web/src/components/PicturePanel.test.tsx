// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ImageRecord } from '../lib/images';
import { PicturePanel } from './PicturePanel';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const picture = (id: string): ImageRecord => ({
  kind: 'image', id, url: `/api/images/${id}.png`, x: 0, y: 0, w: 800, h: 600, createdAt: '2026-01-01T00:00:00Z',
});
function images(...records: unknown[]) {
  const arr = new Y.Doc().getArray<unknown>('images');
  arr.push(records);
  return arr;
}
const PLACEHOLDER = 'The picture appears here after Generate.';

afterEach(cleanup);

describe('PicturePanel', () => {
  it('shows the placeholder text when there is no picture, and no Download', () => {
    render(<PicturePanel images={images()} busy={false} />);
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
    expect(screen.queryByText('Download')).toBeNull();
  });

  it('ignores records that are not valid pictures (placeholder stays)', () => {
    render(<PicturePanel images={images({ kind: 'image', id: 'x', url: 'https://evil.example/a.png' })} busy={false} />);
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy();
  });

  it('shows the latest picture with a Download link when not busy', () => {
    render(<PicturePanel images={images(picture(ID_A), picture(ID_B))} busy={false} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe(`/api/images/${ID_B}.png`);
    const link = screen.getByText('Download');
    expect(link.getAttribute('href')).toBe(`/api/images/${ID_B}.png`);
    expect(link.getAttribute('download')).toBe(`sketch-${ID_B.slice(0, 8)}.png`);
  });

  it('shows the loading grid instead of the picture, and hides Download, while busy', () => {
    render(<PicturePanel images={images(picture(ID_A))} busy={true} />);
    expect(screen.getByRole('status', { name: 'Generating the picture' })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText('Download')).toBeNull();
  });

  it('shows the loading grid while busy even when there is no picture yet (no placeholder)', () => {
    render(<PicturePanel images={images()} busy={true} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('brings the picture back when busy ends', () => {
    const arr = images(picture(ID_A));
    const { rerender } = render(<PicturePanel images={arr} busy={true} />);
    rerender(<PicturePanel images={arr} busy={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('shows a new picture when the server adds one', () => {
    const arr = images(picture(ID_A));
    render(<PicturePanel images={arr} busy={false} />);
    act(() => arr.push([picture(ID_B)]));
    expect(screen.getByRole('img').getAttribute('src')).toBe(`/api/images/${ID_B}.png`);
  });

  it('falls back to an older picture when the newest fails to load', () => {
    render(<PicturePanel images={images(picture(ID_A), picture(ID_B))} busy={false} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').getAttribute('src')).toBe(`/api/images/${ID_A}.png`);
  });
});
