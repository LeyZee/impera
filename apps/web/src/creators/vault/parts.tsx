import type { CreatorId, VaultMediaView } from '@impera/contracts';
import { useEffect, useState, type JSX } from 'react';

import { vaultPreviewUrl } from './api';
import { descriptionLine, type MediaChoice } from './choice';
import { durationLine, mediaKindLine, suggestedLine, uploadedLine, waveOf } from './model';
import { previewOf } from './preview';

import { Dialog } from '@/shell/Dialog';

/*
 * The pieces of her vault's screen: a media's sheet, its pictures (the platform's blur, the sharp small one read on a
 * gesture), a voice note's drawn wave, and the icons.
 */

/**
 * One media's sheet, over the page (the app's own `Dialog`: a sheet from the bottom on a phone, a panel on a computer):
 * its sharp small picture, what it is, when it came, Reveal's own text and range, and the way to the one before or after
 * (the arrows of the keyboard too).
 */
export function MediaSheet({
  creatorId,
  media,
  rank,
  count,
  choice,
  onStep,
  onClose,
}: {
  creatorId: CreatorId;
  media: VaultMediaView;
  rank: number;
  count: number;
  /** Imported or not, and its description (ADR 0145 § 5). */
  choice: MediaChoice;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') onStep(-1);
      if (event.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onStep]);
  const described = descriptionLine(choice);
  // What became of the sharp picture of this media: the note says it was read only once it was (PRO1-10).
  const [sharp, setSharp] = useState<{ readonly id: string; readonly state: SharpState } | null>(null);
  const sharpState = sharp?.id === media.platformMediaId ? sharp.state : 'loading';

  return (
    <Dialog
      title={mediaKindLine(media)}
      lead={uploadedLine(media.uploadedAt)}
      className="vx-dialog"
      onClose={onClose}
    >
      <div className="vx-sheet">
        <div
          key={media.platformMediaId}
          className={`vx-sheet__preview vx-tile--${media.kind}${media.removed ? ' vx-tile--removed' : ''}`}
        >
          {media.kind === 'audio' ? (
            <VoiceFace seed={media.platformMediaId} bars={28} />
          ) : (
            <>
              <Preview hash={media.blurhash} />
              <Sharp
                creatorId={creatorId}
                media={media}
                onState={(state) => {
                  setSharp({ id: media.platformMediaId, state });
                }}
              />
            </>
          )}
          {media.kind !== 'image' && media.durationSeconds !== null ? (
            <span className="vx-tile__time nv-num" aria-hidden="true">
              {durationLine(media.durationSeconds)}
            </span>
          ) : null}
          {media.removed ? (
            <span className="vx-tile__gone" aria-hidden="true">
              <GoneIcon />
              Retiré
            </span>
          ) : null}
        </div>
        <div className="vx-sheet__steps">
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm vx-sheet__step"
            aria-label="Média précédent"
            disabled={rank <= 1}
            onClick={() => {
              onStep(-1);
            }}
          >
            <span className="vx-sheet__back" aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
          <span className="ps-muted nv-num">
            {rank} sur {count}
          </span>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm vx-sheet__step"
            aria-label="Média suivant"
            disabled={rank >= count}
            onClick={() => {
              onStep(1);
            }}
          >
            <span aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
        </div>
        {media.removed ? (
          <p className="vx-sheet__gone">Retiré de Reveal : gardé ici avec ses descriptions.</p>
        ) : null}
        <dl className="vx-sheet__facts">
          <div className="vx-sheet__fact">
            <dt className="nv-eyebrow">Dans Impera</dt>
            <dd className="vx-sheet__state">
              <span className={`vp-badge${choice.imported ? ' vp-badge--in' : ''}`}>
                {choice.imported ? <CheckIcon /> : null}
                {choice.imported ? 'Importé' : 'Non importé'}
              </span>
              {choice.description === 'described' ? (
                <span className="vp-badge vp-badge--described">
                  <SparkIcon />
                  Décrit
                </span>
              ) : (
                <span className={`vx-sheet__said vx-sheet__said--${described.tone}`}>{described.text}</span>
              )}
            </dd>
          </div>
          {choice.description === 'described' && choice.excerpt !== null ? (
            <div className="vx-sheet__fact">
              <dt className="nv-eyebrow">Sa description, pour l’IA</dt>
              <dd className="vx-sheet__excerpt">{choice.excerpt}</dd>
            </div>
          ) : null}
          <div className="vx-sheet__fact">
            <dt className="nv-eyebrow">Texte de Reveal</dt>
            <dd>{media.platformDescription ?? <span className="ps-muted">Aucun texte dans Reveal.</span>}</dd>
          </div>
          {media.suggestedPriceMinor === null ? null : (
            <div className="vx-sheet__fact">
              <dt className="nv-eyebrow">Prix suggéré par Reveal</dt>
              <dd className="nv-num">{suggestedLine(media.suggestedPriceMinor)}</dd>
            </div>
          )}
        </dl>
        {media.kind === 'audio' || media.removed || sharpState === 'loading' ? null : (
          <p className="vx-note">
            {sharpState === 'shown'
              ? 'Image lue dans Reveal à l’instant, jamais gardée par Impera.'
              : 'Aperçu indisponible : sa session Reveal n’est pas lisible.'}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** A voice note's face: the theme's surface and a drawn wave (`waveOf`), never a grey blur that reads as disabled. */
export function VoiceFace({ seed, bars }: { seed: string; bars: number }): JSX.Element {
  const wave = waveOf(seed, bars);
  return (
    <span className="vx-voice" aria-hidden="true">
      <svg className="vx-voice__wave" viewBox={`0 0 ${String(bars * 4)} 20`} preserveAspectRatio="none">
        {wave.map((height, at) => (
          <rect
            key={at}
            x={at * 4 + 1}
            y={10 - height * 9}
            width="2"
            height={height * 18}
            rx="1"
            style={{ animationDelay: `${String(at * 40)}ms` }}
          />
        ))}
      </svg>
    </span>
  );
}

/**
 * The sharp small picture over the blurred one (ADR 0138), faded in once loaded; on any failure it stays hidden and
 * the blur shows. Never for a voice note nor a media Reveal removed: there is no picture to read.
 */
type SharpState = 'loading' | 'shown' | 'failed';

export function Sharp({
  creatorId,
  media,
  onState,
}: {
  creatorId: CreatorId;
  media: VaultMediaView;
  /** Told once the picture is read or failed. */
  onState?: (state: SharpState) => void;
}): JSX.Element | null {
  const [state, setState] = useState<SharpState>('loading');
  if (media.kind === 'audio' || media.removed || state === 'failed') return null;
  return (
    <img
      className="vx-sharp"
      data-state={state}
      src={vaultPreviewUrl(creatorId, media.platformMediaId)}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      onLoad={() => {
        setState('shown');
        onState?.('shown');
      }}
      onError={() => {
        setState('failed');
        onState?.('failed');
      }}
    />
  );
}

/** The platform's blurred preview, or the kind's own colour when it gave none. */
export function Preview({ hash }: { hash: string | null }): JSX.Element {
  const src = hash === null ? null : previewOf(hash);
  return src === null ? (
    <span className="vx-preview vx-preview--none" aria-hidden="true" />
  ) : (
    <img className="vx-preview" src={src} alt="" aria-hidden="true" draggable={false} />
  );
}

export function EyeIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className="vx-eye" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8Z" />
      {open ? <path d="m2.5 13.5 11-11" /> : <circle cx="8" cy="8" r="1.9" />}
    </svg>
  );
}

export function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

/** No longer in Reveal: a cloud struck through. */
export function GoneIcon(): JSX.Element {
  return (
    <svg className="vx-gone" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.6 12.2h6.6a2.8 2.8 0 0 0 .5-5.6 4 4 0 0 0-7.6-.9A3.3 3.3 0 0 0 4.6 12.2Z" />
      <path d="m2.5 2.5 11 11" />
    </svg>
  );
}

export function SyncIcon(): JSX.Element {
  return (
    <svg className="vx-sync__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 6.5A5.2 5.2 0 0 0 3.6 5M3 9.5a5.2 5.2 0 0 0 9.4 1.5" />
      <path d="M3.3 2.6 3.6 5l2.4-.3M12.7 13.4l-.3-2.4-2.4.3" />
    </svg>
  );
}

export function CheckIcon(): JSX.Element {
  return (
    <svg className="vp-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8.4 3 3 6-6.8" />
    </svg>
  );
}

/** The AI's mark: a spark of four points, the agent's colour wherever it describes. */
export function SparkIcon(): JSX.Element {
  return (
    <svg className="vp-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8c.4 2.9 1.4 3.9 4.3 4.3-2.9.4-3.9 1.4-4.3 4.3-.4-2.9-1.4-3.9-4.3-4.3C6.6 5.7 7.6 4.7 8 1.8Z" />
      <path d="M12.6 10.2c.2 1.3.6 1.7 1.9 1.9-1.3.2-1.7.6-1.9 1.9-.2-1.3-.6-1.7-1.9-1.9 1.3-.2 1.7-.6 1.9-1.9Z" />
    </svg>
  );
}

export function SelectIcon(): JSX.Element {
  return (
    <svg className="vp-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.2" />
      <path d="m5.2 8.2 2 2 3.8-4.2" />
    </svg>
  );
}

export function CloseIcon(): JSX.Element {
  return (
    <svg className="vp-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

/** One photo rising out of the chest: a little picture of a sun over hills, framed white, tilted by `turn`. */
function ArtPhoto({
  x,
  y,
  turn,
  tone,
}: {
  x: number;
  y: number;
  turn: number;
  tone: 'a' | 'b' | 'c';
}): JSX.Element {
  return (
    <g transform={`translate(${String(x)} ${String(y)}) rotate(${String(turn)} 13 34)`}>
      <g className={`vp-art__photo vp-art__photo--${tone}`}>
        <rect className="vp-art__frame" x="0" y="0" width="26" height="32" rx="4" />
        <rect className={`vp-art__sky vp-art__sky--${tone}`} x="3" y="3" width="20" height="21" rx="2.5" />
        <circle className="vp-art__sun" cx={tone === 'b' ? 15 : 9} cy="9" r="3.2" />
        <path className="vp-art__hill" d="M3 21.5c3.5-4.5 6.5-5 9.5-2s5-3.5 10.5-1.5V24H3Z" />
      </g>
    </g>
  );
}

/** A four-pointed spark, the glint of something precious. */
const artSpark = (x: number, y: number, size: number): string =>
  `M${String(x)} ${String(y - size)}c${String(size * 0.18)} ${String(size * 0.62)} ${String(size * 0.2)} ${String(size * 0.8)} ${String(size)} ${String(size)}c-${String(size * 0.8)} ${String(size * 0.2)}-${String(size * 0.82)} ${String(size * 0.38)}-${String(size)} ${String(size)}c-${String(size * 0.18)}-${String(size * 0.62)}-${String(size * 0.2)}-${String(size * 0.8)}-${String(size)}-${String(size)}c${String(size * 0.8)}-${String(size * 0.2)} ${String(size * 0.82)}-${String(size * 0.38)} ${String(size)}-${String(size)}Z`;

/**
 * The vault's picture, when nothing of hers is in Impera yet: her chest thrown open, a light from inside, three of her
 * photos rising out of it, a few glints. Drawn in the theme's colours, so it reads by day as by night.
 */
export function VaultArt(): JSX.Element {
  return (
    <svg className="vp-art" viewBox="0 0 160 132" aria-hidden="true">
      <defs>
        <radialGradient id="vp-art-light" cx="0.5" cy="0.62" r="0.5">
          <stop className="vp-art__stop-light" offset="0" />
          <stop className="vp-art__stop-clear" offset="1" />
        </radialGradient>
        <linearGradient id="vp-art-body" x1="0" y1="0" x2="0" y2="1">
          <stop className="vp-art__stop-body-top" offset="0" />
          <stop className="vp-art__stop-body-bottom" offset="1" />
        </linearGradient>
        <linearGradient id="vp-art-lid" x1="0" y1="1" x2="0" y2="0">
          <stop className="vp-art__stop-lid-bottom" offset="0" />
          <stop className="vp-art__stop-lid-top" offset="1" />
        </linearGradient>
        <linearGradient id="vp-art-ray" x1="0" y1="1" x2="0" y2="0">
          <stop className="vp-art__stop-ray" offset="0" />
          <stop className="vp-art__stop-clear" offset="1" />
        </linearGradient>
        <linearGradient id="vp-art-inside" x1="0" y1="0" x2="0" y2="1">
          <stop className="vp-art__stop-inside-top" offset="0" />
          <stop className="vp-art__stop-inside-bottom" offset="1" />
        </linearGradient>
      </defs>
      <ellipse className="vp-art__ground" cx="80" cy="122" rx="54" ry="5" />
      {/* The lid, thrown back: its inside seen, wider at the top, lit from the chest. */}
      <path className="vp-art__lid" d="M34 68 L24 30 Q22 22 30 22 H130 Q138 22 136 30 L126 68 Z" />
      <path
        className="vp-art__lid-inside"
        d="M39 66 L31 33 Q30 28 35 28 H125 Q130 28 129 33 L121 66 Z"
        fill="url(#vp-art-lid)"
      />
      {/* Rays out of the opening. */}
      <path
        className="vp-art__rays"
        d="M80 70 L44 8 L58 6 Z M80 70 L74 2 L86 2 Z M80 70 L102 6 L116 8 Z"
        fill="url(#vp-art-ray)"
      />
      {/* The light from inside, and the opening it comes out of. */}
      <ellipse className="vp-art__light" cx="80" cy="58" rx="64" ry="50" fill="url(#vp-art-light)" />
      <path className="vp-art__inside" d="M30 66 H130 L126 76 H34 Z" fill="url(#vp-art-inside)" />
      <g className="vp-art__photos">
        <ArtPhoto x={42} y={36} turn={-18} tone="a" />
        <ArtPhoto x={92} y={36} turn={16} tone="c" />
        <ArtPhoto x={67} y={24} turn={0} tone="b" />
      </g>
      {/* The chest's front, drawn over the photos' feet. */}
      <path
        className="vp-art__body"
        d="M30 74 H130 V108 Q130 118 120 118 H40 Q30 118 30 108 Z"
        fill="url(#vp-art-body)"
      />
      <rect className="vp-art__rim" x="26" y="68" width="108" height="10" rx="5" />
      <path className="vp-art__strap" d="M52 78 V118 M108 78 V118" />
      <path className="vp-art__lock" d="M72 84 H88 V96 Q88 103 80 106 Q72 103 72 96 Z" />
      <circle className="vp-art__keyhole" cx="80" cy="92" r="2.2" />
      <path className="vp-art__keyhole" d="M79 93 H81 L81.6 98 H78.4 Z" />
      <path className="vp-art__spark vp-art__spark--a" d={artSpark(140, 52, 4.4)} />
      <path className="vp-art__spark vp-art__spark--b" d={artSpark(146, 16, 3.4)} />
      <path className="vp-art__spark vp-art__spark--c" d={artSpark(16, 44, 3.6)} />
    </svg>
  );
}
