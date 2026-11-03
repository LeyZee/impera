/**
 * Motion helpers for the Impera design system. Framework-free: React components call them from
 * effects, the extension popup calls them directly. State (selected tab, checked option) stays with
 * the caller; these helpers only move matter and light.
 */

export {
  areaPath,
  chartPoints,
  linePath,
  nearestIndex,
  niceTicks,
  type ChartFrame,
  type ChartPoint,
} from './chart.js';

export { funnelSteps, ringDash, tipPlacement, type Funnel, type FunnelStep, type Size } from './dashboard.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly left: number;
  readonly top: number;
}

export interface LensGeometry {
  readonly x: number;
  readonly width: number;
}

const ISLAND_SETTLE_MS = 700;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Pointer position relative to an element's box, in px. */
export function lightPosition(box: Box, clientX: number, clientY: number): Point {
  return { x: clientX - box.left, y: clientY - box.top };
}

/**
 * Makes the inner light of a `.nv-glass` surface follow the pointer. While the pointer is over it, the surface
 * carries `is-lit`: the light tightens from the 200px resting sheen to a 110px halo and fades in.
 * Returns a cleanup function (React effect friendly).
 */
export function attachGlassLight(element: HTMLElement): () => void {
  const onMove = (event: PointerEvent): void => {
    const point = lightPosition(element.getBoundingClientRect(), event.clientX, event.clientY);
    element.style.setProperty('--nv-light-x', `${String(point.x)}px`);
    element.style.setProperty('--nv-light-y', `${String(point.y)}px`);
    element.classList.add('is-lit');
  };
  const onLeave = (): void => {
    element.classList.remove('is-lit');
    element.style.removeProperty('--nv-light-x');
    element.style.removeProperty('--nv-light-y');
  };
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerleave', onLeave);
  return () => {
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerleave', onLeave);
    onLeave();
  };
}

/**
 * Restarts a one-shot CSS animation carried by `className`. No-op under reduced motion.
 * Used for the squash of a lens (`is-liquid`) and the gesture of a navigation icon (`is-playing`).
 */
export function playOnce(element: Element, className: string): void {
  if (prefersReducedMotion()) return;
  element.classList.remove(className);
  // Forcing a layout restarts the CSS animation on the next class add.
  element.getBoundingClientRect();
  element.classList.add(className);
}

/** Plays the squash-and-release of a thumb or lens while it travels. No-op under reduced motion. */
export function playLiquid(element: HTMLElement): void {
  playOnce(element, 'is-liquid');
}

/** Fast start, soft landing: the curve numbers count on. `t` is clamped to [0, 1]. */
export function easeOutQuart(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 4;
}

/** Value shown at `elapsedMs` of a count from `from` to `to` lasting `durationMs`. */
export function countValue(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return to;
  return from + (to - from) * easeOutQuart(elapsedMs / durationMs);
}

/**
 * Counts the text of `element` from `from` to `to` (a stat value, a total). Shows `to` at once under
 * reduced motion. Returns a cancel function (React effect friendly).
 */
export function countUp(
  element: HTMLElement,
  to: number,
  format: (value: number) => string,
  { from = 0, durationMs = 1000 }: { from?: number; durationMs?: number } = {},
): () => void {
  if (prefersReducedMotion()) {
    element.textContent = format(to);
    return () => undefined;
  }
  const start = performance.now();
  let frame = 0;
  const step = (now: number): void => {
    const elapsed = now - start;
    element.textContent = format(countValue(from, to, elapsed, durationMs));
    if (elapsed < durationMs) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
  };
}

/** Where the tab bar lens must sit to cover an item. */
export function lensGeometry(item: Pick<HTMLElement, 'offsetLeft' | 'offsetWidth'>): LensGeometry {
  return { x: item.offsetLeft, width: item.offsetWidth };
}

/** Moves the `.nv-tabbar__lens` under `item`. The lens reads the variables from its tab bar. */
export function placeTabBarLens(tabBar: HTMLElement, item: HTMLElement, lens?: HTMLElement): void {
  const { x, width } = lensGeometry(item);
  tabBar.style.setProperty('--nv-lens-x', `${String(x)}px`);
  tabBar.style.setProperty('--nv-lens-width', `${String(width)}px`);
  if (lens) playLiquid(lens);
}

/** Moves the `.nv-seg__thumb` of a segmented control to option `index` of `count`. */
export function placeSegmentThumb(
  segmented: HTMLElement,
  index: number,
  count: number,
  thumb?: HTMLElement,
): void {
  segmented.style.setProperty('--nv-seg-count', String(count));
  segmented.style.setProperty('--nv-seg-index', String(index));
  if (thumb) playLiquid(thumb);
}

/** Shrinks a `.nv-island` into its capsule. */
export function collapseIsland(island: HTMLElement): void {
  island.style.height = `${String(island.offsetHeight)}px`;
  island.getBoundingClientRect();
  island.classList.add('is-collapsed');
  island.style.removeProperty('height');
}

/** Grows a collapsed `.nv-island` back to its content height on a spring. */
export function expandIsland(island: HTMLElement): void {
  island.classList.remove('is-collapsed');
  const height = island.offsetHeight;
  island.classList.add('is-collapsed');
  island.getBoundingClientRect();
  island.classList.remove('is-collapsed');
  island.style.height = `${String(height)}px`;
  window.setTimeout(() => {
    island.style.removeProperty('height');
  }, ISLAND_SETTLE_MS);
}
