import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Slides the children of `list` that carry `data-flip` from where they stood to where they now stand, each time `order`
 * changes: a stage moved up or down glides to its place instead of jumping (First, Last, Invert, Play). Nothing moves
 * under reduced motion, nor on the first drawing.
 */
export function useFlip(list: RefObject<HTMLElement | null>, order: string): void {
  const before = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
    const items = [...root.querySelectorAll<HTMLElement>('[data-flip]')];
    const now = new Map(items.map((item) => [item.dataset['flip'] ?? '', item.getBoundingClientRect().top]));
    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still && typeof root.animate === 'function') {
      for (const item of items) {
        const was = before.current.get(item.dataset['flip'] ?? '');
        const is = now.get(item.dataset['flip'] ?? '');
        if (was === undefined || is === undefined || Math.abs(was - is) < 1) continue;
        item.animate([{ transform: `translateY(${String(was - is)}px)` }, { transform: 'translateY(0)' }], {
          duration: 280,
          easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.15)',
        });
      }
    }
    before.current = now;
  }, [list, order]);
}
