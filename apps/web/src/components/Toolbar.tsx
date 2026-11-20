import { COLORS, SIZES, type Size } from '../lib/tools';
import type { Tool } from '../types';

type Props = {
  tool: Tool;
  color: string;
  size: Size;
  onTool: (tool: Tool) => void;
  onColor: (color: string) => void;
  onSize: (size: Size) => void;
};

const selected = (on: boolean) => (on ? '3px solid #000' : '1px solid #999');

export function Toolbar({ tool, color, size, onTool, onColor, onSize }: Props) {
  // Picking a color means you want to draw, so it switches back to the pen.
  const pickColor = (c: string) => {
    onColor(c);
    onTool('pen');
  };

  return (
    <>
      {(['pen', 'eraser'] as const).map((t) => (
        <button key={t} onClick={() => onTool(t)} aria-pressed={tool === t} style={{ border: selected(tool === t) }}>
          {t === 'pen' ? 'Pen' : 'Eraser'}
        </button>
      ))}
      {COLORS.map((c) => (
        <button
          key={c}
          onClick={() => pickColor(c)}
          aria-label={`Color ${c}`}
          style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: selected(tool === 'pen' && c === color) }}
        />
      ))}
      {SIZES.map((s) => (
        <button key={s} onClick={() => onSize(s)} aria-label={`Size ${s}`} aria-pressed={s === size} style={{ width: 28, height: 28, border: selected(s === size) }}>
          <span style={{ display: 'inline-block', width: s + 2, height: s + 2, borderRadius: '50%', background: '#111' }} />
        </button>
      ))}
    </>
  );
}
