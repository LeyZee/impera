import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';
import { countUp } from '@impera/design-system';
import { useEffect, useId, useRef, useState, type JSX, type PointerEvent, type ReactNode } from 'react';

import { RewardReveal } from '../RewardReveal';

import {
  earnedCount,
  foldedShelf,
  nextTrophy,
  onShelf,
  percentOf,
  shelvesOf,
  SHELF_ORDER,
  type ShelfFamily,
} from './arrange';

import { Dialog } from '@/shell/Dialog';

import './trophy-case.css';

/*
 * « Mes trophées » (ADR 0108): one screen for the chatter and the creator. The next trophy on top in its ring, then
 * three shelves, medals, streaks, trophies, the earned objects first. The server says every fact; the role's
 * `entry` names each object, says how it is earned and draws it with the game's own pieces (`Medal`, `TrophyBadge`,
 * the creator's badges). Display only: nothing here reads money, compares people or calls anyone back.
 */

/** What the screen says and draws for one object of the role's closed list. */
export interface TrophyCaseEntry {
  readonly name: string;
  /** How it is earned, one short line, shown under a silhouette with no count and in the detail. */
  readonly how: string;
  /** What is left, short (« Encore 1 shift », « 2 sur 3 »); the shelf's title already says the unit. */
  readonly left?: string;
  /** What replaces « Gagné le … » under an earned object (« 3 fois · dernière le 9 nov. »). */
  readonly earnedNote?: string;
  /** The object at a size in pixels, earned or a silhouette. */
  readonly art: (size: number, earned: boolean) => ReactNode;
  /** Its reveal's words (ADR 0104 § 12, 0107 § 11). */
  readonly reveal: { readonly kicker: string; readonly text: string; readonly tone: 'gold' | 'neon' };
}

const SHELF_TITLES: Readonly<Record<ShelfFamily, string>> = {
  medal: 'Médailles',
  streak: 'Séries',
  trophy: 'Trophées',
};

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** The entrance plays once a session (ADR 0108 § 10): coming back to the tab finds the case standing (CHT-19). */
const ENTERED = 'impera.trophy-case.entered';

function enteredBefore(): boolean {
  try {
    return window.sessionStorage.getItem(ENTERED) === '1';
  } catch {
    return false;
  }
}

function markEntered(): void {
  try {
    window.sessionStorage.setItem(ENTERED, '1');
  } catch {
    // A browser that keeps nothing replays the entrance: nothing is lost.
  }
}

const RING = 240;
const STROKE = 9;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ percent }: { percent: number }): JSX.Element {
  const style = {
    '--tc-c': CIRCUMFERENCE.toFixed(1),
    '--tc-off': (CIRCUMFERENCE * (1 - percent / 100)).toFixed(1),
  };
  return (
    <svg className="tc-ring" viewBox={`0 0 ${String(RING)} ${String(RING)}`} aria-hidden="true" style={style}>
      <circle cx={RING / 2} cy={RING / 2} r={RADIUS} className="tc-ring__track" strokeWidth={STROKE} />
      <circle
        cx={RING / 2}
        cy={RING / 2}
        r={RADIUS}
        className="tc-ring__arc"
        strokeWidth={STROKE}
        transform={`rotate(-90 ${String(RING / 2)} ${String(RING / 2)})`}
      />
    </svg>
  );
}

/** The number counts up with the ring, once; it is the final figure under reduced motion and in every test. */
function Percent({ value }: { value: number }): JSX.Element {
  const span = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (span.current === null) return undefined;
    return countUp(span.current, value, (shown) => String(Math.floor(shown)), { durationMs: 1000 });
  }, [value]);
  return (
    <span className="tc-hero__pct">
      <span ref={span}>{value}</span>
      <small>%</small>
    </span>
  );
}

/** A slight lean toward the pointer, a mouse only: never on touch (Design, 13/11). */
function lean(event: PointerEvent<HTMLButtonElement>): void {
  if (event.pointerType !== 'mouse') return;
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width - 0.5;
  const y = (event.clientY - box.top) / box.height - 0.5;
  event.currentTarget.style.setProperty('--tc-ry', `${(x * 12).toFixed(1)}deg`);
  event.currentTarget.style.setProperty('--tc-rx', `${(-y * 10).toFixed(1)}deg`);
}

function settle(event: PointerEvent<HTMLButtonElement>): void {
  event.currentTarget.style.removeProperty('--tc-ry');
  event.currentTarget.style.removeProperty('--tc-rx');
}

