import type { ReelBrief as ReelSheet } from '@impera/contracts';
import type { CSSProperties, JSX, ReactNode } from 'react';

import { REEL_ZONES } from './reel-zones';
import './reel-brief.css';

/** « ≈ 20 s », « ≈ 1 min 30 »: how long the reel lasts. */
export function reelLength(seconds: number): string {
  if (seconds < 60) return `≈ ${String(seconds)} s`;
  const rest = seconds % 60;
  return rest === 0
    ? `≈ ${String(seconds / 60)} min`
    : `≈ ${String(Math.floor(seconds / 60))} min ${String(rest)}`;
}

/** « ≈ 7 s » a shot: the reel's length shared evenly, never under a second. */
export function shotLength(seconds: number, shots: number): string {
  return `≈ ${String(Math.max(1, Math.round(seconds / Math.max(1, shots))))} s`;
}

/** What the phone shows, for a reader who does not see it. */
export function frameDescription(onScreen: string | null): string {
  const text =
    onScreen === null
      ? 'Pas de texte à l’écran.'
      : `Ton texte « ${onScreen} » au milieu de l’image, là où rien ne le recouvre.`;
  return `Aperçu de ton reel sur un téléphone. ${text} Les boutons à droite, ta légende en bas et le titre en haut recouvrent le reste.`;
}

/** The clear part of the screen, in percentages: what the app's buttons and texts never cover. */
const clearZone: CSSProperties = {
  top: `${String(REEL_ZONES.top * 100)}%`,
  bottom: `${String(REEL_ZONES.bottom * 100)}%`,
  left: '4%',
  right: `${String(REEL_ZONES.right * 100)}%`,
};

/* Drawn icons, generic outlines: the gestures of a reel, never a brand's mark. */
const ICONS = {
  heart: 'M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z',
  comment: 'M20 11.6a8 8 0 0 1-11.8 7l-4.2 1.2 1.2-4A8 8 0 1 1 20 11.6Z',
  send: 'M21 3.5 3.5 10.3l7 2.6 2.6 7L21 3.5Zm-10.5 9.4L21 3.5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  camera:
    'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8ZM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
  note: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  home: 'M4 11 12 4l8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5V11Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4',
  add: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm7 4v8m-4-4h8',
  reels:
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm-1 4.5h16M9 4l2.5 4.5M14.5 4 17 8.5M10.5 11.5v5l4.2-2.5-4.2-2.5Z',
} as const;

function Icon({ name }: { name: keyof typeof ICONS }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

/**
 * Her reel as her followers will see it on a phone: the title at the top, the buttons on the right, her name, her
 * caption and the sound at the bottom, the app's bar under it. Her text on screen sits in the part nothing covers,
 * outlined. Drawn with generic shapes and placeholder counts, never a brand's mark (ADR 0082 § 3).
 */
function Phone({ onScreen }: { onScreen: string | null }): JSX.Element {
  return (
    <div className="ag-phone" role="img" aria-label={frameDescription(onScreen)}>
      <div className="ag-phone__screen" aria-hidden="true">
        <div className="ag-phone__video" />
        <div className="ag-phone__top">
          <span className="ag-phone__title">Reels</span>
          <Icon name="camera" />
        </div>
        <div className="ag-phone__clear" style={clearZone}>
          {onScreen === null ? null : <span className="ag-phone__text">{onScreen}</span>}
        </div>
        <div className="ag-phone__rail">
          <span className="ag-phone__action">
            <Icon name="heart" />
            <small>1 204</small>
          </span>
          <span className="ag-phone__action">
            <Icon name="comment" />
            <small>58</small>
          </span>
          <span className="ag-phone__action">
            <Icon name="send" />
            <small>31</small>
          </span>
          <span className="ag-phone__action">
            <Icon name="more" />
          </span>
          <span className="ag-phone__disc" />
        </div>
        <div className="ag-phone__bottom">
          <div className="ag-phone__who">
            <span className="ag-phone__avatar" />
            <span className="ag-phone__name">toi</span>
            <span className="ag-phone__follow">Suivre</span>
          </div>
          <p className="ag-phone__legend">
            Ta légende s’affiche ici… <span className="ag-phone__plus">plus</span>
          </p>
          <p className="ag-phone__sound">
            <Icon name="note" />
            Son original
          </p>
        </div>
        <div className="ag-phone__nav">
          <Icon name="home" />
          <Icon name="search" />
          <Icon name="add" />
          <Icon name="reels" />
          <span className="ag-phone__me" />
        </div>
      </div>
    </div>
  );
}

/** One step of her sheet: its number, what to do, then what. */
function Step({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <li className="ag-reel__step">
      <span className="ag-reel__n nv-num" aria-hidden="true">
        {n}
      </span>
      <section className="ag-reel__what" aria-label={title}>
        <h4 className="ag-reel__title">
          {title}
          {aside === undefined ? null : <span className="ag-reel__aside nv-num">{aside}</span>}
        </h4>
        {children}
      </section>
    </li>
  );
}

/**
 * Her reel sheet (ADR 0082 § 3, VEI-08), in the order she shoots it: what she says first, what she films, how she
 * ends, the text she adds; and beside it her reel as her followers will see it on a phone. The same component on her
 * phone and in the agency's preview, so that what the agency writes is exactly what she sees. Her words only: never
 * the agency's.
 */
export function ReelBrief({ brief }: { brief: ReelSheet }): JSX.Element {
  const shots = brief.shots.length;
  // Each step its number, counted over the steps written: the end and the text on screen may be left out.
  const endingStep = 3;
  const onScreenStep = brief.ending === null ? 3 : 4;
  return (
    <div className="ag-reel">
      <p className="ag-reel__sum">
        <span className="ag-reel__chip nv-num">{reelLength(brief.seconds)}</span>
        <span className="ag-reel__chip">{shots} plans</span>
        <span className="ag-reel__chip">Vertical, plein écran</span>
      </p>
      <div className="ag-reel__body">
        <ol className="ag-reel__steps">
          <Step n={1} title="Commence par dire">
            <q className="ag-reel__quote">{brief.hook}</q>
          </Step>
          <Step n={2} title="Puis filme, dans l’ordre" aside={`${shotLength(brief.seconds, shots)} chacun`}>
            <ol className="ag-reel__shots">
              {brief.shots.map((shot, index) => (
                // Lines of one sheet, never reordered while shown: their place is their key.
                <li key={index} className="ag-reel__shot">
                  <span className="ag-reel__dot" aria-hidden="true" />
                  <span>{shot}</span>
                </li>
              ))}
            </ol>
          </Step>
          {brief.ending === null ? null : (
            <Step n={endingStep} title="Termine par">
              <p className="ag-reel__line">{brief.ending}</p>
            </Step>
          )}
          {brief.onScreen === null ? null : (
            <Step n={onScreenStep} title="Ajoute ce texte à l’écran">
              <p className="ag-reel__line">
                <span className="ag-reel__overlay">{brief.onScreen}</span>
              </p>
              <p className="ag-reel__help">Au milieu de l’image, comme sur l’aperçu : rien ne le cache.</p>
            </Step>
          )}
        </ol>
        <figure className="ag-reel__figure">
          <Phone onScreen={brief.onScreen} />
          <figcaption className="ag-reel__help">Ce que verront tes abonnés</figcaption>
        </figure>
      </div>
    </div>
  );
}
