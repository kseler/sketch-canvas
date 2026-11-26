import { Image as ImageIcon, Link2, LoaderCircle, Plus, Sparkles, Spline } from 'lucide-react';
import { useEffect, useState } from 'react';
import { goToNewRoom } from '../hooks/useRoomName';
import { initials } from '../lib/identity';
import type { Person } from '../lib/people';
import { NameEditor } from './NameEditor';
import { Button } from './ui/Button';
import { Menu } from './ui/Menu';
import styles from './TopBar.module.css';

const MAX_AVATARS = 3;

export type ResultButtonState = {
  // Shown while a job runs, or once the room has a picture or a result this tab saw.
  shown: boolean;
  busy: boolean;
  // A picture or an error arrived that this tab hasn't looked at yet.
  unseen: boolean;
  onOpen: () => void;
};

type Props = {
  roomName: string;
  people: Person[];
  onRename: (name: string) => void;
  onGenerate: () => void;
  canGenerate: boolean;
  result: ResultButtonState;
};

// The bar across the top: the app, the room and who's in it, sharing, and Generate.
export function TopBar({ roomName, people, onRename, onGenerate, canGenerate, result }: Props) {
  const me = people.find((p) => p.isMe);
  return (
    <header className={styles.bar}>
      <div className={styles.group}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <Spline size={22} />
          </span>
          <span className={`${styles.brandName} ${styles.wideOnly}`}>Sketch Canvas</span>
        </div>
        <div className={styles.divider} aria-hidden="true" />
        <div className={styles.room}>
          <span className={styles.roomName} title="Room id: share the link to invite people">
            {roomName}
          </span>
          <span className={styles.online}>
            <span className={styles.onlineDot} aria-hidden="true" />
            {people.length} online
          </span>
        </div>
        <Button onClick={goToNewRoom} aria-label="Create room" title="Create room" className={styles.compact}>
          <Plus size={18} /> <span className={styles.wideOnly}>Create room</span>
        </Button>
        <CopyLinkButton />
      </div>

      <div className={styles.group}>
        <Avatars people={people} />
        <div className={styles.divider} aria-hidden="true" />
        {result.shown && <ResultButton {...result} />}
        <Button variant="primary" onClick={onGenerate} disabled={!canGenerate} aria-label="Generate" title="Generate" className={styles.iconOnNarrow}>
          <Sparkles size={18} /> <span className={styles.label}>Generate</span>
        </Button>
        <Menu label="More">
          <div className={styles.menuRow}>
            <span className={styles.menuLabel}>Your name</span>
            {me ? <NameEditor name={me.name} onRename={onRename} /> : <span className={styles.faint}>Connecting...</span>}
          </div>
          <div className={styles.menuRow}>
            <span className={styles.menuLabel}>Room</span>
            <code>{roomName}</code>
          </div>
        </Menu>
      </div>
    </header>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

function CopyLinkButton() {
  const [copy, setCopy] = useState<CopyState>('idle');

  // Back to "Copy link" after a moment.
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

  const label = { idle: 'Copy link', copied: 'Copied!', failed: 'Copy it from the address bar' }[copy];
  return (
    <Button onClick={() => void copyLink()} aria-live="polite" aria-label={label} title={label} className={styles.compact}>
      <Link2 size={18} /> <span className={copy === 'idle' ? styles.wideOnly : undefined}>{label}</span>
    </Button>
  );
}

// A stack of avatars, overflow shown as +N. Counts people, not tabs.
function Avatars({ people }: { people: Person[] }) {
  const shown = people.slice(0, MAX_AVATARS);
  const hidden = people.length - shown.length;
  return (
    <div className={styles.avatars}>
      {shown.map((person) => {
        const title = `${person.name}${person.isMe ? ' (you)' : ''}${person.tabs > 1 ? ` · ${person.tabs} tabs` : ''}`;
        return (
          <span key={person.personId} className={styles.avatar} style={{ background: person.color }} title={title}>
            {initials(person.name)}
            {person.isMe && <span className={styles.meDot} aria-label="you" />}
          </span>
        );
      })}
      {hidden > 0 && (
        <span className={`${styles.avatar} ${styles.more}`} title={`${hidden} more`}>
          +{hidden}
        </span>
      )}
    </div>
  );
}

function ResultButton({ busy, unseen, onOpen }: ResultButtonState) {
  const label = busy ? 'Generating...' : 'Result';
  return (
    <Button
      onClick={onOpen}
      aria-label={unseen ? `${label} (new)` : label}
      title={label}
      className={`${styles.resultButton} ${styles.iconOnNarrow}`}
    >
      {busy ? <LoaderCircle size={18} className={styles.spin} /> : <ImageIcon size={18} />}
      <span className={styles.label}>{label}</span>
      {unseen && <span className={styles.unseen} aria-hidden="true" />}
    </Button>
  );
}
