import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { LevelInsignia } from './LevelInsignia';
import { playChime } from './chime';
import { playForge } from './forge-sound';
import './rewards.css';

/*
 * The reveal of something earned (ADR 0104 § 12 and § 19, note « médailles »): the object turns into the light,
 * rays and sparks, then its name. It settles in about two seconds and stays, a still picture, until the member
 * closes it (« Continuer », a tap anywhere, Échap). Everything it says is written in it: with « réduire les
 * animations » it is that still picture at once. The same component reveals a tier's medal, a trophy's badge, and
 * the creator's badges: the object, the words and the sound are its caller's.
 */

/*
 * The embers a rank's forge gathers before it lights: from a wide ring into the medallion's heart. Fixed, like the
 * sparks.
 */
const EMBERS = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2 + ((index * 23) % 7) / 14;
  const reach = 230 + ((index * 31) % 9) * 10;
  return {
    x: Math.round(Math.cos(angle) * reach),
    y: Math.round(Math.sin(angle) * reach),
    // Its trail points away from the heart it flies to.
    turn: Math.round((angle * 180) / Math.PI),
    size: 6 + ((index * 17) % 4) * 2,
    delay: 120 + ((index * 43) % 16) * 30,
  };
});

/** Where each spark flies: a fixed ring, so the reveal is the same every time and in every test. */
const SPARKS = Array.from({ length: 28 }, (_, index) => {
  const angle = (index / 28) * Math.PI * 2 + ((index * 37) % 10) / 30;
  const reach = 140 + ((index * 53) % 17) * 10;
  return {
    x: Math.round(Math.cos(angle) * reach),
    y: Math.round(Math.sin(angle) * reach),
    size: 3 + ((index * 29) % 6),
    delay: 200 + ((index * 41) % 20) * 10,
    diamond: index % 3 === 0,
  };
});

export interface RevealAlso {
  readonly key: string;
  readonly object: ReactNode;
  readonly name: string;
}

/** « Aussi gagné : Record du jour, Première vente et 2 autres. », for a screen reader, after the reveal's own words. */
export function alsoSentence(names: readonly string[], more: number): string {
  const tail = more === 0 ? [] : [more === 1 ? '1 autre' : `${String(more)} autres`];
  const all = [...names, ...tail];
  const last = all.at(-1) ?? '';
  return `Aussi gagné : ${all.length < 2 ? last : `${all.slice(0, -1).join(', ')} et ${last}`}.`;
}

export function RewardReveal({
  object,
  kicker,
  title,
  text,
  chip,
  tone = 'gold',
  also = [],
  more = 0,
  forge,
  sound,
  onClose,
}: {
  /** What was earned, drawn large: a `Medal` or a `TrophyBadge`. */
  object: ReactNode;
  /** « Palier atteint », « Trophée gagné ». */
  kicker: string;
  title: string;
  text: string;
  /** One fact beside it, already worked out elsewhere (a tier's bonus as the statement gives it). */
  chip?: string;
  /** The light behind the object: gold for a medal, neon for a badge. */
  tone?: 'gold' | 'neon';
  /** What else was earned since the last visit, small and by name, with no ceremony of its own: three at most. */
  also?: readonly RevealAlso[];
  /** How many more were earned beyond `also`: « +2 ». */
  more?: number;
  /**
   * A rank, when the object is that rank's insignia: it is forged instead of turned over. The cold medallion first,
   * embers gather into it, it lights, then the usual light and sparks.
   */
  forge?: number;
  /** Whether the chime plays: the account's « Sons » preference, its caller's to read. */
  sound: boolean;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    button.current?.focus({ preventScroll: true });
    return () => {
      opener?.focus();
    };
  }, []);

  const forged = forge !== undefined;
  useEffect(() => {
    if (!sound) return undefined;
    return forged ? playForge() : playChime();
  }, [sound, forged]);

  // The one thing to reach is « Continuer »: Tab stays on it instead of walking the page behind, and Échap closes
  // wherever the focus went (a click on the stage takes it off the button).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        button.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
    <div
      className="rw-reveal"
      data-tone={tone}
      data-forge={forge !== undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}t`}
      aria-describedby={also.length === 0 ? `${id}d` : `${id}d ${id}a`}
      onClick={onClose}
    >
      <div className="rw-reveal__card">
        <div className="rw-reveal__object">
          <i className="rw-reveal__halo" aria-hidden="true" />
          <i className="rw-reveal__rays" aria-hidden="true" />
          <i className="rw-reveal__ring" aria-hidden="true" />
          <i className="rw-reveal__ring" data-late="true" aria-hidden="true" />
          {forge === undefined ? null : (
            <>
              <div className="rw-reveal__art rw-forge__cold" aria-hidden="true">
                <LevelInsignia rank={forge} earned={false} size={220} />
              </div>
              <i className="rw-forge__core" aria-hidden="true" />
              {EMBERS.map((ember, index) => (
                <i
                  key={index}
                  className="rw-forge__ember"
                  aria-hidden="true"
                  style={{
                    '--_x': `${String(ember.x)}px`,
                    '--_y': `${String(ember.y)}px`,
                    '--_s': `${String(ember.size)}px`,
                    '--_a': `${String(ember.turn)}deg`,
                    '--_d': `${String(ember.delay)}ms`,
                  }}
                />
              ))}
            </>
          )}
          <div className="rw-reveal__art">{object}</div>
          {forge === undefined ? null : <i className="rw-forge__flash" aria-hidden="true" />}
          {SPARKS.map((spark, index) => (
            <i
              key={index}
              className="rw-reveal__spark"
              data-diamond={spark.diamond}
              aria-hidden="true"
              style={{
                '--_x': `${String(spark.x)}px`,
                '--_y': `${String(spark.y)}px`,
                '--_s': `${String(spark.size)}px`,
                '--_d': `${String(spark.delay)}ms`,
              }}
            />
          ))}
        </div>
        <p className="rw-reveal__kicker">{kicker}</p>
        <h2 className="rw-reveal__title" id={`${id}t`}>
          {title}
        </h2>
        <i className="rw-reveal__rule" aria-hidden="true" />
        <p className="rw-reveal__text" id={`${id}d`}>
          {text}
        </p>
        {chip === undefined ? null : <p className="rw-reveal__chip nv-num">{chip}</p>}
        {also.length === 0 ? null : (
          <div className="rw-reveal__also">
            <p className="rw-reveal__alsosaid" id={`${id}a`}>
              {alsoSentence(
                also.map((one) => one.name),
                more,
              )}
            </p>
            <p className="nv-eyebrow rw-reveal__alsohead" aria-hidden="true">
              Aussi gagné
            </p>
            <ul className="rw-reveal__alsolist" aria-hidden="true">
              {also.map((one, index) => (
                <li
                  key={one.key}
                  className="rw-reveal__alsoitem"
                  title={one.name}
                  style={{ '--nv-i': index }}
                >
                  <span className="rw-reveal__alsoobject">{one.object}</span>
                  <span className="rw-reveal__alsoname">{one.name}</span>
                </li>
              ))}
              {more === 0 ? null : (
                <li className="rw-reveal__alsoitem" style={{ '--nv-i': also.length }}>
                  <span className="rw-reveal__alsoobject nv-num" data-more="true">
                    +{more}
                  </span>
                  <span className="rw-reveal__alsoname">{more === 1 ? 'autre' : 'autres'}</span>
                </li>
              )}
            </ul>
          </div>
        )}
        <button ref={button} type="button" className="rw-reveal__close" onClick={onClose}>
          Continuer
        </button>
      </div>
    </div>,
    document.body,
  );
}
