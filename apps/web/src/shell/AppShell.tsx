import type { Me } from '@nirvana/contracts';
import { playLiquid, playOnce } from '@nirvana/design-system';
import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { AgentPill } from './AgentPill';
import { AppearanceChoice } from './AppearanceChoice';
import { NavIcon } from './NavIcon';
import { keepTabInside } from './focus';
import { documentTitle, FAMILY_LABELS, railOf, sectionOf, type NavItem, type Rail } from './nav';

import { initialOf } from '@/lib/utils';
import { HoldProvider } from '@/reports/Hold';
import { ReopenProvider } from '@/reports/reopen';

/** What the account is, under its name: a manager on leave has the chatter's rail, and stays a manager. */
function roleLabel(user: Me): string {
  if (user.role === 'owner') return 'Propriétaire';
  if (user.role === 'creator') return 'Créatrice';
  if (user.team === null) return 'Opérateur';
  return user.team.role === 'manager' ? 'Manager' : 'Chatteur';
}

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/u, '') : path);

/** Who is signed in, as the account's menu and the phone's sheet name them. */
export interface Account {
  readonly name: string;
  readonly role: string;
}

export function AppShell({ user, onSignOut }: { user: Me; onSignOut: () => void }): JSX.Element {
  const rail = useMemo(() => railOf(user), [user]);
  const account = useMemo(() => ({ name: user.name, role: roleLabel(user) }), [user]);
  // The address on screen: while the next one loads, the screen, its tab and its title are still the last one's.
  const pathname = useRouterState({ select: (state) => (state.resolvedLocation ?? state.location).pathname });
  // A screen the router does not know, even inside a section (/equipe/nexiste-pas), lights no tab (NAV-01): the router
  // then matches the section alone, its deepest route short of the address.
  const notFound = useRouterState({
    select: (state) => {
      if (state.matches.some((match) => match.status === 'notFound')) return true;
      // While the next address loads, the matches answer either it or the last one resolved: neither is unknown.
      const deepest = trimSlash(state.matches.at(-1)?.pathname ?? '');
      return [state.location, state.resolvedLocation].every(
        (location) => location === undefined || trimSlash(location.pathname) !== deepest,
      );
    },
  });
  const current = notFound ? null : sectionOf(pathname);
  const main = useRef<HTMLElement>(null);
  const shown = useRef(current);

  // The tab's title names the screen and its section, so that several open tabs read apart (NAV-12).
  useEffect(() => {
    document.title = documentTitle(pathname, current, rail.kind);
  }, [pathname, current, rail.kind]);

  // Another section chosen: the keyboard starts on its title, not back at the top of the rail (NAV-20).
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    const stage = main.current;
    if (stage === null) return;
    const title = stage.querySelector<HTMLElement>('h1') ?? stage;
    if (title !== stage) title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }, [current]);

  // What the route guard said on the way here (NAV-21), carried by the arrival's own history entry. Read once: the
  // entry is then rewritten without it, so that « Précédent » or a reload does not say it again. Shown a few seconds.
  const router = useRouter();
  const notice = useRouterState({ select: (state) => state.resolvedLocation?.state.notice ?? null });
  const [said, setSaid] = useState<{ readonly text: string; readonly at: number } | null>(null);
  useEffect(() => {
    const arrived = router.state.resolvedLocation;
    if (notice === null || arrived === undefined) return;
    setSaid({ text: notice, at: Date.now() });
    router.history.replace(arrived.href, { ...arrived.state, notice: undefined });
  }, [notice, router]);
  useEffect(() => {
    if (said === null) return undefined;
    const timer = setTimeout(() => {
      setSaid(null);
    }, 6_000);
    return () => {
      clearTimeout(timer);
    };
  }, [said]);

  // The hold outlives the screens: a report sent on leaving Aujourd'hui says its refusal in Suivi, and « Rouvrir »
  // takes the reader back to it (EQ-03).
  return (
    <HoldProvider>
      <ReopenProvider>
        <div className="nv-app">
          <a className="nv-skip" href="#contenu">
            Aller au contenu
          </a>
          <div className="nv-ambient" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <RailNav rail={rail} current={current} onSignOut={onSignOut} account={account}>
            <UserMenu account={account} onSignOut={onSignOut} />
          </RailNav>
          <Stage key={current ?? 'none'} pathname={pathname} stage={main} />
          {/* Always there, empty when silent: a screen reader announces what comes into a region it already knows. */}
          <p className="nv-notice-region" role="status">
            {said === null ? null : (
              <span className="nv-notice nv-glass nv-glass--thick" key={said.at}>
                {said.text}
              </span>
            )}
          </p>
        </div>
      </ReopenProvider>
    </HoldProvider>
  );
}

