import { useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { COLORS, ERASER_SCALE, type Size } from './lib/tools';
import { joinRoom, type Room } from './sync/room';
import type { Tool } from './types';

// The room name lives in the URL hash, so sharing the URL puts friends on the same canvas.
function getRoomName(): string {
  if (!location.hash) location.hash = Math.random().toString(36).slice(2, 8);
  return location.hash.slice(1);
}

export function App() {
  const [roomName] = useState(getRoomName);
  const [room, setRoom] = useState<Room | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]!);
  const [size, setSize] = useState<Size>(4);
  const [status, setStatus] = useState('');
  const width = tool === 'eraser' ? size * ERASER_SCALE : size;

  useEffect(() => {
    const r = joinRoom(roomName);
    setRoom(r);
    return () => r.destroy();
  }, [roomName]);

  const generate = async () => {
    setStatus('Generating...');
    const res = await fetch('/api/generate', { method: 'POST' });
    const body = (await res.json()) as { status: string };
    setStatus(body.status);
  };

  return (
    // Full-height column: header and toolbar take what they need, the canvas gets the rest.
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        height: '100dvh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h1 style={{ margin: '0 0 8px' }}>Sketch Canvas</h1>
      <p style={{ margin: '0 0 16px', color: '#555' }}>Room: {roomName}. Share this URL to draw together.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <Toolbar tool={tool} color={color} size={size} onTool={setTool} onColor={setColor} onSize={setSize} />
        <button onClick={() => room?.strokes.delete(0, room.strokes.length)}>Clear</button>
        <button onClick={generate}>Generate</button>
        <span>{status}</span>
      </div>
      {room ? <Canvas strokes={room.strokes} tool={tool} color={color} width={width} /> : <p>Connecting...</p>}
    </main>
  );
}
