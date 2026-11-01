import { placeTabBarLens } from '@nirvana/design-system';
import { Link, useRouterState, type LinkProps } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Layout pieces shared by every screen of the dashboard. A screen is a `Page`: a header that says where
 * you are and what to do, then content `Panel`s (plates, not glass). Sections with several screens put a `SubNav` in the header.
 */

export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): JSX.Element {
  return <div className={cn('nv-page', className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One sentence: what this screen is for, or the one thing to do here. */
  lead?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="nv-page__head">
      <div className="nv-page__title">
        {eyebrow === undefined ? null : <p className="nv-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {lead === undefined ? null : <p className="nv-page__lead">{lead}</p>}
      </div>
      {actions === undefined ? null : <div className="nv-page__actions">{actions}</div>}
    </header>
  );
}

/** @public Shared with the screens of other threads (Réglages > Modèles IA). */
export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className,
  as: Tag = 'section',
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: 'section' | 'aside' | 'main' | 'div';
}): JSX.Element {
  const hasHead = title !== undefined || eyebrow !== undefined || actions !== undefined;
  return (
    <Tag className={cn('nv-plate nv-panel', className)}>
      {hasHead ? (
        <div className="nv-panel__head">
          <div className="min-w-0 flex-1">
            {eyebrow === undefined ? null : <p className="nv-eyebrow">{eyebrow}</p>}
            {title === undefined ? null : <h2>{title}</h2>}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/** @public A labelled block inside a panel, separated from the previous one by a hairline. */
export function PanelSection({
  label,
  children,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('nv-panel__sec', className)}>
      {label === undefined ? null : <p className="nv-eyebrow">{label}</p>}
      {children}
    </div>
  );
}

export interface SubNavItem {
  readonly to: NonNullable<LinkProps['to']>;
  /** A view of one screen chosen by the address's query (Créatrices' `?onglet=`), lit by `current`. */
  readonly search?: LinkProps['search'];
  readonly current?: boolean;
  readonly label: string;
  /**
   * What waits behind the tab, said as a number in ink on glass: never an alarm, the neon is left to the screen's own
   * action (EQ-04, PAIE-09).
   */
  readonly count?: number;
}

/** The thumb put under the active tab at once, with no slide. */
function placeStill(nav: HTMLElement, active: HTMLElement, thumb: HTMLElement | undefined): void {
  thumb?.style.setProperty('transition', 'none');
  placeTabBarLens(nav, active);
  thumb?.getBoundingClientRect();
  thumb?.style.removeProperty('transition');
}

/**
 * The tab each sub-nav left lit as it went, and when. A sub-tab's screen draws its own header, so choosing one makes
 * the sub-nav anew: the new one starts its glass where the last one left it, and slides (NAV-08).
 */
const leftAt = new Map<string, { readonly href: string; readonly at: number }>();
const SAME_GESTURE_MS = 1_000;

/** The screens of a section, as tabs. The active one follows the URL; its glass slides from tab to tab. */
export function SubNav({ items, label }: { items: readonly SubNavItem[]; label: string }): JSX.Element {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const navRef = useRef<HTMLElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const counts = items.map((item) => item.count ?? 0).join(',');
  const lit = items.findIndex((item) => item.current === true);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (nav === null || !(active instanceof HTMLElement)) return;
    const thumb = thumbRef.current ?? undefined;
    if (placed.current) {
      placeTabBarLens(nav, active, thumb);
      return;
    }
    // First paint: the thumb appears in place, without sliding in from the left or squashing; unless the same
    // sub-nav was just left on another tab, the gesture that made this one.
    placed.current = true;
    const left = leftAt.get(label);
    const from =
      left === undefined || performance.now() - left.at > SAME_GESTURE_MS
        ? null
        : [...nav.querySelectorAll('a')].find((link) => link.getAttribute('href') === left.href);
    if (from === undefined || from === null || from === active) {
      placeStill(nav, active, thumb);
      return;
    }
    placeStill(nav, from, thumb);
    placeTabBarLens(nav, active, thumb);
  }, [pathname, lit, label]);

  // Leaving: say where the glass was, for the sub-nav the next screen draws. A layout effect: its cleanup runs before
  // the new sub-nav's first placing, where a passive one would run after it and leave nothing to slide from.
  useLayoutEffect(() => {
    const nav = navRef.current;
    return () => {
      const href = nav?.querySelector('[aria-current="page"]')?.getAttribute('href');
      if (href !== null && href !== undefined) leftAt.set(label, { href, at: performance.now() });
    };
  }, [label]);

  // A count that arrives after the tabs (Paie's « Quinzaine 4 ») widens its tab and moves the others: the thumb
  // follows them where they are, without sliding.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (!placed.current || nav === null || !(active instanceof HTMLElement)) return;
    placeStill(nav, active, thumbRef.current ?? undefined);
  }, [counts]);

  // On a phone a section's tabs can be wider than the screen: the nav scrolls, keeps the active tab in view and fades
  // the edge that hides more tabs, so none is cut off without a sign.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (nav === null || !(active instanceof HTMLElement) || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  useEffect(() => {
    const nav = navRef.current;
    if (nav === null) return;
    const mark = (): void => {
      const start = nav.scrollLeft > 1;
      const end = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
      nav.dataset['more'] = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
    };
    mark();
    nav.addEventListener('scroll', mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(nav);
    return () => {
      nav.removeEventListener('scroll', mark);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="nv-subnav-pill nv-glass nv-glass--thin">
      <nav className="nv-subnav" aria-label={label} ref={navRef}>
        <span className="nv-subnav__thumb" ref={thumbRef} aria-hidden="true" />
        {items.map((item) => (
          <Link
            key={`${item.to}${item.label}`}
            to={item.to}
            {...(item.search === undefined ? {} : { search: item.search })}
            className="nv-subnav__item"
            // A tab is its own address alone: « Conversations » (/suivi) is not lit on /suivi/alertes, and a tab's
            // query (?onglet=, ?conversation=) never turns it off. A view of one screen is lit by its `current`.
            {...(item.current === undefined
              ? {
                  activeOptions: { exact: true, includeSearch: false },
                  activeProps: { 'aria-current': 'page' },
                }
              : {
                  activeOptions: { exact: true, includeSearch: true },
                  'aria-current': item.current ? 'page' : undefined,
                })}
          >
            {item.label}
            {item.count === undefined || item.count === 0 ? null : (
              <span className="nv-subnav__count">{item.count}</span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** A screen that is not built yet: what it will do, and which work brings it. Nothing else. */
export function ComingSoon({
  title,
  what,
  when,
}: {
  title: string;
  what: string;
  when: string;
}): JSX.Element {
  return (
    <Panel className="nv-coming">
      <div className="nv-coming__in">
        <p className="nv-eyebrow">{when}</p>
        <h2>{title}</h2>
        <p>{what}</p>
      </div>
    </Panel>
  );
}
