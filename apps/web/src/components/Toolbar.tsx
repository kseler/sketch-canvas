import {
  Eraser,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useFullscreen } from '../hooks/useFullscreen';
import { COLOR_NAMES, COLORS, SIZES, stepSize, type Size } from '../lib/tools';
import type { Tool } from '../types';
import { IconButton, SOON } from './ui/Button';
import styles from './Toolbar.module.css';

type Props = {
  tool: Tool;
  color: string;
  size: Size;
  onTool: (tool: Tool) => void;
  onColor: (color: string) => void;
  onSize: (size: Size) => void;
  onClear: () => void;
};

const ICON = 20;

// The floating bar under the canvas. Select, text, rectangle, arrow, more colors, undo and redo are
// in the design but not built yet: shown, disabled, and left out on narrow windows.
export function Toolbar({ tool, color, size, onTool, onColor, onSize, onClear }: Props) {
  const fullscreen = useFullscreen();
  // Picking a color means you want to draw, so it switches back to the pen.
  const pickColor = (c: string) => {
    onColor(c);
    onTool('pen');
  };

  return (
    <div className={styles.bar} role="toolbar" aria-label="Drawing tools">
      <div className={styles.group}>
        <IconButton label={`Select (${SOON.toLowerCase()})`} disabled className={styles.placeholder}>
          <MousePointer2 size={ICON} />
        </IconButton>
        <IconButton label="Pen" aria-pressed={tool === 'pen'} onClick={() => onTool('pen')}>
          <Pencil size={ICON} />
        </IconButton>
        <IconButton label="Eraser" aria-pressed={tool === 'eraser'} onClick={() => onTool('eraser')}>
          <Eraser size={ICON} />
        </IconButton>
        <IconButton label={`Text (${SOON.toLowerCase()})`} disabled className={styles.placeholder}>
          <Type size={ICON} />
        </IconButton>
        <IconButton label={`Rectangle (${SOON.toLowerCase()})`} disabled className={styles.placeholder}>
          <Square size={ICON} />
        </IconButton>
        <IconButton label={`Arrow (${SOON.toLowerCase()})`} disabled className={styles.placeholder}>
          <MoveUpRight size={ICON} />
        </IconButton>
      </div>

      <div className={styles.separator} aria-hidden="true" />

      <div className={styles.stepper} role="group" aria-label="Line size">
        <IconButton label="Thinner" onClick={() => onSize(stepSize(size, -1))} disabled={size === SIZES[0]}>
          <Minus size={18} />
        </IconButton>
        <output className={styles.size} aria-live="polite" aria-label={`Size ${size}`}>
          {size}
        </output>
        <IconButton label="Thicker" onClick={() => onSize(stepSize(size, 1))} disabled={size === SIZES[SIZES.length - 1]}>
          <Plus size={18} />
        </IconButton>
      </div>

      <div className={styles.separator} aria-hidden="true" />

      <div className={styles.group} role="group" aria-label="Colors">
        {COLORS.map((c) => {
          const selected = tool === 'pen' && c === color;
          return (
            <button
              key={c}
              type="button"
              className={styles.swatch}
              style={{ background: c }}
              aria-label={COLOR_NAMES[c] ?? c}
              title={COLOR_NAMES[c] ?? c}
              aria-pressed={selected}
              onClick={() => pickColor(c)}
            />
          );
        })}
        <IconButton label={`More colors (${SOON.toLowerCase()})`} disabled className={styles.placeholder}>
          <MoreHorizontal size={ICON} />
        </IconButton>
      </div>

      <div className={`${styles.separator} ${styles.placeholder}`} aria-hidden="true" />

      <div className={`${styles.group} ${styles.placeholder}`}>
        <IconButton label={`Undo (${SOON.toLowerCase()})`} disabled>
          <Undo2 size={ICON} />
        </IconButton>
        <IconButton label={`Redo (${SOON.toLowerCase()})`} disabled>
          <Redo2 size={ICON} />
        </IconButton>
      </div>

      <div className={styles.separator} aria-hidden="true" />

      <div className={styles.group}>
        <IconButton label="Clear the canvas" onClick={onClear}>
          <Trash2 size={ICON} />
        </IconButton>
      </div>

      <div className={styles.separator} aria-hidden="true" />

      <IconButton
        label={fullscreen.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        onClick={fullscreen.toggle}
        disabled={!fullscreen.supported}
      >
        {fullscreen.fullscreen ? <Minimize size={ICON} /> : <Maximize size={ICON} />}
      </IconButton>
    </div>
  );
}
