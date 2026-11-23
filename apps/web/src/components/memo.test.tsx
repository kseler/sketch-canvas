// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Awareness } from '../sync/room';
import { CursorsLayer } from './CursorsLayer';
import { LiveStrokes } from './LiveStrokes';

// Konva can't render in jsdom (no canvas), so its components become empty stand-ins, and
// usePeers is replaced by a counter: each call = one render of the component under test.
const { usePeers } = vi.hoisted(() => ({ usePeers: vi.fn(() => []) }));
vi.mock('../hooks/usePeers', () => ({ usePeers }));
vi.mock('react-konva', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Layer: Pass, Group: Pass, Label: Pass, Line: () => null, Tag: () => null, Text: () => null };
});

const awareness = {} as Awareness; // never read: usePeers is mocked

beforeEach(() => {
  usePeers.mockClear();
});
afterEach(cleanup); // unmount, so renders don't pile up in document.body across tests

// Canvas re-renders on every point of your own stroke. These layers get the same props each time,
// so they should not re-render with it (that would redraw every remote cursor and live stroke).
describe('layers that should not re-render with Canvas', () => {
  it('CursorsLayer skips a parent re-render with the same props', () => {
    const { rerender } = render(<CursorsLayer awareness={awareness} scale={1} />);
    rerender(<CursorsLayer awareness={awareness} scale={1} />);
    expect(usePeers).toHaveBeenCalledTimes(1);
  });

  it('CursorsLayer re-renders when the scale changes (window resized)', () => {
    const { rerender } = render(<CursorsLayer awareness={awareness} scale={1} />);
    rerender(<CursorsLayer awareness={awareness} scale={0.5} />);
    expect(usePeers).toHaveBeenCalledTimes(2);
  });

  it('LiveStrokes skips a parent re-render with the same awareness', () => {
    const { rerender } = render(<LiveStrokes awareness={awareness} />);
    rerender(<LiveStrokes awareness={awareness} />);
    expect(usePeers).toHaveBeenCalledTimes(1);
  });
});
