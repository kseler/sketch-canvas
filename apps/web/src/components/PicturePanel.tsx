import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { latestImage, type ImageRecord } from '../lib/images';
import { DotGrid } from './DotGrid';

// The room's latest generated picture, next to the canvas, so the sketch stays visible and
// drawable. Everyone in the room sees the same picture: it comes from the shared document, not
// from the reply to whoever clicked Generate. While the room's job runs (`busy`, also from the
// shared document), everyone sees the dot-grid loading picture in its place.
export function PicturePanel({ images, busy }: { images: Y.Array<unknown>; busy: boolean }) {
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
    <aside style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {busy ? (
        <DotGrid />
      ) : latest ? (
        <img
          key={latest.id}
          src={latest.url}
          alt="The picture generated from the sketch"
          onError={() => setBroken((prev) => new Set(prev).add(latest.id))}
          style={{
            width: '100%',
            aspectRatio: `${latest.w} / ${latest.h}`,
            objectFit: 'contain',
            border: '1px solid #ccc',
            background: '#fff',
          }}
        />
      ) : (
        <p style={{ margin: 0, color: '#666' }}>The picture appears here after Generate.</p>
      )}
      {latest && !busy && (
        <a href={latest.url} download={`sketch-${latest.id.slice(0, 8)}.png`}>
          Download
        </a>
      )}
    </aside>
  );
}
