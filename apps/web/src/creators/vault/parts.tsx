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
              <Sharp creatorId={creatorId} media={media} />
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
        {media.kind === 'audio' || media.removed ? null : (
          <p className="vx-note">Image lue dans Reveal à l’instant, jamais gardée par Impera.</p>
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
export function Sharp({
  creatorId,
  media,
}: {
  creatorId: CreatorId;
  media: VaultMediaView;
}): JSX.Element | null {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
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
      }}
      onError={() => {
        setState('failed');
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

/** The vault's picture, when nothing of hers is in Impera yet: a chest, three media rising out of it, a spark. */
export function VaultArt(): JSX.Element {
  return (
    <svg className="vp-art" viewBox="0 0 120 96" aria-hidden="true">
      <defs>
        <linearGradient id="vp-art-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--nv-neon)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--nv-neon)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="vp-art__glow" d="M30 56 L60 14 L90 56 Z" fill="url(#vp-art-glow)" />
      <g>
        <rect className="vp-art__card vp-art__card--a" x="34" y="26" width="18" height="24" rx="4" />
        <rect className="vp-art__card vp-art__card--b" x="51" y="16" width="18" height="24" rx="4" />
        <rect className="vp-art__card vp-art__card--c" x="68" y="26" width="18" height="24" rx="4" />
      </g>
      <path
        className="vp-art__spark"
        d="M60 4c.5 3 1.5 4 4.5 4.5-3 .5-4 1.5-4.5 4.5-.5-3-1.5-4-4.5-4.5 3-.5 4-1.5 4.5-4.5Z"
      />
      <path className="vp-art__lid" d="M24 52h72l-6-8H30Z" />
      <rect className="vp-art__chest" x="24" y="52" width="72" height="34" rx="6" />
      <path className="vp-art__band" d="M24 64h72" />
      <rect className="vp-art__lock" x="55" y="60" width="10" height="9" rx="2.5" />
    </svg>
  );
}
