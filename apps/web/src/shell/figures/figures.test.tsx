// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Donut, Meter, Spark, useLit } from './figures';

afterEach(cleanup);

const SLICES = [
  { key: 'a', colour: 'var(--nv-series-1)', value: 30 },
  { key: 'b', colour: 'var(--nv-series-2)', value: 0 },
  { key: 'c', colour: 'var(--nv-series-3)', value: 10 },
];

describe('Donut', () => {
  it('draws one arc per slice that counts, in the design system’s classes, and says its label', () => {
    render(
      <Donut label="Ventes : A 75 %, C 25 %" slices={SLICES}>
        <b className="nv-donut__value">40 €</b>
      </Donut>,
    );
    const ring = screen.getByRole('img', { name: 'Ventes : A 75 %, C 25 %' });
    expect(ring.className).toBe('nv-donut');
    const arcs = [...ring.querySelectorAll<SVGCircleElement>('.nv-donut__arc')];
    expect(arcs).toHaveLength(2);
    expect(arcs[0]?.style.getPropertyValue('--_c')).toBe('var(--nv-series-1)');
    // The second arc starts where the first one ends: three quarters of the way round.
    expect(Number(arcs[1]?.getAttribute('stroke-dashoffset'))).toBeCloseTo(-(2 * Math.PI * 52 * 0.75), 1);
    expect(ring.querySelector('.nv-donut__middle')?.textContent).toBe('40 €');
  });

  it('lights the slice asked and tells which arc the pointer enters', () => {
    const seen: (number | null)[] = [];
    render(<Donut label="x" slices={SLICES} lit={2} onLit={(index) => seen.push(index)} />);
    const ring = screen.getByRole('img');
    expect(ring.className).toBe('nv-donut is-lit');
    const arcs = [...ring.querySelectorAll('.nv-donut__arc')];
    expect(arcs.map((arc) => arc.getAttribute('class'))).toEqual(['nv-donut__arc', 'nv-donut__arc is-on']);
    const [first] = arcs;
    if (first === undefined) throw new Error('no arc');
    fireEvent.pointerEnter(first);
    fireEvent.pointerLeave(first, { pointerType: 'mouse' });
    expect(seen).toEqual([0, null]);
  });

  it('draws one share alone against the whole, with a round end and no gap', () => {
    render(<Donut label="25 %" slices={[{ key: 'p', colour: 'var(--nv-sale)', value: 25 }]} of={100} />);
    const ring = screen.getByRole('img');
    expect(ring.className).toBe('nv-donut nv-donut--solo');
    const dash = ring.querySelector<SVGCircleElement>('.nv-donut__arc')?.style.getPropertyValue('--_dash');
    expect(Number(dash?.split(' ')[0])).toBeCloseTo((2 * Math.PI * 52) / 4, 1);
  });
});

function Rows(): JSX.Element {
  const { lit, row } = useLit();
  return (
    <>
      <output>{lit === null ? 'none' : String(lit)}</output>
      <button type="button" {...row(0)}>
        zero
      </button>
      <button type="button" {...row(1)}>
        one
      </button>
    </>
  );
}

describe('useLit', () => {
  it('lights under the mouse, on a tap and on keyboard focus, and a second tap puts out', () => {
    render(<Rows />);
    const lit = (): string | null => screen.getByRole('status').textContent;
    const one = screen.getByRole('button', { name: 'one' });
    fireEvent.pointerEnter(one, { pointerType: 'mouse' });
    expect(lit()).toBe('1');
    fireEvent.pointerLeave(one, { pointerType: 'mouse' });
    expect(lit()).toBe('none');
    // A finger: entering lights nothing, the click does; the same row tapped again puts out.
    fireEvent.pointerEnter(one, { pointerType: 'touch' });
    fireEvent.pointerDown(one, { pointerType: 'touch' });
    expect(lit()).toBe('none');
    fireEvent.click(one);
    expect(lit()).toBe('1');
    fireEvent.pointerDown(one, { pointerType: 'touch' });
    fireEvent.click(one);
    expect(lit()).toBe('none');
    // The keyboard: focus lights, leaving puts out.
    act(() => {
      screen.getByRole('button', { name: 'zero' }).focus();
    });
    expect(lit()).toBe('0');
    act(() => {
      screen.getByRole('button', { name: 'zero' }).blur();
    });
    expect(lit()).toBe('none');
  });
});

describe('Meter and Spark', () => {
  it('fills the meter to its share, never past its track, and says it when it has a label', () => {
    render(<Meter percent={140} label="140 % de l’objectif" colour="var(--nv-heat)" />);
    const meter = screen.getByRole('img', { name: '140 % de l’objectif' });
    expect(meter.className).toBe('nv-meter');
    const fill = meter.querySelector('span');
    expect(fill?.style.getPropertyValue('--_w')).toBe('100%');
    expect(fill?.style.getPropertyValue('--_c')).toBe('var(--nv-heat)');
  });

  it('hides a meter with no label and a spark from assistive technologies', () => {
    const { container } = render(
      <>
        <Meter percent={40} />
        <Spark values={[1, 3, 2]} tone="down" />
      </>,
    );
    expect(container.querySelector('.nv-meter')?.getAttribute('aria-hidden')).toBe('true');
    const spark = container.querySelector('svg');
    expect(spark?.getAttribute('class')).toBe('nv-spark nv-spark--down');
    expect(spark?.getAttribute('aria-hidden')).toBe('true');
    expect(spark?.querySelector('.nv-spark__line')?.getAttribute('d')).toMatch(/^M0,/u);
  });
});
