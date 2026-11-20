// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameGauge, gaugeStart, lastShown } from './GameGauge';

const USER = '0199f2a0-0000-7000-8000-000000000021';
const at = (container: HTMLElement): string =>
  container.querySelector<HTMLElement>('.rw-gauge')?.style.getPropertyValue('--rw-gauge-at') ?? '';
const moving = (container: HTMLElement): boolean =>
  container.querySelector('.rw-gauge')?.getAttribute('data-moving') === 'true';

describe('GameGauge', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts from the last value shown only when it was lower, for the same target', () => {
    expect(gaugeStart(null, '3', 40)).toBeNull();
    expect(gaugeStart({ scope: '3', percent: 25 }, '3', 40)).toBe(25);
    expect(gaugeStart({ scope: '3', percent: 60 }, '3', 40)).toBeNull();
    expect(gaugeStart({ scope: '3', percent: 40 }, '3', 40)).toBeNull();
    expect(gaugeStart({ scope: '2', percent: 25 }, '3', 40)).toBeNull();
  });

  it('shows today’s value at once on a first visit, and keeps it for the next', () => {
    const { container } = render(<GameGauge userId={USER} name="rank" scope="3" percent={40} label="Vers" />);
    expect(at(container)).toBe('40%');
    expect(moving(container)).toBe(false);
    expect(lastShown(USER, 'rank')).toEqual({ scope: '3', percent: 40 });
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
  });

  it('goes once from the value last shown to today’s', () => {
    render(<GameGauge userId={USER} name="rank" scope="3" percent={25} />);
    cleanup();
    const { container, rerender } = render(<GameGauge userId={USER} name="rank" scope="3" percent={40} />);
    expect(at(container)).toBe('25%');
    expect(moving(container)).toBe(false);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(at(container)).toBe('40%');
    expect(moving(container)).toBe(true);
    const gauge = container.querySelector('.rw-gauge');
    act(() => {
      const end = new Event('transitionend', { bubbles: true });
      Object.defineProperty(end, 'propertyName', { value: 'transform' });
      gauge?.dispatchEvent(end);
    });
    // A value that changes while the screen is open is put there with no second movement.
    rerender(<GameGauge userId={USER} name="rank" scope="3" percent={55} />);
    expect(at(container)).toBe('55%');
    expect(moving(container)).toBe(false);
  });

  it('never moves down, never from another account, and never from another target', () => {
    render(<GameGauge userId={USER} name="rank" scope="3" percent={60} />);
    cleanup();
    expect(at(render(<GameGauge userId={USER} name="rank" scope="3" percent={40} />).container)).toBe('40%');
    cleanup();
    const other = '0199f2a0-0000-7000-8000-000000000022';
    expect(at(render(<GameGauge userId={other} name="rank" scope="3" percent={90} />).container)).toBe('90%');
    cleanup();
    expect(at(render(<GameGauge userId={USER} name="rank" scope="4" percent={90} />).container)).toBe('90%');
  });

  it('is put at today’s value from the first picture with « réduire les animations »', () => {
    render(<GameGauge userId={USER} name="rank" scope="3" percent={25} />);
    cleanup();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { container } = render(<GameGauge userId={USER} name="rank" scope="3" percent={40} />);
    expect(at(container)).toBe('40%');
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(moving(container)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('shows the value at once when the browser refuses its storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refused');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused');
    });
    expect(at(render(<GameGauge userId={USER} name="rank" scope="3" percent={40} />).container)).toBe('40%');
  });
});
