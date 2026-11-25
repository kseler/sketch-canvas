import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobView } from './useJob';

type Note<R> = { text: string; room: R; view: JobView };

// This tab's own message in the status bar ("Draw something first.", "Sending the sketch...", an
// error from the request). It belongs to one join of a room (the room object) and to the job as it
// was when the message was written. Once either changes (a room switch, a job starting or ending, a
// server restart clearing the job), it steps aside for the shared job status and never comes back.
// Derived from state, so no effect has to clear it.
export function useNote<R extends object>(room: R | null, jobView: JobView): { note: string; writeNote: (forRoom: R, text: string) => void } {
  const [note, setNote] = useState<Note<R> | null>(null);
  // The job as it is now, for a message written after an await (e.g. when the request fails while
  // another tab's job ended): the click-time view would hide it at once.
  const latest = useRef(jobView);
  useEffect(() => {
    latest.current = jobView;
  }, [jobView]);

  const writeNote = useCallback((forRoom: R, text: string) => setNote({ text, room: forRoom, view: latest.current }), []);
  const shown = note !== null && note.room === room && note.view === jobView ? note.text : '';
  return { note: shown, writeNote };
}
