// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DotGrid } from './DotGrid';

afterEach(cleanup);

const delays = () => Array.from(document.querySelectorAll<HTMLElement>('[data-dot]')).map((d) => d.style.animationDelay);

describe('DotGrid', () => {
  it('is announced as a status with a label, so screen readers know a picture is being made', () => {
    render(<DotGrid />);
    expect(screen.getByRole('status', { name: 'Generating the picture' })).toBeTruthy();
  });

  it('draws a 16 x 12 grid of dots', () => {
    render(<DotGrid />);
    expect(document.querySelectorAll('[data-dot]')).toHaveLength(16 * 12);
  });

  it('gives every render the same delays, so tabs and re-renders never flicker', () => {
    const first = render(<DotGrid />);
    const before = delays();
    first.unmount();
    render(<DotGrid />);
    expect(delays()).toEqual(before);
  });

  it('spreads the delays out (a wave, not all dots in step), all of them zero or negative', () => {
    render(<DotGrid />);
    const values = delays().map(parseFloat);
    expect(new Set(values).size).toBeGreaterThan(10);
    expect(values.every((v) => v <= 0)).toBe(true); // negative: the animation is already under way at mount
  });
});
