import { attachGlassLight, countUp, tipPlacement } from '@impera/design-system';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Tone } from './model';

declare module 'react' {
  // The design system is driven by CSS variables (--nv-i, --nv-w, --_c…): let `style` carry them, typed.
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- merging into React's interface needs a member.
  interface CSSProperties {
    [variable: `--${string}`]: string | number | undefined;
  }
}

export const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--nv-success)',
  warn: 'var(--nv-warning)',
  bad: 'var(--nv-danger)',
  idle: 'var(--nv-ink-faint)',
};

/** Ref callback: the glass light follows the pointer, the 110px halo fades in (`is-lit`). */
export function lightUp(element: HTMLElement | null): (() => void) | undefined {
  return element === null ? undefined : attachGlassLight(element);
}

/** A number that counts to its value, from the one on screen when it changes (never from zero again). */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const from = shown.current;
    shown.current = value;
    return countUp(element, value, format, { from, durationMs: 900 });
  }, [value, format]);
  // Written by the effect only: React never owns this text, so a count in flight is never overwritten.
  return <span className={className} ref={ref} />;
}

interface TipContent {
  readonly title: string;
  readonly rows?: readonly (readonly [string, string])[];
  readonly text?: string;
  readonly note?: string;
}

/**
 * `above`: over the element's top edge at the pointer's x. `beside`: beside the element on the side with more room,
 * on hover too, so a tall chart's tip stays inside its card and never covers the controls over it.
 */
export interface TipOptions {
  readonly above?: boolean;
  readonly beside?: boolean;
}

export interface FloatingTip {
  /**
   * Spread on any element that explains itself on hover or focus. `above` sets the tip over the element's top edge,
   * at the pointer's x, so a chart's tip never sits over the text beside it; a tap or the keyboard sets it beside the
   * element instead.
   */
  readonly bind: (
    content: TipContent,
    options?: TipOptions,
  ) => {
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerLeave: (event: React.PointerEvent) => void;
    onFocus: (event: React.FocusEvent) => void;
    onBlur: () => void;
  };
  readonly hide: () => void;
  readonly element: JSX.Element;
}

/** The box a tip opened by a tap or the keyboard sits beside. */
interface Beside {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface PlacedTip {
  content: TipContent;
  x: number;
  y: number;
  above?: boolean;
  beside?: Beside;
}

/**
 * Where a tap or the keyboard puts the tip: under the element, or beside it with `above`. A phone has no room over a
 * chart's column: there the tip covered the chart's title, under it the next card's (recette du 07/11).
 */
function placedOn(content: TipContent, box: DOMRect, options: TipOptions | undefined): PlacedTip {
  if (options?.above === true || options?.beside === true) {
    return {
      content,
      x: box.left,
      y: box.top,
      beside: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
    };
  }
  return { content, x: box.left, y: box.bottom };
}

const TIP_GAP = 8;
const TIP_MARGIN = 12;

/**
 * Beside a box, on the side with more room, its middle on the box's middle, kept inside the window. Exported for its
 * tests.
 */
export function besidePlacement(
  box: Beside,
  tip: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  const roomLeft = box.left - TIP_GAP - TIP_MARGIN;
  const roomRight = view.width - box.right - TIP_GAP - TIP_MARGIN;
  const wanted =
    roomRight >= tip.width || roomRight >= roomLeft ? box.right + TIP_GAP : box.left - TIP_GAP - tip.width;
  const left = Math.min(Math.max(TIP_MARGIN, wanted), view.width - tip.width - TIP_MARGIN);
  const middle = (box.top + box.bottom) / 2 - tip.height / 2;
  const top = Math.min(Math.max(TIP_MARGIN, middle), view.height - tip.height - TIP_MARGIN);
  return { left, top };
}

/** One floating `nv-tip` for the whole screen, placed under the pointer by `tipPlacement`. */
export function useFloatingTip(): FloatingTip {
  const [tip, setTip] = useState<PlacedTip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || tip === null) return;
    if (tip.beside !== undefined) {
      const beside = besidePlacement(
        tip.beside,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      element.style.left = `${String(beside.left)}px`;
      element.style.top = `${String(beside.top)}px`;
      return;
    }
    const place = tipPlacement(
      { x: tip.x, y: tip.y },
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    // Above an element: centred on the pointer, kept inside the window.
    const above = tip.above === true;
    const top = above ? Math.max(12, tip.y - element.offsetHeight - 10) : place.top;
    const left = above
      ? Math.min(Math.max(12, tip.x - element.offsetWidth / 2), window.innerWidth - element.offsetWidth - 12)
      : place.left;
    element.style.left = `${String(left)}px`;
    element.style.top = `${String(top)}px`;
  }, [tip]);

  const hide = useCallback(() => {
    setTip(null);
  }, []);

  // A tip opened by a tap stays until the next tap: caught before the element's own handler, which may reopen it.
  // The page scrolls under a tip placed in viewport coordinates: any scroll, wherever it happens, hides it too.
  const shown = tip !== null;
  useEffect(() => {
    if (!shown) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') hide();
    };
    document.addEventListener('pointerdown', onDown, true);
    addEventListener('scroll', hide, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      removeEventListener('scroll', hide, { capture: true });
    };
  }, [shown, hide]);
  const bind = useCallback(
    (content: TipContent, options?: TipOptions) => ({
      onPointerMove: (event: React.PointerEvent) => {
        if (options?.beside === true) {
          setTip(placedOn(content, event.currentTarget.getBoundingClientRect(), options));
          return;
        }
        if (options?.above === true) {
          setTip({
            content,
            x: event.clientX,
            y: event.currentTarget.getBoundingClientRect().top,
            above: true,
          });
          return;
        }
        setTip({ content, x: event.clientX, y: event.clientY });
      },
      // A finger has no hover: a tap shows the tip under the element (beside it with `above`), and the next tap
      // anywhere hides it.
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse') return;
        setTip(placedOn(content, event.currentTarget.getBoundingClientRect(), options));
      },
      onPointerLeave: (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse') hide();
      },
      onFocus: (event: React.FocusEvent) => {
        setTip(placedOn(content, event.currentTarget.getBoundingClientRect(), options));
      },
      onBlur: hide,
    }),
    [hide],
  );

  const content = tip?.content;
  // On the body: `tipPlacement` works in viewport coordinates, a transformed ancestor would shift it.
  const element = createPortal(
    <div
      className={`nv-tip nv-glass nv-glass--thick${tip === null ? '' : ' is-on'}`}
      ref={ref}
      role="tooltip"
    >
      {content === undefined ? null : (
        <>
          <h4 className="nv-tip__title">{content.title}</h4>
          {content.text === undefined ? null : <p className="m-0">{content.text}</p>}
          {content.rows?.map(([label, value]) => (
            <div className="nv-tip__row" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
          {content.note === undefined ? null : <p className="db-tip-note">{content.note}</p>}
        </>
      )}
    </div>,
    document.body,
  );
  return { bind, hide, element };
}

export function Chevron({ className }: { className: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** A section of the screen: an eyebrow title, its one-line reading guide, and an optional control. */
export function Section({
  title,
  sub,
  control,
  index,
  children,
}: {
  title: string;
  sub: string;
  control?: ReactNode;
  index: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="db-sect nv-enter" style={{ '--nv-i': index }}>
      <div className="db-sect__head">
        <h2>
          {title}
          <span className="db-sect__sub">{sub}</span>
        </h2>
        {control}
      </div>
      {children}
    </section>
  );
}
