import { useCallback, useEffect, useState } from 'react';
import { cleanName, IDENTITY_STORAGE_KEY, loadIdentity, saveIdentity, type Identity } from '../lib/identity';

// Your identity, saved in localStorage and shared by all your tabs. A rename in one tab reaches the
// others through the browser's `storage` event, which fires in every OTHER tab of the same site
// when localStorage changes (never in the tab that made the change).
export function useIdentity(): [Identity, (name: string) => void] {
  const [identity, setIdentity] = useState<Identity>(loadIdentity);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // key null = storage was cleared; loadIdentity then makes (and saves) a fresh identity.
      if (e.key === IDENTITY_STORAGE_KEY || e.key === null) setIdentity(loadIdentity());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const rename = useCallback(
    (name: string) => {
      const next = { ...identity, name: cleanName(name) };
      setIdentity(next);
      saveIdentity(next);
    },
    [identity],
  );

  return [identity, rename];
}
