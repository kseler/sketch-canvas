import { useEffect, useState } from 'react';
import { goToNewRoom } from '../hooks/useRoomName';

type CopyState = 'idle' | 'copied' | 'failed';

// Room id, plus buttons to share it and to start a fresh room.
export function RoomControls({ roomName }: { roomName: string }) {
  const [copy, setCopy] = useState<CopyState>('idle');

  // Reset the "Copied!" label after a moment.
  useEffect(() => {
    if (copy === 'idle') return;
    const t = setTimeout(() => setCopy('idle'), 2000);
    return () => clearTimeout(t);
  }, [copy]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopy('copied');
    } catch {
      setCopy('failed'); // clipboard blocked: the address bar still has the link
    }
  };

  const label = { idle: 'Copy link', copied: 'Copied!', failed: 'Copy the URL from the address bar' }[copy];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0 16px' }}>
      <span style={{ color: '#555' }}>
        Room: <code>{roomName}</code>
      </span>
      <button onClick={copyLink} aria-live="polite">
        {label}
      </button>
      <button onClick={goToNewRoom}>New room</button>
    </div>
  );
}