function Cell({
  item,
  entry,
  size,
  index,
  onOpen,
}: {
  item: TrophyCaseItem;
  entry: TrophyCaseEntry;
  size: number;
  index: number;
  onOpen: (item: TrophyCaseItem) => void;
}): JSX.Element {
  const earned = item.earnedAt !== null;
  const fresh = earned && item.revealedAt === null;
  const percent = percentOf(item.progress, earned);
  let foot: ReactNode;
  if (fresh) foot = <b className="tc-new">Nouveau</b>;
  else if (earned && entry.earnedNote !== undefined)
    foot = <span className="tc-cell__sub">{entry.earnedNote}</span>;
  else if (earned)
    foot = (
      <span className="tc-cell__sub">
        <span className="tc-wide">Gagné le {DATE.format(new Date(item.earnedAt ?? ''))}</span>
        <span className="tc-narrow">Le {SHORT_DATE.format(new Date(item.earnedAt ?? ''))}</span>
      </span>
    );
  else if (percent !== null)
    foot = (
      <>
        <span
          className="tc-bar"
          role="meter"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${entry.name}, ${String(percent)} %`}
        >
          <i style={{ '--tc-p': `${String(percent)}%` }} />
        </span>
        {entry.left === undefined ? null : <span className="tc-cell__sub">{entry.left}</span>}
      </>
    );
  else foot = <span className="tc-cell__sub">{entry.how}</span>;
  return (
    <button
      type="button"
      className="tc-cell"
      data-earned={earned}
      data-fresh={fresh}
      style={{ '--tc-i': index, '--tc-s': `${String(size)}px` }}
      onPointerMove={lean}
      onPointerLeave={settle}
      onClick={() => {
        onOpen(item);
      }}
    >
      <span className="tc-stand" aria-hidden="true">
        <span className="tc-spot" />
        <span className="tc-tilt">{entry.art(size, earned)}</span>
        {earned ? <span className="tc-mirror">{entry.art(size, earned)}</span> : null}
      </span>
      <span className="tc-cell__name">{entry.name}</span>
      {foot}
    </button>
  );
}

export function TrophyCaseView({
  trophyCase,
  entry,
  chips,
  level,
  sound,
  readOnly = false,
  shelfTitles,
  emptyShelves,
  onRevealed,
}: {
  trophyCase: TrophyCase;
  /** The role's words and pieces for an object; `null` hides an object the screen does not know yet. */
  entry: (item: TrophyCaseItem) => TrophyCaseEntry | null;
  /** The figures beside the next trophy, three at most (« Série en cours », « Meilleure série »). */
  chips: readonly { readonly label: string; readonly value: string }[];
  /**
   * The chatter's honorary rank at the head of the case: its insignia and its line, already in words (the rank held,
   * or the first one ahead); the creator has none (ADR 0107 § 4).
   */
  level?: { readonly art: ReactNode; readonly text: string } | null;
  /** The account's « Sons » preference. */
  sound: boolean;
  /** The agency's look at a member's case (ADR 0108 § 19): no entrance, no « Revoir », nothing marked seen. */
  readOnly?: boolean;
  /** A role's own name for a shelf, where the default would say the same word twice (the creator's deliveries). */
  shelfTitles?: Partial<Readonly<Record<ShelfFamily, string>>>;
  /** A shelf kept even with nothing on it, and the words that say why (CHT-17: no tiers set yet). */
  emptyShelves?: Partial<Readonly<Record<ShelfFamily, string>>>;
  /** An owed reveal was played here: its caller marks it seen. */
  onRevealed?: (item: TrophyCaseItem) => void;
}): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState<TrophyCaseItem | null>(null);
  const [playing, setPlaying] = useState<TrophyCaseItem | null>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<ShelfFamily>>(new Set());
  const [still] = useState(() => readOnly || enteredBefore());
  useEffect(() => {
    if (!readOnly) markEntered();
  }, [readOnly]);

  const known = {
    ...trophyCase,
    items: trophyCase.items.filter((item) => onShelf(item) && entry(item) !== null),
  };
  const shelves = shelvesOf(
    known,
    SHELF_ORDER.filter((family) => emptyShelves?.[family] !== undefined),
  );
  const next = nextTrophy(known);
  const nextEntry = next === null ? null : entry(next);
  const total = known.items.length;
  let index = 1;

  const openItem = (item: TrophyCaseItem): void => {
    if (!readOnly && item.earnedAt !== null && item.revealedAt === null) setPlaying(item);
    else setOpen(item);
  };
  const playingEntry = playing === null ? null : entry(playing);
  const openEntry = open === null ? null : entry(open);
  const nextPercent = next === null ? null : percentOf(next.progress, false);

  return (
    <div className="tc" data-still={still}>
      {next !== null && nextEntry !== null ? (
        <section className="tc-hero" aria-labelledby={`${id}-next`} style={{ '--tc-i': 0 }}>
          <div className="tc-hero__object">
            <Ring percent={nextPercent ?? 0} />
            <span className="tc-hero__art">{nextEntry.art(168, false)}</span>
          </div>
          <div className="tc-hero__text">
            <div className="tc-kicker">Prochain trophée</div>
            <h2 id={`${id}-next`} className="tc-hero__name">
              {nextEntry.name}
            </h2>
            {/* An object of one gesture: no figure, how to earn it instead (recette 16/11, CRE-14). */}
            {nextPercent === null ? (
              <p className="tc-hero__left">{nextEntry.how}</p>
            ) : (
              <>
                <Percent value={nextPercent} />
                {nextEntry.left === undefined ? null : <p className="tc-hero__left">{nextEntry.left}</p>}
              </>
            )}
            <ul className="tc-chips">
              <li>
                {earnedCount(known)} sur {total} <b>gagnés</b>
              </li>
              {chips.slice(0, 2).map((chip) => (
                <li key={chip.label}>
                  {chip.label} : <b>{chip.value}</b>
                </li>
              ))}
            </ul>
            {level ? (
              <p className="tc-level">
                <span className="tc-level__art" aria-hidden="true">
                  {level.art}
                </span>
                <span>{level.text}</span>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
      {shelves.map((shelf) => {
        const folded = foldedShelf(shelf);
        const all = unfolded.has(shelf.family);
        return (
          <section key={shelf.family} className="tc-shelf" aria-labelledby={`${id}-${shelf.family}`}>
            <header className="tc-shelf__head" style={{ '--tc-i': index++ }}>
              <h3 className="nv-h2" id={`${id}-${shelf.family}`}>
                {shelfTitles?.[shelf.family] ?? SHELF_TITLES[shelf.family]}
              </h3>
              <span className="tc-shelf__count">
                {shelf.items.length === 0
                  ? null
                  : `${String(shelf.earned)} sur ${String(shelf.items.length)}`}
                {folded.hidden > 0 && !all ? (
                  <button
                    type="button"
                    className="tc-all"
                    onClick={() => {
                      setUnfolded(new Set([...unfolded, shelf.family]));
                    }}
                  >
                    Voir tout
                  </button>
                ) : null}
              </span>
            </header>
            <div className="tc-case" data-all={all}>
              {shelf.items.length === 0 ? (
                <p className="tc-case__empty">{emptyShelves?.[shelf.family]}</p>
              ) : null}
              {shelf.items.map((item) => {
                const one = entry(item);
                if (one === null) return null;
                const extra = !folded.shown.includes(item);
                return (
                  <div key={item.kind} className="tc-place" data-extra={extra}>
                    <Cell item={item} entry={one} size={104} index={index++} onOpen={openItem} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {open !== null && openEntry !== null ? (
        <Dialog
          title={openEntry.name}
          className="tc-detail"
          onClose={() => {
            setOpen(null);
          }}
        >
          <div className="tc-detail__object">{openEntry.art(200, open.earnedAt !== null)}</div>
          <p className="tc-detail__meta">
            {open.earnedAt !== null
              ? (openEntry.earnedNote ?? `Gagné le ${DATE.format(new Date(open.earnedAt))}`)
              : [percentOf(open.progress, false), openEntry.left]
                  .filter((part) => part !== null && part !== undefined)
                  .map((part) => (typeof part === 'number' ? `${String(part)} %` : part))
                  .join(' · ') || 'Pas encore gagné'}
          </p>
          <p className="tc-detail__how">
            <b>Comment il se gagne :</b> {openEntry.how}
          </p>
          {open.earnedAt !== null && !readOnly ? (
            <div className="tc-detail__actions">
              <button
                type="button"
                className="nv-btn nv-btn--neon"
                onClick={() => {
                  setPlaying(open);
                  setOpen(null);
                }}
              >
                Revoir
              </button>
            </div>
          ) : null}
        </Dialog>
      ) : null}
      {playing !== null && playingEntry !== null ? (
        <RewardReveal
          object={playingEntry.art(248, true)}
          kicker={playingEntry.reveal.kicker}
          title={playingEntry.name}
          text={playingEntry.reveal.text}
          tone={playingEntry.reveal.tone}
          sound={sound}
          onClose={() => {
            if (playing.revealedAt === null) onRevealed?.(playing);
            setPlaying(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The case's shapes while it is read: a plate for the next trophy, then a shelf (CHT-18). */
export function TrophyCaseLoading(): JSX.Element {
  return (
    <div className="tc tc-skel" aria-busy="true" aria-label="Chargement de la vitrine">
      <div className="tc-skel__hero">
        <i className="tc-skel__ring" />
        <span>
          <i style={{ '--tc-w': '34%' }} />
          <i style={{ '--tc-w': '62%', '--tc-h': '38px' }} />
          <i style={{ '--tc-w': '22%', '--tc-h': '34px' }} />
        </span>
      </div>
      <i className="tc-skel__shelf" />
    </div>
  );
}

/**
 * A read that failed, whatever the cause (a silent server, a refusal, an answer of another shape): said in neutral
 * words, with a retry, never an empty case that would lie (CHT-18; Design, 16/11).
 */
export function TrophyCaseDown({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div className="tc-down" role="alert">
      <p>Ta vitrine n’a pas pu être lue.</p>
      <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onRetry}>
        Réessayer
      </button>
    </div>
  );
}
