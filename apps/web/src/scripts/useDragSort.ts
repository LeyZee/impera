import {
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

/** Past this many pixels a press becomes a drag; below, it stays a click. */
const SLOP = 6;
/** The share of the way to a neighbour's middle the dragged row must travel before they swap (above ½: no flicker). */
const SWAP = 0.55;

interface Origin {
  readonly key: string;
  readonly pointerId: number;
  readonly pointerY: number;
  /** Where the row stood in the list when the press began, before any swap. */
  readonly top: number;
  dragging: boolean;
}

export interface DragSort {
  /** The key being dragged, `null` at rest. */
  readonly dragging: string | null;
  /** Spread on the row: a mouse drags it from anywhere, a finger only from its `[data-sort-handle]`. */
  readonly press: (key: string) => {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  };
  /** The dragged row follows the pointer; the others are left to the layout (and `useFlip`). */
  readonly styleOf: (key: string) => CSSProperties | undefined;
}

/**
 * Reorders a list by dragging its rows (`[data-sort="<key>"]` under `list`), one neighbour at a time through `step`, the
 * same move as the ↑ ↓ buttons and Alt + arrows, so every rule of the list (a bridge that loses its stages goes) holds
 * while dragging too. Works with a mouse and a finger; the keyboard keeps its own way.
 */
export function useDragSort(
  list: RefObject<HTMLElement | null>,
  step: (key: string, delta: -1 | 1) => void,
): DragSort {
  const origin = useRef<Origin | null>(null);
  const moved = useRef(false);
  const [drag, setDrag] = useState<{ key: string; dy: number } | null>(null);

  const rows = (): HTMLElement[] => [...(list.current?.querySelectorAll<HTMLElement>('[data-sort]') ?? [])];
  const rowOf = (key: string): HTMLElement | undefined => rows().find((row) => row.dataset['sort'] === key);
  const middle = (row: HTMLElement): number => row.offsetTop + row.offsetHeight / 2;

  const end = (event: PointerEvent<HTMLElement>): void => {
    const was = origin.current;
    if (was?.pointerId !== event.pointerId) return;
    origin.current = null;
    moved.current = was.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  };

  return {
    dragging: drag?.key ?? null,
    press: (key) => ({
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        // A finger scrolls the page from a row; it drags only from the handle.
        const handle = event.target instanceof Element && event.target.closest('[data-sort-handle]') !== null;
        if (event.pointerType !== 'mouse' && !handle) return;
        const row = rowOf(key);
        if (row === undefined) return;
        moved.current = false;
        origin.current = {
          key,
          pointerId: event.pointerId,
          pointerY: event.clientY,
          top: row.offsetTop,
          dragging: false,
        };
        if (handle) event.preventDefault();
      },
      onPointerMove: (event) => {
        const at = origin.current;
        if (at?.pointerId !== event.pointerId) return;
        const row = rowOf(at.key);
        if (row === undefined) return;
        const travel = event.clientY - at.pointerY;
        if (!at.dragging) {
          if (Math.abs(travel) < SLOP) return;
          at.dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        const all = rows();
        const first = all[0];
        const last = all.at(-1);
        // The pointer's way from the row's place in the layout as it stands now, swaps included, kept in the list.
        const dy = Math.min(
          Math.max(travel - (row.offsetTop - at.top), (first?.offsetTop ?? row.offsetTop) - row.offsetTop),
          (last?.offsetTop ?? row.offsetTop) - row.offsetTop,
        );
        const index = all.indexOf(row);
        const next = all[index + 1];
        const previous = all[index - 1];
        // A swap moves the row by the gap to its neighbour's middle: the pointer stays on it through the new layout.
        if (next !== undefined && dy > (middle(next) - middle(row)) * SWAP) {
          step(at.key, 1);
          setDrag({ key: at.key, dy: dy - (middle(next) - middle(row)) });
        } else if (previous !== undefined && dy < (middle(previous) - middle(row)) * SWAP) {
          step(at.key, -1);
          setDrag({ key: at.key, dy: dy - (middle(previous) - middle(row)) });
        } else setDrag({ key: at.key, dy });
      },
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture: (event) => {
        // The click that ends a drag is not a click on the row.
        if (moved.current) {
          event.preventDefault();
          event.stopPropagation();
          moved.current = false;
        }
      },
    }),
    styleOf: (key) =>
      drag?.key === key ? { transform: `translateY(${String(drag.dy)}px)`, zIndex: 3 } : undefined,
  };
}
