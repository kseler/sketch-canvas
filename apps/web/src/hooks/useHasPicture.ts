import { useCallback, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { latestImage } from '../lib/images';

// Whether the room has a picture to show (a valid record among the latest ones). Re-renders only
// when that answer changes, not on every change to the array.
export function useHasPicture(images: Y.Array<unknown> | undefined): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!images) return () => {};
      const observer = () => onChange();
      images.observe(observer);
      return () => images.unobserve(observer);
    },
    [images],
  );
  return useSyncExternalStore(subscribe, () => (images ? latestImage(images) !== null : false));
}
