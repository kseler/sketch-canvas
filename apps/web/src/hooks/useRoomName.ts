import { useEffect, useState } from 'react';
import { isValidRoomId, newRoomId } from '../lib/roomId';

// The room lives in the URL hash (#abc123), so sharing the URL shares the room.
// Follows hash changes (New room, Back/Forward, editing the URL) so the app can switch rooms.
export function useRoomName(): string {
  const [roomName, setRoomName] = useState(readRoomFromHash);

  useEffect(() => {
    const onHashChange = () => setRoomName(readRoomFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return roomName;
}

export function goToNewRoom(): void {
  location.hash = newRoomId(); // fires hashchange; Back returns to the previous room
}

// Also used as a useState initializer, where side effects are normally avoided. Fixing the URL here
// is safe: running it twice (React StrictMode does) reads the already-fixed hash the second time.
function readRoomFromHash(): string {
  const raw = location.hash.slice(1);
  const fromUrl = raw.toLowerCase();
  const room = isValidRoomId(fromUrl) ? fromUrl : newRoomId();
  if (room !== raw) history.replaceState(null, '', `#${room}`); // fix the URL without adding a Back step
  return room;
}