/**
 * The stage of one section, made anew when the section changes. Once a sub-tab of the same section is chosen, the
 * page's header no longer plays its entrance: the title stays where it is and the sub-tabs' glass slides (NAV-08).
 */
function Stage({ pathname, stage }: { pathname: string; stage: RefObject<HTMLElement | null> }): JSX.Element {
  const [first] = useState(pathname);
  const [within, setWithin] = useState(false);
  if (!within && pathname !== first) setWithin(true);
  return (
    <main className="nv-stage" id="contenu" tabIndex={-1} ref={stage} data-within={within ? '' : undefined}>
      <Outlet />
    </main>
  );
}

/**
 * The rail of one role: its tabs, the family headings, the agent's mode when the rail has the Dashboard, Réglages at
 * the foot. On the phone it becomes the tab bar, and what does not fit goes under « Plus ».
 */
export function RailNav({
  rail,
  current,
  onSignOut,
  account,
  children,
}: {
  rail: Rail;
  /** The section on screen, or null outside every section (an unknown address): no tab is lit. */
  current: string | null;
  /**
   * On the phone the account's menu is hidden: « Plus » says who is signed in, the appearance and the way out, and
   * shows on every rail for it, even one whose tabs all fit on the bar (recette 28/10, M14; NAV-02, NAV-03).
   */
  onSignOut?: () => void;
  account?: Account;
  children?: JSX.Element;
}): JSX.Element {
  const railRef = useRef<HTMLElement>(null);
  const lensRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const first = useRef(true);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const isInMore = [...rail.more].some((to) => to === current);

  // Another tab chosen from the bar while the sheet is open: the sheet goes.
  useEffect(() => {
    setIsMoreOpen(false);
  }, [current]);

  // The lens slides to the active item and squashes on the way; the icon plays its gesture.
  useLayoutEffect(() => {
    const nav = railRef.current;
    const lens = lensRef.current;
    if (lens === null) return;
    const item = current === null ? null : nav?.querySelector<HTMLElement>(`[data-section="${current}"]`);
    // No tab to light: the lens goes, and comes back on the next one.
    lens.style.opacity = item === null || item === undefined ? '0' : '';
    if (nav === null || item === null || item === undefined) return;
    lens.style.transform = `translateY(${String(item.offsetTop)}px)`;
    if (first.current) {
      first.current = false;
      return;
    }
    playLiquid(lens);
    // On the phone, a tab under « Plus » is hidden: « Plus » plays for it.
    for (const host of isInMore ? [item, moreRef.current] : [item]) {
      const icon = host?.querySelector('svg');
      if (icon !== null && icon !== undefined) playOnce(icon, 'is-playing');
    }
  }, [current, isInMore]);

  const link = (item: NavItem): JSX.Element => (
    <Link
      key={item.to}
      to={item.to}
      data-section={item.to}
      data-phone={rail.more.has(item.to) ? 'more' : 'bar'}
      className="nv-rail__item"
      aria-current={item.to === current ? 'page' : undefined}
      // The router lights any link the address starts with, and its aria-current wins: outside the tab's own section
      // only the exact address counts, so that /equipe/nexiste-pas lights nothing (NAV-01).
      activeOptions={{ exact: item.to !== current }}
      title={item.label}
    >
      <NavIcon name={item.icon} />
      <span className="nv-rail__label">{item.label}</span>
    </Link>
  );

  const home = [...rail.items, ...(rail.settings === null ? [] : [rail.settings])].find(
    ({ to }) => to === rail.home,
  );
  const more = [...rail.items, ...(rail.settings === null ? [] : [rail.settings])].filter(({ to }) =>
    rail.more.has(to),
  );

  return (
    <nav
      className="nv-rail nv-glass"
      ref={railRef}
      aria-label="Navigation"
      data-tabs={rail.items.length + (rail.settings === null ? 0 : 1)}
    >
      <Link to={rail.home} className="nv-rail__brand" aria-label={`Nirvana, ${home?.label ?? 'accueil'}`}>
        <img className="nv-rail__mark" src="/nirvana-mark.svg" alt="" width={30} height={30} />
        <span className="nv-rail__name">Nirvana</span>
      </Link>
      <span className="nv-rail__lens" ref={lensRef} aria-hidden="true" />
      {rail.items.map((item, index) => {
        // The first tab of a family opens it: with a heading, or a gap when the family has that tab alone.
        const opens = item.family === rail.items[index - 1]?.family ? null : item.family;
        return (
          <Fragment key={item.to}>
            {opens !== null ? (
              rail.headed.has(opens) ? (
                <span className="nv-rail__heading">{FAMILY_LABELS[opens]}</span>
              ) : (
                <span className="nv-rail__gap" aria-hidden="true" />
              )
            ) : null}
            {link(item)}
          </Fragment>
        );
      })}
      <span className="nv-rail__sp" />
      {/* On the Dashboard the mode's own control is on screen: the pill would say it twice (NAV-07). */}
      {rail.items.some(({ to }) => to === '/') && current !== '/' ? <AgentPill /> : null}
      {rail.settings === null ? null : link(rail.settings)}
      {more.length === 0 && onSignOut === undefined ? null : (
        <button
          ref={moreRef}
          type="button"
          className="nv-rail__item nv-rail__more"
          aria-haspopup="dialog"
          aria-expanded={isMoreOpen}
          data-current={isInMore}
          onClick={() => {
            setIsMoreOpen(!isMoreOpen);
          }}
        >
          <NavIcon name="more" />
          <span className="nv-rail__label">Plus</span>
        </button>
      )}
      {children}
      {isMoreOpen ? (
        <MoreSheet
          items={more}
          current={current}
          onSignOut={onSignOut}
          account={account}
          onClose={() => {
            setIsMoreOpen(false);
            moreRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </nav>
  );
}

/**
 * What the phone's bar has no room for: a glass sheet over the bar (it floats). A modal dialog: Tab stays inside, Escape
 * or a tap outside closes it, and so does choosing a tab; the focus goes back to « Plus ».
 */
export function MoreSheet({
  items,
  current,
  onSignOut,
  account,
  onClose,
}: {
  items: readonly NavItem[];
  current: string | null;
  onSignOut?: (() => void) | undefined;
  account?: Account | undefined;
  onClose: () => void;
}): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const target =
      sheet.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
      sheet.current?.querySelector<HTMLElement>('a[href], button');
    target?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, []);

  // On the body: the rail's glass would capture `position: fixed`.
  return createPortal(
    <>
      <div className="nv-more-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheet}
        className="nv-more nv-glass nv-glass--thick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nv-more-title"
        onKeyDown={keepTabInside}
      >
        <h2 className="nv-more__title" id="nv-more-title">
          Plus
        </h2>
        {items.map((item, index) => (
          <Link
            key={item.to}
            to={item.to}
            className="nv-more__item nv-enter"
            style={{ '--nv-i': index + 1 }}
            aria-current={item.to === current ? 'page' : undefined}
            activeOptions={{ exact: item.to !== current }}
            onClick={onClose}
          >
            <NavIcon name={item.icon} />
            {item.label}
          </Link>
        ))}
        {account === undefined ? null : (
          <div className="nv-more__account nv-enter" style={{ '--nv-i': items.length + 1 }}>
            <span className="nv-avatar nv-avatar--sm" aria-hidden="true">
              {initialOf(account.name)}
            </span>
            <span className="nv-user__id">
              <span>{account.name}</span>
              <small>{account.role}</small>
            </span>
          </div>
        )}
        {account === undefined ? null : (
          <div className="nv-enter" style={{ '--nv-i': items.length + 2 }}>
            <AppearanceChoice />
          </div>
        )}
        {onSignOut === undefined ? null : (
          <button
            type="button"
            className="nv-more__item nv-more__out nv-enter"
            style={{ '--nv-i': items.length + 3 }}
            onClick={onSignOut}
          >
            Se déconnecter
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

/**
 * The account's menu at the foot of the rail: who is signed in, the appearance of this browser (NAV-03), the way out.
 * A popover, not a menu: it holds a radio group.
 */
function UserMenu({ account, onSignOut }: { account: Account; onSignOut: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent | KeyboardEvent): void => {
      const outside = event.target instanceof Node && ref.current?.contains(event.target) !== true;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        setOpen(false);
        button.current?.focus({ preventScroll: true });
        return;
      }
      if (outside) setOpen(false);
    };
    addEventListener('pointerdown', close);
    addEventListener('keydown', close);
    return () => {
      removeEventListener('pointerdown', close);
      removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="nv-user" ref={ref}>
      <button
        ref={button}
        type="button"
        className="nv-user__btn"
        aria-expanded={open}
        aria-controls="nv-user-menu"
        title={account.name}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="nv-avatar nv-avatar--sm" aria-hidden="true">
          {initialOf(account.name)}
        </span>
        <span className="nv-user__id">
          <span>{account.name}</span>
          <small>{account.role}</small>
        </span>
      </button>
      {open ? (
        <div className="nv-user__menu nv-glass nv-glass--thick" id="nv-user-menu">
          <AppearanceChoice />
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onSignOut}>
            Se déconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}
