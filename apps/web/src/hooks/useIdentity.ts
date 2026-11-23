import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cleanName,
  IDENTITY_STORAGE_KEY,
  loadIdentity,
  readStoredIdentity,
  saveIdentity,
  type Identity,
} from '../lib/identity';

// Your identity, saved in localStorage and shared by all your tabs. A rename in one tab reaches the
// others through the browser's `storage` event, which fires in every OTHER tab of the same site
// when localStorage changes (never in the tab that made the change).
export function useIdentity(): [Identity, (name: string) => void] {
  const [identity, setIdentity] = useState<Identity>(loadIdentity);
  // The latest identity for event handlers and rename, without re-creating them on every change.
  const current = useRef(identity);
  current.current = identity;

  // Only update (and so re-announce in awareness) when something actually changed.
  const update = useCallback((next: Identity) => {
    const now = current.current;
    if (next.id === now.id && next.name === now.name && next.color === now.color) return;
    current.current = next;
    setIdentity(next);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return; // sessionStorage changes are not ours
      if (e.key !== IDENTITY_STORAGE_KEY && e.key !== null) return; // another key; null = cleared
      const stored = readStoredIdentity();
      if (stored) {
        update(stored); // another tab renamed (or added an id): follow it
      } else {
        // Cleared, removed or garbage. Put our identity back instead of making a new one, so this
        // browser stays one person with one name in every tab.
        saveIdentity(current.current);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [update]);

  // Merge the new name into what is saved NOW, not into this tab's copy: another tab may have
  // changed the identity a moment ago and this tab may not have seen the event yet.
  const rename = useCallback(
    (name: string) => {
      const next = { ...(readStoredIdentity() ?? current.current), name: cleanName(name) };
      saveIdentity(next);
      update(next);
    },
    [update],
  );

  return [identity, rename];
}
