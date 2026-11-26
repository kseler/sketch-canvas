import { Download } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { latestImage, type ImageRecord } from '../lib/images';
import { DotGrid } from './DotGrid';
import buttonStyles from './ui/Button.module.css';
import styles from './PicturePanel.module.css';

// The room's latest generated picture. Everyone in the room sees the same picture: it comes from
// the shared document, not from the reply to whoever clicked Generate. While the room's job runs
// (`busy`, also from the shared document), the dot-grid loading picture takes its place.
// `actions` go before Download (the result panel puts Regenerate there).
export function PicturePanel({ images, busy, actions }: { images: Y.Array<unknown>; busy: boolean; actions?: ReactNode }) {
  // Pictures that failed to load (e.g. the file was removed): skipped, so an older one shows.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [latest, setLatest] = useState<ImageRecord | null>(() => latestImage(images));

  useEffect(() => {
    const sync = () => setLatest(latestImage(images, broken));
    images.observe(sync);
    sync();
    return () => images.unobserve(sync);
  }, [images, broken]);

  return (
    <div className={styles.panel}>
      <div className={styles.frame}>
        {busy ? (
          <DotGrid />
        ) : latest ? (
          <img
            key={latest.id}
            src={latest.url}
            alt="The picture generated from the sketch"
            onError={() => setBroken((prev) => new Set(prev).add(latest.id))}
            className={styles.picture}
            style={{ aspectRatio: `${latest.w} / ${latest.h}` }}
          />
        ) : (
          <p className={styles.empty}>The picture appears here after Generate.</p>
        )}
      </div>
      <div className={styles.actions}>
        {actions}
        {latest && !busy && (
          <a href={latest.url} download={`sketch-${latest.id.slice(0, 8)}.png`} className={buttonStyles.button}>
            <Download size={18} aria-hidden="true" />
            Download
          </a>
        )}
      </div>
    </div>
  );
}
