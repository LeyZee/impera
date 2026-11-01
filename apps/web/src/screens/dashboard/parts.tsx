import { attachGlassLight, countUp, tipPlacement } from '@nirvana/design-system';
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

export interface FloatingTip {
  /** Spread on any element that explains itself on hover or focus. */
  readonly bind: (content: TipContent) => {
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerLeave: (event: React.PointerEvent) => void;
    onFocus: (event: React.FocusEvent) => void;
    onBlur: () => void;
  };
  readonly hide: () => void;
  readonly element: JSX.Element;
}

/** One floating `nv-tip` for the whole screen, placed under the pointer by `tipPlacement`. */
export function useFloatingTip(): FloatingTip {
  const [tip, setTip] = useState<{ content: TipContent; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || tip === null) return;
    const place = tipPlacement(
      { x: tip.x, y: tip.y },
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    element.style.left = `${String(place.left)}px`;
    element.style.top = `${String(place.top)}px`;
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
    (content: TipContent) => ({
      onPointerMove: (event: React.PointerEvent) => {
        setTip({ content, x: event.clientX, y: event.clientY });
      },
      // A finger has no hover: a tap shows the tip under the element, and the next tap anywhere hides it.
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse') return;
        const box = event.currentTarget.getBoundingClientRect();
        setTip({ content, x: box.left, y: box.bottom });
      },
      onPointerLeave: (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse') hide();
      },
      onFocus: (event: React.FocusEvent) => {
        const box = event.currentTarget.getBoundingClientRect();
        setTip({ content, x: box.left, y: box.bottom });
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
