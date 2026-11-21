// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Columns, Donut, Meter, Ring, Spark, useLit } from './figures';

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

describe('Donut on its own', () => {
  it('lights its own arcs under the pointer when the screen holds nothing, and a finger puts out what it lit', () => {
    render(<Donut label="x" slices={SLICES} />);
    const ring = screen.getByRole('img', { name: 'x' });
    const arcs = [...ring.querySelectorAll('.nv-donut__arc')];
    const [first, second] = arcs;
    if (first === undefined || second === undefined) throw new Error('no arcs');
    expect(ring.className).toBe('nv-donut');
    fireEvent.pointerEnter(first, { pointerType: 'mouse' });
    expect(ring.className).toBe('nv-donut is-lit');
    expect(first.getAttribute('class')).toBe('nv-donut__arc is-on');
    fireEvent.pointerLeave(first, { pointerType: 'mouse' });
    expect(ring.className).toBe('nv-donut');
    fireEvent.pointerEnter(second, { pointerType: 'touch' });
    expect(second.getAttribute('class')).toBe('nv-donut__arc is-on');
    fireEvent.pointerEnter(second, { pointerType: 'touch' });
    expect(ring.className).toBe('nv-donut');
  });
});

describe('Columns', () => {
  const columns = [
    {
      key: 'mon',
      label: 'lun.',
      says: 'Lundi : 30 €',
      parts: [
        { key: 'a', colour: 'var(--nv-series-1)', value: 20 },
        { key: 'b', colour: 'var(--nv-series-2)', value: 0 },
        { key: 'c', value: 10, hatched: true },
      ],
    },
    { key: 'tue', label: '', says: 'Mardi : 40 €', parts: [{ key: 'a', value: 40 }] },
    { key: 'wed', label: 'mer.', says: 'Mercredi : 0 €', parts: [] },
  ];
  const draw = (): HTMLElement => {
    render(
      <Columns
        label="Ventes jour par jour"
        columns={columns}
        top={40}
        ticks={[
          { value: 0, text: '0 €' },
          { value: 40, text: '40 €' },
        ]}
        mark={30}
      />,
    );
    return screen.getByRole('group', { name: 'Ventes jour par jour' });
  };

  it('stacks the parts that count on the plot’s scale, hatches the one of another nature and draws the mark', () => {
    const plot = draw();
    const first = screen.getByRole('button', { name: 'Lundi : 30 €' });
    const parts = [...first.querySelectorAll<HTMLElement>('.nv-col__part')];
    expect(parts.map((part) => part.className)).toEqual([
      'nv-col__part',
      'nv-col__part nv-col__part--hatched',
    ]);
    expect(parts.map((part) => part.style.getPropertyValue('--_h'))).toEqual(['50%', '25%']);
    expect(parts.map((part) => part.style.getPropertyValue('--_c'))).toEqual(['var(--nv-series-1)', '']);
    expect(plot.style.getPropertyValue('--_n')).toBe('3');
    const grid = plot.parentElement?.querySelector('.nv-cols__grid');
    expect(grid?.textContent).toBe('0 €40 €');
    expect(grid?.querySelector<HTMLElement>('.nv-cols__mark')?.style.getPropertyValue('--_y')).toBe('75%');
  });

  it('keeps one column in the tab order, the last at first, and moves with the arrows, Home and End', () => {
    const plot = draw();
    const order = (): string[] => screen.getAllByRole('button').map((one) => String(one.tabIndex));
    expect(order()).toEqual(['-1', '-1', '0']);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(order()).toEqual(['-1', '0', '-1']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mardi : 40 €' }));
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(order()).toEqual(['0', '-1', '-1']);
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(order()).toEqual(['0', '-1', '-1']);
    fireEvent.keyDown(plot, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mercredi : 0 €' }));
  });
});

describe('Meter with its objective, and Ring', () => {
  it('draws the objective as a mark on the same track, kept within it', () => {
    const { container } = render(<Meter percent={40} mark={130} label="4 jours sur 7" />);
    const mark = container.querySelector('.nv-meter__mark');
    expect(mark?.getAttribute('style')).toContain('--_m: 100%');
    expect(render(<Meter percent={40} />).container.querySelector('.nv-meter__mark')).toBeNull();
  });

  it('draws a ring to its share, says it to a screen reader, and draws no value at nothing', () => {
    const { container, getByRole } = render(
      <Ring share={0.5} label="4 jours d’avance" colour="var(--nv-series-2)">
        4 j
      </Ring>,
    );
    expect(getByRole('img', { name: '4 jours d’avance' })).toBeTruthy();
    const value = container.querySelector('.nv-ring__value');
    const [drawn, whole] = (value?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
    expect((drawn ?? 0) / (whole ?? 1)).toBeCloseTo(0.5, 2);
    expect(container.querySelector('.nv-ring__label')?.textContent).toBe('4 j');
    const empty = render(<Ring share={0} label="Rien" />).container;
    expect(empty.querySelector('.nv-ring__value')).toBeNull();
    expect(empty.querySelector('.nv-ring__track')).not.toBeNull();
  });
});
