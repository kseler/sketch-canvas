import { Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import { cleanName, hasVisibleText, MAX_NAME_LENGTH } from '../lib/identity';
import styles from './NameEditor.module.css';

type Props = { name: string; onRename: (name: string) => void };

// Your own name: a button that turns into a text field. Enter or clicking away saves, Escape cancels.
export function NameEditor({ name, onRename }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  // Some browsers fire blur when the field disappears after Enter or Escape. This makes sure each
  // edit finishes exactly once, so Escape can't turn into a save.
  const finished = useRef(false);

  if (draft === null) {
    const edit = () => {
      finished.current = false;
      setDraft(name);
    };
    return (
      <button type="button" onClick={edit} title="Click to rename" className={styles.name}>
        <span className={styles.text}>{name}</span>
        <Pencil size={14} aria-hidden="true" />
      </button>
    );
  }

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save && hasVisibleText(cleanName(draft))) onRename(draft); // others would reject an invisible name
    setDraft(null);
  };

  return (
    <input
      className={styles.input}
      autoFocus
      onFocus={(e) => e.target.select()} // typing replaces the old name
      value={draft}
      maxLength={MAX_NAME_LENGTH}
      aria-label="Your name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}
