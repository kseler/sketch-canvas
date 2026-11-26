import { MoreHorizontal, RotateCw, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { PicturePanel } from './PicturePanel';
import { Button, IconButton, SOON } from './ui/Button';
import styles from './ResultPanel.module.css';

type Props = {
  open: boolean;
  images: Y.Array<unknown>;
  busy: boolean;
  // "Generating...", the error, or this tab's own message; empty once the picture is there.
  status: string;
  failed: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onClose: () => void;
};

// "Generated result": slides in from the right over the pushed-aside canvas (App.module.css).
export function ResultPanel({ open, images, busy, status, failed, canRegenerate, onRegenerate, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);

  // Escape closes it, like the overlay and the ✕, unless something on top (the "⋯" menu, the name
  // field) already used that Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keyboard focus: into the panel when it opens (the canvas behind it goes inert, which would drop
  // focus to the page), and back to where it was (Result or Generate) when it closes.
  // preventScroll: the panel is still off-screen when it starts sliding in, and a plain focus()
  // makes the browser scroll the stage sideways to show it: the canvas would jump.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    return () => before?.focus({ preventScroll: true });
  }, [open]);

  return (
    <aside className={styles.panel} data-open={open} inert={!open} aria-label="Generated result">
      <header className={styles.header}>
        <Sparkles size={26} className={styles.sparkle} aria-hidden="true" />
        <h2 className={styles.title}>Generated result</h2>
        <IconButton label={`More (${SOON.toLowerCase()})`} round disabled>
          <MoreHorizontal size={20} />
        </IconButton>
        <IconButton ref={closeButton} label="Close" round onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>

      {/* The status region is always there, so a new message is announced; an error is an alert,
          which is announced as it appears. */}
      <p className={styles.status} role="status">
        {failed ? '' : status}
      </p>
      {failed && status && (
        <p className={styles.error} role="alert">
          {status}
        </p>
      )}

      <PicturePanel
        images={images}
        busy={busy}
        actions={
          <Button onClick={onRegenerate} disabled={!canRegenerate}>
            <RotateCw size={18} aria-hidden="true" />
            {failed ? 'Try again' : 'Regenerate'}
          </Button>
        }
      />
    </aside>
  );
}
