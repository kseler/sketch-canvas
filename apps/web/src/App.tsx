import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './App.module.css';
import { Canvas } from './components/Canvas';
import { ResultPanel } from './components/ResultPanel';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { useHasPicture } from './hooks/useHasPicture';
import { useIdentity } from './hooks/useIdentity';
import { useJob } from './hooks/useJob';
import { useNote } from './hooks/useNote';
import { usePeople } from './hooks/usePeople';
import { useRoomName } from './hooks/useRoomName';
import { exportSketch } from './lib/exportSketch';
import { requestGenerate } from './lib/generateClient';
import { isActive, jobText } from './lib/jobs';
import { resultButton, viewedAfterLooking } from './lib/resultButton';
import { readStrokes } from './lib/strokes';
import { COLORS, ERASER_SCALE, type Size } from './lib/tools';
import { joinRoom, type Room } from './sync/room';
import type { Tool } from './types';

export function App() {
  const roomName = useRoomName();
  const [joined, setJoined] = useState<Room | null>(null);
  // Right after a room switch, `joined` still holds the old room for one render; ignore it.
  const room = joined?.name === roomName ? joined : null;
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]!);
  const [size, setSize] = useState<Size>(4);
  const [identity, rename] = useIdentity();
  const people = usePeople(room?.awareness ?? null);
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
  const { note, writeNote } = useNote(room, jobView);

  // The result panel. Open for one room at a time (switching rooms closes it), and the last ended
  // job seen in it, for the Result button's dot.
  const [panelFor, setPanelFor] = useState<Room | null>(null);
  const [viewed, setViewed] = useState<{ room: Room; job: string | null } | null>(null);
  const panelOpen = room !== null && panelFor === room;
  const hasPicture = useHasPicture(room?.images);
  const viewedJob = viewed?.room === room ? viewed.job : null;
  const result = resultButton({
    job,
    seen: seenOrMine,
    hasPicture,
    panelOpen,
    viewedJob,
  });
  const lookedAt = viewedAfterLooking(job, viewedJob);
  const openPanel = () => {
    if (!room) return;
    setPanelFor(room);
    setViewed({ room, job: lookedAt });
  };
  const closePanel = useCallback(() => {
    setPanelFor(null);
    if (room) setViewed({ room, job: lookedAt });
  }, [room, lookedAt]);

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
      // Null when everything drawn was erased again: nothing to send, and nothing to pay for.
      const sketch = await exportSketch(strokes);
      if (!sketch) {
        show('Draw something first.');
        return;
      }
      const reply = await requestGenerate(forRoom.name, sketch);
      if (reply.ok) {
        setMine({ room: forRoom, id: reply.jobId });
        // Whoever clicked Generate watches it happen; everyone else gets the Result button's dot.
        setPanelFor(forRoom);
      }
      // Once the job has started, the shared job status takes over.
      show(reply.ok ? '' : reply.error);
    } catch (err) {
      console.error('Exporting the sketch failed:', err);
      show('Could not export the sketch.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const canGenerate = room !== null && !sending && !generating;
  const shownJob = job && seenOrMine.has(job.id) ? job : null;

  return (
    <div className={styles.app}>
      <TopBar
        roomName={roomName}
        people={people}
        onRename={rename}
        onGenerate={() => void generate()}
        canGenerate={canGenerate}
        result={{ ...result, onOpen: openPanel }}
      />
      <main className={styles.stage}>
        {room ? (
          <>
            {/* Slides aside when the result panel opens (moved, not resized, so the drawing keeps
                its scale) and sits under an overlay that blocks drawing until the panel closes. */}
            <div className={styles.workspace} data-shifted={panelOpen} inert={panelOpen}>
              {/* key: a fresh canvas per room, so nothing half-drawn carries over. */}
              <Canvas key={room.name} strokes={room.strokes} awareness={room.awareness} tool={tool} color={color} width={width} />
              <div className={styles.dock}>
                {/* Always there, so screen readers announce the text when it appears; hidden when empty. */}
                <p className={styles.toast} role="status">
                  {panelOpen ? '' : note}
                </p>
                <Toolbar
                  tool={tool}
                  color={color}
                  size={size}
                  onTool={setTool}
                  onColor={setColor}
                  onSize={setSize}
                  onClear={clearCanvas}
                />
              </div>
            </div>
            {panelOpen && <div className={styles.overlay} onClick={closePanel} aria-hidden="true" />}
            <ResultPanel
              key={`${room.name}-result`}
              open={panelOpen}
              images={room.images}
              busy={generating}
              status={note || jobText(job, seenOrMine)}
              failed={!note && shownJob?.status === 'failed'}
              canRegenerate={canGenerate}
              onRegenerate={() => void generate()}
              onClose={closePanel}
            />
          </>
        ) : (
          <p className={styles.connecting}>Connecting...</p>
        )}
      </main>
    </div>
  );
}
