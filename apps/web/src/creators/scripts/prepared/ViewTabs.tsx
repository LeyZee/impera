import { placeTabBarLens } from '@impera/design-system';
import { useLayoutEffect, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react';

/**
 * The views inside one tab (ADR 0149 § 3: « Scripts · À copier dans Reveal », « Construire · Performances »): the
 * persona's `nv-subnav` bar in `role="tablist"`, its glass sliding under the lit view, the arrows of the keyboard going
 * from one to the next. Never a second bar of tabs, never a native control.
 */
export function ViewTabs<V extends string>({
  label,
  views,
  value,
  onChange,
}: {
  label: string;
  views: readonly (readonly [V, ReactNode])[];
  value: V;
  onChange: (view: V) => void;
}): JSX.Element {
  const navRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector('[aria-selected="true"]');
    if (nav === null || !(item instanceof HTMLElement)) return;
    placeTabBarLens(nav, item, placed.current ? (thumbRef.current ?? undefined) : undefined);
    placed.current = true;
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const at = views.findIndex(([view]) => view === value);
    const next = views[(at + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next[0]);
    navRef.current?.querySelector<HTMLElement>(`[data-view="${next[0]}"]`)?.focus();
  };

  return (
    <div className="se-tabs">
      <div
        className="nv-subnav se-tabs__bar"
        role="tablist"
        aria-label={label}
        ref={navRef}
        onKeyDown={onKeyDown}
      >
        <span className="nv-subnav__thumb" ref={thumbRef} aria-hidden="true" />
        {views.map(([view, text]) => (
          <button
            key={view}
            type="button"
            role="tab"
            data-view={view}
            tabIndex={view === value ? 0 : -1}
            aria-selected={view === value}
            className="nv-subnav__item"
            onClick={() => {
              onChange(view);
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
