import { useEffect, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { PicturePanel } from './components/PicturePanel';
import { Presence } from './components/Presence';
import { RoomControls } from './components/RoomControls';
import { Toolbar } from './components/Toolbar';
import { useIdentity } from './hooks/useIdentity';
import { useJob } from './hooks/useJob';
import { useNote } from './hooks/useNote';
import { useRoomName } from './hooks/useRoomName';
import { exportSketch } from './lib/exportSketch';
import { requestGenerate } from './lib/generateClient';
import { readStrokes } from './lib/strokes';
import { COLORS, ERASER_SCALE, type Size } from './lib/tools';
import { joinRoom, type Room } from './sync/room';
import type { Tool } from './types';
import { isActive, jobText } from './lib/jobs';

export function App() {
  const roomName = useRoomName();
  const [joined, setJoined] = useState<Room | null>(null);
  // Right after a room switch, `joined` still holds the old room for one render; ignore it.
  const room = joined?.name === roomName ? joined : null;
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]!);
  const [size, setSize] = useState<Size>(4);
  const [identity, rename] = useIdentity();
  const width = tool === 'eraser' ? size * ERASER_SCALE : size;

  // Join the room in the URL. When it changes, the cleanup leaves the old room first
  // (disconnects and removes us from its awareness), then the new one is joined.
  useEffect(() => {
    const r = joinRoom(roomName);
    // The room is a connection this effect opens and closes; the state only hands it to render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an external resource made here
    setJoined(r);
    return () => r.destroy();
  }, [roomName]);

  // Announce who we are to everyone in the room (awareness), and again after a rename here or in
  // another of your tabs.
  useEffect(() => {
    room?.awareness.setLocalStateField('user', identity);
  }, [room, identity]);

  // Clear wipes the drawing for everyone in the room and can't be undone yet, so ask first.
  const clearCanvas = () => {
    if (!room || room.strokes.length === 0) return;
    if (window.confirm('Clear the canvas for everyone in this room? This cannot be undone.')) {
      room.strokes.delete(0, room.strokes.length);
    }
  };

  // One request at a time, so a double click can't send (and later pay for) a sketch twice. The ref
  // blocks a second click at once; the state only greys out the button on the next render.
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  // The room's generation, shared by everyone in the room: while it runs, Generate is off for all
  // of them (the server's room lock is the real gate; this just says so before anyone clicks).
  // `seen`: jobs this tab saw running (capped at SEEN_JOBS_MAX).
  const jobView = useJob(room?.job);
  const { job, seen } = jobView;
  const generating = isActive(job);
  // The job this tab started itself, kept apart from `seen` so a peer flashing fake job ids can't
  // push it out. Tied to this join of the room (the room object), like `seen`.
  const [mine, setMine] = useState<{ room: Room; id: string } | null>(null);
  const seenOrMine = { has: (id: string) => (mine?.room === room && mine.id === id) || seen.has(id) };

  // This tab's own message; it steps aside once the room or the job changes (hooks/useNote.ts).
  const { note: status, writeNote } = useNote(room, jobView);

  // Export the room's sketch and send it to the server. A canvas with no ink (empty, or only eraser
  // strokes on blank paper) is not sent: once the pipeline is built, every request costs money.
  const generate = async () => {
    if (!room || sendingRef.current || generating) return;
    const forRoom = room;
    const show = (text: string) => writeNote(forRoom, text);
    const strokes = readStrokes(room.strokes);
    if (!strokes.some((s) => s.tool !== 'eraser')) {
      show('Draw something first.');
      return;
    }
    sendingRef.current = true;
    setSending(true);
    show('Sending the sketch...');
    try {
      const result = await requestGenerate(forRoom.name, await exportSketch(strokes));
      if (result.ok) setMine({ room: forRoom, id: result.jobId });
      // Once the job has started, the shared job status takes over the status bar.
      show(result.ok ? '' : result.error);
    } catch (err) {
      console.error('Exporting the sketch failed:', err);
      show('Could not export the sketch.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
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
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Sketch Canvas</h1>
        {room && <Presence key={room.name} awareness={room.awareness} onRename={rename} />}
      </header>
      <RoomControls roomName={roomName} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <Toolbar tool={tool} color={color} size={size} onTool={setTool} onColor={setColor} onSize={setSize} />
        <button onClick={clearCanvas}>Clear</button>
        <button onClick={() => void generate()} disabled={sending || generating}>
          Generate
        </button>
        <span>{status || jobText(job, seenOrMine)}</span>
      </div>
      {room ? (
        // The canvas takes the remaining space; the picture panel sits beside it (sketch stays visible).
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
          {/* key: a fresh canvas per room, so nothing half-drawn carries over. */}
          <Canvas key={room.name} strokes={room.strokes} awareness={room.awareness} tool={tool} color={color} width={width} />
          <PicturePanel key={`${room.name}-picture`} images={room.images} busy={generating} />
        </div>
      ) : (
        <p>Connecting...</p>
      )}
    </main>
  );
}
