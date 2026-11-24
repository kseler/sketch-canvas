import { describe, expect, it } from 'vitest';
import type { Stroke } from '../types';
import { strokeLineConfig } from './strokeStyle';

const pen: Stroke = { id: 'a', tool: 'pen', color: '#ff0000', width: 4, points: [0, 0, 5, 5] };

describe('strokeLineConfig', () => {
  it('draws a pen stroke in its colour on top of what is there', () => {
    const config = strokeLineConfig(pen);
    expect(config.stroke).toBe('#ff0000');
    expect(config.globalCompositeOperation).toBe('source-over');
    expect(config.strokeWidth).toBe(4);
    expect(config.points).toEqual([0, 0, 5, 5]);
  });

  it('treats a stroke without a tool as a pen (older data)', () => {
    const { tool: _tool, ...old } = pen;
    expect(strokeLineConfig(old).globalCompositeOperation).toBe('source-over');
    expect(strokeLineConfig(old).stroke).toBe('#ff0000');
  });

  it('makes an eraser stroke cut a hole, ignoring its stored colour', () => {
    const config = strokeLineConfig({ ...pen, tool: 'eraser', color: '#00ff00' });
    expect(config.globalCompositeOperation).toBe('destination-out');
    expect(config.stroke).toBe('#000');
    expect(config.strokeWidth).toBe(4);
  });
});
